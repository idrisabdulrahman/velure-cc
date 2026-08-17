-- Velure Phase A5: workspace-owned products and services.

create table public.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  type text not null check (type in ('product', 'service')),
  name text not null check (btrim(name) <> ''),
  description text,
  sku text,
  unit_name text,
  default_unit_price numeric(20, 4) not null check (default_unit_price >= 0),
  default_tax_id text,
  is_active boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index products_workspace_id_idx on public.products (workspace_id);
create index products_workspace_name_idx on public.products (workspace_id, name);
create index products_workspace_active_idx on public.products (workspace_id, is_active);

alter table public.products enable row level security;

revoke all on table public.products from anon, authenticated;
grant select, insert, update, delete on table public.products to authenticated;

create policy products_pending_verified_identity
  on public.products
  for all
  to authenticated
  using (false)
  with check (false);
