-- Velure Phase A5 prerequisites + A6 narrowly scoped bypasses.

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id text,
  token text not null,
  token_revoked_at timestamptz,
  document_type public.invoice_document_type not null default 'standard',
  invoice_number text not null check (btrim(invoice_number) <> ''),
  customer_id uuid references public.clients (id) on delete set null,
  customer_name text not null,
  logo_url text,
  customer_po_number text,
  currency text not null,
  invoice_type text not null default 'one-time' check (invoice_type in ('one-time', 'recurring')),
  invoice_size text not null default 'A4' check (invoice_size in ('A4', 'LETTER')),
  date_format text not null default 'ng' check (date_format in ('iso', 'us', 'ng')),
  payment_terms_days integer check (payment_terms_days >= 0),
  template text,
  issue_date date not null,
  due_date date not null,
  status public.invoice_status not null default 'draft',
  payment_amount numeric(20, 4) not null default 0 check (payment_amount >= 0),
  delivered_at timestamptz,
  canceled_at timestamptz,
  payment_details text,
  payment_link text,
  payment_provider public.payment_source,
  paid_at timestamptz,
  payment_reference text,
  finalized_at timestamptz,
  scheduled_at timestamptz,
  schedule_version text,
  notes jsonb,
  internal_notes text,
  deleted_at timestamptz,
  line_items jsonb not null check (jsonb_typeof(line_items) = 'array'),
  template_settings jsonb,
  top_block jsonb,
  bottom_block jsonb,
  compliance jsonb,
  fiscalization jsonb,
  reminder jsonb,
  sync jsonb,
  lifecycle jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (token)
);

create index invoices_workspace_idx on public.invoices (workspace_id);
create index invoices_workspace_type_idx on public.invoices (workspace_id, document_type);
create index invoices_workspace_status_idx on public.invoices (workspace_id, status);
create index invoices_workspace_due_idx on public.invoices (workspace_id, due_date);
create index invoices_workspace_updated_idx on public.invoices (workspace_id, updated_at);
create index invoices_workspace_number_idx on public.invoices (workspace_id, invoice_number);
create index invoices_token_idx on public.invoices (token);

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id text,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  source public.payment_source not null,
  provider text,
  reference text,
  provider_payment_id text,
  event_type text,
  provider_status text,
  amount numeric(20, 4) not null check (amount >= 0),
  currency text not null,
  recorded_by text,
  customer_email text,
  raw_event jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payment_transactions_workspace_idx on public.payment_transactions (workspace_id);
create index payment_transactions_invoice_idx on public.payment_transactions (invoice_id);
create index payment_transactions_reference_idx on public.payment_transactions (reference);

create table public.payment_charges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  provider text not null default 'paystack' check (provider = 'paystack'),
  reference text not null,
  status public.payment_charge_status not null,
  amount numeric(20, 4) not null check (amount >= 0),
  currency text not null,
  account_name text,
  account_number text,
  bank_name text,
  bank_slug text,
  expires_at timestamptz not null,
  provider_status text,
  provider_message text,
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payment_charges_workspace_idx on public.payment_charges (workspace_id);
create index payment_charges_invoice_idx on public.payment_charges (invoice_id);
create index payment_charges_reference_idx on public.payment_charges (reference);
create index payment_charges_invoice_status_idx on public.payment_charges (invoice_id, status);

alter table public.invoices enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.payment_charges enable row level security;

revoke all on table public.invoices, public.payment_transactions, public.payment_charges from anon, authenticated;
grant select, insert, update, delete on table public.invoices, public.payment_transactions, public.payment_charges to authenticated;

create policy invoices_pending_verified_identity on public.invoices for all to authenticated using (false) with check (false);
create policy payment_transactions_pending_verified_identity on public.payment_transactions for all to authenticated using (false) with check (false);
create policy payment_charges_pending_verified_identity on public.payment_charges for all to authenticated using (false) with check (false);

create view public.payment_charges_public
with (security_invoker = true)
as select id, workspace_id, invoice_id, provider, reference, status, amount,
  currency, expires_at, provider_status, provider_message, created_at, updated_at
from public.payment_charges;

revoke all on table public.payment_charges_public from anon, authenticated;
grant select on table public.payment_charges_public to authenticated;

create or replace function public.public_invoice_by_token(input_token text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', i.id,
    'token', i.token,
    'documentType', i.document_type,
    'invoiceNumber', i.invoice_number,
    'customerName', i.customer_name,
    'logoUrl', i.logo_url,
    'customerPoNumber', i.customer_po_number,
    'currency', i.currency,
    'type', i.invoice_type,
    'invoiceSize', i.invoice_size,
    'dateFormat', i.date_format,
    'paymentTermsDays', i.payment_terms_days,
    'template', i.template,
    'issueDate', i.issue_date,
    'dueDate', i.due_date,
    'status', i.status,
    'paymentAmount', i.payment_amount,
    'paymentDetails', i.payment_details,
    'paidAt', i.paid_at,
    'deliveredAt', i.delivered_at,
    'canceledAt', i.canceled_at,
    'notes', i.notes,
    'lineItems', i.line_items,
    'compliance', i.compliance,
    'fiscalization', i.fiscalization,
    'lifecycle', i.lifecycle,
    'createdAt', i.created_at,
    'updatedAt', i.updated_at
  )
  from public.invoices i
  where i.token = input_token
    and i.deleted_at is null
    and i.canceled_at is null
    and i.token_revoked_at is null;
$$;

revoke all on function public.public_invoice_by_token(text) from public;
grant execute on function public.public_invoice_by_token(text) to anon, authenticated;
