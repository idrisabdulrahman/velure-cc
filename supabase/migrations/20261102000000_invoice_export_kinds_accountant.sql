-- Velure T10 step 1: accountant line export kinds
-- (docs/EXPORT-FORMATS.md; prompts/accountant-line-export-2026-11.md).
--
-- The invoice_exports.kind CHECK was created inline by
-- 20260814235401_phase_a5_invoice_delivery_exports_events.sql, so Postgres
-- auto-named it invoice_exports_kind_check. New export kinds must be
-- REVERSIBLE and additive: the original four kinds keep their meaning and
-- no existing row is rewritten, so an old export stays readable.
--
-- kind. Undoing it requires that no row already uses the new kinds (delete those
-- export records first, manually) — documented in the reversal block.

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
      'accountant_lines_xlsx'
    )
  );

-- Reversal (run manually if this migration must be undone). Delete any rows
-- that already use the new kinds first, then restore the original
-- four-kind check:
--
-- delete from public.invoice_exports
--  where kind in ('accountant_lines_csv', 'accountant_lines_xlsx');
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
--       'normalized_accounting'
--     )
--   );
