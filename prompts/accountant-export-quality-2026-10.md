# T10 — Accountant export quality (VAT/WHT split, credit-note signs, currency)

Status: done
Task: T10 from `Task List.md`. Builds on `prompts/csv-import-export-hardening.md`
(the 1000-row cap and formula injection were already fixed in `ca53467`).

## Goal

Make the compliance CSV genuinely usable by an accountant: expose the tax split
(subtotal, VAT, withholding), identify the document type, and sign credit/debit
notes correctly, while keeping the per-row currency and the NRS disclaimer.

## Premise check

T10 asks to "test CSV/Excel exports with a realistic data set, including the
1000-row cap fix. Check column naming, VAT/WHT splits, credit-note signs, and
currency." The 1000-row paging fix is already in `loadAllExportInvoices`
(`compliance.ts:388-410`) and formula injection is guarded in
`compliance-export.ts:92-101`. What remains, verified in code:

- the CSV has only `invoiceNumber,customerName,currency,total,status,issueDate,
  dueDate` — **no VAT, no withholding, no subtotal, no document type**;
- `loadAllExportInvoices` does not even `select("document_type")`, so credit
  notes are indistinguishable from standard invoices and are not signed;
- `compliance.totalTax` and `compliance.withholdingTaxAmount` exist in the
  stored snapshot (`features/compliance/types.ts:174-197`) but are dropped.

## Decisions / assumptions (confirmed with user)

- **2026-10-30 (user):** "proceed with the standard audit now"; a real
  (anonymized) accountant request can be matched later. Column names/order are
  therefore **provisional** until that request arrives.
- Keep `total` as the amount payable after withholding (existing precedence),
  and add `subtotal`, `vat`, `withholdingTax` around it.
- Credit notes reduce revenue: their money columns export **negative**. Debit
  notes and standard invoices stay positive.
- Currency stays a per-row column; no conversion and no mixed-currency totals.
- No schema, migration, RLS, numbering, or issued-invoice change. This is a
  read-only projection over the stored snapshot.

## Skills read

- `supabase-postgres-best-practices` (installed) for the PostgREST select/RLS
  reasoning. Repo governance applied by hand. No Midday source exists for this
  path, so the Midday parity rule does not apply.

## Existing code inspected

- `src/server/data/compliance-export.ts` — `ComplianceExportInvoiceRow`
  (:9-19), `CSV_HEADERS` (:21-29), `invoiceTotalForExportRow` (:52-81),
  `csvTextCell`/`csvValueCell` (:92-101), `buildInvoiceExportContent`
  (:110-142).
- `src/server/data/compliance.ts:388-410` — `loadAllExportInvoices` (select
  omits `document_type`).
- `src/server/data/compliance.ts:412-456` — `createInvoiceExport` (audit
  `rowCount`, kind, disclaimer path).
- `src/features/compliance/types.ts:174-197` — `InvoiceComplianceSnapshot`
  (`subtotal`, `totalTax`, `withholdingTaxAmount`, `netPayable`, `grandTotal`).
- `src/features/invoices/types.ts:62-80` — `InvoiceDocumentType`,
  `isCorrectionDocumentType`.
- `src/server/data/compliance-export.test.ts` — current exact-row assertions.
- `src/server/data/compliance-export-paging.test.ts` — the 1000-row cap.

## Files likely to change or be added

- **Edit** `src/server/data/compliance.ts` — add `document_type` to the select.
- **Edit** `src/server/data/compliance-export.ts` — add `document_type` to the
  row type; add `subtotal`/`vat`/`withholdingTax`/`documentType` columns; sign
  credit notes negative; keep the formula guard on free-text columns.
- **Edit** `src/server/data/compliance-export.test.ts` — update the exact-row
  assertions and add VAT/WHT/credit-note cases.
- **Edit** `src/server/data/compliance-export-paging.test.ts` if its row
  fixtures need the new field (it must stay green).
- **Add** `prompts/accountant-export-quality-2026-10.md` (this file).

## Implementation requirements

1. CSV header becomes (provisional):
   `invoiceNumber,customerName,documentType,currency,subtotal,vat,withholdingTax,total,status,issueDate,dueDate`
2. Money columns are numeric and **not** apostrophe-guarded, so spreadsheets can
   sum them:
   - `subtotal` = `compliance.subtotal`
   - `vat` = `compliance.totalTax`
   - `withholdingTax` = `compliance.withholdingTaxAmount`
   - `total` = the existing `invoiceTotalForExportRow` precedence
   Missing snapshot values fall back to `0` (never `undefined`/`NaN`).
3. A `credit_note` row negates `subtotal`, `vat`, `withholdingTax` and `total`.
   `debit_note`, `standard` and `proforma` stay positive. `proforma` remains
   identifiable by `documentType`.
4. `documentType` exports the raw stored value (`standard` / `credit_note` /
   `debit_note` / `proforma`), defaulting to `standard` when null/absent.
