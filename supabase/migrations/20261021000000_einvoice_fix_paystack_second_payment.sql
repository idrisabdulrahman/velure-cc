-- C2 interaction fix — confirm_paystack_payment keeps the FIRST payment
-- reference (second/remainder payments must not rewrite history).
--
-- Audit finding (WP8 fix round): `confirm_paystack_payment` as frozen in
-- 20260818143000_phase_a10_atomic_paystack_confirmation.sql UNCONDITIONALLY
-- set `payment_reference = input_reference` on every confirmation. WP8's C2
-- forward-only guard (20261020000001, `forward_only_columns`) rejects any
-- change to `invoices.payment_reference` once it is set, so from WP8 on:
--   * a partial payment leaves `payment_reference = ref-1`;
--   * the remainder payment (ref-2) tries to overwrite it;
--   * the trigger raises `insufficient_privilege`, the confirmation rolls
--     back, and the webhook retry fails identically forever — money has
--     crossed at Paystack but the invoice never records the settlement.
--
-- Fix: `payment_reference = coalesce(invoice.payment_reference, input_reference)`
-- — the first reference wins, consistent with forward-only history. Every
-- other behaviour of the RPC is preserved verbatim (duplicate short-circuit,
-- amount/currency check, `for update` locking, total derivation, partial vs
-- full branch, payment accumulation, the payment_transactions insert and the
-- payment_charges status update); each charge's own reference is still
-- recorded per row in payment_transactions (unique on provider, reference).
--
-- 20260818143000 is already applied and FROZEN — this migration only
-- CREATE OR REPLACEs the function body; the frozen file is untouched. The
-- signature is identical, so its revoke/grant lines carry over unchanged
-- (repeated below for self-containment).
--
-- Fully reversible: the down section restores the original body
-- (payment_reference = input_reference) from 20260818143000's source; the
-- frozen file itself is untouched.

