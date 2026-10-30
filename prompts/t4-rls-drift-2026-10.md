# T4 — tenancy-doc drift check (RLS + honesty wording)

Status: done

## Goal

Execute the audit's T4 ("RLS drift / wording — only if drift is found"). Verify
whether the live RLS enforcement and the tenancy documentation still match the
code, and fix only the drift that is proven. No schema, policy, or app-behavior
change is in scope unless real drift is found.

## Decisions / assumptions (confirmed with user)

- Priority order is T3 → T2 → T5 → T1 → **T4** → Phase 2+ (`docs/DECISIONS.md`).
- T4 is a verification task first: "only if RLS drift is found; current
  docs/copy are already honest" (`docs/AUDIT-2026-10.md` recommended order).
- Read-only against the live project unless drift requires an edit.
- The A10_LIVE minted-JWT matrix (`pnpm test:wp3-tenant-isolation-live`) writes
  fixtures and needs explicit user approval; **not run** in this task. Live
  policy state is inspected directly via the Supabase MCP instead.

## Skills read / considered

- `supabase-postgres-best-practices` (RLS/policy design) — considered for the
  policy-vs-code comparison; the authoritative check here is the live
  `pg_policies`/`pg_class` state plus the migrations.
- `code-review` — used as the review lens for "does the doc match the guard".

## Existing code inspected

- `docs/e-invoicing/tenant-isolation.md` (whole file) — the tenancy coverage
  summary; the drift source.
- `src/server/data/tenant-isolation-coverage.test.ts:118-121,258-278` — the
  live classification guard.
- `src/server/data/reminders.ts:256-320` — `currentRule` filters
  `.eq("owner_id", userId)`; `saveReminderSettings` reads via `currentRule` and
  inserts `owner_id: userId`, so both are genuinely app-scoped after T1.
- Live project `kbexydkmmfabfutgkbxn` (read-only SQL): `pg_class` RLS flags,
  `pg_policies` for all `public` tables, and the recurring/reminder/job tables.

## Findings

- **No live RLS drift.** All 33 `public` tables have RLS enabled. 5 tables are
  RLS-on with **no** policy (deny-all to browser roles, server-only by design):
  `einvoice_provider_credentials`, `integration_connections`,
  `integration_webhooks`, `invoice_number_sequences`,
  `public_rate_limit_windows`. One explicit deny-all policy
  (`job_runs_server_only`) exists for `job_runs`, which is correct (service-role
  only). No leftover `*_pending_verified_identity` placeholders remain. The
  recurring/reminder tables T1 reads and writes have correct active policies
  (`workspace_member` for recurring; `owner_id = app.current_user_id()` for
  reminders and collections).
- **Documentation drift (the actual T4 finding).**
  `docs/e-invoicing/tenant-isolation.md` still lists `getReminderSettings` and
  `saveReminderSettings` as `rls-only`. T1 added the `owner_id` filter to
  `currentRule`, so the coverage guard now classifies them `app-scoped`
  (`tenant-isolation-coverage.test.ts:264-265`). The doc also omits the T1
  additions `sendQueuedEmails`, `listReminderRuns` (app-scoped) and
  `listRecurringRuns` (app-scoped).

## Files likely to change

- `docs/e-invoicing/tenant-isolation.md` — move the two reminder-settings
  functions out of the `rls-only` lists, note the T1 additions, and correct the
  stale "landed on `einv/wp3`" status line.
- `docs/DECISIONS.md` — log the T4 finding + decision.
- `docs/AUDIT-2026-10.md` — mark T4 resolved in the recommended-order section.
- `prompts/t4-rls-drift-2026-10.md` — this file.

## Implementation requirements

- Docs-only. Do **not** change policies, schema, or app code.
- Every claim in the edited doc must be backed by the guard, the code read, or
  the live policy query above.

## Acceptance criteria

- `docs/e-invoicing/tenant-isolation.md` `rls-only` lists contain exactly the
  guard's `rls-only` set (`markReminderEventStatus`, `listSyncJobs`, `listLogs`,
  `retrySyncJob`) and no more.
- The live RLS state is recorded as evidence (33 tables RLS-on, 5 server-only
  with no policy, `job_runs` deny-all, no pending placeholders).
- `docs/DECISIONS.md` and `docs/AUDIT-2026-10.md` reflect the T4 result.

## Checks to run

- `pnpm test` (unchanged count expected; docs-only).
- `pnpm typecheck` and `pnpm check` (no code change; guard files unchanged).
- Live read-only SQL already captured above.

## Scope changes (append-only)

- 2026-10-29: Prompt created after verification. Confirmed T4 is docs-only: no
  live RLS drift exists, only `tenant-isolation.md` wording is stale.
- 2026-10-30: The 23 environmental `JWT expired` failures noted below were fixed
  separately (re-minted the local `service_role` token in `.env.test`; see
  `docs/DECISIONS.md` 2026-10-30). Full `pnpm test` is green again at
  787 passed / 86 skipped. No T4 doc change needed.

## Verification (2026-10-29)

- `pnpm typecheck` → clean.
- `pnpm check` → exit 0 (unchanged pre-existing warnings).
- `pnpm test` → 764 passed / 23 failed / 86 skipped. **All 23 failures are
  pre-existing and environmental, not caused by T4:** the three local-stack
  Paystack DB integration suites
  (`src/routes/api/payments/paystack/-initialize-db.integration.test.ts`,
  `-reconcile-db.integration.test.ts`, `-webhook-db.integration.test.ts`) fail
  with `JWT expired`. The local test stack's service-role JWT
  (`PAYSTACK_TEST_SERVICE_ROLE_KEY`) expired at **2026-10-29T19:54:25Z**; the
  same suite passed earlier the same day (~17:04) before expiry. These suites
  are guarded to a **local** host only (`-test-helpers.ts:81-91`), so the live
  migration is unrelated. Fix = restart and reseed the local Supabase stack
  (`supabase stop && supabase start`), which rewrites `.env.test`; not done
  here because it discards local state and needs the user's go-ahead. The
  default (no-DB) suite is otherwise fully green, and every T4 change is
  docs-only.
- Live RLS state captured read-only (33 tables RLS-on; 5 server-only with no
  policy; `job_runs` deny-all; no pending placeholders).
- Acceptance: `docs/e-invoicing/tenant-isolation.md` `rls-only` set now equals
  the guard's (`markReminderEventStatus`, `listSyncJobs`, `listLogs`,
  `retrySyncJob`).
