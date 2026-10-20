-- C1 — server-side, per-supplier invoice number sequence
-- (SPEC §5.C row C1 "server-side, per-supplier, gap-aware sequence",
--  §6.2 item 5, §3.1 P2: the editable "next invoice number" counter).
--
-- Before this migration the "next number" was app-only logic: every create
-- scanned `invoices` for the max sequence and then wrote
-- `workspaces.next_invoice_sequence` in a second, separate statement. Two
-- concurrent issuances could therefore both read the same max and both write
-- the same number, and nothing in the database disagreed.
--
-- After this migration the authority is the database:
--
--   * `public.invoice_number_sequences` holds one row per
--     (workspace = supplier, prefix, year) with a monotone `last_value`;
--   * `public.allocate_invoice_number(...)` advances it in ONE atomic
--     statement (`INSERT … ON CONFLICT DO UPDATE … RETURNING`, which takes
--     the row lock for the statement), so concurrent callers serialize and
--     each receives a distinct value; the `greatest(last_value + 1, minimum)`
--     floor makes the allocation gap-aware and impossible to lower;
--     `p_reserve_only` switches the same function into reservation mode
--     (`greatest(last_value, minimum)`, no value consumed) for user-chosen
--     custom invoice numbers, so a custom `…-0009` lifts the counter past 9
--     without burning 10;
--   * `public.invoices (workspace_id, invoice_number)` becomes a UNIQUE
--     index (it was a plain index) — the backstop for every path, scripts and
--     service-role keys included;
--   * `workspaces.next_invoice_sequence` stays as the human-facing floor and
--     UI preview only: callers pass it as `p_minimum_sequence`, so raising it
--     is honored (C1 allows raising before the first issued invoice) and
--     lowering it can never reissue an allocated or issued number.
--
-- `public.invoice_is_issued(...)` is defined here because the de-duplication
-- step below must know which rows are issued; the C2/C3 lock triggers
-- (20261020000001_einvoice_c2_c3_invoice_lock_guard.sql) reuse the same
-- predicate so application and database always agree on "issued".
--
-- Fully reversible: the down section at the bottom restores the plain index,
-- drops the sequence machinery and leaves invoice rows untouched.

-- 1. The sequence table. RLS enabled and zero grants for the API roles: only
--    the SECURITY DEFINER allocator (and the service role, which bypasses
--    RLS) may touch it, so no browser session can rewind a counter directly.
create table public.invoice_number_sequences (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  prefix text not null check (btrim(prefix) <> ''),
  year integer not null check (year between 2000 and 2100),
  last_value integer not null check (last_value >= 1),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, prefix, year)
);

alter table public.invoice_number_sequences enable row level security;
revoke all on table public.invoice_number_sequences from anon, authenticated;

