# T10 step 2 correction — Rev360 VAT sales schedule (XLSX)

Status: done
Task ID: rev360-vat-schedule-2026-11

## Goal

Correct the step-2 VAT sales schedule for the 2026-11-01 export research. NRS
**retired TaxPro Max and replaced it with Rev360** (selfservice.nrs.gov.ng,
live around April 2026), so the provisional `vat_sales_schedule_csv` shape
shipped in `35a4dad` is superseded. Deliver the six-field Rev360 schedule as
an **XLSX**, one row per invoice line, with the layout explicitly labelled
unverified and the VAT-status labels held in a config table.

This is not a Midday parity port. Classification: N/A (local export feature).

## Decisions / assumptions (confirmed with user, 2026-11-01)

- **Rev360, not TaxPro Max.** Every user-facing reference is renamed. The
  retired platform name is kept only in historical docs/prompts and the
  migration that added it.
- **Six fields, in order:** `beneficiary_name`, `beneficiary_tin`, `item`,
  `item_cost`, `item_description`, `vat_status`.
- **XLSX**, not CSV. Replaces the provisional CSV kind (zero live rows
  verified before the migration narrowed the CHECK).
- **Unverified layout.** UI card and sheet row 2 say to verify against the
  user's Rev360 template. Never claims NRS/Rev360 compatibility or clearance.
- **`beneficiary_tin` = `0`** when the buyer TIN is blank, malformed, a
  placeholder, or the invoice has no linked client (reuses
  `validateSupplierTin`).
- **VAT status is a config table**, `REV360_VAT_STATUS_CONFIG`, not hardcoded
  in the exporter. Values are provisional (`VATable` / `Zero-rated` /
  `Exempt`) and must be replaced from a real template.
- **No VAT-amount column** in the six-field layout; `item_cost` is the line's
  extended amount (quantity × unit price).
- **One row per line**, not per invoice.
- Seller TIN is dropped: Rev360 identifies the seller by login, and the
  six-field list has no seller column.
- **Reversible migration**: a new migration replaces the CHECK with the six
  prior kinds + `vat_sales_schedule_xlsx`; the applied
  `20261103000000_invoice_export_kinds_vat_schedule.sql` is untouched.

## Skills read

- `api-design-principles`: one canonical per-line row builder, one contract.
- `database-migration`: reversible CHECK replacement ordering.
- `code-review` / `frontend-security-coder`: downloaded XLSX formula-lead guard.
- Gap: the `supabase` skill is not installed in this environment (same gap
  recorded by the prior step-2 and TIN prompts); substitute = direct
  migration inspection + live read-only probes.

## Existing code inspected (concrete)

- `src/server/data/compliance-export.ts` — kind union, `ComplianceExportMeta`,
  `buildInvoiceExportContent`, the old `vatScheduleRowForInvoice`/
  `VAT_SCHEDULE_HEADERS`, `buildAccountantLinesXlsx`,
  `buildInvoiceExportArtifact`.
- `src/server/data/compliance.ts:390-478` — buyer-TIN map, kind gate, seller
  `tax_id` select, extension mapping.
- `src/routes/settings.compliance.tsx:110-148,1259-1288` — kind label, MIME
  decoding, VAT card.
- `supabase/migrations/20261103000000_invoice_export_kinds_vat_schedule.sql`.
- `src/server/data/compliance-export.test.ts`, `compliance-export-accountant.test.ts`,
  `compliance-export-vat-schedule.test.ts`, `vat-schedule-migration.test.ts`.
- `src/features/compliance/supplier-profile.ts:95-130` `validateSupplierTin`.
- `src/features/compliance/nigeria.ts` `NRS_INFORMATIONAL_DISCLAIMER`.
- `src/features/invoices/types.ts:21-34` — line items have one `name`, no
  separate description.

## Files changed / added

- `src/features/compliance/rev360-vat-status.ts` — NEW config table + resolver.
- `src/server/data/compliance-export.ts` — new kind, per-line XLSX builder,
  removed `ComplianceExportMeta`/seller TIN, removed the CSV builder.
- `src/server/data/compliance.ts` — kind gate, extension, no seller TIN.
- `src/routes/settings.compliance.tsx` — Rev360 label + card + XLSX kind.
- `supabase/migrations/20261104000000_invoice_export_kinds_rev360_vat_schedule.sql`
  — NEW reversible CHECK replacement.
- `src/server/data/compliance-export-rev360-vat-schedule.test.ts` — NEW tests.
- `src/server/data/rev360-vat-schedule-migration.test.ts` — NEW contract test.
- `src/server/data/compliance-export.test.ts` — async-kind list updated.
- `src/server/data/compliance-export-vat-schedule.test.ts` — deleted (superseded).
- `docs/EXPORT-FORMATS.md`, `docs/DECISIONS.md`, `docs/e-invoicing/STATE.md`.

## Implementation requirements

1. Six fields in the exact order, one row per invoice line.
2. `beneficiary_tin` = `0` for unknown; valid 10-12 digit TINs pass through.
3. `vat_status` resolved from the config table; never a literal in the
   exporter.
4. `item_cost` numeric (naira), negated for credit notes; unsafe kobo aborts.
5. XLSX layout: A1 disclaimer, A2 unverified-layout note, row 3 header.
6. Formula-lead guard on every text cell.
7. Migration: replace `invoice_exports_kind_check` with six prior kinds +
   `vat_sales_schedule_xlsx`; document a comment-only reversal.
8. No change to money/numbering/issued-invoice immutability/audit-log paths.

## Acceptance criteria

- [x] `vat_sales_schedule_xlsx` is a valid kind; the async artifact emits the
      six headers, one row per line, with the disclaimer and unverified note.
- [x] Unknown/blank/malformed/placeholder/unlinked buyer TIN → `"0"`; a valid
      10-12 digit TIN passes unchanged.
- [x] `vat_status` comes from `REV360_VAT_STATUS_CONFIG` for all three
      categories; missing category → `standard`.
- [x] `item_cost` = quantity × unit price, numeric, negated for credit notes.
- [x] Formula lead in `beneficiary_name`/`item`/`item_description` neutralised.
- [x] Sync builder rejects the async XLSX kind.
- [x] Migration contract test pins the seven kinds (six + XLSX, no CSV) and a
      comment-only reversal; applied VAT migration untouched.
- [x] Exports card and history label say "Rev360"; no "FIRS"/TaxPro Max copy.
- [x] `pnpm test`, `pnpm typecheck`, `pnpm check` pass.

## Checks to run

- `pnpm test` → **946 passed / 86 skipped** (112 files passed, 10 skipped).
- `pnpm typecheck` → clean.
- `pnpm check` → exit 0 / 359 pre-existing warnings.
- Focused (6 files, 67 tests) green: the two new test files,
  `compliance-export.test.ts`, `compliance-export-accountant.test.ts`,
  `vat-schedule-migration.test.ts` (historical file), `nrs-claims.test.ts`.
- Live: `supabase db push --linked` applied `20261104000000` (only pending).
  Verified read-only: the CHECK admits `vat_sales_schedule_xlsx` and no longer
  `vat_sales_schedule_csv`; 11 export rows unchanged (0 xlsx, 0 csv); ledger
  records the version; a transactional probe insert was accepted then rolled
  back (0 residual).

## Scope changes

- 2026-11-01 (user research): TaxPro Max retired → Rev360; six-field XLSX
  replaces the provisional CSV; VAT status becomes a config table.
