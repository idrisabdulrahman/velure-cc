# T10 step 1 — Accountant line export (CSV + XLSX)

Status: done
Task ID: accountant-line-export-2026-11

## Goal

Give an accountant an export with **one row per invoice line** so bookkeeping can
post to a ledger (QBO/Zoho/Xero-style), while still being able to group and sum
by invoice. New kinds: `accountant_lines_csv` and `accountant_lines_xlsx`.
`docs/EXPORT-FORMATS.md` is written FIRST and every column is given a language
tag (`[stored]`, `[derived]`, `[computed]`, `[inferred]`) so no column can ever
read as NRS-official data (SPEC A2: never claim clearance).

This is T10 step 1 of the four-step build order (recorded 2026-11-01 in
DECISIONS): (2) TaxPro Max-shaped VAT sales schedule, (3) QBO/Zoho import
CSVs then Xero, (4) received-WHT credit tracker = a proposal only.

This is not a Midday parity port. Classification: N/A (local export feature).
No Midday source is ported.

## Decisions / assumptions (confirmed with user)

- 2026-11-01 (user): after the TIN fix (`b1aa3a4`), the next slice is "T10 step
  1 + EXPORT-FORMATS.md (Recommended)". One row per invoice **line**, grouped by
  invoice number, in **both** XLSX and CSV.
- WHT stays an invoice-level, payment-time deduction (Q-H). It is never
  allocated to a line.
- Money is computed in **kobo** integer arithmetic throughout
  (`priceToKobo`/`lineTotalKobo`/largest-remainder), then emitted as naira
  decimals. No float arithmetic on the money path.
- XLSX is stored as **base64 text** in `invoice_exports.content` (the column is
  `text`); the download path decodes it.
- New kinds need a reversible migration widening the `kind` CHECK; the original
  constraint is auto-named `invoice_exports_kind_check`
  (`20260814235401_phase_a5…sql:8`).
- Per-line money is NOT stored, so the builder derives it and must reconcile
  to the stored snapshot. The design rules are:
  - `Σ line gross = kobo(snapshot.subtotal)` — if the stored line items do not
    add up to the stored subtotal (legacy rows), the **last line absorbs the
    residual**. Documented and tagged.
  - `Σ line discount = invoice discount` — line mode uses the line's own
    discount; invoice modes allocate the invoice-level discount over lines by
    largest remainder weighted by line gross, in BOTH before- and after-tax
    modes.
  - `Σ line vat = kobo(snapshot.totalTax)` — allocated by largest remainder
    weighted by (gross − discount) over `standard` lines only;
    zero_rated/exempt lines take 0; fall back to weighting over all lines when
    no standard line exists but a VAT total is stored.
  - `line net = gross − discount − (inclusive ? vat : 0)`, so
    `Σ(net+vat) = kobo(snapshot.grandTotal)` in every mode; WHT only subtracts
    at invoice level.
  - inclusive/exclusive: trust the stored `compliance.taxTreatment`
    (`InvoiceComplianceSnapshot` types.ts:180); when absent, infer inclusive
    iff `kobo(grandTotal) === kobo(subtotal) − discount`; else exclusive.
- Invoice-level columns (`invoiceSubtotal…invoiceNetPayable`) print on the
  FIRST row of each invoice group only and are blank on continuation rows;
  repeating text keys (number, customer, dates, status, doc type, currency)
  repeat on every row.
- Credit notes negate every money column (line + invoice level), matching the
  existing exports.
- The `xlsx@0.18.5` dependency already exists (dynamic-imported client-side in
  `invoices.index.lazy.tsx:264`); no new dependency.

## Skills read

- `api-design-principles`: single source of truth for the row builder feeding
  both formats; contract documented in EXPORT-FORMATS.md.
- `database-migration`: reversible (re-established) CHECK-constraint widening.
- `supabase-postgres-best-practices`: constraint replacement ordering.
- `code-review`/`frontend-security-coder`: SpreadsheetML/xlsx output is a
  downloaded file — the formula-injection guard carries over to the new CSV.
- Gap recorded: `supabase` skill not installed in this environment (also noted
  in `tin-length-10-12-2026-11`); substitute = direct migration inspection.

## Existing code inspected (concrete)

