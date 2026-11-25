-- Invoicly cleanup (2026-11-25): retire the transitional Velure identifiers.
--
-- The rename (20261122000000) kept two things live only so the code and the
-- database could deploy separately:
--   * the access-token hook set BOTH `invoicly_user_id` and the legacy
--     `velure_user_id`, and `app.current_user_id()` read the new claim first,
--     falling back to the legacy claim and then `sub`; and
--   * the bridge mint (`src/server/supabase-session.ts`) emitted both claims.
--
-- Both sides have run new-first long enough that the legacy fallback is never
-- exercised, so this migration removes it. The claim the resolver reads
-- (`invoicly_user_id`) is unchanged, so no RLS policy moves.
--
-- REVERSIBLE: recreate the previous bodies (verbatim in 20261122000000) to
-- restore the both-claim write and the legacy fallback. The bridge mint also
-- stops emitting `velure_user_id` in the same deploy, but the token still
-- carries `invoicly_user_id`, so resolution is unaffected either way.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  uid text := event ->> 'user_id';
  provider_sub text;
  claims jsonb := event -> 'claims';
begin
  if uid is null or uid = '' then
    return jsonb_build_object('claims', claims);
  end if;

  -- The Better Auth user id for OIDC sign-ins through custom:velure. That
  -- provider identifier is registered in the Supabase Auth dashboard and is
  -- deliberately unchanged by this cleanup.
  select identities.provider_id into provider_sub
  from auth.identities as identities
  where identities.user_id = uid::uuid
    and identities.provider = 'custom:velure'
  limit 1;

  if provider_sub is not null then
    claims := jsonb_set(claims, '{invoicly_user_id}', to_jsonb(provider_sub));
  end if;

  return jsonb_build_object('claims', claims);
end;
$$;

revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- The tenant resolver now reads the new claim and the A9 `sub` fallback only.
create or replace function app.current_user_id()
returns text
language sql
stable
set search_path = pg_catalog, auth
as $$
  select nullif(
    btrim(
      coalesce(
        auth.jwt() ->> 'invoicly_user_id',
        auth.jwt() ->> 'sub'
      )
    ),
    ''
  );
$$;

revoke all on function app.current_user_id() from public;
grant execute on function app.current_user_id() to authenticated;

-- Drop the legacy scheduler Vault keys. `invoke_scheduler_tick()`
-- (20261122000001) reads only `invoicly_scheduler_url` /
-- `invoicly_scheduler_secret`, and the cron job was renamed
-- `invoicly-scheduler-tick` on 2026-11-22, so nothing reads the old names.
-- Idempotent: a fresh database with no legacy keys is a no-op.
delete from vault.secrets
 where name in ('velure_scheduler_url', 'velure_scheduler_secret');
