# T10 step 2 — TaxPro Max-shaped VAT sales schedule (CSV)

Status: done
Task ID: taxpro-vat-schedule-2026-11

## Goal

Deliver **T10 step 2**: a VAT-only **sales schedule** shaped for manual entry
against the FIRS TaxPro Max platform, with a buyer TIN column that prints `0`
when the buyer TIN is unknown. This is the second of the four-step T10 build
order recorded 2026-11-01 (step 1 = accountant line export, done; step 3 =
QBO/Zoho then Xero import files; step 4 = received-WHT tracker, proposal only).

New export kind: `vat_sales_schedule_csv`.

This is not a Midday parity port. Classification: N/A (local export feature).
No Midday source is ported.

## Decisions / assumptions (confirmed with user)

- 2026-11-01 (user): after the migration push, "start step 2".
- **Provisional shape.** No official TaxPro Max sample is available (human
  input still open). The column order and the CSV-vs-XLSX choice are therefore
  **provisional** and are labelled as such in `docs/EXPORT-FORMATS.md`. The
  contract must never claim TaxPro Max/NRS official compatibility.
- **Granularity:** one row per invoice. Line-level detail already ships as the
  accountant line export; a VAT schedule is an invoice/customer-level filing.
- **Buyer TIN (`customerTin`):** sourced from the invoice's linked
  `clients.tax_id`. If it is blank, malformed, a placeholder, or the invoice has
  no linked client, print the literal **`0`** (the requirement). Reuses the
  canonical `validateSupplierTin` format/placeholder rule (10-12 digits, not a
  placeholder) rather than duplicating it.
- **Seller TIN (`supplierTin`):** sourced from `workspaces.tax_id`, `0` when
  unknown. Included so the schedule identifies both parties when an accountant
  files on the business's behalf.
- **Taxable base:** recomputed exactly as `calculateInvoiceCompliance` does —
  `taxableBase = subtotal − (before-tax or line discount)`; an **after-tax**
  discount does NOT reduce the taxable base. Exclusive: taxable =
  taxableBase, total = taxableBase + VAT. Inclusive: taxable = taxableBase −
  VAT, total = taxableBase. So `taxableAmount + vatAmount = totalAmount` in
  every mode, `vatAmount` = stored `compliance.totalTax` (authoritative),
  `[computed]`/`[derived]` tags as documented.
- **Money** is kobo integer arithmetic (`priceToKobo`, `Number.isSafeInteger`
  guard), emitted as naira decimals. Credit notes negate every money column.
- **CSV only** for step 2 (no XLSX); a `.xlsx` variant is a follow-up once the
  official template is known.
- New kind needs a **reversible** migration widening the `invoice_exports.kind`
  CHECK from six kinds to seven. The two applied kind migrations
  (`20261102000000_invoice_export_kinds_accountant.sql`, now applied) stay
  byte-for-byte untouched.
- No float arithmetic on the money path; no new dependency.

## Skills read

- `api-design-principles`: single row builder, one contract document.
- `database-migration`: reversible CHECK-constraint widening ordering.
- `supabase-postgres-best-practices`: drop-then-add constraint replacement.
- `code-review` / `frontend-security-coder`: downloaded CSV → formula-injection
  guard on free-text cells.
- Gap recorded: the `supabase` skill is not installed in this environment
  (same gap noted in `tin-length-10-12-2026-11` and
  `accountant-line-export-2026-11`); substitute = direct migration inspection.

## Existing code inspected (concrete)

