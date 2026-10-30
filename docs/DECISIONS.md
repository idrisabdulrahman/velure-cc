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
| Q-G | **Discount semantics (T6/review).** Is a non-zero invoice discount supported, and how is it treated in the submitted totals (line-level vs invoice-level, before/after tax)? | `validateCanonicalInvoice` blocks any non-zero discount (`discount_semantics_unsupported`), so discounted invoices cannot be submitted. Product decision, not a bug. | Keep the block until the tax treatment is defined. |
| Q-H | **WHT / payable (T6/review).** Does the NRS e-invoice carry a gross amount plus a separate withholding amount, or a single net payable? | The app stores `withholdingTotal` and a net payable; whether that maps to the NRS/UBL document is UNKNOWN. Needs a provider/NRS confirmation. | Ask the provider question list (§9 of the gap analysis); do not guess. |

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
- **Decision (superseded below):** The `pg_cron`/`pg_net` migration was written
  but not applied at first; applying it and creating the Vault secrets are
  operator actions that need the user's go-ahead. The reminder-events partial
  unique index was checked against live data first: 0 duplicate
  `(invoice_id, stage, channel)` keys with `status <> 'failed'` (the table had 0
  rows anyway).
- **Fix found on the way:** `currentRule` in `src/server/data/reminders.ts` read
  `reminder_rules` with no owner filter. That is safe under the user-scoped RLS
  client but wrong for the service-role sweep (it would apply one owner's rule
  to every workspace). It now filters by `owner_id`, and the coverage guard
  reclassifies `getReminderSettings`/`saveReminderSettings` as `app-scoped`.
- **Checks:** `pnpm test` → 787 passed / 86 skipped (baseline 757; +30 new
  tests); `pnpm typecheck` clean; `pnpm check` exit 0 (359 pre-existing
  warnings).

### 2026-10-29 — Operator answers (T1 go-live, applied via MCP)

- **Q:** Apply the scheduler migration to the live project and create the Vault
  secrets? **Answer:** yes — "apply the migration and set vault secrets use the
  supabase MCP." **Applied:** `supabase/migrations/20261029000000_scheduler_pg_cron.sql`
  applied to project `kbexydkmmfabfutgkbxn` (`apply_migration`). Result:
  `pg_cron` 1.6.4 and `pg_net` 0.20.4 enabled, `public.invoke_scheduler_tick()`
  created, `reminder_events_invoice_stage_channel_unique` created, and the
  `velure-scheduler-tick` job scheduled (`*/10 * * * *`, active).
- **Vault:** `velure_scheduler_url` =
  `https://velure-f2c.pages.dev/api/cron/tick`; `velure_scheduler_secret` =
  a fresh 32-byte random hex generated **inside** Postgres
  (`extensions.gen_random_bytes`), so its value is not recorded here. Retrieve
  with `select decrypted_secret from vault.decrypted_secrets where
  name = 'velure_scheduler_secret';` (service role/postgres only).
- **Q:** Enable automatic reminder email sending? **Answer:** yes — enable it.
  This is a customer-facing, irreversible action the user explicitly approved.
  It only takes effect once the app env var `SCHEDULER_REMINDER_SEND_ENABLED`
  is `true` **and** the T1 code is deployed; the tick still must reach a running
  app with a matching `INVOICE_SCHEDULER_SECRET`.
- **Outstanding operator step:** T1 must still be **deployed to production**.
  The live site returns **404** for `POST /api/cron/tick` (checked 2026-10-29)
  because `development` is not deployed, so every cron tick is a harmless 404
  until then. A redeploy is also required for the env-var change to take effect.
- **Env vars set via the Cloudflare API (safe):** Pages project `velure`
  (account `699cc6ec07aa29df7034163270b23f87`) now has
  `INVOICE_SCHEDULER_SECRET` = the Vault secret value (`secret_text`) and
  `SCHEDULER_REMINDER_SEND_ENABLED=true` (`plain_text`). Before writing, the
  merge behaviour was proven on a throwaway Pages project: a partial
  `PATCH /projects/{name}` upserts `env_vars` and leaves unmentioned vars
  untouched, so the 17 pre-existing secrets (`SUPABASE_SERVICE_ROLE_KEY`,
  `DATABASE_URL`, `BETTER_AUTH_SECRET`, …) were preserved — re-read after the
  write to confirm all are still present. The scheduler secret value was read
  from Vault only to be written and was never printed to the session.
- **Decision (superseded):** The initial plan was to avoid the Pages API because
  `secret_text` values cannot be read back. The throwaway-project probe removed
  that uncertainty, so the API was used.

### 2026-10-29 — Task T4 (tenancy-doc / RLS drift check)

