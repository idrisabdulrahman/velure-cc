-- Paystack webhook money-safety: turn business rejections into a structured
-- result instead of a raised exception, and refuse to settle a canceled
-- invoice.
--
-- Audit findings on the frozen body (20260818143000, last replaced by
-- 20261021000000):
--   1. `Unknown payment reference.`, `Payment amount or currency mismatch.`
--      and `Payment amount cannot exceed the invoice balance.` were raised —
--      the webhook route turns any raise into HTTP 500, so Paystack retries
--      an event that can never succeed, forever, and no structured signal
--      reaches the app. The route needs to acknowledge (200) a business
--      rejection and only 5xx a transient failure.
--   2. A canceled/voided invoice had no guard: a pending charge on a canceled
--      invoice would be credited, flipping it to paid. Cancellation must win;
--      the money that crossed is a manual-review/refund case, not a settlement.
--
-- Behaviour change, all fail-closed (no new credit path):
--   * unknown reference           -> {ok:false, reason:'unknown_reference'}
--   * amount/currency mismatch    -> {ok:false, reason:'amount_currency_mismatch'}
--                                    (charge flagged `manual_review`)
--   * canceled invoice            -> {ok:false, reason:'invoice_canceled'}
--                                    (charge flagged `manual_review`)
--   * amount exceeds balance      -> {ok:false, reason:'exceeds_balance'}
--                                    (charge flagged `manual_review`)
--   * success                     -> {ok:true, duplicate:false, paid:<bool>}
--   * replay of a settled ref     -> {ok:true, duplicate:true}
--
-- Everything else is preserved verbatim from 20261021000000: the signature,
-- the SECURITY DEFINER surface, the row locks (`for update` on the charge and
-- the invoice), the amount/currency equality check, the total derivation
-- (netPayable -> grandTotal - WHT -> line items), the partial-vs-full branch,
-- the FIRST-reference rule (`coalesce(invoice.payment_reference, ...)`) and
-- the per-charge `payment_transactions` insert (unique on provider+reference).
-- The duplicate check now runs BEFORE the amount check so a replay can never
-- re-flag an already-settled charge.
--
-- 20260818143000 and 20261021000000 are already applied and FROZEN; this
-- migration only CREATE OR REPLACEs the function body. Fully reversible: the
-- down section restores the 20261021000000 body verbatim.

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
  if not found then
    return jsonb_build_object(
      'ok', false, 'duplicate', false,
      'reason', 'unknown_reference', 'reference', input_reference
    );
  end if;

  -- Replay first: a settled reference is always a duplicate, regardless of
  -- what the retried payload claims, so a retry can never re-flag or
  -- re-credit an already-processed charge.
  if exists (
    select 1 from public.payment_transactions
    where provider = 'paystack' and reference = input_reference
  ) then
    return jsonb_build_object(
      'ok', true, 'duplicate', true, 'reference', input_reference
    );
  end if;

  if charge.amount <> input_amount
    or upper(charge.currency) <> upper(input_currency)
  then
    update public.payment_charges
    set status = 'manual_review',
        provider_message = 'amount_currency_mismatch',
        updated_at = now()
    where id = charge.id;
    return jsonb_build_object(
      'ok', false, 'duplicate', false,
      'reason', 'amount_currency_mismatch', 'reference', input_reference
    );
  end if;

  select * into invoice from public.invoices
  where id = charge.invoice_id for update;
  if not found then
    return jsonb_build_object(
      'ok', false, 'duplicate', false,
      'reason', 'invoice_not_found', 'reference', input_reference
    );
  end if;

  -- Cancellation wins: never settle a voided invoice from a webhook. The
  -- crossed funds are a refund / manual-review case.
  if invoice.canceled_at is not null or invoice.status = 'canceled' then
    update public.payment_charges
    set status = 'manual_review',
        provider_message = 'invoice_canceled',
        updated_at = now()
    where id = charge.id;
    return jsonb_build_object(
      'ok', false, 'duplicate', false,
      'reason', 'invoice_canceled', 'reference', input_reference
    );
  end if;

  total := coalesce(
    nullif(invoice.compliance->>'netPayable', '')::numeric,
    nullif(invoice.compliance->>'grandTotal', '')::numeric - coalesce(nullif(invoice.compliance->>'withholdingTaxAmount', '')::numeric, 0),
    (select coalesce(sum((item->>'quantity')::numeric * (item->>'price')::numeric), 0) from jsonb_array_elements(invoice.line_items) item)
  );
  next_paid := round((coalesce(invoice.payment_amount, 0) + input_amount)::numeric, 2);
  if next_paid > total then
    update public.payment_charges
    set status = 'manual_review',
        provider_message = 'exceeds_balance',
        updated_at = now()
    where id = charge.id;
    return jsonb_build_object(
      'ok', false, 'duplicate', false,
      'reason', 'exceeds_balance', 'reference', input_reference
    );
  end if;

  insert into public.payment_transactions (workspace_id, invoice_id, source, provider, reference, provider_payment_id, event_type, provider_status, amount, currency, customer_email, raw_event)
  values (charge.workspace_id, charge.invoice_id, 'paystack', 'paystack', input_reference, input_provider_payment_id, input_event_type, input_provider_status, input_amount, input_currency, input_customer_email, input_raw_event);
  update public.payment_charges set status = 'succeeded', provider_status = input_provider_status, provider_message = null, updated_at = now() where id = charge.id;
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
  return jsonb_build_object(
    'ok', true, 'duplicate', false,
    'reference', input_reference, 'paid', next_paid = total
  );
end;
$$;

revoke all on function public.confirm_paystack_payment(text, numeric, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.confirm_paystack_payment(text, numeric, text, text, text, text, text, jsonb) to service_role;

-- down (reversible): restore the 20261021000000 body verbatim (business
-- rejections raise again; no canceled guard). Apply only with the handler
-- that expects raised exceptions. Uncomment to apply.
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
--     payment_reference = coalesce(invoice.payment_reference, input_reference),
--     status = case when next_paid = total then 'paid'::public.invoice_status else 'partially-paid'::public.invoice_status end,
--     lifecycle = coalesce(lifecycle, '{}'::jsonb) || jsonb_build_object('paymentReceivedAt', (extract(epoch from now()) * 1000)::bigint),
--     updated_at = now()
--   where id = invoice.id;
--   return jsonb_build_object('ok', true, 'duplicate', false, 'reference', input_reference);
-- end;
-- $$;
