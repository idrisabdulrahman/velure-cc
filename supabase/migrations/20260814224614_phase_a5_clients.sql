-- Velure Phase A5: nullable-workspace clients.

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces (id) on delete set null,
  owner_id text,
  name text not null,
  company text,
  email text not null,
  phone text,
  website text,
  billing_address text,
  tax_id text,
  currency text not null,
  payment_terms text not null,
  internal_notes text,
  contact jsonb not null check (jsonb_typeof(contact) = 'object'),
  favorite boolean not null,
  status text not null check (status in ('active', 'pending', 'inactive', 'archived')),
  created_at timestamptz,
  updated_at timestamptz
);

create index clients_workspace_id_idx on public.clients (workspace_id);
create index clients_workspace_email_idx on public.clients (workspace_id, email);
create index clients_workspace_status_idx on public.clients (workspace_id, status);
create index clients_email_idx on public.clients (email);
create index clients_status_idx on public.clients (status);
create index clients_updated_at_idx on public.clients (updated_at);

alter table public.clients enable row level security;

revoke all on table public.clients from anon, authenticated;
grant select, insert, update, delete on table public.clients to authenticated;

create policy clients_pending_verified_identity
  on public.clients
  for all
  to authenticated
  using (false)
  with check (false);