- `src/server/data/compliance-export.ts:3-7` — `ComplianceExportKind` (4 kinds
  today); `:29-41` `CSV_HEADERS`; `:44-52` `numeric()`; `:64-93`
  `invoiceTotalForExportRow` (netPayable → grandTotal−WHT → Σlines →
  payment_amount precedence); `:104-113` `csvTextCell`/`csvValueCell`
  (formula-lead guard `FORMULA_LEAD` at :104, free-text only); `:115-119`
  `documentTypeForExportRow`; `:132-146` `invoiceMoneyForExportRow`
  (credit-note sign ×); `:155-192` `buildInvoiceExportContent` (disclaimer
  line + header + rows for CSV; JSON for `normalized_accounting`).
- `src/server/data/compliance.ts:390-410` — `loadAllExportInvoices` pages in
  1000-row ranges; selects
  `invoice_number, customer_name, document_type, currency, payment_amount,
  status, issue_date, due_date, compliance, line_items` — notably NOT
  `template_settings` (discount lives there). `:412-456`
  `createInvoiceExport`: file prefix from workspace initials; file name
  `${prefix}-${kind}-${now}.${json|csv}`; inserts `status:"ready"` +
  `content`; records `invoice.export` audit with `rowCount`.
- `src/routes/settings.compliance.tsx:110-119` `formatExportKind`;
  `:121-125` `formatExportDisplayName`; `:127-141` `downloadExportContent`
  (json/csv MIME only); `:263-265` `visibleExports` filters out
  `normalized_accounting`; `:1102-1190` three export cards;
  `:1192-1241` history list.
- `src/features/compliance/calculate.ts:184-225` `resolveInvoiceDiscount`
  (modes mutually exclusive; stored discount w/o mode →
  `invoice_after_tax`); `:227-303` `calculateInvoiceCompliance` (before-tax
  reduces the taxable base; inclusive `totalTax = percentageKobo(base, rate,
  true)`, `grandTotal = base`; exclusive adds VAT; after-tax subtracted from
  grandTotal after tax; WHT snapshot on grandTotal).
- `src/features/invoices/line-money.ts:3-30` — `priceToKobo` (string/number →
  exact kobo, safe-integer guarded) and `lineTotalKobo` (whole-quantity ×
  price).
- `src/features/invoices/types.ts:21-32` — `InvoiceLineItem`
  `{name, quantity, price, unit, vatCategory, classificationCode, discount}`;
  `discount` in major units (line mode only).
- `src/features/compliance/types.ts:174-197` — stored snapshot carries
  `taxTreatment`, `taxRate`, `subtotal`, `totalTax`, `grandTotal`,
  `netPayable`, `withholdingTaxAmount` (major units), but NOT the discount
  fields.
- `src/server/data/invoices.ts:560-636` — `assertInvoiceInput` write guards:
  discount between 0 and subtotal; line discount ≤ line amount; line+invoice
  discounts mutually exclusive; `template_settings.includeDiscount` gates the
  invoice discount.
- `supabase/migrations/20260814235401_phase_a5_invoice_delivery_exports_events.sql:8`
  — inline `check (kind in ('invoices_csv','tax_summary_csv',
  'customer_ledger_csv','normalized_accounting'))` → auto-name
  `invoice_exports_kind_check`.
- `src/server/data/compliance-export.test.ts` — the exact-row test style to
  mirror; `src/server/data/tin-length-migration.test.ts` — the
  migration-contract test pattern.
- `src/types/database.types.ts:621-660` — `invoice_exports.content` is `text`.
- `src/routes/invoices.index.lazy.tsx:263-279` — client xlsx usage pattern
  (`await import("xlsx")`, `XLSX.read(..., {type:"array"})`,
  `sheet_to_json(header:1)`).

## Files likely to change or be added

- `docs/EXPORT-FORMATS.md` — NEW, first artifact.
- `src/server/data/compliance-export.ts` — kinds + row shape
  (`template_settings`), accountant line-row builder (kobo → naira cells),
  CSV writer, XLSX writer (async, dynamic import → base64), artifact
  dispatcher.
- `src/server/data/compliance.ts` — `loadAllExportInvoices` adds
  `template_settings` to the select; `createInvoiceExport` awaits the
  artifact builder; file-name extension gains `.xlsx`.
- `supabase/migrations/20261102000000_invoice_export_kinds_accountant.sql` —
  NEW reversible CHECK widening (4 → 6 kinds).
- `src/server/data/export-kind-migration.test.ts` — NEW contract test.
- `src/server/data/compliance-export.test.ts` — extend ALL_KINDS pinning.
- `src/server/data/compliance-export-accountant.test.ts` — NEW: allocation +
  reconciliation + group semantics + credit note + legacy residual + formula
  guard + XLSX round-trip.
