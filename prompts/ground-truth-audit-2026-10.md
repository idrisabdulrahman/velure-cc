# Ground-truth audit and honesty pass (T0 / Phase 0)

Status: in-progress

Task source: outside critique of a Velure walkthrough (see conversation). Phase 0
is read-only; T1–T13 are gated behind the user reviewing this audit.

## Goal

Check every claim in the critique against the repository and the linked Supabase
project, produce `docs/AUDIT-2026-10.md` with a Confirmed/Refuted/Unclear verdict
and file evidence for each, then present findings and ask which to act on.

## Decisions / assumptions (confirmed with user)

- Work lands on a new `development` branch; `V2` is not renamed yet (Q-A in
  `docs/DECISIONS.md`). `V2` is an ancestor of `main`, one commit behind.
- The uncommitted `.gitignore` edits found on checkout are user work and are
  preserved untouched.
- Governing docs (`ProductStrategy.md`, `Architecture.md`, `migration-plan.md`)
  are gitignored and absent from the tree; copies exist in `~/Downloads` and in
  git history. Do not commit them without the user's choice.
- Phase 0 is read-only. No schema, numbering, audit-log, immutability, or
  customer-facing copy change.

## Skills read

- None required for a read-only audit. `code-review` conventions followed for
  verdict discipline.

## Existing code inspected

- Scheduler: `src/routes/api/invoice/scheduled.ts:2-15`,
  `src/routes/api/invoice/submissions/scheduled.ts:5`,
  `src/routes/api/payments/paystack/reconcile.ts:5-46`,
  `src/server/data/reminders.ts:23,732,799`,
  `src/server/data/invoices.ts:54`,
  `src/routes/settings.collections.tsx:438,454,481`,
  `src/routes/settings.recurring.tsx:106-116,243-267`.
- Mock artifacts: `src/server/pdf.ts:68-76`,
  `src/server/pdf.mock-clearance.test.ts:45-75`,
  `src/features/einvoicing/provider-adapter.ts:112-118`,
  `src/features/einvoicing/mock-sandbox-notice.tsx`,
  `src/server/data/invoices.ts:819-883`, `src/routes/i.$token.tsx`,
  `src/lib/midday-invoice/templates/pdf/index.tsx:175-183`,
  `src/server/invoice-mailer.ts:30-43`.
- RLS / service role: `src/server/supabase.ts:6-26`,
  `docs/e-invoicing/tenant-isolation.md:9-24,62-71`,
  `src/server/data/tenant-isolation-coverage.test.ts`,
  migration `20260815223943_phase_a9_identity_sub_claim_hook.sql`.
- License: `/home/asys/JS-TS/apps/projects/midday-main/LICENSE`;
  `src/lib/midday-invoice/**`; `src/features/invoices/midday-adapter.ts`.
- Pricing: `src/routes/pricing.tsx:15-55`,
  `src/routes/settings.index.tsx:994-1004`.
- Security copy: `src/routes/index.lazy.tsx:79-102,559-611`,
  `src/routes/security.tsx`, `src/routes/settings.security.tsx`.
- Migrations directory listing; `package.json` scripts; `.gitignore`.

## Files likely to change or be added

- `docs/AUDIT-2026-10.md` (new) — verdicts and evidence.
- `docs/DECISIONS.md` (new) — open questions and logged decisions.
- `prompts/ground-truth-audit-2026-10.md` (new) — this trail.
- No application code in Phase 0.

## Implementation requirements

- One verdict per critique claim with concrete file:line evidence.
- Aggregate-only usage numbers; no personal data.
- Record open questions rather than silently deciding them.

## Acceptance criteria

- All seven critique items have a verdict and evidence.
- Ground-truth state of reminders, recurring billing, and reconciliation is
  explicit.
- The misleading pricing/Growth claims and the "Free Plan" label are identified.
- Licensing risk is stated in plain language with the derived-file list.
- No repository behavior changed.

## Checks to run

- `pnpm test` baseline before and after (recorded; expect no change).
- `pnpm typecheck` and `pnpm check` if any code changes follow in later phases.
- Read-only aggregate SQL counts against the linked Supabase project.

## Scope changes (append-only)

- 2026-10-29: Created `development` from `main`; wrote the three docs above;
  baseline `pnpm test` = 754 passed / 86 skipped. Phase 0 verdicts complete.
  Stopped before T1–T13 pending user review and answers to Q-A…Q-F.
- 2026-10-29: User resolved Q-A (fresh `development`), Q-B (audit doc is the
  source-of-truth table), and chose the audit's priority order. Proceeding.
- 2026-10-29 (T2): Added render-path guard tests (public HTML page + email
  body) instead of stripping the deliberate WP16 public projection. 3 tests
  pass.
- 2026-10-29 (T5): Added status labels to settings (recurring = not automated,
  collections = manual runs, account plan = not enforced), annotated the two
  unbuilt Growth pricing features, and added the investor/customer status table
  and honest usage line to `docs/AUDIT-2026-10.md`. No pricing number changed.
- 2026-10-29 (T3): Wrote `docs/LICENSE-REVIEW.md` (AGPL-3.0, derived files,
  obligations, options). Nothing rewritten. Awaiting Q-C.
- 2026-10-29 (T3/Q-C): User chose closed source + rewrite. Renamed
  `src/lib/midday-invoice` → `src/lib/invoice-document`,
  `src/shims/midday-utils` → `src/shims/invoice-utils`,
  `midday-adapter.ts` → `invoice-document-adapter.ts` (`toMiddayInvoice` →
  `toInvoiceDocument`), removed unused `@midday/*` tsconfig aliases, scrubbed
  remaining strings. Zero "midday" references remain in `src`/config.
  Typecheck clean, tests 757/86, check exit 0. Residual legal caveat recorded
  in `docs/LICENSE-REVIEW.md` §6.
- 2026-10-29 (T1): Plan presented; awaiting Q-E (scheduler host). The three
  new tests and typecheck/lint are green; `pnpm test` = 757 passed / 86 skipped;
  `pnpm typecheck` clean; `pnpm check` exit 0 (357 pre-existing warnings).
