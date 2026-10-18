-- Velure e-invoicing G1 (SPEC 5.G "Append-only audit log", 4.2): one
-- append-only invoice audit log — who created, edited, sent, cancelled and
-- exported an invoice, with before/after snapshots.
--
-- Written by exactly one service: src/server/data/audit.ts
-- (recordInvoiceAudit). Guarantees, in order of strength:
--
--   * Writes are SERVER-ONLY. anon/authenticated hold no INSERT grant and
--     no INSERT policy on this table, so a browser session (the A10
--     publishable-key PostgREST client) cannot forge events; the audit
--     service writes with the service-role key after resolving the
--     workspace through the caller's user-scoped RLS client. No
--     client-supplied workspace id ever reaches this table.
--   * Reads are tenant-scoped: members of a workspace can SELECT only that
--     workspace's audit rows (app.is_workspace_member).
--   * No UPDATE path anywhere: no RLS policy, no grant, and a BEFORE
--     UPDATE trigger that raises for every role, including the service key
--     (tamper-evidence floor).
--   * No application DELETE path: no RLS policy, no grant, no service
--     method, and a BEFORE DELETE guard shipped in
--     20261017000000_einvoice_g1_invoice_audit_log_delete_guard.sql rejects
--     a direct removal of rows for every role (service-role key included).
--     The only delete that can touch rows is the workspaces FK ON DELETE
--     CASCADE (account deletion), which that guard passes through while the
--     removal is nested, matching public.audit_logs.
--
-- Deliberately separate from public.audit_logs (A5): that table is the
-- Convex-ported general event trail whose `action` is a Postgres enum —
-- enum values cannot be removed, so extending it would not be reversible —
-- and it has no before/after payload columns. This migration is fully
-- reversible (down section at the bottom).

create table public.invoice_audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_id text not null check (btrim(actor_id) <> ''),
  actor_type text not null check (actor_type in ('user', 'system')),
  action text not null check (action in (
    'invoice.create',
    'invoice.edit',
    'invoice.send',
    'invoice.cancel',
    'invoice.export'
  )),
  resource_type text not null default 'invoice' check (btrim(resource_type) <> ''),
  resource_id text,
  before_payload jsonb,
  after_payload jsonb,
  message text,
  created_at timestamptz not null default now()
);

create index invoice_audit_log_workspace_created_idx
  on public.invoice_audit_log (workspace_id, created_at desc);
create index invoice_audit_log_resource_idx
  on public.invoice_audit_log (resource_type, resource_id, created_at);

alter table public.invoice_audit_log enable row level security;

-- Server-only writes: strip every table privilege from the public roles;
-- members keep SELECT only.
revoke all on table public.invoice_audit_log from anon, authenticated;
grant select on table public.invoice_audit_log to authenticated;

create policy invoice_audit_log_member_select
  on public.invoice_audit_log
  for select
  to authenticated
  using (app.is_workspace_member(workspace_id));

-- No insert/update/delete policy exists: an absent policy denies the
-- operation even where a stale grant might otherwise allow it.

-- Append-only enforcement above RLS: even the service-role key, which
-- bypasses RLS entirely, cannot rewrite history in place.
create or replace function public.invoice_audit_log_append_only() returns trigger
language plpgsql
as $$
begin
  raise exception 'invoice_audit_log is append-only; % is not permitted', tg_op;
end;
$$;

-- UPDATE only: a DELETE trigger raised for every statement would also fire
-- for the workspaces FK ON DELETE CASCADE above and break account deletion;
-- the follow-up guard in 20261017000000_einvoice_g1_invoice_audit_log_delete_guard.sql
-- rejects only a direct removal and lets that cascade through.
create trigger invoice_audit_log_append_only
  before update on public.invoice_audit_log
  for each row
  execute function public.invoice_audit_log_append_only();

-- ---------------------------------------------------------------------------
-- down (reversible) — run to remove every object this migration adds:
--
--   drop trigger if exists invoice_audit_log_append_only on public.invoice_audit_log;
--   drop function if exists public.invoice_audit_log_append_only();
--   drop policy if exists invoice_audit_log_member_select on public.invoice_audit_log;
--   revoke select on table public.invoice_audit_log from authenticated;
--   drop table if exists public.invoice_audit_log;
