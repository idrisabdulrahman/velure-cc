-- C2/C3 — issued-invoice immutability enforced in the database, plus the C1
-- lock on the human-facing "next invoice number" counter
-- (SPEC §5.C rows C2 "issued invoices immutable, cancel-only", C3
-- "no hard delete of issued invoices, cancel instead", §6.2 item 6).
--
-- Before this migration the immutability rules existed only as application
-- checks in src/server/data/invoices.ts: any writer holding a service-role
-- key, any script, and any future code path could rewrite or delete an
-- issued invoice, and nothing prevented `workspaces.next_invoice_sequence`
-- from being lowered back onto an already-issued number.
--
-- After this migration the database refuses, for every role:
--   * content edits to an ISSUED invoice (see the shared predicate
--     `public.invoice_is_issued` from 20261020000000 — mirrored 1:1 by
--     `isInvoiceIssued` in src/server/data/invoice-numbering.ts);
--   * erasing external history (delivery, payment, cancellation, archival
--     timestamps and money moving backwards);
--   * top-level hard deletes of issued invoices (the workspaces FK
--     ON DELETE CASCADE keeps working, exactly like the audit-log delete
--     guard in 20261017000000);
--   * user edits to `workspaces.next_invoice_sequence` once a workspace has
--     any issued invoice — the allocator's own monotone preview write passes
--     through the `velure.sequence_preview` transaction-local flag.
--
-- Scope note for WP11 (lifecycle owner): "issued" here is the C2 stand-in
-- built from the fields that exist today; when the real lifecycle states
-- land, update `public.invoice_is_issued` and the guard column list below
-- together. WP13 (NRS submission) will need to extend the allowed column
-- set deliberately for `fiscalization` writes — do not widen it quietly.
--
-- Fully reversible: the down section at the bottom drops the three triggers
-- and two functions; no invoice or workspace row is modified by this
-- migration.

-- 1. BEFORE UPDATE guard on invoices. Column-level rules:
--      * 33 content/identity columns are immutable once the OLD row is
--        issued (compared with IS DISTINCT FROM via to_jsonb);
--      * external-history columns are immutable once set (forward-only):
--        delivered_at, paid_at, payment_reference, canceled_at, deleted_at;
--      * money is monotone: payment_amount may rise but never fall;
--      * a paid invoice cannot become anything but paid or canceled
--        (bulk archival soft-cancels paid invoices today, so that
--        transition must keep working);
--      * the lifecycle JSON may grow but may never drop the keys that make
--        the row issued (sentAt / emailDeliveredAt / paymentReceivedAt).
--    Bookkeeping columns stay writable on issued rows so delivery events,
--    payment recording, reminders and archival keep functioning: status,
--    reminder, sync, lifecycle, token_revoked_at, updated_at, plus the
--    forward-only columns above.
--    New content columns added by future migrations MUST be appended to
--    v_immutable below, otherwise they silently default to writable.
create or replace function public.invoices_issued_guard_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  col text;
  immutable_columns constant text[] := array[
    'token',
    'document_type',
    'shipment_details',
    'invoice_number',
    'customer_id',
    'customer_name',
    'logo_url',
    'customer_po_number',
    'currency',
    'invoice_type',
    'invoice_size',
    'date_format',
    'payment_terms_days',
    'template',
    'template_settings',
    'top_block',
    'bottom_block',
    'issue_date',
    'due_date',
    'payment_details',
    'payment_link',
    'payment_provider',
    'notes',
    'internal_notes',
    'line_items',
    'compliance',
    'fiscalization',
    'scheduled_at',
    'schedule_version',
    'finalized_at',
    'workspace_id',
    'user_id',
    'created_at'
  ];
  forward_only_columns constant text[] := array[
    'delivered_at',
    'paid_at',
    'payment_reference',
    'canceled_at',
    'deleted_at'
  ];
  lifecycle_keys constant text[] := array[
    'sentAt',
    'emailDeliveredAt',
    'paymentReceivedAt'
  ];
