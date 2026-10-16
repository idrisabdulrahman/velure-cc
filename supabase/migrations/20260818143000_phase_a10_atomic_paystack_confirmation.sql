create unique index if not exists payment_transactions_provider_reference_unique
  on public.payment_transactions (provider, reference)
  where provider is not null and reference is not null;

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
    payment_reference = input_reference,
    status = case when next_paid = total then 'paid'::public.invoice_status else 'partially-paid'::public.invoice_status end,
    lifecycle = coalesce(lifecycle, '{}'::jsonb) || jsonb_build_object('paymentReceivedAt', (extract(epoch from now()) * 1000)::bigint),
    updated_at = now()
  where id = invoice.id;
  return jsonb_build_object('ok', true, 'duplicate', false, 'reference', input_reference);
end;
$$;

revoke all on function public.confirm_paystack_payment(text, numeric, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.confirm_paystack_payment(text, numeric, text, text, text, text, text, jsonb) to service_role;
