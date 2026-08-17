-- Velure Phase A5: owner-scoped tax profiles and the deferred workspace link.

create table public.tax_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null check (btrim(owner_id) <> ''),
  name text not null check (btrim(name) <> ''),
  jurisdiction_code text not null references public.jurisdictions (code),
  tax_treatment public.tax_treatment not null,
  rate numeric(7, 4) not null check (rate >= 0 and rate <= 100),
  label text not null check (btrim(label) <> ''),
  is_default boolean not null default false,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create index tax_profiles_owner_id_default_idx
  on public.tax_profiles (owner_id, is_default);

create unique index tax_profiles_one_default_per_owner_idx
  on public.tax_profiles (owner_id)
  where is_default;

alter table public.workspaces
  add column default_tax_profile_id uuid;

alter table public.workspaces
  add constraint workspaces_default_tax_profile_owner_fkey
  foreign key (default_tax_profile_id, owner_id)
  references public.tax_profiles (id, owner_id)
  on delete set null (default_tax_profile_id);

alter table public.tax_profiles enable row level security;

revoke all on table public.tax_profiles from anon, authenticated;
grant select, insert, update, delete on table public.tax_profiles to authenticated;

create policy tax_profiles_pending_verified_identity
  on public.tax_profiles
  for all
  to authenticated
  using (false)
  with check (false);
