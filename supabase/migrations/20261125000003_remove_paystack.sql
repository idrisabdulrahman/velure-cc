-- Remove the retired Paystack integration from the database surface.
--
-- Bachs is the only online collection provider; manual recording is unchanged.
-- Financial history is preserved:
--   * payment_transactions holds zero paystack rows (source/provider), so no
--     settled transaction is ever touched (guarded below).
--   * invoices.payment_provider = 'paystack' is a single un-settled marker that
--     is cleared to null.
--   * payment_charges.provider = 'paystack' holds only un-settled attempts
--     (expired/pending) with no matching transaction row; they are deleted.
--
-- Rollback (documented, not automated):
--   alter type public.payment_source add value 'paystack';
--   alter table public.payment_charges drop constraint payment_charges_provider_check;
--   alter table public.payment_charges add constraint payment_charges_provider_check
--     check (provider in ('paystack', 'bachs'));
--   alter table public.payment_charges alter column provider set default 'paystack';
--   -- then recreate public.confirm_paystack_payment(...) from
--   -- 20260818143000_phase_a10_atomic_paystack_confirmation.sql.

-- Guard: refuse the whole migration if settled Paystack money exists. This is a
-- safety net only; recon confirmed zero such rows.
do $guard$
begin
  if exists (
    select 1 from public.payment_transactions
    where source = 'paystack' or provider = 'paystack'
  ) then
    raise exception 'Refusing to remove paystack: settled payment_transactions rows exist.';
  end if;
end
$guard$;

-- 1) Clear the retired invoice marker (un-settled; no payment references it).
update public.invoices
set payment_provider = null, updated_at = now()
where payment_provider = 'paystack';

-- 2) Drop the un-settled Paystack charges (no transaction references them).
delete from public.payment_charges where provider = 'paystack';

-- 3) Drop the Paystack confirmation RPC.
drop function if exists public.confirm_paystack_payment(text, numeric, text, text, text, text, text, jsonb);

-- 4) Narrow the charge provider check to Bachs only, and drop the Paystack
--    default so a future insert can never be silently flagged as paystack.
alter table public.payment_charges alter column provider drop default;
alter table public.payment_charges drop constraint payment_charges_provider_check;
alter table public.payment_charges add constraint payment_charges_provider_check check (provider in ('bachs'));

-- 5) Remove 'paystack' from the payment_source enum. Postgres cannot drop a
--    label in place, so recreate the type and swap the three dependent columns
--    (values are cast through text, so no data is lost). The Bachs RLS policies
--    on payment_transactions reference the `source` column, so they are dropped
--    and recreated verbatim around the column swap.
drop policy payment_transactions_bachs_insert_service_only on public.payment_transactions;
drop policy payment_transactions_bachs_update_service_only on public.payment_transactions;
drop policy payment_transactions_bachs_delete_service_only on public.payment_transactions;

alter type public.payment_source rename to payment_source_old;
create type public.payment_source as enum ('manual', 'bachs');

alter table public.invoices
  alter column payment_provider type public.payment_source
  using payment_provider::text::public.payment_source;

alter table public.payment_transactions
  alter column source type public.payment_source
  using source::text::public.payment_source;

alter table public.recurring_invoice_schedules
  alter column payment_provider type public.payment_source
  using payment_provider::text::public.payment_source;

drop type public.payment_source_old;

create policy payment_transactions_bachs_insert_service_only on public.payment_transactions
  as restrictive for insert to authenticated with check (provider is distinct from 'bachs' and source <> 'bachs');
create policy payment_transactions_bachs_update_service_only on public.payment_transactions
  as restrictive for update to authenticated using (provider is distinct from 'bachs' and source <> 'bachs') with check (provider is distinct from 'bachs' and source <> 'bachs');
create policy payment_transactions_bachs_delete_service_only on public.payment_transactions
  as restrictive for delete to authenticated using (provider is distinct from 'bachs' and source <> 'bachs');
