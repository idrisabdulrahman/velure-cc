-- Velure Phase A9: identity sub-claim hook.
--
-- Live proof (2026-08-15, scripts/bridge-proof/README.md) established that
-- when a user signs in through Supabase's custom OIDC provider, GoTrue mints
-- its own UUID as the JWT `sub`; the Better Auth user id (the value the app
-- stores in owner_id / user_id) lives in auth.identities.provider_id, not in
-- `sub`. This migration closes that gap:
--
--   1. public.custom_access_token_hook(jsonb) - the Supabase custom access
--      token hook. Runs at token issuance; when the user has a
--      `custom:velure` identity it copies the Better Auth user id into the
--      JWT as the `velure_user_id` claim. Users without the OIDC identity
--      (e.g. password-flow accounts) are untouched.
--   2. app.current_user_id() now prefers the `velure_user_id` claim and
--      falls back to `sub`, so RLS policies built on the A4 helpers resolve
--      the Better Auth id for OIDC sign-ins while password-flow users keep
--      working.
--
-- The hook is a database hook invoked by Supabase Auth (the auth server looks
-- up public.custom_access_token_hook by name). It runs security definer as
-- the migration owner so it may read auth.identities; execution is granted
-- only to supabase_auth_admin. If the auth server is configured with hooks
-- disabled, enable the Custom Access Token hook in the project (Auth ->
-- Hooks) pointing at this function.
--
-- GATE: still part of the A9 activation sequence - the A3 deny-all bootstrap
-- policies stay in force until the policy-swap migration is applied after the
-- live sub-claim verification (see the migration memory graph, A9 gate).

-- 1. The custom access token hook.
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

  -- The Better Auth user id for OIDC sign-ins through custom:velure.
  select identities.provider_id into provider_sub
  from auth.identities as identities
  where identities.user_id = uid::uuid
    and identities.provider = 'custom:velure'
  limit 1;

  if provider_sub is not null then
    claims := jsonb_set(claims, '{velure_user_id}', to_jsonb(provider_sub));
  end if;

  return jsonb_build_object('claims', claims);
end;
$$;

revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- 2. The A4 helper now reads the hook's claim first, falling back to sub.
create or replace function app.current_user_id()
returns text
language sql
stable
set search_path = pg_catalog, auth
as $$
  select nullif(btrim(coalesce(auth.jwt() ->> 'velure_user_id', auth.jwt() ->> 'sub')), '');
$$;

revoke all on function app.current_user_id() from public;
grant execute on function app.current_user_id() to authenticated;
