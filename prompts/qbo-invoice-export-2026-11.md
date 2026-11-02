# T10 step 3 — canonical accounting rows + QuickBooks invoice import (CSV)

Status: done
Task ID: qbo-invoice-export-2026-11

## Goal

Build the first accounting-system import target for T10 step 3: one canonical
typed per-line row model shared by every target, and a QuickBooks Online
**invoice import CSV** (`qbo_invoices_csv`) projected from it. Later slices add
Zoho (CSV) and Xero (fixed headings) behind the same model.

Not a Midday parity port. Classification: N/A (local export feature).

## Decisions / assumptions (confirmed with user, 2026-11-02)

- Proceed with step 3 (flat export first, then QuickBooks → Zoho → Xero) behind
  configurable headings; diff against real template files when supplied.
- One canonical flat row model, per-target mapping profiles. Only Xero has a
  rigid heading/order contract.
- QuickBooks import files keep the **vendor headers exactly**: no leading
  disclaimer row (documented in-file disclaimer exception). The screen and
  audit log carry the informational framing.
- Dates default to `DD/MM/YYYY`. The date format is exposed as a builder option
  (`AccountingDateFormat`) and shown on the card; a persisted export setting is
  deferred until the Xero slice (Xero depends on the organisation's regional
  settings).
- `Terms` is left blank: Velure stores payment-terms **days**, not a QuickBooks
  term name, and QBO rejects unknown term names. Never invent `Net 30`.
- `Item Tax Code` is a config table (`QBO_ITEM_TAX_CODE_CONFIG`), blank by
  default; never guess a QBO tax code.
- Custom invoice numbers survive only when the QBO company has "Custom
  transaction numbers" on. The card states this; Velure cannot detect it.
- Excluded from the QBO file, each with a returned warning: credit notes
  (import as credit memos), discounted invoices (the vendor columns have no
  discount field), invoices in a currency other than the workspace base
  currency, and invoices with no customer name (QBO requires one).
- Hard limits: **100 invoices** and **1,000 data rows** per file. Above either,
  the export aborts with an actionable error until auto-split exists.
- Credit notes stay in every other export kind; only the QBO profile excludes
  them.

## Skills read

- `api-design-principles`: one canonical row contract, thin per-target profile.
- `code-review` / `frontend-security-coder`: CSV formula-lead guard, warning
  surfacing on money exclusions.
- `database-migration`: additive reversible CHECK replacement.
- Gap: `supabase` skill is not installed (same gap recorded by prior prompts);
  substitute = direct migration inspection + live read-only probes.

## Existing code inspected (concrete)

- `src/server/data/compliance-export.ts:1-23` kind union; `:54-66` CSV headers;
  `:129-148` formula guard; `:260-283` accountant headers; `:336-398` stored
  lines / synthetic line; `:400-569` `accountantRowsForInvoice` (kobo money
  identity); `:571-596` XLSX projection; `:598-727` Rev360 rows/XLSX; `:729-746`
  `buildInvoiceExportArtifact`.
- `src/server/data/compliance.ts:388-447` paging + client Tax ID map; `:449-499`
  `createInvoiceExport` (workspace source, extension mapping, audit).
- `src/routes/settings.compliance.tsx:110-123` kind labels; `:237-241`
  `createExport`; `:1209-1288` accountant + Rev360 cards; `:1292-1334` history.
- `src/server/data/compliance-export.test.ts:19-51` kind lists + sync rejection.
- `supabase/migrations/20261104000000_invoice_export_kinds_rev360_vat_schedule.sql`
  — current seven-kind CHECK.
- `src/server/data/rev360-vat-schedule-migration.test.ts` — migration contract
  pattern.
- `src/features/compliance/rev360-vat-status.ts` — config-table pattern.
- `docs/EXPORT-FORMATS.md:1-57,188-290` — contract + planned-order section.

## Files likely to change / added

- `src/features/compliance/accounting-import.ts` — NEW date-format contract,
  QBO headers, blank-default QBO tax-code config.
- `src/server/data/compliance-export.ts` — `qbo_invoices_csv` kind, canonical
  typed line-row model (built from `accountantRowsForInvoice` cells), QBO CSV
  projection, warnings + limits, sync/artifact guards.
- `src/server/data/compliance.ts` — pass base currency, collect warnings, audit
  the exported counts.
