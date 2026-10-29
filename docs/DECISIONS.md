# Velure decisions ledger

Future agents read this before asking again. One entry per decision: date,
question, answer, task ID. Append-only.

---

## Open questions (awaiting the user)

These block work that depends on the answer. Unattended runs must stop here.

| ID | Question | Why it blocks | Default if forced |
| --- | --- | --- | --- |
| Q-D | **Target segment (T12).** Small businesses only, or also medium taxpayers already inside the mandate? | Drives positioning copy and whether a mock can ever serve the segment. | Small businesses. |
| Q-F | **Real users / pilots (T7/T13).** Are there any real pilot users today? | Ground-truth table honesty. Evidence says effectively none (§7 of the audit). | Report "no known paying users; data is test fixtures". |

### Resolved

| ID | Answer | Date |
| --- | --- | --- |
| Q-A | Fresh `development` branch from `main` (`d7d8f07`); leave `V2` untouched for now. | 2026-10-29 |
| Q-B | Use `docs/AUDIT-2026-10.md` as the source-of-truth ground-truth table (the walkthrough document is not in the repo). | 2026-10-29 |
| Priority | Execute the audit's recommended priority order (T3 → T2 → T5 → T1 → T4 → Phase 2+), not a single first fix. | 2026-10-29 |
| Q-C | **Closed source.** Rewrite the Midday-derived files as clean-room originals and remove every "midday" name/path. UI and behavior must stay identical. No commercial licence. | 2026-10-29 |
| Q-E | **Supabase `pg_cron` + `pg_net`** calls the secret scheduler endpoint. No separate Worker. | 2026-10-29 |

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
- **2026-10-29 — Q-C answered: closed source + rewrite.** Removed every
  "midday" name/path from the codebase while keeping UI/behaviour identical:
  `src/lib/midday-invoice/**` → `src/lib/invoice-document/**`,
  `src/shims/midday-utils` → `src/shims/invoice-utils`,
  `midday-adapter.ts` → `invoice-document-adapter.ts` (`toMiddayInvoice` →
  `toInvoiceDocument`), removed unused `@midday/*` tsconfig aliases, and
  scrubbed remaining strings in comments/tests/sample links. `pnpm test` 757
  passed / 86 skipped (unchanged), typecheck clean, check exit 0. Residual risk
  recorded in `docs/LICENSE-REVIEW.md` §6: de-branding is not a legal
  clean-room; an independent reimplementation or a written opinion is still
  advised.

### 2026-10-29 — Task T1 (scheduler tick, reminder sweep, recurring drafts)

- **Decision (design, pending user enablement):** Automatic reminder **email
  sending** is off by default. The scheduled sweep always scans and queues, but
  `sendQueuedEmails` only runs inside the tick when
  `SCHEDULER_REMINDER_SEND_ENABLED === "true"`. Sending customer email is
  irreversible; enabling it needs the user's explicit approval (recorded here
  when given).
- **Decision:** Recurring generation creates **drafts only**. A
  `recurring_invoice_schedules` row stores a customer *name* but no customer
  id/email, and leaving Draft requires a linked customer (B2 gate), so
  `auto_send` cannot be honoured. The UI says a draft is created and the
  operator completes/ sends it in the normal flow. Honouring `auto_send` needs a
  schema + UI product decision.
- **Decision:** One scheduler entry point (`POST /api/cron/tick`) with a job
  registry and per-job `job_runs` bookkeeping, instead of five separate cron
  entries. Each job is individually idempotent, so a retried tick is safe.
- **Decision:** No global scheduler-health endpoint/UI function; the Settings
  pages read `reminder_runs` / `recurring_invoice_runs` through the user-scoped
  RLS client, which is the real "last run" surface.
- **Decision:** The `pg_cron`/`pg_net` migration is written but **not applied**
  to the live project. Applying it and creating the Vault secrets
  (`velure_scheduler_url`, `velure_scheduler_secret`) are operator actions that
  need the user's go-ahead. The reminder-events partial unique index was checked
  against live data first: 0 duplicate `(invoice_id, stage, channel)` keys with
  `status <> 'failed'` (the table had 0 rows anyway).
- **Fix found on the way:** `currentRule` in `src/server/data/reminders.ts` read
  `reminder_rules` with no owner filter. That is safe under the user-scoped RLS
  client but wrong for the service-role sweep (it would apply one owner's rule
  to every workspace). It now filters by `owner_id`, and the coverage guard
  reclassifies `getReminderSettings`/`saveReminderSettings` as `app-scoped`.
- **Checks:** `pnpm test` → 787 passed / 86 skipped (baseline 757; +30 new
  tests); `pnpm typecheck` clean; `pnpm check` exit 0 (359 pre-existing
  warnings).

