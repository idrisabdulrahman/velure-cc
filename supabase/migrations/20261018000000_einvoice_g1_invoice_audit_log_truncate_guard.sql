-- G1 append-only invoice audit log — TRUNCATE guard (post-final-audit fix,
-- MEDIUM).
--
-- The append-only guards shipped so far are ROW triggers
-- (20261016000000_einvoice_g1_invoice_audit_log.sql: BEFORE UPDATE;
-- 20261017000000_einvoice_g1_invoice_audit_log_delete_guard.sql: BEFORE
-- DELETE). Row triggers do not fire on `TRUNCATE TABLE`, so a service-role
-- `truncate table public.invoice_audit_log` would have silently wiped the
-- whole trail while the migration headers and the audit service
-- (src/server/data/audit.ts) documented removal as impossible for any role.
-- Fixing reality, not the claim: this migration adds a BEFORE TRUNCATE
-- STATEMENT trigger that raises for every role, service-role key included.
--
-- A dedicated function, not the DELETE guard's: a statement trigger has no
-- row, so `public.invoice_audit_log_append_only_delete()` (which returns
-- `old`) cannot run in that context, and unlike DELETE there is no nested
-- case to pass through — the workspaces FK ON DELETE CASCADE is a DELETE,
-- never a TRUNCATE. The raise is therefore unconditional.
--
-- Reversible: the down section drops only this trigger and this function;
-- no data is written, read or removed by this migration.

create or replace function public.invoice_audit_log_block_truncate()
returns trigger
language plpgsql
as $$
begin
	raise exception
		'invoice_audit_log is append-only; TRUNCATE is not permitted (G1)'
		using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists invoice_audit_log_block_truncate on public.invoice_audit_log;

create trigger invoice_audit_log_block_truncate
	before truncate on public.invoice_audit_log
	for each statement
	execute function public.invoice_audit_log_block_truncate();

-- down (reversible): remove the TRUNCATE guard, restoring the 20261017
-- state (UPDATE + DELETE row triggers only). Run to remove every object
-- this migration adds:
-- drop trigger if exists invoice_audit_log_block_truncate on public.invoice_audit_log;
-- drop function if exists public.invoice_audit_log_block_truncate();
