-- Keep the remote maintenance helper out of the PostgREST RPC surface.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
