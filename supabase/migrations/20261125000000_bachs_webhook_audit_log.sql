-- Bachs webhook audit trail: a webhook-confirmed payment must leave an
-- audit_logs entry like manual payments do (governance §8: actor, workspace,
-- resource, action, result, timestamp for material money workflows).
-- Forward-only: adds the insert to confirm_bachs_payment on the success path
-- only; duplicates and manual_review rejections stay silent as before.

create or replace function public.confirm_bachs_payment(
  input_reference text,
  input_account text,
  input_amount numeric,
  input_currency text,
  input_event_type text,
  input_provider_status text,
  input_provider_payment_id text default null,
  input_customer_email text default null,
  input_raw_event jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  charge public.payment_charges;
  invoice public.invoices;
  total numeric;
  next_paid numeric;
begin
  select * into charge from public.payment_charges
  where provider = 'bachs' and reference = input_reference
    and raw_response->>'account' = input_account for update;
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
    where provider = 'bachs' and reference = input_reference
  ) then
    return jsonb_build_object(
      'ok', true, 'duplicate', true, 'reference', input_reference
    );
  end if;

  if input_amount <= 0 or charge.amount <> input_amount
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
  where id = charge.invoice_id and workspace_id = charge.workspace_id for update;
  if not found then
    return jsonb_build_object(
      'ok', false, 'duplicate', false,
      'reason', 'invoice_not_found', 'reference', input_reference
    );
  end if;

  -- Cancellation wins: never settle a voided invoice from a webhook. The
  -- crossed funds are a refund / manual-review case.
  if invoice.canceled_at is not null or invoice.deleted_at is not null
    or invoice.document_type <> 'standard' or invoice.currency <> input_currency
    or invoice.status in ('canceled', 'draft', 'scheduled') then
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
  values (charge.workspace_id, charge.invoice_id, 'bachs', 'bachs', input_reference, input_provider_payment_id, input_event_type, input_provider_status, input_amount, input_currency, input_customer_email, input_raw_event);
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
  insert into public.audit_logs (
    workspace_id, actor_id, actor_type, action,
    resource_type, resource_id, result, message, metadata
  ) values (
    charge.workspace_id,
    null,
    'system',
    'payment.received',
    'invoice',
    invoice.id::text,
    'success',
    'Bachs webhook confirmed a payment of ' || input_amount || ' ' || input_currency || '.',
    jsonb_build_object(
      'provider', 'bachs',
      'reference', input_reference,
      'provider_payment_id', input_provider_payment_id,
      'event_type', input_event_type,
      'paid_in_full', next_paid = total
    )
  );
  return jsonb_build_object(
    'ok', true, 'duplicate', false,
    'reference', input_reference, 'paid', next_paid = total
  );
end;
$$;

revoke execute on function public.confirm_bachs_payment(text, text, numeric, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.confirm_bachs_payment(text, text, numeric, text, text, text, text, text, jsonb) to service_role;
