-- Guard: no public-schema relation may carry privileges for `anon` (or for
-- PUBLIC, which anon inherits).
--
-- Supabase's default privileges grant `anon` and `authenticated` full access
-- to tables created in the public schema, so every migration must explicitly
-- revoke before selective grants (the landmine the 2026-08-15 live RLS run
-- exposed: a scratch table was readable by anon until revoked). This query
-- lists any relation that still carries such a grant. Empty result = pass.
--
-- Runs against a Postgres catalog, so it works on the remote project, a local
-- Supabase stack, or any scratch Postgres that has the migrations applied.
select
  n.nspname as "schema",
  c.relname as "relation",
  c.relkind as "kind",
  coalesce(r.rolname, 'PUBLIC') as "grantee",
  string_agg(acl.privilege_type, ', ' order by acl.privilege_type)
    as "granted_privileges"
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(
  coalesce(c.relacl, acldefault(c.relkind, c.relowner))
) acl
left join pg_roles r on r.oid = acl.grantee
where n.nspname = 'public'
  and c.relkind in ('r', 'p', 'v', 'm')
  and (acl.grantee = to_regrole('anon') or acl.grantee = 0::oid)
group by n.nspname, c.relname, c.relkind, coalesce(r.rolname, 'PUBLIC')
order by c.relname;
