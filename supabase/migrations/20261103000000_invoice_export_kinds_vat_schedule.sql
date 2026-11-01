-- Velure T10 step 2: VAT sales schedule export kind
-- (docs/EXPORT-FORMATS.md; prompts/taxpro-vat-schedule-2026-11.md).
--
-- The invoice_exports.kind CHECK was grown from four to six kinds by
-- 20261102000000_invoice_export_kinds_accountant.sql. This migration is
-- purely additive and REVERSIBLE: it adds the seventh kind
-- `vat_sales_schedule_csv` and leaves every existing kind and row untouched,
-- so an old export stays readable.
--
-- Undoing it is documented at the bottom: delete any rows that use the new
-- kind first, then restore the six-kind check. The block is documentation only
-- and is never executed by the pipeline.

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
      'vat_sales_schedule_csv'
    )
  );

-- Reversal — restore the six-kind check after removing any rows that use the
-- seventh kind:
--
-- delete from public.invoice_exports
--  where kind = 'vat_sales_schedule_csv';
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
--       'accountant_lines_xlsx'
--     )
--   );