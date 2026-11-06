-- Velure / Invoicly WP-C (build_plan.md §WP-C): expense tracking, minimal.
--
-- This is an expense **log**, not a ledger: amount, category, date and note.
-- No accounts, no double entry, no P&L, no balance sheet (AGENTS.md §2). The
-- only reader is a monthly totals view for the workspace.
--
-- Tenancy families (AGENTS.md §1):
--   * `expenses` is **workspace**: `workspace_id` is derived server-side from
--     the caller's verified active workspace, never from the request body. RLS
--     keeps members (owner/member/viewer) able to SELECT; only owner|member may
--     INSERT/UPDATE (AGENTS.md §8).
--   * `expense_categories` is **global-reference**: a small seeded, read-mostly
--     lookup shared by every tenant. It holds no tenant data, so no workspace
--     column exists; SELECT is open to authenticated, writes are server-only
--     (there is no client write path at all).
--
-- Money is `numeric(20, 2)` — major units to 2 decimal places, matching the
-- app's `roundMoney` helper. Never float (AGENTS.md §9). A row is an expense
-- only when `amount > 0`.
--
-- Issued financial rows are never hard-deleted: voiding is a soft
-- `voided_at` timestamp, so the log is append-and-amend, not delete
-- (AGENTS.md §9).
--
-- Guarantees:
--   * Reads are tenant-scoped: `app.is_workspace_member(workspace_id)` admits
--     owner, member and viewer.
--   * Inserts/updates are limited to owner|member (a viewer cannot write).
--   * No DELETE path: `voidExpense` sets `voided_at`.
--   * `category_code` is constrained to the seeded reference set.

create table public.expense_categories (
  code text primary key,
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.expense_categories enable row level security;

revoke all on table public.expense_categories from public, anon, authenticated;
grant select on table public.expense_categories to authenticated;
grant select on table public.expense_categories to service_role;

-- Global reference data: every authenticated user may read the shared set,
-- nobody may write it from a browser session.
create policy expense_categories_select
  on public.expense_categories
  for select
  to authenticated
  using (true);

insert into public.expense_categories (code, name, sort_order) values
  ('rent', 'Rent', 10),
  ('utilities', 'Utilities', 20),
  ('salaries', 'Salaries & wages', 30),
  ('supplies', 'Office supplies', 40),
  ('travel', 'Travel', 50),
  ('software', 'Software & subscriptions', 60),
  ('marketing', 'Marketing', 70),
  ('professional_fees', 'Professional fees', 80),
  ('bank_fees', 'Bank & payment fees', 90),
  ('tax', 'Taxes & levies', 100),
  ('other', 'Other', 999)
on conflict (code) do nothing;

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  owner_id text,
  amount numeric(20, 2) not null check (amount > 0),
  -- Column default is the app-wide base currency; the data layer overrides it
  -- with the workspace's own `base_currency` when the caller omits one, since a
  -- column default cannot read a sibling table.
  currency text not null default 'NGN',
  category_code text not null references public.expense_categories (code),
  incurred_on date not null,
  note text,
  -- Soft void: a voided expense stays in the log but drops out of totals.
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index expenses_workspace_id_idx
  on public.expenses (workspace_id);
create index expenses_workspace_incurred_on_idx
  on public.expenses (workspace_id, incurred_on);
create index expenses_workspace_category_idx
  on public.expenses (workspace_id, category_code);

alter table public.expenses enable row level security;

revoke all on table public.expenses from public, anon, authenticated;
grant select, insert, update on table public.expenses to authenticated;
grant select, insert, update on table public.expenses to service_role;

create policy expenses_select
  on public.expenses
  for select
  to authenticated
  using (app.is_workspace_member(workspace_id));

create policy expenses_insert
  on public.expenses
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = public.expenses.workspace_id
        and m.user_id = app.current_user_id()
        and m.role in ('owner', 'member')
    )
  );

create policy expenses_update
  on public.expenses
  for update
  to authenticated
  using (app.is_workspace_member(workspace_id))
  with check (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = public.expenses.workspace_id
        and m.user_id = app.current_user_id()
        and m.role in ('owner', 'member')
    )
  );

-- ---------------------------------------------------------------------------
-- down (reversible) — run to remove every object this migration adds:
--
--   drop policy if exists expenses_update on public.expenses;
--   drop policy if exists expenses_insert on public.expenses;
--   drop policy if exists expenses_select on public.expenses;
--   drop table if exists public.expenses;
--   drop policy if exists expense_categories_select on public.expense_categories;
--   drop table if exists public.expense_categories;