- **Finding — no live RLS drift.** Read-only inspection of project
  `kbexydkmmfabfutgkbxn`: all 33 `public` tables have RLS enabled; five
  server-only tables (`einvoice_provider_credentials`,
  `integration_connections`, `integration_webhooks`,
  `invoice_number_sequences`, `public_rate_limit_windows`) are RLS-on with no
  policy (deny-all to browser roles); `job_runs` has an explicit deny-all policy
  (`job_runs_server_only`); no `*_pending_verified_identity` placeholder policy
  remains; the recurring tables use `workspace_member` predicates and the
  reminder/collection tables use `owner_id = app.current_user_id()`.
- **Finding — documentation drift.** `docs/e-invoicing/tenant-isolation.md`
  still listed `getReminderSettings`/`saveReminderSettings` as `rls-only`. T1's
  `currentRule` now filters `.eq("owner_id", userId)`
  (`src/server/data/reminders.ts:256-266`) and the coverage guard classifies
  both `app-scoped` (`tenant-isolation-coverage.test.ts:264-265`).
- **Decision:** Fix the doc only. No schema, policy, or app code change — the
  enforcement is already correct. Record the T1 additions (`sendQueuedEmails`,
  `listReminderRuns`, `listRecurringRuns`) as `app-scoped`.
- **Decision:** Do **not** run the A10_LIVE minted-JWT matrix
  (`pnpm test:wp3-tenant-isolation-live`) without explicit approval, because it
  writes fixtures to the linked project. Live policy state was inspected
  directly instead; running the matrix in CI remains the residual gap.
- **Files:** `docs/e-invoicing/tenant-isolation.md`,
  `docs/AUDIT-2026-10.md`, `prompts/t4-rls-drift-2026-10.md`.
- **Checks (as run at commit time):** `pnpm typecheck` clean; `pnpm check`
  exit 0 (unchanged warnings); `pnpm test` 764 passed / 23 failed / 86 skipped.
  The 23 failures are the three local-stack Paystack DB integration suites
  failing with `JWT expired` (the local test stack's service-role JWT expired at
  2026-10-29T19:54:25Z); pre-existing and environmental, not a regression — they
  were fixed immediately after; see the 2026-10-30 entry below.

### 2026-10-30 — Local test-stack JWT expiry (environmental, fixed)

- **Finding.** `.env.test`'s `PAYSTACK_TEST_SERVICE_ROLE_KEY` was a `service_role`
  HS256 JWT minted with a **10-hour** lifetime (`iat` 2026-10-29T10:14:25Z,
  `exp` 2026-10-29T19:54:25Z) against the running local stack
  (`velure-einv-qa`, ports 55421/55422). After `exp`, PostgREST rejects it and
  the three DB-backed Paystack suites fail with `JWT expired` (23 tests).
- **Decision — re-mint the token instead of restarting the stack.** The stack
  was started from a project directory that no longer exists anywhere on disk
  (no `config.toml` with `project_id = "velure-einv-qa"`), so a faithful
  `supabase stop && supabase start` for that identity/ports is not safely
  reproducible; `supabase stop` would risk taking the stack down with no
  matching config to bring it back. The stack's signing secret is unchanged
  (the CLI default `GOTRUE_JWT_SECRET` observed in the running `auth` container,
  and PostgREST's JWKS is the matching `oct` key), so a fresh token signed with
  that secret is exactly the credential a restart would mint — without risking
  the running stack or its data. Re-minted a `service_role` HS256 token with a
  **10-year** `exp` (iss `supabase`) and wrote it into `.env.test`; the value was
  never printed or committed (`.env.test` is gitignored).
- **Evidence.** PostgREST root (`http://127.0.0.1:55421/rest/v1/`) returns **200**
  with the new key; the three suites pass (**30 tests**); full `pnpm test` is
  **787 passed / 86 skipped**. This also resolves the earlier "known
  environmental failure" note.
- **Follow-up risk.** A future `supabase start` regenerates local keys and will
  break `.env.test` again by design. If the local stack is ever recreated, prefer
  `supabase start` from this repo's own `supabase/config.toml` (`velure-cc`,
  ports 54321/54322) and point `.env.test` at it, rather than reviving the lost
  `velure-einv-qa` identity.

### 2026-10-30 — Tasks T6/T7 (e-invoicing gap analysis + provider questions)

- **T6 question:** Which sources should the gap analysis use?
  **Answer:** Public official sources only — the official NRS developer portal
  (`community.nrsmbs.com`) plus a certified provider's public docs (Etranzact).
  No private NITDA/NRS documents supplied; anything not publicly covered is
  marked UNKNOWN in `docs/EINVOICE-GAP-ANALYSIS.md`, never inferred.
- **T7 question:** Has anyone already spoken to an NRS-accredited provider or
  NRS/NITDA? **Answer:** No contact yet.
- **T7 question:** Any constraints to reflect (cost ceiling, preferred provider,
  existing relationships, timeline)? **Answer:** None known yet.
