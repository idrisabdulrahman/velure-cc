-- Velure Phase A5: invoice delivery, exports, and email provider events.

create table public.invoice_exports (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null check (btrim(owner_id) <> ''),
  workspace_id uuid references public.workspaces (id) on delete set null,
  invoice_id uuid references public.invoices (id) on delete set null,
  kind text not null check (kind in ('invoices_csv', 'tax_summary_csv', 'customer_ledger_csv', 'normalized_accounting')),
  provider public.provider,
  status text not null check (status in ('pending', 'ready', 'failed')),
  file_name text not null check (btrim(file_name) <> ''),
  content text not null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoice_exports_owner_idx on public.invoice_exports (owner_id);
create index invoice_exports_workspace_idx on public.invoice_exports (workspace_id);

create table public.invoice_delivery_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id text not null check (btrim(owner_id) <> ''),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  channel text not null check (channel = 'email'),
  recipient text not null check (btrim(recipient) <> ''),
  provider text not null check (provider = 'resend'),
  status text not null check (status in ('sent', 'failed')),
  provider_message_id text,
  public_url text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoice_delivery_workspace_idx on public.invoice_delivery_events (workspace_id);
create index invoice_delivery_invoice_idx on public.invoice_delivery_events (invoice_id);
create index invoice_delivery_owner_idx on public.invoice_delivery_events (owner_id);
create index invoice_delivery_provider_message_idx on public.invoice_delivery_events (provider_message_id);

create table public.email_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete set null,
  owner_id text,
  invoice_id uuid references public.invoices (id) on delete set null,
  delivery_event_id uuid references public.invoice_delivery_events (id) on delete set null,
  provider text not null check (provider = 'resend'),
  provider_message_id text,
  provider_event_id text,
  event_type public.email_event_type not null,
  recipient text,
  subject text,
  error text,
  raw_event jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index email_events_workspace_idx on public.email_events (workspace_id);
create index email_events_invoice_idx on public.email_events (invoice_id);
create index email_events_provider_message_idx on public.email_events (provider_message_id);
create index email_events_provider_event_idx on public.email_events (provider_event_id);

alter table public.invoice_exports enable row level security;
alter table public.invoice_delivery_events enable row level security;
alter table public.email_events enable row level security;

revoke all on table public.invoice_exports, public.invoice_delivery_events, public.email_events from anon, authenticated;
grant select, insert, update, delete on table public.invoice_exports, public.invoice_delivery_events, public.email_events to authenticated;

create policy invoice_exports_pending_verified_identity on public.invoice_exports for all to authenticated using (false) with check (false);
create policy invoice_delivery_pending_verified_identity on public.invoice_delivery_events for all to authenticated using (false) with check (false);
create policy email_events_pending_verified_identity on public.email_events for all to authenticated using (false) with check (false);
