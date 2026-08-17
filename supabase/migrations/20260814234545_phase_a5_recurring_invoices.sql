-- Velure Phase A5: workspace-owned recurring invoice schedules and runs.

create table public.recurring_invoice_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id text not null check (btrim(owner_id) <> ''),
  name text not null check (btrim(name) <> ''),
  status public.recurring_schedule_status not null,
  frequency public.recurring_frequency not null,
  interval integer not null check (interval > 0),
  start_date date not null,
  next_run_date date not null,
  end_date date,
  auto_send boolean not null,
  customer_name text not null,
  logo_url text,
  currency text not null,
  invoice_size text check (invoice_size in ('A4', 'LETTER')),
  date_format text check (date_format in ('iso', 'us', 'ng')),
  payment_terms_days integer not null check (payment_terms_days >= 0),
  template text not null,
  payment_details text,
  payment_link text,
  payment_provider public.payment_source,
  notes text,
  line_items jsonb not null check (jsonb_typeof(line_items) = 'array'),
  compliance jsonb,
  last_generated_at timestamptz,
  last_generated_invoice_id uuid references public.invoices (id) on delete set null,
  last_generated_period text,
  generated_count integer not null default 0 check (generated_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recurring_schedules_workspace_idx on public.recurring_invoice_schedules (workspace_id);
create index recurring_schedules_workspace_status_idx on public.recurring_invoice_schedules (workspace_id, status);
create index recurring_schedules_next_status_idx on public.recurring_invoice_schedules (next_run_date, status);

create table public.recurring_invoice_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  schedule_id uuid not null references public.recurring_invoice_schedules (id) on delete cascade,
  period_key text not null,
  invoice_id uuid references public.invoices (id) on delete set null,
  status public.recurring_run_status not null,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (schedule_id, period_key)
);

create index recurring_runs_workspace_idx on public.recurring_invoice_runs (workspace_id);
create index recurring_runs_schedule_idx on public.recurring_invoice_runs (schedule_id);
create index recurring_runs_schedule_period_idx on public.recurring_invoice_runs (schedule_id, period_key);

alter table public.recurring_invoice_schedules enable row level security;
alter table public.recurring_invoice_runs enable row level security;
revoke all on table public.recurring_invoice_schedules, public.recurring_invoice_runs from anon, authenticated;
grant select, insert, update, delete on table public.recurring_invoice_schedules, public.recurring_invoice_runs to authenticated;

create policy recurring_schedules_pending_verified_identity on public.recurring_invoice_schedules for all to authenticated using (false) with check (false);
create policy recurring_runs_pending_verified_identity on public.recurring_invoice_runs for all to authenticated using (false) with check (false);
