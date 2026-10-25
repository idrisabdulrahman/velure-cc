-- G1 append-only invoice audit log — fix (audit round 1, MEDIUM).
--
-- 20261016000000_einvoice_g1_invoice_audit_log.sql enforces append-only with
-- a BEFORE UPDATE trigger only. Its header claimed that only the workspaces
-- FK cascade could remove a row — misleading: anon/authenticated have no
-- DELETE grant, but the service-role key bypasses RLS and no trigger
-- rejected a DELETE, so a direct `delete from invoice_audit_log` with the
-- service-role key would silently succeed. This migration closes that gap;
-- the misleading comment in the original migration header was corrected next
-- to this file (comment only — its SQL is unchanged).
--
-- Correct behavior:
--   * a top-level DELETE of an audit row (pg_trigger_depth() <= 1 inside the
--     row trigger, i.e. the trigger fired directly from a client statement)
--     is rejected for every role, service-role key included;
--   * a nested DELETE (pg_trigger_depth() > 1) — the workspaces FK
--     ON DELETE CASCADE used by account deletion — is allowed to proceed.
--
-- Reversible: the down section below restores the UPDATE-only trigger set
-- from 20261016 by dropping this trigger and function.

create or replace function public.invoice_audit_log_append_only_delete()
returns trigger
language plpgsql
as $$
begin
	if pg_trigger_depth() <= 1 then
		raise exception
			'invoice_audit_log rows are append-only; deletes are not permitted (G1)'
			using errcode = 'insufficient_privilege';
	end if;
	-- nested delete (e.g. ON DELETE CASCADE from a parent row): let it pass.
	return old;
end;
$$;

drop trigger if exists invoice_audit_log_block_delete on public.invoice_audit_log;

create trigger invoice_audit_log_block_delete
	before delete on public.invoice_audit_log
	for each row
	execute function public.invoice_audit_log_append_only_delete();

-- down (reversible): restore the 20261016 state (UPDATE trigger only).
-- drop trigger if exists invoice_audit_log_block_delete on public.invoice_audit_log;
-- drop function if exists public.invoice_audit_log_append_only_delete();
