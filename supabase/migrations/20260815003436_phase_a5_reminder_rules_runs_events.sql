-- Velure Phase A5: owner-scoped reminder rules, runs, and events.

create table public.reminder_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null check (btrim(owner_id) <> ''),
  enabled boolean not null,
  days_before_due integer not null check (days_before_due >= 0),
  on_due_date boolean not null,
  overdue_cadence_days integer not null check (overdue_cadence_days >= 1),
  max_overdue_reminders integer not null check (max_overdue_reminders between 0 and 3),
  escalate_after_count integer not null check (
    escalate_after_count between 0 and max_overdue_reminders
  ),
  business_signature text check (char_length(btrim(business_signature)) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reminder_rules_owner_idx on public.reminder_rules (owner_id);

create table public.reminder_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null check (btrim(owner_id) <> ''),
  run_date date not null,
  status text not null check (status in ('queued', 'completed', 'failed')),
  scanned_count integer not null check (scanned_count >= 0),
  queued_count integer not null check (queued_count >= 0),
  sent_count integer not null check (sent_count >= 0),
  escalated_count integer not null check (escalated_count >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index reminder_runs_owner_idx on public.reminder_runs (owner_id);

create table public.reminder_events (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null check (btrim(owner_id) <> ''),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  stage public.reminder_stage not null,
  channel text not null check (channel in ('email', 'slack', 'internal')),
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  status text not null check (status in ('queued', 'sent', 'skipped', 'failed')),
  error text,
  meta jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (sent_at is null or sent_at >= scheduled_for)
);
create index reminder_events_owner_idx on public.reminder_events (owner_id);
create index reminder_events_invoice_idx on public.reminder_events (invoice_id);

alter table public.reminder_rules enable row level security;
alter table public.reminder_runs enable row level security;
alter table public.reminder_events enable row level security;

revoke all on table public.reminder_rules, public.reminder_runs, public.reminder_events from anon, authenticated;
grant select, insert, update, delete on table public.reminder_rules, public.reminder_runs, public.reminder_events to authenticated;

create policy reminder_rules_pending_verified_identity on public.reminder_rules
  for all to authenticated using (false) with check (false);
create policy reminder_runs_pending_verified_identity on public.reminder_runs
  for all to authenticated using (false) with check (false);
create policy reminder_events_pending_verified_identity on public.reminder_events
  for all to authenticated using (false) with check (false);
