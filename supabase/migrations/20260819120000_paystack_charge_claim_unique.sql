create unique index if not exists payment_charges_one_pending_per_invoice
  on public.payment_charges (invoice_id)
  where status = 'pending';
