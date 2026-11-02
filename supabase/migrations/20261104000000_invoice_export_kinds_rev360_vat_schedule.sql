-- Velure T10 step 2 correction (2026-11-01): Rev360 VAT sales schedule kind.
-- (docs/EXPORT-FORMATS.md; prompts/rev360-vat-schedule-2026-11.md).
--
-- NRS retired TaxPro Max and replaced it with Rev360. The provisional
-- `vat_sales_schedule_csv` kind (added by
-- 20261103000000_invoice_export_kinds_vat_schedule.sql) is superseded by the
-- six-field Rev360 XLSX schedule `vat_sales_schedule_xlsx`. This migration
-- REPLACES the retired kind: the CHECK admits the same six pre-existing kinds
-- plus the new one, and no longer admits `vat_sales_schedule_csv`.
--
-- It is REVERSIBLE (reversal documented below, never executed by the
-- pipeline). The live database had zero `vat_sales_schedule_csv` rows when
-- this ran (verified 2026-11-01), so narrowing the CHECK cannot fail; if any
-- row ever used the retired kind the ADD CONSTRAINT fails loudly rather than
-- silently deleting it. Every existing kind and row is otherwise untouched.
--
-- The applied migrations 20261102000000_invoice_export_kinds_accountant.sql and
-- 20261103000000_invoice_export_kinds_vat_schedule.sql stay byte-for-byte
-- untouched.

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
      'vat_sales_schedule_xlsx'
    )
  );

-- Reversal — restore the pre-migration seven-kind check (the six kinds plus the
-- retired `vat_sales_schedule_csv`) after removing any rows that use the new
-- kind:
--
-- delete from public.invoice_exports
--  where kind = 'vat_sales_schedule_xlsx';
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
--       'vat_sales_schedule_csv'
--     )
--   );
