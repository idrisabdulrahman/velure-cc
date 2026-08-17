-- Velure Phase A3: tenancy roots. Client access stays closed until A4 verifies
-- Better Auth identity and replaces the bootstrap RLS policies below.

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null check (btrim(owner_id) <> ''),
  name text not null check (btrim(name) <> '' and char_length(name) <= 120),
  legal_name text,
  email text,
  phone text,
  address text,
  website text,
  tax_id text,
  rc_number text,
  country_code text not null references public.jurisdictions (code),
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  seller_tax_status public.seller_tax_status,
  tax_rule_set_version text,
  atrs jsonb check (atrs is null or jsonb_typeof(atrs) = 'object'),
  reminder_signature text,
  reminders_enabled boolean not null,
  logo_url text,
  payment_details text,
  default_payment_link text,
  default_payment_terms_days integer check (default_payment_terms_days >= 0),
  invoice_number_mode public.invoice_number_mode,
  invoice_number_prefix text,
  next_invoice_sequence bigint check (next_invoice_sequence >= 1),
  invoice_template_defaults jsonb check (
    invoice_template_defaults is null
    or jsonb_typeof(invoice_template_defaults) = 'object'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspaces_owner_id_idx on public.workspaces (owner_id);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id text not null check (btrim(user_id) <> ''),
  role public.workspace_role not null,
  invited_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create index workspace_members_workspace_id_idx
  on public.workspace_members (workspace_id);
create index workspace_members_user_id_idx
  on public.workspace_members (user_id);

create table public.active_workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id text not null unique check (btrim(user_id) <> ''),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index active_workspaces_workspace_id_idx
  on public.active_workspaces (workspace_id);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.active_workspaces enable row level security;

revoke all on table public.workspaces from anon, authenticated;
revoke all on table public.workspace_members from anon, authenticated;
revoke all on table public.active_workspaces from anon, authenticated;

grant select, insert, update, delete on table public.workspaces to authenticated;
grant select, insert, update, delete on table public.workspace_members to authenticated;
grant select, insert, update, delete on table public.active_workspaces to authenticated;

create policy workspaces_pending_verified_identity
  on public.workspaces
  for all
  to authenticated
  using (false)
  with check (false);

create policy workspace_members_pending_verified_identity
  on public.workspace_members
  for all
  to authenticated
  using (false)
  with check (false);

create policy active_workspaces_pending_verified_identity
  on public.active_workspaces
  for all
  to authenticated
  using (false)
  with check (false);
