-- Velure T10 step 3 (2026-11-02): Zoho Books invoice import kind.
-- (docs/EXPORT-FORMATS.md; prompts/zoho-invoice-export-2026-11.md).
--
-- Adds `zoho_invoices_csv` to `invoice_exports_kind_check`. The migration is
-- ADDITIVE and REVERSIBLE: every previously admitted kind keeps its meaning,
-- no row is rewritten, and the applied migrations
-- 20261102000000_invoice_export_kinds_accountant.sql,
-- 20261104000000_invoice_export_kinds_rev360_vat_schedule.sql and
-- 20261105000000_invoice_export_kinds_qbo.sql stay byte-for-byte untouched.
--
-- The CHECK is widened by replacement only. Live rows are unaffected because
-- this only adds an accepted value; if a future narrowing would ever hit a
-- stored row, the ADD CONSTRAINT would fail loudly rather than silently
-- deleting it.

alter table public.invoice_exports
  drop constraint invoice_exports_kind_check;

alter table public.invoice_exports
  add constraint invoice_exports_kind_check
  check (
    kind in (
      'invoices_csv',
      'tax_summary_csv',
      'customer_ledger_csv',
      'normalized_accounting',
      'accountant_lines_csv',
      'accountant_lines_xlsx',
      'vat_sales_schedule_xlsx',
      'qbo_invoices_csv',
      'zoho_invoices_csv'
    )
  );

-- Reversal — restore the pre-migration eight-kind check after removing any
-- rows that use the new kind:
--
-- delete from public.invoice_exports
--  where kind = 'zoho_invoices_csv';
--
-- alter table public.invoice_exports
--   drop constraint invoice_exports_kind_check;
--
-- alter table public.invoice_exports
--   add constraint invoice_exports_kind_check
--   check (
--     kind in (
--       'invoices_csv',
--       'tax_summary_csv',
--       'customer_ledger_csv',
--       'normalized_accounting',
--       'accountant_lines_csv',
--       'accountant_lines_xlsx',
--       'vat_sales_schedule_xlsx',
--       'qbo_invoices_csv'
--     )
--   );
