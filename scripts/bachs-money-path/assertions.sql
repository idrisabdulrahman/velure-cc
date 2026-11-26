-- Fixtures + assertions for the Bachs money path.
create or replace function pg_temp.assert(cond boolean, label text) returns void
language plpgsql as $$
begin
  if cond is not true then
    raise exception 'FAIL: %', label;
  end if;
  raise notice 'PASS: %', label;
end $$;

insert into public.workspaces (id) values ('00000000-0000-0000-0000-0000000000aa');

insert into public.invoices (id, workspace_id, currency, status, line_items)
values
  ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000aa','NGN','sent','[{"quantity":1,"price":10000}]'),
  ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000aa','NGN','sent','[{"quantity":1,"price":10000}]'),
  ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000aa','NGN','sent','[{"quantity":1,"price":10000}]'),
  ('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-0000000000aa','NGN','sent','[{"quantity":1,"price":10000}]'),
  ('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-0000000000aa','NGN','sent','[{"quantity":1,"price":10000}]');

insert into public.payment_charges
  (id, workspace_id, invoice_id, provider, reference, status, amount, currency, raw_response)
values
  ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000aa','00000000-0000-0000-0000-000000000001','bachs','chk_1','pending',10000,'NGN','{"account":"acct_1"}'),
  ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000aa','00000000-0000-0000-0000-000000000002','bachs','chk_2','pending',10000,'NGN','{"account":"acct_1"}'),
  ('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000aa','00000000-0000-0000-0000-000000000003','bachs','chk_3','pending',10000,'NGN','{"account":"acct_1"}'),
  ('00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-0000000000aa','00000000-0000-0000-0000-000000000004','bachs','chk_4','pending',10000,'NGN','{"account":"acct_1"}'),
  ('00000000-0000-0000-0000-0000000000c5','00000000-0000-0000-0000-0000000000aa','00000000-0000-0000-0000-000000000005','bachs','chk_5','pending',10000,'NGN','{"account":"acct_1"}');

do $$
declare
  r jsonb;
  st public.payment_charge_status;
  inv public.invoices;
begin
  -- 1. A succeeded collection settles the matching invoice.
  r := public.confirm_bachs_payment('chk_1','acct_1',10000,'NGN','collection.succeeded','SUCCEEDED','ch_1',null,'{}');
  perform pg_temp.assert((r->>'ok')::boolean and (r->>'paid')::boolean, 'success settles invoice in full');
  select * into inv from public.invoices where id='00000000-0000-0000-0000-000000000001';
  perform pg_temp.assert(inv.status='paid' and inv.payment_amount=10000 and inv.payment_reference='chk_1', 'invoice marked paid with reference');
  perform pg_temp.assert((select count(*) from public.payment_transactions where reference='chk_1')=1, 'one transaction recorded');
  perform pg_temp.assert((select count(*) from public.audit_logs where action='payment.received')=1, 'audit entry written');

  -- 2. A replay is a duplicate and never double-credits.
  r := public.confirm_bachs_payment('chk_1','acct_1',10000,'NGN','collection.succeeded','SUCCEEDED','ch_1',null,'{}');
  perform pg_temp.assert((r->>'duplicate')::boolean, 'replay is a duplicate');
  perform pg_temp.assert((select count(*) from public.payment_transactions where reference='chk_1')=1, 'replay does not double-credit');
  select * into inv from public.invoices where id='00000000-0000-0000-0000-000000000001';
  perform pg_temp.assert(inv.payment_amount=10000, 'replay does not change balance');

  -- 3. Failed is non-final: unpaid, still retryable, later success settles.
  r := public.record_bachs_payment_outcome('chk_2','acct_1','collection.failed','FAILED','failed','declined',null,'{}');
  perform pg_temp.assert((r->>'ok')::boolean, 'failed outcome recorded');
  select status into st from public.payment_charges where reference='chk_2';
  perform pg_temp.assert(st='pending', 'failed charge stays retryable');
  select * into inv from public.invoices where id='00000000-0000-0000-0000-000000000002';
  perform pg_temp.assert(inv.status='sent' and inv.payment_amount=0, 'failed does not pay the invoice');
  r := public.confirm_bachs_payment('chk_2','acct_1',10000,'NGN','collection.succeeded','SUCCEEDED','ch_2',null,'{}');
  perform pg_temp.assert((r->>'paid')::boolean, 'a later success settles after a failure');

  -- 4. Expiry is not final: unpaid, invoice not cancelled, late success settles.
  r := public.record_bachs_payment_outcome('chk_3','acct_1','checkout.expired','expired','expired',null,null,'{}');
  perform pg_temp.assert((r->>'status')='expired', 'expired closes the charge');
  select * into inv from public.invoices where id='00000000-0000-0000-0000-000000000003';
  perform pg_temp.assert(inv.status='sent' and inv.payment_amount=0 and inv.canceled_at is null, 'expiry does not pay or cancel the invoice');
  r := public.confirm_bachs_payment('chk_3','acct_1',10000,'NGN','collection.succeeded','SUCCEEDED','ch_3',null,'{}');
  perform pg_temp.assert((r->>'ok')::boolean and (r->>'paid')::boolean, 'a late success settles an expired charge');

  -- 5. ACCEPTED / OVERPAID never auto-settle.
  r := public.record_bachs_payment_outcome('chk_4','acct_1','collection.succeeded','ACCEPTED','manual_review','collection_accepted',null,'{}');
  perform pg_temp.assert((r->>'ok')::boolean, 'manual review recorded');
  select status into st from public.payment_charges where reference='chk_4';
  perform pg_temp.assert(st='manual_review', 'accepted collection parks for review');
  perform pg_temp.assert(
    exists (select 1 from public.audit_logs
            where resource_id='00000000-0000-0000-0000-000000000004'
              and action='payment.received' and result='success'),
    'manual review is logged as a received payment, not a failure');
  select * into inv from public.invoices where id='00000000-0000-0000-0000-000000000004';
  perform pg_temp.assert(inv.payment_amount=0, 'manual review does not credit');

  -- 6. An amount mismatch never settles.
  r := public.confirm_bachs_payment('chk_5','acct_1',9000,'NGN','collection.succeeded','SUCCEEDED','ch_5',null,'{}');
  perform pg_temp.assert((r->>'ok')::boolean = false and (r->>'reason')='amount_currency_mismatch', 'amount mismatch rejects');
  select status into st from public.payment_charges where reference='chk_5';
  perform pg_temp.assert(st='manual_review', 'mismatch parks the charge');

  -- 7. A different account cannot match the charge.
  r := public.confirm_bachs_payment('chk_5','acct_other',10000,'NGN','collection.succeeded','SUCCEEDED','ch_5',null,'{}');
  perform pg_temp.assert((r->>'reason')='unknown_reference', 'wrong account cannot touch the charge');

  -- 8. A lifecycle event never downgrades settled money.
  r := public.record_bachs_payment_outcome('chk_1','acct_1','checkout.expired','expired','expired',null,null,'{}');
  perform pg_temp.assert((r->>'ignored')::boolean and (r->>'reason')='already_settled', 'expiry after settlement is ignored');
  select status into st from public.payment_charges where reference='chk_1';
  perform pg_temp.assert(st='succeeded', 'settled charge is never downgraded');
end $$;

select 'ALL PASSED' as result;
