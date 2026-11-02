# T10 step 3b — Zoho Books invoice import (CSV)

Status: done
Task ID: zoho-invoice-export-2026-11

## Goal

Add the second accounting-system target for T10 step 3: a Zoho Books
**invoice import CSV** (`zoho_invoices_csv`) projected from the same canonical
typed line-row model as QuickBooks. The vendor's import wizard maps columns, so
this profile ships a clear provisional header set rather than a rigid template;
the 10 MB file cap and the auto-number off guidance come from Zoho's own help
page.

Not a Midday parity port. Classification: N/A (local export feature).

## Decisions / assumptions (confirmed with user, 2026-11-02)

- Proceed through the approved step-3 order: QuickBooks (done, `016c5fc`),
  **Zoho**, then Xero, behind configurable headings.
- Zoho Books maps imported columns to fields in its wizard, so no fixed column
  order is required. The headers below are provisional and labelled unverified
  until the sample file is supplied.
- **Auto-generate Invoice Numbers must stay off** so Velure numbers survive;
  the card says so.
- Zoho accepts **CSV/TSV/XLS up to 10 MB**; enforce the byte cap and abort
  rather than truncate. No row-count limit is invented.
- `Tax Name` comes from a **blank-default config table**
  (`ZOHO_TAX_NAME_CONFIG`), never invented. `Tax Amount` carries the line VAT.
  Taxable lines without a configured tax name produce a warning.
- Exclude credit notes (import as credit notes in Zoho), discounted invoices
  (the provisional columns carry no discount), non-base-currency invoices, and
  invoices without a customer, each with a returned warning.
- No in-file disclaimer row: the first line is the headers.

## Skills read

- `api-design-principles`: reuse the canonical row contract; target supplies
  headers, date rendering and code tables only.
- `code-review` / `frontend-security-coder`: CSV formula guard, warning
  surfacing, file-size guard.
- `database-migration`: additive reversible CHECK replacement.
- Gap: `supabase` skill is not installed; substitute = direct migration
  inspection + live read-only probes.

## Existing code inspected (concrete)

- `src/server/data/compliance-export.ts` — canonical model, QBO writer,
  `csvTextCell`, `buildInvoiceExportArtifact`.
- `src/features/compliance/accounting-import.ts` — date contract, QBO headers,
  blank-default config pattern.
- `src/server/data/compliance.ts:449-520` — `createInvoiceExport` target
  switch, base currency, warnings, audit.
- `src/routes/settings.compliance.tsx:110-123,1289-1338` — labels + QBO card.
- `supabase/migrations/20261105000000_invoice_export_kinds_qbo.sql` — current
  eight-kind CHECK.
- `src/server/data/compliance-export-qbo.test.ts` / `qbo-export-migration.test.ts`
  — test patterns to mirror.
- Zoho help, *Invoices → Import Invoices* (fetched 2026-11-02): CSV/TSV/XLS,
  10 MB maximum, field mapping, auto-generate invoice numbers option.

## Files likely to change / added

- `src/features/compliance/accounting-import.ts` — Zoho headers, 10 MB cap,
  blank-default tax-name config.
- `src/server/data/compliance-export.ts` — `zoho_invoices_csv` kind, writer,
  warnings, byte guard, generic-builder guards.
- `src/server/data/compliance.ts` — target switch + base currency.
- `src/routes/settings.compliance.tsx` — label + Zoho card.
- `supabase/migrations/20261106000000_invoice_export_kinds_zoho.sql` — NEW
  reversible CHECK replacement (nine kinds).
- `src/server/data/compliance-export-zoho.test.ts` — NEW projection tests.
- `src/server/data/zoho-export-migration.test.ts` — NEW migration contract.
- `src/server/data/compliance-export.test.ts` — generic-builder guards.
- `src/server/data/tenant-isolation-coverage.test.ts` — pure classification.
- `docs/EXPORT-FORMATS.md`, `docs/DECISIONS.md`, `docs/e-invoicing/STATE.md`,
  this prompt, Obsidian handoff.

## Implementation requirements

1. Provisional headers:
   `Invoice Number, Invoice Date, Due Date, Customer Name, Item Name, Item Description, Quantity, Item Price, Item Total, Tax Name, Tax Amount`.
2. One row per line; invoice number and dates repeated; no disclaimer row.
3. Dates default `DD/MM/YYYY` (shared builder option).
4. `Tax Name` from config (blank default); `Tax Amount` = line VAT.
5. Synthetic line = quantity 1, price = total = stored subtotal.
6. Exclusions and warnings as above; abort above 10 MB.
7. RFC 4180 quoting + formula-lead guard; numbers bare.
8. Migration replaces `invoice_exports_kind_check` with the eight existing
   kinds + `zoho_invoices_csv`; comment-only reversal.
9. No change to money arithmetic, numbering, issued-invoice immutability, or
   audit semantics.

## Acceptance criteria

- [x] `zoho_invoices_csv` is a valid kind and both generic builders refuse it.
- [x] Header line is exactly the eleven provisional headers, first line.
- [x] One row per line; invoice keys repeated; `DD/MM/YYYY`.
- [x] Tax name blank by default; taxable lines without a name warn; tax amount
      carries the line VAT.
- [x] Credit notes, discounted invoices, other-currency invoices and missing-
      customer invoices excluded with warnings; >10 MB aborts.
- [x] Synthetic line exported as quantity 1, price = total = subtotal.
- [x] Formula leads neutralised; money numeric.
- [x] Migration test pins nine kinds and a comment-only reversal.
- [x] Card states auto-number off, date format, 10 MB cap and exclusions.
- [x] `pnpm test`, `pnpm typecheck`, `pnpm check` pass.

## Checks to run

- Focused: `compliance-export-zoho.test.ts`, `zoho-export-migration.test.ts`,
  `compliance-export.test.ts`, `compliance-export-qbo.test.ts`,
  `nrs-claims.test.ts`, `tenant-isolation-coverage.test.ts`.
- Full: `pnpm test`, `pnpm typecheck`, `pnpm check`.
- Live: `supabase db push --linked --yes` (only the new kind migration);
  read-only verify the CHECK admits nine kinds and existing rows are untouched.

## Scope changes

- 2026-11-02: Zoho shipped with provisional headers and a blank-default tax-name
  table; diff against the real Zoho sample when supplied. Xero remains next.

## Result (2026-11-02)

- Commit: `feat(exports): add Zoho Books invoice import on canonical line rows`.
- `pnpm test` **990 passed / 86 skipped** (focused: Zoho projection 12,
  Zoho migration 5, QBO unchanged, tenant-isolation classification extended);
  `pnpm typecheck` clean; `pnpm check` exit 0 / 359 warnings.
- Live: `supabase db push --linked --yes` applied
  `20261106000000_invoice_export_kinds_zoho.sql` (only pending). Read-only
  verified: `invoice_exports_kind_check` admits nine kinds incl.
  `zoho_invoices_csv`; 11 rows intact (1 `customer_ledger_csv`, 4
  `invoices_csv`, 6 `tax_summary_csv`).
- Refactor: QBO and Zoho now share `includeAccountingInvoices` /
  `skippedWarning`; QBO output unchanged (its tests still pass).