5. Currency stays a per-row column; do not convert or aggregate.
6. The `NRS_INFORMATIONAL_DISCLAIMER` stays the first CSV line, and the JSON
   `normalized_accounting` export keeps its `disclaimer` field.
7. `normalized_accounting` JSON rows include the new fields automatically via
   the row objects; do not hand-build a second shape.
8. No float money beyond the existing snapshot decimals; reuse the current
   rounding helper when computing a fallback.

## Acceptance criteria

1. A row with `compliance: { subtotal: 100000, totalTax: 7500,
   withholdingTaxAmount: 5000, netPayable: 102500 }` exports
   `subtotal=100000, vat=7500, withholdingTax=5000, total=102500`.
2. A `credit_note` row exports negative money values; the same row as `standard`
   exports positive values.
3. `documentType` appears in the header and defaults to `standard` when absent.
4. The formula guard still neutralises a leading `= + - @` in `customerName`,
   and the numeric columns stay unguarded.
5. The disclaimer remains the first CSV line.
6. Paging still includes rows beyond the first 1000-row page (existing test green
   with the new row shape).
7. `pnpm typecheck`, focused tests, `pnpm test`, and `pnpm check` pass.

## Checks to run

- `pnpm typecheck`
- `pnpm vitest run src/server/data/compliance-export.test.ts
  src/server/data/compliance-export-paging.test.ts`
- `pnpm test`
- `pnpm check`
- Optional live read-back: generate an `invoices_csv` for a QA workspace and
  confirm the header and a real row's split.

## Open input (not blocking)

- The user's real (anonymized) accountant request and the accounting tools their
  accountants use. When supplied, column names/order can be matched exactly.
  Until then the columns above are provisional.

## Scope changes (append-only)

- 2026-10-30: Prompt created. User chose the standard audit; real request later.

## Result

Implemented 2026-10-30 in the `t10-accountant-export` worktree.

### Files changed

- `src/server/data/compliance.ts` — `loadAllExportInvoices` now selects
  `document_type` alongside the existing columns.
- `src/server/data/compliance-export.ts` — `ComplianceExportInvoiceRow` gains
  optional `document_type`; `CSV_HEADERS` becomes
  `invoiceNumber,customerName,documentType,currency,subtotal,vat,withholdingTax,total,status,issueDate,dueDate`;
  new private `documentTypeForExportRow` (defaults to `standard`) and
  `invoiceMoneyForExportRow` (subtle/`subtotal`/`vat`/`withholdingTax`/`total`,
  credit notes negated, missing values `0`). The formula guard stays on the
  free-text columns (now including `documentType`); the money columns stay
  unguarded. The JSON `normalized_accounting` shape is unchanged apart from
  including the newly selected `document_type` via the raw row objects.
- `src/server/data/compliance-export.test.ts` — exact-row assertions updated to
  the new shape; added the VAT/WHT split case, the `standard`-default case, the
  credit-note negative-sign case, and a debit-note/pro-forma positive case.
- `src/server/data/compliance-export-paging.test.ts` — fixture gains
  `document_type`; the total assertion matches the new column order; a new case
  proves `document_type` is read so a credit note pages through signed.
- `prompts/accountant-export-quality-2026-10.md` — this file.

### Checks run

- `pnpm typecheck` — pass (no output).
- `pnpm vitest run src/server/data/compliance-export.test.ts
  src/server/data/compliance-export-paging.test.ts` — 2 files, 18 tests passed.
- `pnpm test` — 99 passed / 13 skipped files, 819 passed / 116 skipped tests.
  Initial run failed only on `src/components/brand/velure-symbol.test.tsx`
  (missing gitignored `design/brand/kit/velure-symbol.svg`); copying the
  untracked `design/` kit from the main checkout into the worktree fixed the
  environment without touching the commit. No product test regressed.
- `pnpm check` — exit 0; 359 pre-existing biome warnings (unchanged).
- No migration, schema, RLS, numbering, or issued-invoice change; the export is
  a read-only projection over the stored snapshot.

### Acceptance evidence

1. Split: `compliance: { subtotal: 100000, totalTax: 7500,
   withholdingTaxAmount: 5000, netPayable: 102500 }` →
   `...,"NGN",100000,7500,5000,102500,...` (test "exports the stored subtotal,
   VAT and withholding split").
2. Credit-note signs: the same row as `credit_note` →
   `"credit_note","NGN",-100000,-7500,-5000,-102500,...`; as `standard` stays
   positive (test "signs credit notes negative and leaves standard invoices
   positive").
3. `documentType` is in the header and defaults to `standard` when absent
   (test "defaults documentType to standard and missing money to zero").
4. Formula guard still neutralises a leading `= + - @` in `customerName`, and
   the money columns stay unguarded (spreadsheet-safety suite).
5. The disclaimer remains the first CSV line (disclaimer suite).
6. Paging still includes rows beyond the first 1000-row page, and the new
   `document_type` read is proven by the credit-note paging case.