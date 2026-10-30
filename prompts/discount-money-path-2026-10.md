# Discount money path: three mutually-exclusive modes

Status: done

Task source: `docs/DECISIONS.md` (2026-10-30, Q-G resolved) and the T6 review.
The validator blocked every non-zero discount (`discount_semantics_unsupported`)
because the stored totals ignored discounts while the renderer displayed them.
The user chose **all three** modes, **mutually exclusive per invoice**:

1. invoice-level discount **before tax** (reduces the taxable base, so VAT is
   charged on the discounted amount);
2. invoice-level discount **after tax** (VAT on the full subtotal, discount
   subtracted from the total);
3. **line-level** discounts (each line's own base is reduced before VAT).

For before-tax the discount reduces the taxable base proportionally across VAT
categories before VAT. The current `calculateInvoiceCompliance` engine uses a
single invoice-level rate, so for a single rate the proportional reduction is
exactly `taxableBase = subtotal - discount`; per-category rate modelling is a
pre-existing gap (`src/features/tax/calculate.ts` models it but is not wired)
and stays out of this slice.

## Goal

Make the stored totals, the persisted snapshot, the canonical e-invoice model,
and the pre-submission validator agree for all three discount modes, so a
discounted invoice can be submitted once its arithmetic is consistent.

## Decisions / assumptions (confirmed with user)

- All three modes exist; **mutually exclusive per invoice** (user, 2026-10-30).
- Before-tax discount **reduces the taxable base proportionally** (user,
  2026-10-30).
- The discount lives in `templateSettings` (invoice-level) and on each
  `lineItem` (line-level). The compliance snapshot does **not** gain new
  required fields (backward compatible with stored snapshots); it stores the
  resulting `subtotal` (gross), `totalTax` (on the discounted base), `grandTotal`
  and `netPayable`.
- **Default mode = `invoice_after_tax`** when a discount is present but no mode
  is stored. This preserves the numbers the document renderer already displays
  (`subtotal + VAT - discount`); changing the default to before-tax would
  silently change what a customer is charged. The mode selector lands in this
  slice for invoice-level before/after; per-line inputs remain a follow-up.
- No change to issued-invoice immutability, numbering, audit logging, or
  customer-facing tax/clearance copy.

## Skills read

`architect` (data flow + trust boundaries), `systematic-debugging` (root-cause
the stored-vs-rendered mismatch first), `api-design-principles` (canonical
contract), `code-review`, `supabase-postgres-best-practices` (integer minor
units). AGENTS.md §4/§8/§9. No Next.js/Midday port involved.

## Existing code inspected

- `src/features/compliance/calculate.ts:167-314` — `calculateInvoiceCompliance`;
  uses one invoice-level rate and ignores discounts.
- `src/features/compliance/types.ts:134-157` — `InvoiceComplianceSnapshot`.
- `src/features/tax/calculate.ts:217-341` — `computeInvoiceTotals` already models
  a line `discountMinor` reducing the VAT base (reference maths, not wired).
- `src/features/invoices/types.ts:20-55` — `InvoiceLineItem`,
  `InvoiceTemplateSettings`.
- `src/server/data/invoices.ts:82-132` — duplicated `LineItem` /
  `InvoiceTemplateSettings`; `:421-478` `defaultCompliance`; `:557-607`
  `assertInvoiceInput`; `:1658-1860` `createDraft`; `:1872-1994`
  `autosaveDraft`.
- `src/features/invoices/components/create-invoice-panel.tsx:932-993` — the
  panel engine call (no discount passed); `:849-857` template settings;
  `:3230-3289` panel totals; `:3935-3954` discount input.
- `src/features/einvoicing/canonical-invoice.ts:37-111, 199-330` — canonical
  line/totals mapping.
- `src/features/einvoicing/validate-canonical-invoice.ts:262-456` — line math,
  blanket discount block, gross/payable checks.
- `src/features/invoices/invoice-document-adapter.ts:72-158, 168-301` — document
  template + discount wiring.
- `src/lib/invoice-document/utils/calculate.ts:3-58` — renderer `calculateTotal`
  (currently after-tax only).
- `src/lib/invoice-document/templates/{html,pdf}/components/summary.tsx`.

## Files likely to change

- `src/features/compliance/types.ts` — `DiscountMode`.
- `src/features/compliance/calculate.ts` — mode-aware totals.
- `src/features/invoices/types.ts` — `discountMode` on template settings,
  `discount` on line items.
- `src/server/data/invoices.ts` — duplicated types + `assertInvoiceInput`
  bounds/mutual exclusivity.
- `src/features/einvoicing/canonical-invoice.ts` — line discount +
  `totals.discountMode`.
- `src/features/einvoicing/validate-canonical-invoice.ts` — per-mode arithmetic.
- `src/features/invoices/invoice-document-adapter.ts` — pass mode to renderer.
- `src/lib/invoice-document/types.ts` + `{html,pdf}` summary + `utils/calculate.ts`
  — render before-tax vs after-tax using the stored totals.
- `src/features/invoices/components/create-invoice-panel.tsx` — pass discount +
  mode, show a discount row, invoice-level mode selector.
- Focused tests for each layer.

## Implementation requirements

1. **Engine.** `calculateInvoiceCompliance` accepts
   `discountMode?: DiscountMode`, `discount?: number` (invoice-level) and
   `lineItems[].discount?` (line-level). Reject mixing invoice-level and
   line-level discounts. `subtotal` stays gross; `totalTax` is computed on the
   reduced base for before-tax/line; `grandTotal` and `netPayable` reflect the
   mode. Integer kobo only.
2. **Canonical.** Lines carry their discount; `totals` carries `discount` and
   `discountMode`. Legacy snapshots without a mode resolve to
   `invoice_after_tax` when a discount exists.
3. **Validator.** Replace the blanket `discount_semantics_unsupported` block
   with per-mode checks: discount non-negative and ≤ subtotal; line-mode
   discount equals the sum of line discounts and no invoice-level discount;
   invoice modes have no line discounts; `grossTotal` matches the mode's
   arithmetic; payable/invoice totals still equal gross − withholding.
4. **Bounds.** `assertInvoiceInput` validates the mode, the amount bounds, and
   mutual exclusivity, and each line discount is ≥ 0 and ≤ its line net.
5. **Renderer.** `calculateTotal` handles before-tax/line (VAT on the reduced
   base) and after-tax; the summary displays the stored grand total when
   available so HTML, PDF, and the panel agree.
6. **UI.** The panel passes the discount/mode to the engine, shows a discount
   row, and offers an invoice-level before/after selector. Per-line discount
   inputs are the follow-up slice.

## Acceptance criteria

1. Before-tax: with subtotal 100 and 10% VAT, a 20 discount gives tax 8 and
   grand total 88.
2. After-tax: with subtotal 100 and 10% VAT, a 20 discount gives tax 10 and
   grand total 90.
3. Line: line discounts reduce the base per line; invoice-level and line-level
   discounts cannot coexist.
4. The canonical model round-trips the mode and per-line discounts.
5. The validator accepts each mode's consistent arithmetic and rejects a
   mismatched gross with a specific code.
6. HTML, PDF, and the panel show the same grand total for a discounted invoice.
7. `pnpm test`, `pnpm typecheck`, `pnpm check` pass.
8. `nrs-claims.test.ts` still passes; no float money; issued invoices stay
   immutable.

## Checks to run

- `pnpm test` before and after (baseline 793 passed / 86 skipped).
- `pnpm typecheck`, `pnpm check`.
- Focused: compliance, canonical, validator, invoice save, renderer tests.

## Checks run (2026-10-30)

- `pnpm test` → **823 passed / 86 skipped** (30 new tests, baseline 793).
- `pnpm typecheck` → clean.
- `pnpm check` → exit 0, 359 pre-existing warnings (same count as baseline).
- Focused suites: `calculate.test.ts` (14), `canonical-invoice.test.ts`,
  `validate-canonical-invoice.test.ts` (25), `invoice-document-adapter.test.ts`
  (renderer/stored-total parity), `lib/invoice-document/utils/calculate.test.ts`
  (before-/after-tax/line), `invoice-discount-guards.test.ts` (9 save guards).
- `nrs-claims.test.ts` passes inside the full run; no float money added.

## Acceptance evidence

1. Before-tax: `calculate.ts` test asserts subtotal 100, VAT 8, total 88. ✅
2. After-tax: test asserts VAT 10, total 90. ✅
3. Line: test asserts base 80 / VAT 8 / total 88; engine + guard reject
   invoice+line combinations. ✅
4. Canonical: lines carry `discount`, totals carry `discountMode`; legacy
   discount with no mode → `invoice_after_tax`. ✅
5. Validator: positive tests for all three modes and negative tests for
   `discount_total_mismatch`, `discount_mode_mismatch`,
   `discount_exceeds_subtotal`, mode-aware `gross_total_mismatch`. ✅
6. Adapter test computes what the HTML summary renders and asserts it equals the
   stored `amount` that the PDF prints, which the panel shows as net payable. ✅
7. Commands above. ✅
8. No issued-invoice, numbering, audit-log, or NRS-copy changes. ✅

## Scope changes (append-only)

- 2026-10-30: Prompt created for the approved money-path slice.
- 2026-10-30: Slice complete except **per-line discount input UI**, which is
  deferred to a follow-up so this slice stays reviewable. The engine, canonical
  model, validator, save guards, and renderers already support `line` mode; the
  panel exposes only the invoice-level before/after selector and discount row.
- 2026-10-30: Known limitation recorded rather than hidden. The validator checks
  a before-tax discount arithmetically (`grossTotal = subtotal − discount +
  declaredVat`) but does **not** re-derive VAT from the rate, so an invoice
  labelled `invoice_before_tax` that leaves VAT on the undiscounted base still
  validates when its totals are internally consistent (it behaves as an
  after-tax discount and over-remits VAT, never under-remits). The engine never
  produces that shape; it always recomputes VAT on the reduced base.