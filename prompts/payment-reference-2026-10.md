# Payment reference = invoice number on invoice instructions and the public payer page

Status: done
Task: first step of the accepted T9 recommendation
(`docs/BANK-RECONCILIATION-OPTIONS.md` §9.5 step 1).

## Goal

Print the invoice number as a **payment reference** in every invoice's payment
instructions, so a payer who transfers into the workspace's own bank account can
put a unique, matcher-friendly value in the narration. The same block renders on
the public payer page and in the emailed/PDF invoice, so the reference reaches
the payer through every channel.

No provider, no new data, no schema/migration change: existing invoices inherit
it because the invoice number is already stored.

## Decisions / assumptions (confirmed with user)

- **User answer 2026-10-30:** proceeded with the T9 recommendation; step 1 is
  the payment reference. Recorded as Q-J follow-up in `docs/DECISIONS.md`.
- **Following the existing wording deliberately.** The app already has a
  `paymentReference` field on a *recorded payment*
  (`src/features/invoices/types.ts:140`, surfaced as the "Payment reference"
  field when recording a settlement,
  `src/features/invoices/components/invoice-details-sheet.tsx:2053`). The printed
  instruction and that field are the same convention: the payer puts the invoice
  number in the narration; the user records that reference. Using the same words
  is intentional, not a collision.
- **Hide it once the invoice no longer needs paying** (`paid`, `canceled`), the
  same terminal states the payer flow already treats as closed. Show it for
  `draft`, `unpaid`, `partially-paid`, `overdue` (all still owe money or are
  pre-issue previews).
- **Minimal by design (AGENTS.md §9, Ponytail ladder):** the label is the
  constant `"Payment reference"`, not a new `Template`/settings field. There is
  no UI to set a different one, so a configurable field would be dead
  configuration. Other labels are similarly hardcoded (`"VAT"`, `"Tax"`,
  `"Amount Payable"` in `invoice-document-adapter.ts:158-166`).

## Skills read

- Repo governance (`AGENTS.md` §3 Midday parity, §8 tenancy floor, §9 minimal
  change) applied by hand.
- `e2e-testing-patterns` / `javascript-testing-patterns` not separately loaded;
  this slice is proven with the existing Vitest render harness
  (`src/features/invoices/public-invoice-render.test.tsx`) and a unit test for
  the pure helper.

## Existing code inspected (concrete files and line ranges)

- `src/lib/invoice-document/types.ts:30-124` — document `Invoice` has
  `invoiceNumber: string | null` (33) and `status` (52-58); `Template` (83).
- `src/features/invoices/invoice-document-adapter.ts:219-330` —
  `toInvoiceDocument`: maps `InvoiceRecord` → document, sets `invoiceNumber`
  (274) and `status` (304, `scheduled` → `draft`), `paymentDetails` via
  `toEditorDoc` (174/280).
- `src/lib/invoice-document/templates/html/index.tsx:28-46` destructure,
  `:76-78` `sectionLabelClass`, `:162-178` payment-details block (renders
  `template.paymentLabel` + `<EditorContent content={paymentDetails} />`
  unconditionally).
- `src/lib/invoice-document/templates/pdf/index.tsx:12-34` signature (no
  `status` today), `:168-187` left column with `<PaymentDetails>` then QR.
- `src/lib/invoice-document/templates/pdf/components/payment-details.tsx:10-18`
  — returns `null` when there is no content; label + `EditorContent`.
- `src/lib/invoice-document/templates/pdf/components/meta.tsx:36-41` — the
  established "bold label Text + value Text" row pattern to copy.
- `src/routes/i.$token.tsx:100,212,265` — public page renders `HtmlTemplate`.
- `src/server/pdf.ts:132` — PDF path renders `PdfTemplate(toInvoiceDocument(...))`.
- `src/features/invoices/public-invoice-render.test.tsx` — existing render test
  harness (`renderToStaticMarkup` + `toInvoiceDocument`).

## Files likely to change or be added

