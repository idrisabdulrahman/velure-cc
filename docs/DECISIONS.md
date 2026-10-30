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
| Q-H | **WHT / payable (T6/review).** Does the NRS e-invoice carry a gross amount plus a separate withholding amount, or a single net payable? | The app stores `withholdingTotal` and a net payable; whether that maps to the NRS/UBL document is UNKNOWN. Needs a provider/NRS confirmation. | Ask the provider question list (§9 of the gap analysis); do not guess. |

### Resolved

| ID | Answer | Date |
| --- | --- | --- |
| Q-A | Fresh `development` branch from `main` (`d7d8f07`); leave `V2` untouched for now. | 2026-10-29 |
| Q-B | Use `docs/AUDIT-2026-10.md` as the source-of-truth ground-truth table (the walkthrough document is not in the repo). | 2026-10-29 |
| Priority | Execute the audit's recommended priority order (T3 → T2 → T5 → T1 → T4 → Phase 2+), not a single first fix. | 2026-10-29 |
| Q-C | **Closed source.** Rewrite the Midday-derived files as clean-room originals and remove every "midday" name/path. UI and behavior must stay identical. No commercial licence. | 2026-10-29 |
| Q-E | **Supabase `pg_cron` + `pg_net`** calls the secret scheduler endpoint. No separate Worker. | 2026-10-29 |
| Q-G | **Discounts:** support invoice-level *before tax*, invoice-level *after tax*, and line-level, **mutually exclusive per invoice**. Before-tax reduces the taxable base proportionally (VAT on the discounted amount). A legacy discount with no stored mode defaults to **after tax**, preserving the totals the renderer already displayed. | 2026-10-30 |
| Q-I | **Reconciliation (T9):** keep manual + per-invoice Paystack virtual accounts as they are — **no new code now** — and separately investigate the "customers pay into the workspace's own bank account" case. Payment mix in practice: **mixed**. Follow-up raised as Q-J. | 2026-10-30 |
| Q-J | **Own-account reconciliation (T9/D):** ship the **payment reference = invoice number** (done), then **stop** — no statement import and no bank connection now. Customers do **not** currently put the invoice number in the narration, but the user is **willing to ask them to**. Statement import and any Nigerian aggregator remain deferred; a bank connection still needs product-strategy approval (`AGENTS.md` §3). | 2026-10-30 |

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

### 2026-10-30 — Post-review decisions (T1 sweep, TIN placeholder, discount)

- **T1 tick timeout (user decision).** The reminder sweep becomes
  **cursor-bounded**: each tick processes a bounded batch and resumes from a
  persisted cursor on the next tick, and the sweep runs **after** the cheap jobs
  so it can never starve them. Chosen over raising the pg_net timeout or fanning
  the sweep out. Implementation follows in
  `prompts/scheduler-sweep-cursor-2026-10.md`.
- **Placeholder TIN (user decision).** `tin_placeholder` stays **blocking
  everywhere**, including the invoice-save `assertValidTin` boundary. A legacy
  stored placeholder (e.g. `1234567890`) therefore blocks an invoice save until
  the client/workspace profile is corrected. This is the intended behaviour, not
  a regression to work around.
- **Discount (user decision, partial).** The product wants **all three**:
  invoice-level discount *before tax*, invoice-level discount *after tax*, and
  line-level discounts. The repo spec (`docs/e-invoicing/SPEC.md` B3) currently
  documents **line-level only**, and the tax engine
  (`src/features/tax/calculate.ts`) already models a line-level `discountMinor`
  that reduces that line's VAT base — but `calculateInvoiceCompliance` ignores
  discounts entirely, so the stored totals do not reflect the discount the
  renderer can display. **Combination/precedence (whether the modes are
  mutually exclusive or can stack) must be pinned before any money-path code
  changes.** The `discount_semantics_unsupported` block stays until then.

### 2026-10-30 — Discount money path (Q-G resolved)

- **Decision (user).** All three modes exist and are **mutually exclusive per
  invoice**: invoice-level *before tax*, invoice-level *after tax*, and
  line-level. A before-tax discount reduces the taxable base proportionally, so
  VAT is charged on the discounted amount; an after-tax discount leaves VAT
  intact and is subtracted from the total; a line discount reduces that line's
  base before VAT.
- **Default mode (implementation).** A stored discount with no mode resolves to
  `invoice_after_tax`, because that is what the HTML/PDF renderer has always
  displayed (`subtotal + VAT - discount`). Changing the default would silently
  change what a customer is charged, so this is deliberately conservative.
- **Where it lives.** Invoice-level discount + mode stay in `templateSettings`
  (`discount`, `discountMode`); line discounts live on `lineItem.discount`. No
  new required snapshot fields — the compliance snapshot stores the resulting
  gross `subtotal`, mode-adjusted `totalTax`, `grandTotal`, and `netPayable`, so
  stored legacy snapshots stay valid.
