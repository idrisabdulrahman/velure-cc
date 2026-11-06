-- Velure / Invoicly WP-A (build_plan.md §3): buyer payment claims.
--
-- A buyer opening a public invoice link can tap "I've paid". That records an
-- *unverified claim* — evidence, never settlement. Only the existing
-- `recordPayment` path (`src/server/data/payments.ts`) changes invoice payment
-- state, so this table can never mark an invoice Paid on its own
-- (AGENTS.md §9: issued invoices are immutable; corrections are notes).
--
-- Tenancy family: **workspace**. `workspace_id` is derived server-side from the
-- invoice resolved by the public token — never from the request body. The
-- public submit runs with the service-role key (the token is the only bearer
-- credential), so the workspace/owner scoping below is enforced in application
-- code as well as by RLS as defense in depth (AGENTS.md §8).
--
-- Guarantees:
--   * Reads are tenant-scoped: a workspace member can SELECT only that
--     workspace's claims (app.is_workspace_member).
--   * Inserts/updates are limited to owner|member (viewers cannot confirm).
--   * No DELETE path: reject is a status change, not a removal.
--   * Idempotency: a repeat submit with the same reference for the same invoice
--     collides on `payment_claims_invoice_reference_unique` and is a no-op.

create table public.payment_claims (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  -- Same money representation as invoices.payment_amount / payment_transactions.amount.
  claimed_amount numeric(20, 4) not null check (claimed_amount > 0),
  claim_reference text,
  note text,
  status text not null default 'claimed'
    check (status in ('claimed', 'confirmed', 'rejected')),
  claimed_at timestamptz not null default now(),
  -- Set when a seller confirms *or* rejects the claim (status above).
  resolved_at timestamptz,
  resolved_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payment_claims_workspace_id_idx
  on public.payment_claims (workspace_id);
create index payment_claims_invoice_id_idx
  on public.payment_claims (invoice_id);
create index payment_claims_status_idx
  on public.payment_claims (status);

-- One claim per (invoice, reference). Null references are allowed and unbounded
-- (a buyer may submit without a reference).
create unique index payment_claims_invoice_reference_unique
  on public.payment_claims (invoice_id, claim_reference)
  where claim_reference is not null;

alter table public.payment_claims enable row level security;

revoke all on table public.payment_claims from public, anon, authenticated;
grant select, insert, update on table public.payment_claims to authenticated;
grant select, insert, update on table public.payment_claims to service_role;

create policy payment_claims_select
  on public.payment_claims
  for select
  to authenticated
  using (app.is_workspace_member(workspace_id));

create policy payment_claims_insert
  on public.payment_claims
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = public.payment_claims.workspace_id
        and m.user_id = app.current_user_id()
        and m.role in ('owner', 'member')
    )
  );

create policy payment_claims_update
  on public.payment_claims
  for update
  to authenticated
  using (app.is_workspace_member(workspace_id))
  with check (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = public.payment_claims.workspace_id
        and m.user_id = app.current_user_id()
        and m.role in ('owner', 'member')
    )
  );

-- ---------------------------------------------------------------------------
-- down (reversible) — run to remove every object this migration adds:
--
--   drop policy if exists payment_claims_update on public.payment_claims;
--   drop policy if exists payment_claims_insert on public.payment_claims;
--   drop policy if exists payment_claims_select on public.payment_claims;
--   drop table if exists public.payment_claims;