- **Add** `src/lib/invoice-document/payment-reference.ts` — pure helper
  `getInvoicePaymentReference` + `DEFAULT_PAYMENT_REFERENCE_LABEL`.
- **Add** `src/lib/invoice-document/payment-reference.test.ts` — helper unit test.
- **Add** `src/lib/invoice-document/templates/pdf/components/payment-reference.tsx`
  — PDF row component.
- **Edit** `src/lib/invoice-document/templates/html/index.tsx` — render the
  reference in the payment block.
- **Edit** `src/lib/invoice-document/templates/pdf/index.tsx` — destructure
  `status`, render the reference under `PaymentDetails`.
- **Edit** `src/features/invoices/public-invoice-render.test.tsx` — assert the
  public HTML shows the reference for a payable invoice and hides it when paid.
- **Add** `prompts/payment-reference-2026-10.md` (this file).

## Implementation requirements

1. No schema, migration, or stored-field change. The invoice number is read
   as-is; nothing about numbering or issued-invoice immutability changes.
2. One pure helper decides *whether* and *what* to show; both renderers call it,
   so HTML and PDF cannot disagree. Money, numbering, and audit are untouched.
3. Render even when the invoice has no custom `paymentDetails` text, because the
   reference is the instruction that matters most for own-account payers.
4. Keep Wayfare tokens (`var(--invoice-*)`) and the responsive/kb layout; the new
   line is a small muted label + value, no new colors.
5. No new dependency.

## Acceptance criteria

1. A payable invoice with an invoice number renders `Payment reference` and the
   invoice number in the HTML payment block and the PDF payment section. ✅
2. A `paid` or `canceled` invoice renders no payment reference. ✅
3. An invoice with no invoice number renders no payment reference line (but the
   payment block otherwise behaves as before). ✅
4. Both renderers produce the reference from the same helper. ✅
5. No schema, migration, route, or stored-field change; no float money. ✅
6. `pnpm typecheck`, focused tests, `pnpm test`, `pnpm check` pass; the
   `nrs-claims` / public-render guards still pass.

## Checks to run

- `pnpm typecheck`
- `pnpm vitest run src/lib/invoice-document/payment-reference.test.ts
  src/features/invoices/public-invoice-render.test.tsx`
- `pnpm test` (expect ≥823 passed, 86 skipped)
- `pnpm check` (expect exit 0, 359 pre-existing warnings)

## Scope changes (append-only)

- 2026-10-30: Prompt created.
- 2026-10-30: Implemented. Files: added
  `src/lib/invoice-document/payment-reference.ts` (+ test),
  `templates/pdf/components/payment-reference.tsx` (+ PDF render test);
  edited `templates/html/index.tsx`, `templates/pdf/index.tsx`, and
  `public-invoice-render.test.tsx`. No `Template`/settings field added (see
  Decisions). Committed with the docs ledger updates.

## Checks run (2026-10-30)

- `pnpm typecheck` → clean.
- Focused: `pnpm vitest run src/lib/invoice-document/payment-reference.test.ts
  src/lib/invoice-document/templates/pdf/payment-reference.test.tsx
  src/features/invoices/public-invoice-render.test.tsx` → 13 passed.
- `pnpm test` → **835 passed / 86 skipped** (12 new tests).
- `pnpm check` → exit 0, 359 pre-existing warnings.

## Acceptance evidence

1. HTML (`payment-reference.test.tsx`, `public-invoice-render.test.tsx`) and PDF
   (`templates/pdf/payment-reference.test.tsx`) both render `Payment reference`
   plus the invoice number for an `unpaid` invoice. ✅
2. `paid` renders no reference in either renderer. ✅
3. Missing/blank invoice number renders no reference line. ✅
4. Both renderers obtain the value from `getInvoicePaymentReference`. ✅
5. No schema, migration, route, or stored-field change; the number is read
   as-is. ✅
6. All four checks above pass; the mock-clearance and public-render guards
   still pass. ✅