- **Validator.** The blanket `discount_semantics_unsupported` block is replaced
  by per-mode arithmetic: `discount_invalid`, `line_discount_invalid`,
  `discount_mode_invalid`, `discount_mode_mismatch`, `discount_total_mismatch`,
  and `discount_exceeds_subtotal`; `gross_total_mismatch` is now mode-aware.
- **Scope (this slice).** Engine, canonical model, pre-submission validator,
  save-path guards, HTML/PDF renderer, and the panel's invoice-level
  before/after selector + discount row. **Per-line discount inputs remain a
  follow-up slice**; the engine and validator already accept line mode.
- **Prompt:** `prompts/discount-money-path-2026-10.md`.
- **Checks:** `pnpm test` → 823 passed / 86 skipped (30 new tests);
  `pnpm typecheck` clean; `pnpm check` exit 0 with 359 pre-existing warnings.

### 2026-10-30 — Task T9 (bank-transfer reconciliation memo)

- **Decision:** Produce the options memo only; write **no code** until the user
  picks an option (T9's own instruction). Output:
  `docs/BANK-RECONCILIATION-OPTIONS.md`.
- **Correction recorded:** T9's premise ("manual plus Paystack only") is only
  half right. Paystack **Pay-with-Transfer already creates a per-invoice
  dedicated virtual account** (`ensurePaystackTransferCharge`,
  `src/server/data/paystack-server.ts:113`) with an 8-hour expiry, a
  deterministic `velure-<invoiceId>-<ts>` reference, and webhook + reconcile
  confirmation. Option B is therefore an **extension**, not a new build.
- **Pricing:** taken from `https://paystack.com/pricing` (fetched 2026-10-30).
  Virtual Accounts **1% capped at ₦300**; local transactions 1.5% + ₦100 capped
  at ₦2,000; transfers ₦10/₦25/₦50 by tier. Which class `/charge` with
  `bank_transfer` falls under is **UNKNOWN** — confirm with Paystack.
- **Open question Q-I** (added above): the user's choice and their real payment
  mix / statement format.
- **No code, schema, route, or migration touched.**
- **Checks:** `pnpm test` → 823 passed / 86 skipped (unchanged);
  `pnpm typecheck` clean; `pnpm check` exit 0 with 359 pre-existing warnings.

### 2026-10-30 — T9 answer + own-bank-account addendum (Q-I resolved, Q-J opened)

- **User answer (Q-I):** keep manual recording + per-invoice Paystack virtual
  accounts as they are; **no new reconciliation code now** (option 1 of the
  memo). Payment mix in practice: **mixed**.
- **User follow-up (new Q-J):** what if the workspace wants customers to pay
  into its **own** bank account rather than the generated virtual account — how
  would Velure verify that, or should it copy Midday and connect the bank to
  check automatically?
- **Research (no code):** `docs/BANK-RECONCILIATION-OPTIONS.md` §9. Midday's
  bank connection is real but **US/EU only** — its providers are plaid, teller,
  gocardless, enablebanking (`midday-main/apps/engine/src/providers/index.ts`),
  none of which covers Nigerian banks. Its matching engine is ~2,600 lines
  (`packages/db/src/utils/transaction-matching.ts`,
  `packages/db/src/queries/transaction-matching.ts`) and is **rejected for v1**;
  only the explicit `auto_matched | high_confidence | suggested` tier idea is
  adapted. Its `bank_connections` **stores the provider access token in the row**
  (`packages/db/src/schema.ts:1068`) — flagged as a defect Velure must **not**
  copy. `AGENTS.md` §3 requires product-strategy approval before any banking
  domain work, so nothing is built.
- **Recommended sequencing:** (1) put the **invoice number as a payment
  reference** into every invoice's instructions and the public payer page — no
  new provider needed and it helps A/C/D equally; (2) decide statement import for
  the workspace's own account; (3) only then evaluate **one** Nigerian
  aggregator, with approval.
- **Skill gap recorded (required by `AGENTS.md` §7):** `plaid-fintech` and
  `bank-sync` are **not installed** anywhere under `/home/asys` (only
  `plaid-fintech` is listed in `CATALOG.md:798`); no substitute was loaded.
- **Prompt:** `prompts/t9d-own-bank-account-reconciliation-2026-10.md`.
- **No code, schema, route, or migration touched.**
- **Checks:** `pnpm test` → 823 passed / 86 skipped (unchanged);
  `pnpm typecheck` clean; `pnpm check` exit 0 with 359 pre-existing warnings.

### 2026-10-30 — Payment reference = invoice number (T9/D step 1, first code)

- **User answer:** "proceed with recommendation" — implement step 1 of
  `docs/BANK-RECONCILIATION-OPTIONS.md` §9.5.
- **What shipped:** the invoice number is printed as a **payment reference** in
  the invoice payment instructions, so it reaches the payer on the public payer
  page and in the emailed/PDF invoice. One shared pure helper
  (`src/lib/invoice-document/payment-reference.ts`,
  `getInvoicePaymentReference`) decides whether and what to show, and **both**
  renderers call it: `templates/html/index.tsx` and `templates/pdf/index.tsx`
  (new `PaymentReference` component). No schema, migration, stored field,
  numbering, or issued-invoice behaviour changed; existing invoices inherit the
  reference because the invoice number is already stored.
- **Hidden once settled:** no reference is printed for `paid` or `canceled`
  invoices, matching the states the payer flow already treats as closed. Shown
  for `draft`, `unpaid`, `partially-paid`, `overdue`, and for an invoice with
  no invoice number it is simply omitted.
- **Deliberate wording reuse:** the app already has a recorded-payment
  `paymentReference` field (`src/features/invoices/types.ts:140`; the "Payment
  reference" input in `invoice-details-sheet.tsx:2053`). Printing the same words
  is intentional — the payer quotes the invoice number and the user records that
  same reference when reconciling.
- **Deliberately not done (minimal change, AGENTS.md §9):** the label is the
  constant `"Payment reference"`, not a new `Template`/settings field. There is
  no UI to change it, so a configurable field would be dead configuration.
- **Prompt:** `prompts/payment-reference-2026-10.md`.
- **Checks (2026-10-30):** `pnpm test` → **835 passed / 86 skipped** (12 new
  tests: 6 helper, 3 public-HTML render, 3 PDF render); `pnpm typecheck` clean;
  `pnpm check` exit 0 with 359 pre-existing warnings.
- **User follow-up answer (Q-J resolved 2026-10-30):** stop after the payment
  reference — do **not** build statement import or a bank connection now; deploy
  `development` and move to the next task. Customers do **not** currently put the
  invoice number in the narration, but the user is **willing to ask them to**,
  which is exactly what the printed reference enables. Deploying `development`
  now takes effect for the discount slice (`f98b165`), the T1 sweep fix
  (`0081444`), and this slice.

### 2026-10-30 — Reminder sweep bounded under the free-tier tick ceilings

- **Live defect found after the T1 deploy:** `job_runs` had **zero**
  `reminder_sweep` rows, so the sweep's resume cursor never persisted and it
  re-swept the *same* first ~9–11 of **111** active workspaces every tick; the
  rest were never swept. The `reminder_runs` ledger showed identical owner ids
  across the 08:45 and 08:50 ticks.
- **Root cause (verified):** **Cloudflare Pages Functions' free-plan cap of 50
  external subrequests per invocation** (paid is 10,000). A captured tick made
  **49** Supabase requests; the 50th — the `reminder_sweep` bookkeeping insert
  that carries `nextCursor` — was dropped. A direct probe with the identical
  payload + service-role key inserted fine, ruling out permissions/schema/data.
  Secondary: the 08:50 tick also **timed out** (`net._http_response` id 104);
  the pg_net timeout is exactly `10000` ms and the tick ran ~8.5–10 s.
- **User answer 2026-10-30:** fix by **bounding the sweep to fit** both ceilings
  (over giving the sweep its own cron invocation or upgrading Cloudflare to
  Paid).
- **What shipped:** `REMINDER_SWEEP_DEFAULT_BATCH_SIZE` 50 → **8** and
  `REMINDER_SWEEP_DEFAULT_BUDGET_MS` 7000 → **5000** (`src/server/reminder-sweep.ts`),
  with the arithmetic documented in-code (8 × 4 + ~10 ≈ 42 subrequests; 5 s + ~2 s
  ≈ 7 s). Added `src/server/error-message.ts` (`formatErrorMessage`) so a
  supabase-js plain-object PostgREST error is serialized instead of logging
  `[object Object]`; the three private copies (`scheduler.ts`,
  `reminder-sweep.ts`, `recurring-generation.ts`) now share it.
- **Consequence accepted:** ~8 workspaces/tick → a full 111-workspace pass takes
  ~2–3 h at a 10-minute cadence (fine for daily-cadence reminders). A future
  slice could cut the ~4 subrequests/workspace (pass `workspace_id` from the
  `active_workspaces` page instead of re-resolving it; bulk-insert
  `reminder_runs`) to raise coverage, or move to Paid.
- **Not changed:** no schema/migration/route; outbound email stays behind
  `SCHEDULER_REMINDER_SEND_ENABLED`.
- **Prompt:** `prompts/reminder-sweep-subrequest-cap-2026-10.md`.
- **Checks (2026-10-30):** `pnpm test` → **844 passed / 86 skipped** (9 new
  tests); `pnpm typecheck` clean; `pnpm check` exit 0 with 359 pre-existing
  warnings.
- **Follow-up decision (2026-10-30):** automatic reminder sending stays **OFF**.
  The `reminder_events` queue is **empty** and nothing is eligible to send (0 of
  62 invoices have `lifecycle.sentAt`; 47 are still drafts, 0 custom rules).
  Enabling `SCHEDULER_REMINDER_SEND_ENABLED` today would email zero people, but
  the data contains real-looking buyer addresses
  (`idrisabdulrahman114@gmail.com`, `noicepikachu@gmail.com`,
  `roxxam01@gmail.com`, …), so turning it on would **arm** outbound email for the
  next delivered invoice. User chose to keep it off and enable it deliberately
  when real invoices are being issued.

