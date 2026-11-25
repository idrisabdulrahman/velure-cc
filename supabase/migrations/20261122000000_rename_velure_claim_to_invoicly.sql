-- Invoicly rename (2026-11-22): the tenant JWT claim.
--
-- The app was renamed Velure → Invoicly. The tenant claim `velure_user_id` —
-- set by the A9 custom access token hook (20260815223943) and by the app's
-- own bridge mint (`src/server/supabase-session.ts`) — becomes
-- `invoicly_user_id`. Every RLS policy resolves the tenant through
-- `app.current_user_id()`, so this migration plus the server deploy rename
-- the tenancy key without touching a single policy.
--
-- TRANSITION SAFETY (the two sides cannot deploy atomically):
--   * The hook now sets BOTH claims, and the bridge mint emits both while the
--     transition is live (the legacy `velure_user_id` emission is removed in
--     a later cleanup migration once verified).
--   * `app.current_user_id()` reads `invoicly_user_id` first, falling back to
--     the legacy claim, then `sub` (the A9 fallback for password-flow users).
--     Any combination of pre/post-deploy server and database therefore
--     resolves the same Better Auth user id.
--
-- REVERSIBLE: to roll back, recreate the previous bodies of both functions
-- (verbatim in 20260815223943) — the legacy claim is still being written by
-- the hook and the bridge until the cleanup migration, so a rollback loses
-- nothing.

-- 1. The custom access token hook: now sets both claim names.
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

  -- The Better Auth user id for OIDC sign-ins through custom:velure (the
  -- provider identifier itself is registered in the Supabase Auth dashboard
  -- and stays unchanged — renaming it requires a dashboard change that must
  -- not race sign-in traffic).
  select identities.provider_id into provider_sub
  from auth.identities as identities
  where identities.user_id = uid::uuid
    and identities.provider = 'custom:velure'
  limit 1;

  if provider_sub is not null then
    claims := jsonb_set(claims, '{invoicly_user_id}', to_jsonb(provider_sub));
    claims := jsonb_set(claims, '{velure_user_id}', to_jsonb(provider_sub));
  end if;

  return jsonb_build_object('claims', claims);
end;
$$;

revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- 2. The tenant resolver reads the new claim first, with the legacy claim and
--    then sub as fallbacks — identical resolution to before the rename.
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
        auth.jwt() ->> 'velure_user_id',
        auth.jwt() ->> 'sub'
      )
    ),
    ''
  );
$$;

revoke all on function app.current_user_id() from public;
grant execute on function app.current_user_id() to authenticated;
