-- Public invoice lookup is a server-side token boundary, not a PostgREST RPC.
revoke execute on function public.public_invoice_by_token(text) from public, anon, authenticated;
grant execute on function public.public_invoice_by_token(text) to service_role;