create or replace function public.confirm_paystack_payment(
  input_reference text,
  input_amount numeric,
  input_currency text,
  input_event_type text,
  input_provider_status text,
  input_provider_payment_id text default null,
  input_customer_email text default null,
  input_raw_event jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  charge public.payment_charges%rowtype;
  invoice public.invoices%rowtype;
  total numeric;
  next_paid numeric;
begin
  select * into charge from public.payment_charges
  where provider = 'paystack' and reference = input_reference for update;
  if not found then raise exception 'Unknown payment reference.'; end if;
  if charge.amount <> input_amount or upper(charge.currency) <> upper(input_currency) then
    raise exception 'Payment amount or currency mismatch.';
  end if;
  if exists (select 1 from public.payment_transactions where provider = 'paystack' and reference = input_reference) then
    return jsonb_build_object('ok', true, 'duplicate', true, 'reference', input_reference);
  end if;
  select * into invoice from public.invoices where id = charge.invoice_id for update;
  if not found then raise exception 'Invoice not found.'; end if;
  total := coalesce(
    nullif(invoice.compliance->>'netPayable', '')::numeric,
    nullif(invoice.compliance->>'grandTotal', '')::numeric - coalesce(nullif(invoice.compliance->>'withholdingTaxAmount', '')::numeric, 0),
    (select coalesce(sum((item->>'quantity')::numeric * (item->>'price')::numeric), 0) from jsonb_array_elements(invoice.line_items) item)
  );
  next_paid := round((coalesce(invoice.payment_amount, 0) + input_amount)::numeric, 2);
  if next_paid > total then raise exception 'Payment amount cannot exceed the invoice balance.'; end if;
  insert into public.payment_transactions (workspace_id, invoice_id, source, provider, reference, provider_payment_id, event_type, provider_status, amount, currency, customer_email, raw_event)
  values (charge.workspace_id, charge.invoice_id, 'paystack', 'paystack', input_reference, input_provider_payment_id, input_event_type, input_provider_status, input_amount, input_currency, input_customer_email, input_raw_event);
  update public.payment_charges set status = 'succeeded', provider_status = input_provider_status, updated_at = now() where id = charge.id;
  update public.invoices set
    payment_amount = next_paid,
    paid_at = case when next_paid = total then now() else paid_at end,
    -- C2 forward-only (20261020000001): the FIRST reference is the
    -- invoice's payment history; a later (remainder) confirmation must not
    -- rewrite it. `invoice.payment_reference` is the row locked above, i.e.
    -- the pre-update value.
    payment_reference = coalesce(invoice.payment_reference, input_reference),
    status = case when next_paid = total then 'paid'::public.invoice_status else 'partially-paid'::public.invoice_status end,
    lifecycle = coalesce(lifecycle, '{}'::jsonb) || jsonb_build_object('paymentReceivedAt', (extract(epoch from now()) * 1000)::bigint),
    updated_at = now()
  where id = invoice.id;
  return jsonb_build_object('ok', true, 'duplicate', false, 'reference', input_reference);
end;
$$;

revoke all on function public.confirm_paystack_payment(text, numeric, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.confirm_paystack_payment(text, numeric, text, text, text, text, text, jsonb) to service_role;

-- down (reversible): restore the pre-WP8-fix body from the frozen migration
-- exactly — payment_reference is again overwritten with the newest
-- reference. Applying the down while WP8's forward-only guard
-- (20261020000001) is live re-arms the second-payment rollback, so only
-- roll this back together with 20261020000001. Uncomment to apply.
-- create or replace function public.confirm_paystack_payment(
--   input_reference text,
--   input_amount numeric,
--   input_currency text,
--   input_event_type text,
--   input_provider_status text,
--   input_provider_payment_id text default null,
--   input_customer_email text default null,
--   input_raw_event jsonb default null
-- ) returns jsonb
-- language plpgsql
-- security definer
-- set search_path = pg_catalog, public
-- as $$
-- declare
--   charge public.payment_charges%rowtype;
--   invoice public.invoices%rowtype;
--   total numeric;
--   next_paid numeric;
-- begin
--   select * into charge from public.payment_charges
--   where provider = 'paystack' and reference = input_reference for update;
--   if not found then raise exception 'Unknown payment reference.'; end if;
--   if charge.amount <> input_amount or upper(charge.currency) <> upper(input_currency) then
--     raise exception 'Payment amount or currency mismatch.';
--   end if;
--   if exists (select 1 from public.payment_transactions where provider = 'paystack' and reference = input_reference) then
--     return jsonb_build_object('ok', true, 'duplicate', true, 'reference', input_reference);
--   end if;
--   select * into invoice from public.invoices where id = charge.invoice_id for update;
--   if not found then raise exception 'Invoice not found.'; end if;
--   total := coalesce(
--     nullif(invoice.compliance->>'netPayable', '')::numeric,
--     nullif(invoice.compliance->>'grandTotal', '')::numeric - coalesce(nullif(invoice.compliance->>'withholdingTaxAmount', '')::numeric, 0),
--     (select coalesce(sum((item->>'quantity')::numeric * (item->>'price')::numeric), 0) from jsonb_array_elements(invoice.line_items) item)
--   );
--   next_paid := round((coalesce(invoice.payment_amount, 0) + input_amount)::numeric, 2);
--   if next_paid > total then raise exception 'Payment amount cannot exceed the invoice balance.'; end if;
--   insert into public.payment_transactions (workspace_id, invoice_id, source, provider, reference, provider_payment_id, event_type, provider_status, amount, currency, customer_email, raw_event)
--   values (charge.workspace_id, charge.invoice_id, 'paystack', 'paystack', input_reference, input_provider_payment_id, input_event_type, input_provider_status, input_amount, input_currency, input_customer_email, input_raw_event);
--   update public.payment_charges set status = 'succeeded', provider_status = input_provider_status, updated_at = now() where id = charge.id;
--   update public.invoices set
--     payment_amount = next_paid,
--     paid_at = case when next_paid = total then now() else paid_at end,
--     payment_reference = input_reference,
--     status = case when next_paid = total then 'paid'::public.invoice_status else 'partially-paid'::public.invoice_status end,
--     lifecycle = coalesce(lifecycle, '{}'::jsonb) || jsonb_build_object('paymentReceivedAt', (extract(epoch from now()) * 1000)::bigint),
--     updated_at = now()
--   where id = invoice.id;
--   return jsonb_build_object('ok', true, 'duplicate', false, 'reference', input_reference);
-- end;
-- $$;