begin
  if not public.invoice_is_issued(old) then
    return new;
  end if;

  foreach col in array immutable_columns loop
    -- `->>` (text) rather than `->` (jsonb): `to_jsonb(row) -> 'col'` returns
    -- the JSON null *value* for a NULL column, which `is not null` accepts,
    -- while `->>` maps JSON null to SQL NULL as intended.
    if to_jsonb(new) ->> col is distinct from to_jsonb(old) ->> col then
      raise exception
        'Issued invoice % is immutable; column % cannot be changed (C2).',
        old.id, col
        using errcode = 'insufficient_privilege';
    end if;
  end loop;

  foreach col in array forward_only_columns loop
    if to_jsonb(old) ->> col is not null
      and to_jsonb(new) ->> col is distinct from to_jsonb(old) ->> col
    then
      raise exception
        'Issued invoice % keeps its history; column % cannot be changed once set (C2).',
        old.id, col
        using errcode = 'insufficient_privilege';
    end if;
  end loop;

  if coalesce(new.payment_amount, 0) < coalesce(old.payment_amount, 0) then
    raise exception
      'Issued invoice % keeps its money history; payment_amount cannot decrease (C2).',
      old.id
      using errcode = 'insufficient_privilege';
  end if;

  if old.status = 'paid'
    and new.status is distinct from old.status
    and new.status <> 'canceled'
  then
    raise exception
      'Issued invoice % is paid; its status can only stay paid or become canceled (C2).',
      old.id
      using errcode = 'insufficient_privilege';
  end if;

  foreach col in array lifecycle_keys loop
    if coalesce(old.lifecycle ->> col, '') <> ''
      and coalesce(new.lifecycle ->> col, '') = ''
    then
      raise exception
        'Issued invoice % keeps its history; lifecycle.% cannot be removed (C2).',
        old.id, col
        using errcode = 'insufficient_privilege';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists invoices_issued_guard_update on public.invoices;
create trigger invoices_issued_guard_update
  before update on public.invoices
  for each row
  execute function public.invoices_issued_guard_update();

-- 2. BEFORE DELETE guard on invoices. Issued invoices are cancelled, never
--    deleted. `pg_trigger_depth() <= 1` is the same idiom as the audit-log
--    delete guard (20261017000000): a top-level DELETE (any role,
--    service-role key included) is rejected, while the nested delete issued
--    by the workspaces FK ON DELETE CASCADE keeps working.
create or replace function public.invoices_issued_guard_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if pg_trigger_depth() <= 1 and public.invoice_is_issued(old) then
    raise exception
      'Issued invoice % cannot be deleted; cancel it instead (C3).',
      old.id
      using errcode = 'insufficient_privilege';
  end if;
  return old;
end;
$$;

drop trigger if exists invoices_issued_guard_delete on public.invoices;
create trigger invoices_issued_guard_delete
  before delete on public.invoices
  for each row
  execute function public.invoices_issued_guard_delete();

-- 3. BEFORE UPDATE guard on workspaces (C1 second half): once a workspace
--    has ANY issued invoice its human-facing "next invoice number" counter
--    is frozen. The allocator (20261020000000) writes its monotone preview
--    inside the same transaction that flagged
--    `set_config('velure.sequence_preview', '1', true)`, so system writes
--    pass and every user edit — raising included, per SPEC "not editable
--    after the first issued invoice" — is rejected. Other workspace columns
--    are unaffected.
create or replace function public.workspaces_invoice_sequence_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.next_invoice_sequence is distinct from old.next_invoice_sequence then
    if current_setting('velure.sequence_preview', true) = '1' then
      return new;
    end if;
    if exists (
      select 1
      from public.invoices i
      where i.workspace_id = old.id
        and public.invoice_is_issued(i)
    ) then
      raise exception
        'The next invoice number is locked after the first issued invoice (C1).'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists workspaces_invoice_sequence_guard on public.workspaces;
create trigger workspaces_invoice_sequence_guard
  before update on public.workspaces
  for each row
  execute function public.workspaces_invoice_sequence_guard();

-- 4. Read helper for the application: does this workspace already have an
--    issued invoice? SECURITY INVOKER on purpose — the EXISTS scan is
--    subject to the caller's own RLS on invoices, so a member sees exactly
--    their workspace's rows and a non-member sees none (and gets `false`,
--    leaking nothing). The settings service uses it to lock the
--    "next invoice number" field; the workspaces trigger above re-checks in
--    the database so the app answer is never load-bearing for security.
create or replace function public.has_issued_invoice(p_workspace_id uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.invoices i
    where i.workspace_id = p_workspace_id
      and public.invoice_is_issued(i)
  );
$$;

revoke all on function public.has_issued_invoice(uuid) from public, anon;
grant execute on function public.has_issued_invoice(uuid)
  to authenticated, service_role;

-- down (reversible): restore the application-only enforcement of C1/C2/C3.
-- No row data is touched by the up migration, so dropping the triggers and
-- helper loses nothing. Uncomment to apply.
-- drop function if exists public.has_issued_invoice(uuid);
-- drop trigger if exists workspaces_invoice_sequence_guard on public.workspaces;
-- drop function if exists public.workspaces_invoice_sequence_guard();
-- drop trigger if exists invoices_issued_guard_delete on public.invoices;
-- drop function if exists public.invoices_issued_guard_delete();
-- drop trigger if exists invoices_issued_guard_update on public.invoices;
-- drop function if exists public.invoices_issued_guard_update();