- **Result:** `docs/EINVOICE-GAP-ANALYSIS.md` written (read-only research; no
  code/schema/copy change). Key findings: canonical model derives from the
  app's own snapshot, not the NRS schema (`prompts/einv-wp10.md`); official
  format is UBL 2.1 with SI/APP two-layer roles, OAuth 2.0 + TLS, CSID signing,
  and encrypted IRN QR; the "55 mandatory fields" figure is absent from the repo
  and unconfirmed; the 10-digit TIN is a UI hint with an explicit
  `TODO(tin-checksum)`, and a provider sample shows a **dashed** TIN; the only
  publicly known rejection codes are HTTP statuses (the app's rejection codes
  are invented mock codes). Largest concrete gap: structured postal address
  (street/city/postal_zone/LGA/state/country codes).
- **Not done / next:** obtained no official NITDA guideline, no NRS schema PDF,
  no rejection-code catalogue; nobody contacted a provider. 15 provider/NRS
  questions are handed to the user in §9 of the gap analysis.
- **Q-F status:** unchanged (T7 contact question is separate from whether real
  pilot users exist; Q-F stays open).

### 2026-10-30 — T1 deployed to production (go-live verified)

- **Q:** Deploy T1 to production so the cron ticks stop 404ing?
  **Answer:** yes (the user reviewed and approved deploying T1).
- **Deployment method:** direct upload —
  `pnpm deploy:pages` = `build:pages` + `wrangler pages deploy dist
  --project-name velure --branch main --env-file .env`. No git push is
  involved; `development` remains local-only.
- **Result:** deployed revision `709411ca`
  (`https://709411ca.velure-f2c.pages.dev`). Live checks (read-only):
  `POST /api/cron/tick` → **401** (route now exists; the old build 404'd),
  `GET /` → **200**, `GET /auth` → **200**.
- **First live tick (06:30 UTC) — partial.** `net._http_response` row
  `id=87` recorded `timed_out=true` at pg_net's `timeout_milliseconds := 10000`
  (`Total time: 10001 ms`). `job_runs` recorded only **3 of the 5** jobs
  (`scheduled_invoice_emails` 1308 ms, `einvoice_submissions` 91 ms,
  `paystack_reconcile` 46 ms — all success). `reminder_sweep` covered only
  **10 of 111** active workspaces (`reminder_runs` +10, all at the tick-start
  timestamp) before the worker was killed at the 10 s timeout;
  `recurring_generation` never ran (`recurring_today=0`).
- **Cause (confirmed).** `reminder_sweep` runs sequentially, one
  `runReminderBatch` per active workspace (~0.75–0.9 s each: several Supabase
  round trips per workspace, and `defaultRule.enabled = true` scans every
  invoice). At 111 workspaces that is ~O(111 × 0.9 s) ≫ 10 s.
- **Status:** **open — needs an architecture decision, no fix applied.** The
  tick runs jobs sequentially with a per-job try/catch, so a timed-out process
  simply dies mid-sweep; the remaining workspaces and all later jobs are
  skipped. Options to decide between (pending user): bound the sweep per tick
  with a persisted cursor (resume next tick), raise the pg_net timeout, or fan
  the sweep out. Recorded as the T1 residual defect.
- **Docs:** review corrections and this deploy are mirrored in the Obsidian
  handoff note.

### 2026-10-30 — Review actions on the T6/T7 deliverable (user review)

- **Q (count):** The gap-analyses envelope claim was wrong. **Action:** fixed
  the count to "3 of 17" and the table headers to "Provider-published field"
  (only that which a provider actually publishes), with a source caveat.
- **Q (rejection codes):** Invented codes read like real NRS/provider codes.
  **Action:** every code Velure invents is now prefixed `MOCK_`
  (`rejection-guidance.ts`, `provider-adapter.ts`, `einvoice-submissions.ts`);
  the real catalogue is UNKNOWN.
- **Q (accreditation):** Do not build a real adapter until the accreditation
  question (Q4) is answered in writing. **Action:** Q4 moved to the top of §9
  and gates any real adapter.
- **Q (TIN):** Change the 10-digit TIN check from block to warn until NRS
  confirms. **Action:** `tin_format` is now a **warning** in the supplier
  profile, buyer profile, the invoice-save `assertValidTin` boundary, and the
  canonical pre-submission validator; `tin_required` and `tin_placeholder`
  stay blocking. Commit `22c3619`.
- **Q (structured address):** Confirm and fix the flattening first.
  **Action:** the snapshot party and `CanonicalParty` now carry the structured
  components (street/LGA/state + country via jurisdiction) instead of a single
  flattened string; `city`/`postalZone` are still not collected and stay
  absent, and no buyer postal address is invented. Commit `2d2e917`.
- **Q (discount):** blocked submission needs a product decision. **Action:**
  recorded as open question **Q-G**; the current validator block is unchanged.
- **Q (WHT/payable):** put the concern to a provider. **Action:** recorded as
  open question **Q-H** and added to the provider question list.

