# Velure decisions ledger

Future agents read this before asking again. One entry per decision: date,
question, answer, task ID. Append-only.

---

## Open questions (awaiting the user)

These block work that depends on the answer. Unattended runs must stop here.

| ID | Question | Why it blocks | Default if forced |
| --- | --- | --- | --- |
| Q-C | **License intent (T3).** Is Velure intended to be closed-source paid SaaS, or open to publishing source? | AGPL-3.0 obligations on derived Midday code change the answer. See `docs/LICENSE-REVIEW.md`. | None — legal decision. Ask first. |
| Q-D | **Target segment (T12).** Small businesses only, or also medium taxpayers already inside the mandate? | Drives positioning copy and whether a mock can ever serve the segment. | Small businesses. |
| Q-E | **Scheduler host (T1).** Cloudflare Worker cron, Supabase `pg_cron`, or an external cron caller of the existing secret endpoints? | Deployment is Cloudflare **Pages**, which has no Cron Triggers, so the existing endpoints need an external pinger. | Cloudflare Worker with a Cron Trigger calling the secret endpoints. |
| Q-F | **Real users / pilots (T7/T13).** Are there any real pilot users today? | Ground-truth table honesty. Evidence says effectively none (§7 of the audit). | Report "no known paying users; data is test fixtures". |

### Resolved

| ID | Answer | Date |
| --- | --- | --- |
| Q-A | Fresh `development` branch from `main` (`d7d8f07`); leave `V2` untouched for now. | 2026-10-29 |
| Q-B | Use `docs/AUDIT-2026-10.md` as the source-of-truth ground-truth table (the walkthrough document is not in the repo). | 2026-10-29 |
| Priority | Execute the audit's recommended priority order (T3 → T2 → T5 → T1 → T4 → Phase 2+), not a single first fix. | 2026-10-29 |

---

## Logged decisions

### 2026-10-29 — Task T0 (Phase 0 audit)

- **Decision:** Work on a new local branch `development` cut from `main`
  (`d7d8f07`); do not rename or force-push `V2` until Q-A is answered.
  Rationale: `V2` is an ancestor of `main` (exactly one commit behind), so a
  verbatim rename would drop the latest Paystack hardening commit. Creating a
  fresh branch is reversible and preserves both existing branches.
- **Decision:** Preserve the uncommitted `.gitignore` edits found on checkout
  (`prompts/`, `design/`, `docs/internal/`, `.claude/`, `.opencode/`,
  `.worktrees/` un-ignored). This is user work-in-progress; the prior handoff
  note said the file was to be left alone, but it is now modified on disk.
  Nothing here reverts it.
- **Decision:** Produced `docs/AUDIT-2026-10.md` (read-only verdicts for all
  seven critique claims) plus this ledger. No product behavior, schema,
  numbering, audit-log, or customer-facing document was changed.
- **Baseline checks:** `pnpm test` → 754 passed / 86 skipped (unchanged).

### 2026-10-29 — Task T2 (render-path guard tests)

- **Finding:** The mock IRN/QR is already prefixed (`MOCK-IRN-`,
  `MOCK-SANDBOX|NOT-NRS-CLEARED|`) and the PDF stamps it
  ("MOCK SANDBOX — NOT NRS CLEARED"). The specific risk in the critique is
  refuted.
- **Decision:** Do **not** strip the public `fiscalization` projection from
  `mapPublicInvoice`. The projection is a deliberate WP16 decision and is
  pinned by `src/server/data/invoices.test.ts:76-150`; the public page never
  renders it. Reversing it would be a silent reversal of an earlier decision.
- **Action:** Added render-path guard tests instead:
  `src/features/invoices/public-invoice-render.test.tsx` (public HTML page
  renders no mock artifact) and
  `src/server/invoice-mailer.mock-artifacts.test.ts` (email body renders no
  mock artifact, still attaches the stamped PDF). 3 tests, all passing.

### 2026-10-29 — Task T5 (labels align with ground truth)

- **Decision:** Add explicit status labels; do not change any pricing number
  (that is T11, user-gated).
- **Action:**
  - `src/routes/settings.recurring.tsx` — warn callout "Status: not automated
    yet"; disabled the "Run due scan" button (generation was never built; it
    always threw).
  - `src/routes/settings.collections.tsx` — info callout "Status: manual runs."
  - `src/routes/settings.index.tsx` — note under the "Free Plan" pill: no plan
    is enforced or billed.
  - `src/routes/pricing.tsx` — marked the two unbuilt Growth features
    ("Automatic payment reminders (manual runs today)", "QuickBooks and Xero
    connection points (coming soon)") and added a note that no plan is billed
    and limits are not enforced.
  - `docs/AUDIT-2026-10.md` — added the investor/customer one-line status table
    (reminders manual, recurring not implemented, reconciliation unwired) and
    the honest usage line (5 users, zero known paying customers, data is test
    fixtures).

### 2026-10-29 — Task T3 (licence review)

- **Finding:** Midday is AGPL-3.0, and its README (`80-87`) frames AGPL as
  **non-commercial** with a paid commercial licence at `engineer@midday.ai`.
  Velure ships 28 derived files under `src/lib/midday-invoice/**` plus
  `src/shims/midday-utils/format.ts` and `src/features/invoices/midday-adapter.ts`,
  with no `LICENSE`/`NOTICE`.
- **Action:** Wrote `docs/LICENSE-REVIEW.md` (plain-language obligations and
  four options). **No code or licence file changed.** Awaiting Q-C; then add a
  `NOTICE` (required either way) and pick comply / rewrite / buy a commercial
  licence.

