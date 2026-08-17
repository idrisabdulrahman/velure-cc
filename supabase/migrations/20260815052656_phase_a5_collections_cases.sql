-- Velure Phase A5: owner-scoped invoice collections cases.

create table public.collections_cases (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null check (btrim(owner_id) <> ''),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  status text not null check (
    status in ('open', 'paused', 'resolved', 'manual_exception')
  ),
  last_action_at timestamptz not null,
  note text,
  escalation_status public.escalation_status not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index collections_cases_owner_idx on public.collections_cases (owner_id);
create index collections_cases_invoice_idx on public.collections_cases (invoice_id);

alter table public.collections_cases enable row level security;

revoke all on table public.collections_cases from anon, authenticated;
grant select, insert, update, delete on table public.collections_cases to authenticated;

create policy collections_cases_pending_verified_identity on public.collections_cases
  for all to authenticated using (false) with check (false);
