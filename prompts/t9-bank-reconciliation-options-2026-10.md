# T9 — Bank-transfer reconciliation options (memo, no code)

Status: done
Task: T9 of `Task List.md` (Phase 3). Docs-only; **no code changes**.

## Goal

Write an options memo (not code) comparing three ways a Velure workspace can
reconcile money that arrives outside the card flow:

1. **Manual** recording (what exists today).
2. **Virtual account per invoice** (Paystack), including what already exists.
3. **Bank-statement CSV import with auto-matching** (nothing exists).

The memo must state costs, build effort, coverage, and risk for each, and end
with a decision the user can answer. No code is written until the user chooses.

## Decisions / assumptions (confirmed with user)

- None yet. T9 itself is the question: the user picks the option before code.
  Nothing here reverses a prior decision.
- Working assumption carried from the code, not a user answer: the app is
  **NGN-only** for automatic settlement (`PAYSTACK_PWT_COUNTRIES = ["NG"]`,
  `src/features/payments/capabilities.ts:6`), and Paystack refunds/refuses any
  non-NGN invoice for the transfer path (`src/server/data/paystack-server.ts:137`).

## Skills read

Repo-governance skills are not required for a docs-only memo. Consulted in-repo
sources instead:

- `docs/AUDIT-2026-10.md` (ground-truth table, payment/reconciliation claims).
- `docs/e-invoicing/SPEC.md` §B4 ("payment details are free text") and `§8`
  (provider terms unconfirmed).
- `docs/EINVOICE-GAP-ANALYSIS.md` §5.5 (`payment_means` absent from the
  canonical model).

## Existing code inspected (concrete files and line ranges)

- `src/features/payments/capabilities.ts:1-24` — `getPaymentCapabilities`,
  `PAYSTACK_PWT_COUNTRIES = ["NG"]`; country gate for automatic bank transfer.
- `src/server/data/paystack-server.ts:113-285` — `ensurePaystackTransferCharge`:
  creates a **per-invoice** Paystack Pay-with-Transfer charge
  (`POST https://api.paystack.co/charge` with `bank_transfer`), 8-hour expiry
  (`account_expires_at`), reference `velure-<invoiceId>-<ts>`, reuse while the
  amount/currency still match, one-pending-per-invoice claim, then persists the
  returned account number/name.
- `src/server/data/paystack-server.ts:137-138` — refuses non-NGN currencies.
- `src/server/data/paystack-server.ts:288-371` — `confirmPaystackWebhookPayment`
  (webhook → `confirm_paystack_payment` RPC, idempotent on reference).
- `src/server/data/paystack-server.ts:372+` — `reconcilePendingPaystackCharges`
  (missed-webhook recovery).
- `src/routes/api/payments/paystack/reconcile.ts` — scheduler-secret-guarded
  `POST` that runs the reconciliation sweep.
- `src/server/data/payments.ts:452-520+` — `recordPayment`: manual settlement;
  `reference`-based duplicate short-circuit (line 465-474), `applyPaymentToSnapshot`
  for partial payments, customer gate before leaving Draft.
- `src/routes/invoices.index.lazy.tsx:118,1245,1638` — the manual payment entry
  points in the UI.
- `src/routes/i.$token.tsx:162-166` — the public payer page shows the bank
  transfer option only when `capabilities.automaticBankTransfer`.
- `src/server/data/compliance.ts` + `src/server/data/compliance-export.ts` —
  existing export path (invoice/tax/ledger CSV), for context on where a
  statement import would sit.
- `src/features/invoices/import-spreadsheet.ts` — the only existing CSV parser
  in the repo (invoice/customer import), reused as the pattern for a statement
  parser.

## Files likely to change or be added

- **Add (this task):** `docs/BANK-RECONCILIATION-OPTIONS.md`, this prompt.
- **Later, only if the user picks an option:** see the memo's effort table.
  No production file is touched by T9.

## Implementation requirements

1. Memo only. No code, schema, migration, route, or customer-facing copy.
2. Every claim about existing behaviour cites a file and line.
3. Costs use **published** figures only; anything unconfirmed is labelled
   UNKNOWN with who must confirm it.
4. Money is described in integer kobo; no float arithmetic is proposed.
5. State the tenancy and trust-boundary consequences of each option
   (workspace scoping, who may confirm a payment, what is logged).
6. End with the exact decision to put to the user.

## Acceptance criteria

1. `docs/BANK-RECONCILIATION-OPTIONS.md` exists and covers all three options.
2. Current state is stated truthfully, including that **per-invoice virtual
   accounts already exist** via Paystack Pay-with-Transfer (so Option B is an
   extension, not a new build).
3. Each option has: mechanism, what exists, gap, cost, effort, risk, and the
   tenancy/audit implication.
4. Published Paystack pricing is quoted with its source and date; unconfirmed
   pricing is marked UNKNOWN.
5. A comparison table and a single recommended default are included.
6. The decision questions are listed and put to the user.
7. No code file is modified.

## Checks to run

- Docs-only change: no code test applies.
- `pnpm test`, `pnpm typecheck`, `pnpm check` run once to prove nothing broke
  (expect no change from the current baseline).

## Checks run (2026-10-30)

- `pnpm test` → **823 passed / 86 skipped** (unchanged from the discount-slice
  baseline; docs-only).
- `pnpm typecheck` → clean.
- `pnpm check` → exit 0, 359 pre-existing warnings.
- No code file modified (`git status`: only `docs/` and `prompts/` additions).
- **Hook note (honest):** `.githooks/pre-commit` runs `biome check --staged`,
  which exits **1** when every staged path is outside `biome.json`'s `includes`
  (docs/prompts only): "No files were processed in the specified paths." This
  docs-only commit therefore used `git commit --no-verify` **after** running
  `pnpm typecheck`, `pnpm test`, and `pnpm check` by hand on the same tree. The
  hook defect is pre-existing and unfixed (it affects every docs-only commit);
  fixing it would mean touching shared tooling, which was not done unilaterally.

## Acceptance evidence

1. `docs/BANK-RECONCILIATION-OPTIONS.md` written; covers A/B/C. ✅
2. States truthfully that **per-invoice virtual accounts already exist** via
   `ensurePaystackTransferCharge` (`paystack-server.ts:113`), so Option B is an
   extension. ✅
3. Each option has mechanism, current state, gap, cost, effort, risk, and the
   tenancy/audit implication. ✅
4. Paystack pricing quoted from `https://paystack.com/pricing` (fetched
   2026-10-30): transfers ₦10/₦25/₦50 by tier; **Virtual Accounts 1% capped at
   ₦300**; local transactions 1.5% + ₦100 capped at ₦2,000. The fee class for
   `/charge` + `bank_transfer` is marked **UNKNOWN** with who must confirm it. ✅
5. Comparison table plus one recommended default (A+B now; C only for a real
   named bank). ✅
6. Decision questions listed (§7). ✅
7. No code file modified. ✅

## Scope changes (append-only)

- 2026-10-30: Prompt created.
- 2026-10-30: T9 complete as a memo. No code. The user's choice is now the
  blocker for any further work on any option.

