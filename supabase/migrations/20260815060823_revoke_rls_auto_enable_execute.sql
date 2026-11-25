-- Keep the remote maintenance helper out of the PostgREST RPC surface.
--
-- `rls_auto_enable()` is provisioned by the hosted Supabase platform, so a
-- fresh database (the local CLI stack, or a self-hosted instance) does not
-- have it and an unguarded `revoke` aborts the whole migration run. Guard on
-- existence: the revoke still applies wherever the helper is present.
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end
$$;