-- 2. The ONE issued predicate, shared by the dedupe step, the lock triggers
--    and (through the app's mirrored helper) the UI/server guards.
--
--    Scope note for WP11 (lifecycle owner): this is the C2 stand-in for
--    "Submitted/Sent and beyond", expressed with the fields that exist today.
--    An invoice is issued once it has left the tenant's hands — it was
--    delivered/sent, or money moved against it. Deliberately excluded:
--      * `finalized_at` — set by the plain create flow, so a created but
--        unsent invoice must stay editable;
--      * `lifecycle.firstViewedAt` — a public token preview (often the
--        owner's own) must not lock a draft;
--      * a bare `status = 'unpaid'` with no delivery — the derived status
--        for created-but-unsent rows (the UI shows them as Draft).
--    When WP11 lands the real states, replace this body with
--    status-in ('submitted','cleared','sent','paid') and keep both callers
--    (src/server/data/invoice-numbering.ts mirrors it 1:1).
create or replace function public.invoice_is_issued(r public.invoices)
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select r.delivered_at is not null
      or r.paid_at is not null
      or r.payment_reference is not null
      or coalesce(r.payment_amount, 0) > 0
      or r.status = 'paid'
      or coalesce(r.lifecycle ->> 'sentAt', '') <> ''
      or coalesce(r.lifecycle ->> 'emailDeliveredAt', '') <> ''
      or coalesce(r.lifecycle ->> 'paymentReceivedAt', '') <> '';
$$;

revoke all on function public.invoice_is_issued(public.invoices) from public;
revoke all on function public.invoice_is_issued(public.invoices) from anon;
grant execute on function public.invoice_is_issued(public.invoices)
  to authenticated, service_role;

-- 3. The transactional allocator.
--
--    Authorization: workspace membership from the caller's own JWT
--    (`app.is_workspace_member` reads `auth.jwt() ->> 'sub'`), or the
--    server-only service-role claim for cron/job callers that hold no user
--    session. Never a client-supplied "am I a member" flag.
--
--    Allocation: a single `INSERT … ON CONFLICT DO UPDATE … RETURNING`
--    statement. A concurrent caller for the same key blocks on the row lock,
--    then evaluates the `greatest(...)` against the committed value — so two
--    simultaneous issuances can never receive the same sequence, and no
--    caller can move the counter backwards.
--
--    Two modes, one function:
--      * allocate (`p_reserve_only = false`, the normal issuance path):
--        `greatest(last_value + 1, p_minimum_sequence)` — consume the next
--        value, never below the human-facing floor the caller passes;
--      * reserve (`p_reserve_only = true`, custom user-chosen numbers):
--        `greatest(last_value, p_minimum_sequence)` — lift the counter to
--        the custom sequence without consuming a value, so numbering stays
--        contiguous around it.
--
--    The preview write (the editable "next invoice number" the UI shows) is
--    monotone (`greatest(v_sequence + 1, current)`) and runs inside the same
--    statement set, flagged so the C1 workspace guard in migration
--    20261020000001 recognises it as a system write rather than a user edit.
create or replace function public.allocate_invoice_number(
  p_workspace_id uuid,
  p_prefix text,
  p_year integer,
  p_minimum_sequence integer default 1,
  p_reserve_only boolean default false
) returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, app
as $$
declare
  v_prefix text;
  v_minimum integer;
  v_sequence integer;
begin
  if p_workspace_id is null or p_year is null then
    raise exception 'allocate_invoice_number requires a workspace id and a year';
  end if;

  if not (
    app.is_workspace_member(p_workspace_id)
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
  ) then
    raise exception 'Not a member of this workspace.'
      using errcode = 'insufficient_privilege';
  end if;

  v_prefix := coalesce(
    nullif(
      left(regexp_replace(coalesce(p_prefix, 'INV'), '[^A-Z0-9]', '', 'g'), 12),
      ''
    ),
    'INV'
  );
  v_minimum := greatest(coalesce(p_minimum_sequence, 1), 1);

  insert into public.invoice_number_sequences as seq
    (workspace_id, prefix, year, last_value)
  values
    (p_workspace_id, v_prefix, p_year, v_minimum)
  on conflict (workspace_id, prefix, year)
  do update set
    last_value = case
      when p_reserve_only then greatest(seq.last_value, excluded.last_value)
      else greatest(seq.last_value + 1, excluded.last_value)
    end,
    updated_at = now()
  returning seq.last_value into v_sequence;

  -- Keep the human-facing preview in step with the real floor. Flagged so the
  -- workspaces C1 guard (migration 2) lets this system write through while it
  -- still rejects every user edit once an issued invoice exists. The value
  -- can never decrease, so the guard can simply reject all post-issuance
  -- changes without blocking the allocator.
  perform set_config('velure.sequence_preview', '1', true);
  update public.workspaces
     set next_invoice_sequence =
           greatest(v_sequence + 1, coalesce(next_invoice_sequence, 1))
   where id = p_workspace_id;

  return v_sequence;
end;
$$;

revoke all on function public.allocate_invoice_number(uuid, text, integer, integer, boolean)
  from public, anon;
grant execute on function public.allocate_invoice_number(uuid, text, integer, integer, boolean)
  to authenticated, service_role;

-- 4. De-duplicate BEFORE the unique index exists, with no data loss and no
--    renumbering of issued documents:
--      * a group holding more than one ISSUED row aborts the migration —
--        resolving that needs a human decision, and issued numbers are
--        never rewritten by machinery;
--      * in any other group the issued row (or, when there is none, the
--        oldest row) keeps its number and only draft/unissued copies are
--        moved to the next free number of their own prefix/year.
do $$
declare
  grp record;
  row record;
  keeper_id uuid;
  issued_count integer;
  v_prefix text;
  v_year integer;
  v_sequence integer;
  v_number text;
begin
  for grp in
    select i.workspace_id, i.invoice_number, count(*)::integer as copies
    from public.invoices i
    group by i.workspace_id, i.invoice_number
    having count(*) > 1
  loop
    select count(*)::integer into issued_count
    from public.invoices i
    where i.workspace_id = grp.workspace_id
      and i.invoice_number = grp.invoice_number
      and public.invoice_is_issued(i);

    if issued_count > 1 then
      raise exception
        'Duplicate issued invoice numbers (% x %): issued documents are never renumbered — resolve these rows manually, then re-run',
        grp.invoice_number, grp.copies;
    end if;

    select i.id into keeper_id
    from public.invoices i
    where i.workspace_id = grp.workspace_id
      and i.invoice_number = grp.invoice_number
    order by public.invoice_is_issued(i) desc, i.created_at asc, i.id asc
    limit 1;

    for row in
      select i.id, i.invoice_number
      from public.invoices i
      where i.workspace_id = grp.workspace_id
        and i.invoice_number = grp.invoice_number
        and i.id <> keeper_id
    loop
      v_prefix := (regexp_match(
        row.invoice_number,
        '^([A-Z0-9]{2,12})-([0-9]{4})-([0-9]{4,6})$'
      ))[1];
      v_year := ((regexp_match(
        row.invoice_number,
        '^([A-Z0-9]{2,12})-([0-9]{4})-([0-9]{4,6})$'
      ))[2])::integer;
      v_sequence := ((regexp_match(
        row.invoice_number,
        '^([A-Z0-9]{2,12})-([0-9]{4})-([0-9]{4,6})$'
      ))[3])::integer;

      if v_prefix is null then
        raise exception
          'Duplicate invoice number % on row % does not match PREFIX-YYYY-NNNN and cannot be renumbered automatically',
          grp.invoice_number, row.id;
      end if;

      loop
        v_number := case
          when v_prefix = 'INV'
            then 'INV-' || v_year::text || '-' || lpad(v_sequence::text, 6, '0')
          else v_prefix || '-' || v_year::text || '-' || lpad(v_sequence::text, 4, '0')
        end;
        exit when not exists (
          select 1 from public.invoices i
          where i.workspace_id = grp.workspace_id
            and i.invoice_number = v_number
        );
        v_sequence := v_sequence + 1;
      end loop;

      update public.invoices
         set invoice_number = v_number, updated_at = now()
       where id = row.id;
    end loop;
  end loop;
end;
$$;

-- 5. The DB constraint (was a plain index): unique invoice numbers per
--    supplier/workspace, for every writer including service-role scripts.
drop index if exists public.invoices_workspace_number_idx;
create unique index invoices_workspace_number_unique
  on public.invoices (workspace_id, invoice_number);

-- 6. Backfill: seed one floor per (workspace, prefix, year) found in existing
--    invoice numbers at max(sequence) + 1, and lift each workspace's own
--    prefix/current-year floor to its editable `next_invoice_sequence` (the
--    pre-C1 behaviour), so the very first allocation after this migration
--    never reissues a number that already exists. No row is modified.
with floors as (
  select
    i.workspace_id,
    (regexp_match(
      i.invoice_number,
      '^([A-Z0-9]{2,12})-([0-9]{4})-([0-9]{4,6})$'
    ))[1] as prefix,
    (((regexp_match(
      i.invoice_number,
      '^([A-Z0-9]{2,12})-([0-9]{4})-([0-9]{4,6})$'
    ))[2])::integer) as year,
    max(((
      regexp_match(
        i.invoice_number,
        '^([A-Z0-9]{2,12})-([0-9]{4})-([0-9]{4,6})$'
      ))[3])::integer)::integer + 1 as last_value
  from public.invoices i
  where i.invoice_number ~ '^[A-Z0-9]{2,12}-[0-9]{4}-[0-9]{4,6}$'
  group by 1, 2, 3
)
insert into public.invoice_number_sequences
  (workspace_id, prefix, year, last_value)
select floors.workspace_id, floors.prefix, floors.year, floors.last_value
from floors
on conflict (workspace_id, prefix, year)
do update set
  last_value = greatest(
    public.invoice_number_sequences.last_value,
    excluded.last_value
  ),
  updated_at = now();

insert into public.invoice_number_sequences
  (workspace_id, prefix, year, last_value)
select
  w.id,
  coalesce(
    nullif(
      left(
        regexp_replace(
          upper(
            coalesce(
              case
                when w.invoice_number_mode = 'business_name' then w.name
                else w.invoice_number_prefix
              end,
              'INV'
            )
          ),
          '[^A-Z0-9]',
          '',
          'g'
        ),
        12
      ),
      ''
    ),
    'INV'
  ),
  (extract(year from now()))::integer,
  greatest(coalesce(w.next_invoice_sequence, 1), 1)
from public.workspaces w
on conflict (workspace_id, prefix, year)
do update set
  last_value = greatest(
    public.invoice_number_sequences.last_value,
    excluded.last_value
  ),
  updated_at = now();

-- down (reversible): restore the pre-C1 numbering surface. The only invoice
-- rows the up migration touches are UNISSUED duplicates moved by the dedupe
-- step (never an issued document, never a data loss); dropping the
-- index/table/functions loses no invoice data, and the plain index comes
-- back exactly as 20260814232444 created it. Uncomment to apply.
-- drop index if exists public.invoices_workspace_number_unique;
-- create index invoices_workspace_number_idx on public.invoices (workspace_id, invoice_number);
-- drop function if exists public.allocate_invoice_number(uuid, text, integer, integer, boolean);
-- drop function if exists public.invoice_is_issued(public.invoices);
-- drop table if exists public.invoice_number_sequences;