- `src/routes/settings.compliance.tsx` — label, QBO card, warning/error toast.
- `supabase/migrations/20261105000000_invoice_export_kinds_qbo.sql` — NEW
  reversible CHECK replacement (eight kinds).
- `src/server/data/compliance-export-qbo.test.ts` — NEW projection tests.
- `src/server/data/qbo-export-migration.test.ts` — NEW migration contract.
- `src/server/data/compliance-export.test.ts` — kind lists.
- `docs/EXPORT-FORMATS.md`, `docs/DECISIONS.md`, `docs/e-invoicing/STATE.md`,
  this prompt.

## Implementation requirements

1. Canonical row model reuses `accountantRowsForInvoice` cells (no second money
   derivation). Invoice-level cells stay `null` on continuation rows.
2. QBO headers exactly:
   `Invoice No.,Customer,Invoice Date,Due Date,Terms,Item,Item Description,Item Quantity,Item Rate,Item Amount,Item Tax Code`.
3. One row per invoice line; the invoice number repeats on every line. No
   disclaimer line in the file.
4. Dates `DD/MM/YYYY` (option parameter), blank for missing/invalid dates.
5. Synthetic lines (no stored line items) export as one line with quantity 1,
   rate = amount = the stored subtotal, plus a warning.
6. Exclusions and limits as decided above; warnings returned from
   `createInvoiceExport`.
7. Formula-lead guard on every text cell; numbers stay numeric.
8. Migration replaces `invoice_exports_kind_check` with the seven existing
   kinds + `qbo_invoices_csv`; comment-only reversal; applied migrations
   untouched.
9. No change to money arithmetic, numbering, issued-invoice immutability, or
   audit-log semantics beyond the export entry.

## Acceptance criteria

- [x] `qbo_invoices_csv` is a valid kind and the sync builder/artifact builder
      refuse it (it must go through `buildQboInvoicesExport`).
- [x] Header line is exactly the eleven vendor headers, first line, no
      disclaimer row.
- [x] One row per line; invoice number/date repeated per line; `DD/MM/YYYY`.
- [x] Credit notes, discounted invoices, other-currency invoices and
      missing-customer invoices are excluded with one deterministic warning
      each; limits abort above 100 invoices / 1,000 rows.
- [x] Synthetic line exported as quantity 1, rate = amount = stored subtotal.
- [x] `Item Tax Code` blank by default via config; no invented code.
- [x] Formula leads neutralised; money stays numeric and reconciles with the
      accountant row model.
- [x] Migration test pins eight kinds and a comment-only reversal.
- [x] Card shows the date format, the custom-number caveat, exclusions, and
      surfaces warnings/errors.
- [x] `pnpm test`, `pnpm typecheck`, `pnpm check` pass.

## Checks to run

- Focused: `compliance-export-qbo.test.ts`, `qbo-export-migration.test.ts`,
  `compliance-export.test.ts`, `compliance-export-accountant.test.ts`,
  `nrs-claims.test.ts`.
- Full: `pnpm test`, `pnpm typecheck`, `pnpm check`.
- Live (after gates): `supabase db push --linked --yes` applies only the new
  kind migration; read-only verify the CHECK admits eight kinds and existing
  export rows are untouched.

## Results

- `pnpm test` → **969 passed / 86 skipped** (114 files passed, 10 skipped).
- `pnpm typecheck` → clean.
- `pnpm check` → exit 0 / 359 pre-existing warnings.
- Focused (6 files, 79 tests) green: QBO projection, migration contract,
  generic export suite, accountant suite, Rev360 suite, `nrs-claims`.
- Live: `supabase db push --linked --yes` applied only
  `20261105000000_invoice_export_kinds_qbo.sql`. Read-only verify:
  `invoice_exports_kind_check` admits the seven prior kinds plus
  `qbo_invoices_csv`; the 11 existing export rows are unchanged
  (1 customer_ledger_csv, 4 invoices_csv, 6 tax_summary_csv).
- Incidental correctness fix: `csvTextCell` now emits RFC 4180 quoting
  (embedded `"` doubled) instead of JSON escaping. JSON escaping is not CSV and
  would corrupt any quoted line description in a vendor import. The accountant
  test helper now parses CSV instead of `JSON.parse`.
- `tenant-isolation-coverage` classifies the two new pure exports.

## Scope changes

- 2026-11-02: persisted export date setting and the Zoho/Xero profiles are
  deferred to their own slices; this slice ships the canonical model and QBO.