- `src/server/data/compliance-export.ts:6-13` — `ComplianceExportKind` union
  (6 kinds); `:15-29` `ComplianceExportInvoiceRow` (no `customer_id`/TIN yet);
  `:37-49` `CSV_HEADERS`; `:52-60` `numeric`; `:72-101`
  `invoiceTotalForExportRow`; `:112-126` `FORMULA_LEAD` + `csvTextCell`/
  `csvValueCell`; `:145-159` `invoiceMoneyForExportRow` (credit-note sign);
  `:168-231` `buildInvoiceExportContent` (disclaimer + header + rows; JSON
  branch; xlsx guard); `:245-268` `ACCOUNTANT_LINE_HEADERS`; `:273-287`
  `assertKobo`/`koboOfStored`/`naira`; `:294-319` `allocateMinor`; `:343-368`
  `storedLinesOf`; `:391-554` `accountantRowsForInvoice`; `:562-581`
  `buildAccountantLinesXlsx`; `:588-597` `buildInvoiceExportArtifact`.
- `src/server/data/compliance.ts:388-410` — `loadAllExportInvoices` pages
  invoices in 1000-row ranges; selects
  `invoice_number, customer_name, document_type, currency, payment_amount,
  status, issue_date, due_date, compliance, line_items, template_settings` —
  NOT `customer_id`; `:412-462` `createInvoiceExport`: workspace
  `id, name, legal_name` query, prefix, `content = await
  buildInvoiceExportArtifact(...)`, `fileExtension` (json/xlsx/csv), file
  name, insert, `invoice.export` audit with `rowCount`.
- `src/features/compliance/calculate.ts:184-225` `resolveInvoiceDiscount`
  (mutually exclusive; stored discount without mode → `invoice_after_tax`);
  `:279-303` the exact taxable-base rule: `beforeTaxDiscountMinor` only for
  before-tax/line; `taxableBase = subtotal − beforeTaxDiscount`; exclusive
  `grand = base + tax`; inclusive `grand = base`; after-tax `grand −=
  discount`.
- `src/features/compliance/supplier-profile.ts:19-25` `NIGERIA_TIN_*`;
  `:49-54` `PLACEHOLDER_TIN_VALUES`; `:95-130` `validateSupplierTin`
  (10-12 digits, placeholder/all-same-digit rejection) — reused for the buyer
  TIN rule.
- `src/server/data/clients.ts:315-325` — `clients` filtered by
  `workspace_id`, and `:1484-1492` of `src/server/data/invoices.ts` reads
  `clients.tax_id` by `id`, confirming the buyer-TIN column exists.
- `src/server/data/invoices.ts:678`, `:731` — `invoices.customer_id` is the
  FK used to resolve the linked client.
- `src/routes/settings.compliance.tsx:110-122` `formatExportKind`;
  `:130-146` `blobForExport` (xlsx base64 / json / csv MIME); `:281-283`
  `visibleExports` (filters only `normalized_accounting`); `:1208-1256`
  accountant cards; `:1259-1302` history list.
- `supabase/migrations/20261102000000_invoice_export_kinds_accountant.sql` —
  the applied 6-kind CHECK; new migration must not edit it.
- `src/server/data/export-kind-migration.test.ts` — migration-contract test
  pattern to mirror; `src/server/data/compliance-export-accountant.test.ts` —
  reconciliation/credit-note/formula-guard test style; `:19-25` of
  `compliance-export.test.ts` — the `ALL_KINDS` disclaimer pinning list.
- `src/server/data/tenant-isolation-coverage.test.ts:82-88` — export
  classification (`buildInvoiceExportContent`/`buildInvoiceExportArtifact`/
  `invoiceTotalForExportRow` = `pure`); no new exports are introduced, so no
  new classification is needed.

## Files likely to change or be added

- `docs/EXPORT-FORMATS.md` — new "VAT sales schedule" section; remove step 2
  from "Not built yet".
- `src/server/data/compliance-export.ts` — add `vat_sales_schedule_csv` kind;
  add `customer_id`/`customer_tin` to the row type; optional seller-TIN meta
  param; `tinOrZero`, `vatScheduleRowForInvoice` (private); CSV branch.
- `src/server/data/compliance.ts` — `loadAllExportInvoices` selects
  `customer_id` and resolves buyer TIN from `clients`; `createInvoiceExport`
  selects `tax_id` and passes `{ sellerTin }`.