- `src/routes/settings.compliance.tsx` — kind labels, `.xlsx` download
  branch, two new export cards.
- `docs/e-invoicing/STATE.md`, `docs/DECISIONS.md` — append entries.

## Implementation requirements

1. `docs/EXPORT-FORMATS.md` first: per-format purpose, column list, money
   unit, sign convention, disclaimer, group semantics, and a confidence tag
   per column (stored/derived/computed/inferred). Steps 2/3/4 recorded as
   not-built.
2. One builder produces the row model; CSV and XLSX are two projections of it.
3. All money math in kobo with `Number.isSafeInteger` guarding; output as
   exact naira decimals (plain for CSV numeric columns; numeric cells for
   XLSX).
4. WHT invoice-level only (Q-H).
5. The XLSX artifact is base64 in `invoice_exports.content`; the sheet
   carries the disclaimer in cell A1 above the header row.
6. Migration: drop `invoice_exports_kind_check`, recreate it with the six
   kinds; reversal restores the original four (commented reversal block,
   repo convention — never auto-run).
7. No changes to the four existing export kinds' byte-level output beyond the
   additive `template_settings` key inside `normalized_accounting` JSON rows
   (documented in EXPORT-FORMATS.md).
8. Scope guards: no step 2/3/4 work; no banking/Magic Inbox; never print or
   commit secrets; issued invoices untouched.

## Acceptance criteria

- [x] `docs/EXPORT-FORMATS.md` exists first and covers every existing + new
      format with column language tags and the legacy residual rule.
- [x] New kinds produce one row per line; invoice-level columns only on the
      first row of each invoice; text keys repeat.
- [x] In every mode exercised (exclusive, inclusive, before-tax, after-tax,
      line discount, no discount): Σ lineGross = invoiceSubtotal,
      Σ lineDiscount = invoiceDiscount, Σ vat = invoiceVat, and
      Σ(lineNet+vat) = grandTotal in kobo, reconciled EXACTLY to the stored
      snapshot (`compliance-export-accountant.test.ts`).
- [x] Legacy rows whose lines do not sum to the stored subtotal reconcile
      (last line absorbs the residual); rows with no line items get one
      synthetic line row; a malformed discount combination degrades to
      instead of aborting.
- [x] Credit-note rows negate all money columns; WHT never appears on a line.
- [x] The CSV keeps the disclaimer line above the header; the XLSX keeps it
      in A1; a formula-lead line description is neutralised in both.
- [x] The generated XLSX parses back (SheetJS round-trip) with the same
      header and values; the download path decodes base64 with the
      SpreadsheetML MIME.
- [x] Migration widens the CHECK reversibly; contract test pins the six
      kinds; the migration validates on live under `begin…rollback` and the
      rollback leaves the original constraint enforced (verified by a probe
      insert that correctly failed after rollback).
- [x] Exports tab shows the new "Accountant line export" card (CSV + Excel
      buttons); history lists/releases/downloads both formats
      (`visibleExports` already filters only `normalized_accounting`).
- [x] `pnpm test` 921 passed / 86 skipped; `pnpm typecheck` clean; `pnpm check`
      exit 0 / 359 pre-existing warnings.

## Checks to run

- `pnpm test`, `pnpm typecheck`, `pnpm check` — run; figures above.
- Focused (3 files, 39 tests): `compliance-export.test.ts`,
  `compliance-export-accountant.test.ts`, `export-kind-migration.test.ts` —
  pass.
- Live DB (read-only): constraint confirmed auto-named
  `invoice_exports_kind_check` (11 stored rows, all original kinds); the
  CHECK swap ran under `begin…rollback` and parsed cleanly; a probe insert of
  `accountant_lines_csv` was rejected after rollback, so nothing persisted.
- **Deployment prerequisite:** the new kinds cannot store until
  `supabase/migrations/20261102000000_invoice_export_kinds_accountant.sql`
  applies through the file-based pipeline (`supabase db push`), the same
  pending list as the TIN widening migration.

## Scope changes (append-only)

- 2026-11-01: created.
- 2026-11-01: tenant-isolation coverage guard classified the new exported
  `buildInvoiceExportArtifact` as `pure` (no client access; serializer over
  already-loaded rows). The guard caught it mid-run, as designed.
