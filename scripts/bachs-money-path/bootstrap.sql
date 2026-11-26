-- Minimal, faithful bootstrap for the Bachs money path. Mirrors only the
-- columns the two functions touch, so the real function bodies can run against
-- a disposable Postgres. Test-only; never applied to a real database.

drop schema if exists public cascade;
create schema public;

create type public.invoice_status as enum (
  'draft','scheduled','sent','viewed','partially-paid','paid','overdue','canceled'
);
create type public.invoice_document_type as enum ('standard','credit_note','debit_note');
create type public.payment_source as enum ('manual','paystack','bachs');
create type public.payment_charge_status as enum (
  'pending','succeeded','failed','expired','manual_review'
);
create type public.audit_action as enum (
  'invoice.created','invoice.edited','invoice.deleted','invoice.renumbered',
  'invoice.paid','invoice.partially_paid','invoice.sent','invoice.viewed',
  'invoice.converted','invoice.schedule_canceled','invoice.rescheduled',
  'collection.session.created','collection.session.expired','payment.initiated',
  'payment.received','payment.failed','reminder.sent','oauth.connected',
  'integration.synced','export.created','export.retried','workspace.changed',
  'workspace.selected'
);
create type public.audit_result as enum ('success','failure');

create table public.workspaces (id uuid primary key default gen_random_uuid());

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  document_type public.invoice_document_type not null default 'standard',
  currency text not null,
  status public.invoice_status not null default 'draft',
  payment_amount numeric(20,4) not null default 0,
  canceled_at timestamptz,
  deleted_at timestamptz,
  paid_at timestamptz,
  payment_reference text,
  line_items jsonb not null default '[]'::jsonb,
  compliance jsonb,
  lifecycle jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_charges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  provider text not null,
  reference text not null,
  status public.payment_charge_status not null,
  amount numeric(20,4) not null,
  currency text not null,
  expires_at timestamptz not null default now(),
  provider_status text,
  provider_message text,
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  source public.payment_source not null,
  provider text,
  reference text,
  provider_payment_id text,
  event_type text,
  provider_status text,
  amount numeric(20,4) not null,
  currency text not null,
  customer_email text,
  raw_event jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid,
  actor_id text,
  actor_type text not null,
  action public.audit_action not null,
  resource_type text not null,
  resource_id text,
  result public.audit_result not null,
  message text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
