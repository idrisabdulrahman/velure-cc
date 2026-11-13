alter table public.payment_charges drop constraint payment_charges_provider_check;
alter table public.payment_charges add constraint payment_charges_provider_check check (provider in ('paystack', 'bachs'));
drop index public.payment_charges_one_pending_per_invoice;
create unique index payment_charges_one_pending_per_invoice on public.payment_charges (provider, invoice_id) where status = 'pending';
create unique index bachs_charge_reference_unique on public.payment_charges (reference) where provider = 'bachs';
create unique index bachs_transaction_payment_unique on public.payment_transactions (provider_payment_id)
  where provider = 'bachs' and provider_payment_id is not null;

create policy payment_charges_bachs_insert_service_only on public.payment_charges
  as restrictive for insert to authenticated with check (provider is distinct from 'bachs');
create policy payment_charges_bachs_update_service_only on public.payment_charges
  as restrictive for update to authenticated using (provider is distinct from 'bachs') with check (provider is distinct from 'bachs');
create policy payment_charges_bachs_delete_service_only on public.payment_charges
  as restrictive for delete to authenticated using (provider is distinct from 'bachs');
create policy payment_transactions_bachs_insert_service_only on public.payment_transactions
  as restrictive for insert to authenticated with check (provider is distinct from 'bachs' and source <> 'bachs');
create policy payment_transactions_bachs_update_service_only on public.payment_transactions
  as restrictive for update to authenticated using (provider is distinct from 'bachs' and source <> 'bachs') with check (provider is distinct from 'bachs' and source <> 'bachs');
create policy payment_transactions_bachs_delete_service_only on public.payment_transactions
  as restrictive for delete to authenticated using (provider is distinct from 'bachs' and source <> 'bachs');

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
  return jsonb_build_object(
    'ok', true, 'duplicate', false,
    'reference', input_reference, 'paid', next_paid = total
  );
end;
$$;

revoke all on function public.confirm_bachs_payment(text, text, numeric, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.confirm_bachs_payment(text, text, numeric, text, text, text, text, text, jsonb) to service_role;
