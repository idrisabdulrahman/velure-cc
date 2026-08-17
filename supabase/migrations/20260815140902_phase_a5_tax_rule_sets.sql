-- Velure Phase A5: versioned Nigeria tax rule reference data and the
-- workspace rule-set version guard.
--
-- Mirrors the versioned VAT/WHT rule registry in convex/nigeria.ts. Convex is
-- the source of truth; these tables are the read-only global reference mirror.

create table public.tax_rule_sets (
  id text primary key check (btrim(id) <> ''),
  label text not null check (btrim(label) <> ''),
  authority text not null check (btrim(authority) <> ''),
  vat_rate numeric(7, 4) not null check (vat_rate >= 0 and vat_rate <= 100),
  effective_from date not null,
  effective_to date check (effective_to is null or effective_to >= effective_from),
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one rule set can be the current source of truth.
create unique index tax_rule_sets_one_current_idx
  on public.tax_rule_sets (is_current)
  where is_current;

create table public.withholding_rates (
  rule_set_id text not null references public.tax_rule_sets (id) on delete cascade,
  category public.withholding_category not null,
  resident_rate numeric(7, 4) not null check (resident_rate >= 0 and resident_rate <= 100),
  non_resident_rate numeric(7, 4) not null check (non_resident_rate >= 0 and non_resident_rate <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (rule_set_id, category)
);

-- Read-only global reference data, mirroring the `jurisdictions` posture:
-- authenticated users can read, nobody can write through the API.
alter table public.tax_rule_sets enable row level security;
alter table public.withholding_rates enable row level security;

revoke all on table public.tax_rule_sets from anon, authenticated;
revoke all on table public.withholding_rates from anon, authenticated;
grant select on table public.tax_rule_sets to authenticated;
grant select on table public.withholding_rates to authenticated;

create policy "authenticated users can read tax rule sets"
on public.tax_rule_sets
for select
to authenticated
using (true);

create policy "authenticated users can read withholding rates"
on public.withholding_rates
for select
to authenticated
using (true);

-- Workspace rule-set versions must reference a known rule set. Convex always
-- writes the canonical id and normalizes legacy ids on save, so the legacy
-- default strings (`ng-nrs-2026.1`, `NG-2026-v1`) never reach the database.
-- The Phase A8 data migration must map those legacy ids to `ng-2026-q1` when
-- copying workspace rows, because this foreign key rejects unknown values.
alter table public.workspaces
  add constraint workspaces_tax_rule_set_version_fkey
  foreign key (tax_rule_set_version)
  references public.tax_rule_sets (id);

insert into public.tax_rule_sets (
  id,
  label,
  authority,
  vat_rate,
  effective_from,
  is_current
)
values (
  'ng-2026-q1',
  'Nigeria 2026 Q1 tax rules',
  'Nigeria Revenue Service (NRS)',
  7.5,
  '2026-01-01',
  true
);

insert into public.withholding_rates (
  rule_set_id,
  category,
  resident_rate,
  non_resident_rate
)
values
  ('ng-2026-q1', 'none', 0, 0),
  ('ng-2026-q1', 'goods_materials', 2, 0),
  ('ng-2026-q1', 'general_services', 2, 5),
  ('ng-2026-q1', 'professional_fees', 5, 10),
  ('ng-2026-q1', 'major_construction', 2, 5),
  ('ng-2026-q1', 'other_construction', 5, 10),
  ('ng-2026-q1', 'telecom_colocation', 2, 5),
  ('ng-2026-q1', 'brokerage', 5, 10),
  ('ng-2026-q1', 'rent_hire_lease', 10, 10);
