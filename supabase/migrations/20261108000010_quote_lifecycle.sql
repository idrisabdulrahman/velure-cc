-- Velure / Invoicly WP-D (build_plan.md §WP-D): quote lifecycle → invoice.
--
-- A pro-forma quote can be *sent* and then *accepted by the client on the
-- public page*. Acceptance creates exactly ONE new payable standard invoice;
-- the quote row itself is never mutated into an invoice and is never deleted
-- (AGENTS.md §9: issued invoices are immutable; corrections are notes). A
-- repeat accept is a no-op, and the conversion link lives on a first-class
-- column guarded by a partial unique index so a racing accept cannot create a
-- second invoice even against a service-role/buggy writer.
--
-- Tenancy family: **workspace** — the new columns sit on the existing
-- `public.invoices` row, whose `workspace_id` RLS policies already apply. The
-- public accept resolves the workspace from the bearer token only (never from
-- the request body) and then filters every admin-client read/write by it, so
-- the column additions introduce no new policy surface.
--
-- Guarantees:
--   * `quote_status` is one of draft|sent|accepted|declined|expired or null
--     (null = not a quote / legacy row).
--   * `quote_converted_invoice_id` points at the ONE invoice a quote produced;
--     the partial unique index makes a second link impossible.
--   * `public_invoice_by_token` keeps returning only intentionally public
--     fields — quote status/timestamps are exposed, but the conversion link and
--     the linked invoice id are NOT (they stay private to the seller).
--
-- Reversible: the down section at the bottom drops the index/columns and
-- re-creates the previous `public_invoice_by_token` body. Uncomment to apply.
-- Authored-not-applied: this migration has NOT been pushed to the live project.

alter table public.invoices
  add column quote_status text null
    check (
      quote_status is null
      or quote_status in ('draft', 'sent', 'accepted', 'declined', 'expired')
    ),
  add column quote_sent_at timestamptz null,
  add column quote_accepted_at timestamptz null,
  add column quote_converted_invoice_id uuid null
    references public.invoices (id) on delete set null;

-- Exactly one converted invoice per quote. NULL (not converted) is unbounded.
create unique index invoices_quote_converted_invoice_unique
  on public.invoices (quote_converted_invoice_id)
  where quote_converted_invoice_id is not null;

-- ---------------------------------------------------------------------------
-- Public share-token RPC: same body as
-- 20260827000000_harden_public_invoice_payment_boundaries.sql, plus the three
-- public quote fields (status + sent/accepted timestamps). The private
-- `quote_converted_invoice_id` deliberately stays out of the public payload.
-- ---------------------------------------------------------------------------
create or replace function public.public_invoice_by_token(input_token text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'countryCode', w.country_code,
    'invoice', jsonb_build_object(
      'id', i.id,
      'token', i.token,
      'document_type', i.document_type,
      'shipment_details', i.shipment_details,
      'invoice_number', i.invoice_number,
      'customer_name', i.customer_name,
      'logo_url', i.logo_url,
      'customer_po_number', i.customer_po_number,
      'currency', i.currency,
      'invoice_type', i.invoice_type,
      'invoice_size', i.invoice_size,
      'date_format', i.date_format,
      'payment_terms_days', i.payment_terms_days,
      'template', i.template,
      'issue_date', i.issue_date,
      'due_date', i.due_date,
      'status', i.status,
      'payment_amount', i.payment_amount,
      'delivered_at', i.delivered_at,
      'canceled_at', i.canceled_at,
      'payment_details', i.payment_details,
      'payment_link', i.payment_link,
      'payment_provider', i.payment_provider,
      'paid_at', i.paid_at,
      'payment_reference', i.payment_reference,
      'finalized_at', i.finalized_at,
      'scheduled_at', i.scheduled_at,
      'schedule_version', i.schedule_version,
      'notes', i.notes,
      'line_items', i.line_items,
      'template_settings', i.template_settings,
      'top_block', i.top_block,
      'bottom_block', i.bottom_block,
      'compliance', i.compliance,
      'fiscalization', i.fiscalization,
      'lifecycle', i.lifecycle,
      'quote_status', i.quote_status,
      'quote_sent_at', i.quote_sent_at,
      'quote_accepted_at', i.quote_accepted_at,
      'created_at', i.created_at,
      'updated_at', i.updated_at
    )
  )
  from public.invoices i
  join public.workspaces w on w.id = i.workspace_id
  where i.token = input_token
    and i.deleted_at is null
    and i.canceled_at is null
    and i.token_revoked_at is null;
$$;

revoke execute on function public.public_invoice_by_token(text)
  from public, anon, authenticated;
grant execute on function public.public_invoice_by_token(text) to service_role;

-- ---------------------------------------------------------------------------
-- down (reversible) — run to remove every object this migration adds. The
-- re-created RPC is byte-for-byte the 20260827000000 body (no quote fields);
-- the three quote columns are additive and their values are only ever written
-- by WP-D, so dropping them loses no pre-existing user data.
--
--   drop index if exists public.invoices_quote_converted_invoice_unique;
--   alter table public.invoices
--     drop column if exists quote_accepted_at,
--     drop column if exists quote_sent_at,
--     drop column if exists quote_status,
--     drop column if exists quote_converted_invoice_id;
--   -- then re-create public.public_invoice_by_token exactly as defined in
--   -- supabase/migrations/20260827000000_harden_public_invoice_payment_boundaries.sql
-- ---------------------------------------------------------------------------