- `supabase/migrations/20261103000000_invoice_export_kinds_vat_schedule.sql` —
  NEW reversible CHECK widening (6 → 7 kinds).
- `src/server/data/vat-schedule-migration.test.ts` — NEW contract test.
- `src/server/data/compliance-export-vat-schedule.test.ts` — NEW behaviour
  tests (TIN `0`, reconciliation, modes, credit note, formula guard,
  disclaimer).
- `src/server/data/compliance-export.test.ts` — extend `ALL_KINDS`.
- `src/routes/settings.compliance.tsx` — kind label + one export card.
- `docs/e-invoicing/STATE.md`, `docs/DECISIONS.md` — append entries.
- Obsidian handoff `Velure agent handoff - governance and Midday parity.md` —
  record the new stopping point.

## Implementation requirements

1. Extend `docs/EXPORT-FORMATS.md` first with the VAT schedule contract:
   provisional banner, per-column language tags, the `0` TIN rule, the taxable
   computation, the `taxable + vat = total` identity, credit-note sign, and
   disclaimer placement.
2. One row per invoice; disclaimer quoted line above the header.
3. Buyer TIN `0` when blank/malformed/placeholder/unlinked; seller TIN `0`
   when unknown. Free-text cells are formula-lead guarded.
4. Money in kobo with safe-integer guarding; emitted as naira decimals.
5. `<prefix>-vat_sales_schedule_csv-<now>.csv` file name (existing
   `createInvoiceExport` extension mapping already yields `csv`).
6. Migration drops and recreates `invoice_exports_kind_check` with seven
   kinds; the reversal block (comment-only, never auto-run) restores six.
7. No change to any existing kind's output; no change to money/numbering/
   issued-invoice immutability/audit-log path.
8. Scope guards: no step 3/4 work; no banking/Magic Inbox; never print or
   commit secrets; never claim NRS/TaxPro clearance.

## Acceptance criteria

- [x] `vat_sales_schedule_csv` is a valid kind; the sync builder emits the
      disclaimer line + documented header + one row per invoice.
- [x] For an unknown/blank/malformed/placeholder buyer TIN the `customerTin`
      cell is exactly `"0"`; a valid 10-12 digit TIN passes through unchanged;
      the seller TIN follows the same rule.
- [x] `vatAmount` equals the stored `compliance.totalTax`; `taxableAmount +
      vatAmount = totalAmount` in kobo for exclusive, inclusive, before-tax,
      after-tax, no-discount and line-discount invoices.
- [x] Credit notes negate every money column; text columns never negate.
- [x] A formula-lead description is neutralised with a leading apostrophe.
- [x] Migration widens the CHECK reversibly (6 → 7 kinds); a contract test
      pins the seven kinds and the comment-only six-kind reversal; the new
      migration leaves the applied accountant migration untouched.
- [x] Exports tab shows a "VAT sales schedule (TaxPro Max)" card; history
      lists/downloads the new kind.
- [x] `pnpm test` 943 passed / 86 skipped (was 921 — 22 new tests);
      `pnpm typecheck` clean; `pnpm check` exit 0 / 359 pre-existing warnings.

## Checks to run

- `pnpm test` → **943 passed / 86 skipped**; `pnpm typecheck` clean;
  `pnpm check` exit 0 / 359 pre-existing warnings.
- Focused (4 files, 45 tests): `compliance-export.test.ts`,
  `compliance-export-vat-schedule.test.ts`, `vat-schedule-migration.test.ts`,
  `nrs-claims.test.ts` — pass. The honesty guard rejected "FIRS" in the new
  UI copy; the card now says "TaxPro Max VAT filing".
- Live DB: `supabase db push --linked` applied
  `20261103000000_invoice_export_kinds_vat_schedule.sql` (only pending
  migration). Verified read-only: `invoice_exports_kind_check` now admits
  `vat_sales_schedule_csv` (7 kinds); the ledger records the new version; a
  probe insert of a `vat_sales_schedule_csv` row was accepted and rolled back
  (0 residual rows).

## Scope changes

- (none)