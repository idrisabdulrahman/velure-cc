-- Velure Phase A4: fail-closed identity helpers. The A3 policies remain
-- restrictive until Supabase can verify a Better Auth-issued identity token.

create schema if not exists app;

revoke all on schema app from public;
grant usage on schema app to authenticated;

create or replace function app.current_user_id()
returns text
language sql
stable
set search_path = pg_catalog, auth
as $$
  select nullif(btrim(auth.jwt() ->> 'sub'), '');
$$;

create or replace function app.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, app
as $$
  select exists (
    select 1
    from public.workspace_members as membership
    where membership.workspace_id = ws
      and membership.user_id = app.current_user_id()
  );
$$;

revoke all on function app.current_user_id() from public;
revoke all on function app.is_workspace_member(uuid) from public;

grant execute on function app.current_user_id() to authenticated;
grant execute on function app.is_workspace_member(uuid) to authenticated;
