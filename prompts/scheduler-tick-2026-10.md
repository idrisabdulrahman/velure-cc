# Scheduler tick, reminder sweep, and recurring generation (T1)

Status: done

Task source: critique item **#1** — "No scheduler runs the reminder / recurring /
reconciliation / scheduled-send jobs in production" — verdict **Confirmed** in
[`../docs/AUDIT-2026-10.md`](../docs/AUDIT-2026-10.md). Priority order chosen by
the user: T3 → T2 → T5 → **T1** → T4 → Phase 2+.

## Goal

Make the existing job endpoints actually run on a schedule, add the two missing
jobs (server-side reminder sweep, recurring draft generation), record every run
in `job_runs`, and make the Settings surfaces describe the true run state instead
of "manual only".

## Decisions / assumptions (confirmed with user)

- **Q-E (answered 2026-10-29):** scheduler host is **Supabase `pg_cron` +
  `pg_net`**, POSTing to a secret endpoint. No separate Worker.
- **Cadence defaults are not changed.** `defaultRule` in
  `src/server/data/reminders.ts:80-94` (3 days before due / due date / every 3
  days overdue / max 3) is kept as-is; tuning it is a product decision, not part
  of T1.
- **Automatic reminder *email* sending is off by default.** Queuing/scans run
  automatically, but the outbound send only runs when
  `SCHEDULER_REMINDER_SEND_ENABLED === "true"`. Sending customer email is
  irreversible and customer-facing, so it stays behind one explicit switch until
  the user approves it. Documented in `docs/DECISIONS.md`.
- **Recurring generation creates drafts only.** The schedule stores no
  customer id/email, so `auto_send` cannot be honoured and generation must not
  finalize, issue, or send. This is the safe partial and is stated in the UI.
- Migrations are **written but not applied** to the live project in this task;
  applying `pg_cron`/`pg_net`/the index is the operator's step (asked at the
  end). The unique partial index was checked against live data first: 0
  duplicate `(invoice_id, stage, channel)` keys with `status <> 'failed'`.

## Skills read

- `architect` / `api-design-principles` conventions (route + job contract).
- Governance `AGENTS.md` §8 (service-role is server-only, logged) and §9
  (smallest complete change).

## Existing code inspected

- `src/routes/api/invoice/scheduled.ts`, `.../submissions/scheduled.ts`,
  `.../payments/paystack/reconcile.ts`, `.../reminders/send-queue.ts` — the four
  existing secret/user endpoints and their auth patterns.
- `src/server/data/reminders.ts` — `currentRule:249` (**unscoped bug**),
  `runReminderBatch:732`, `sendQueuedEmails:799`, `queueReminderEvent:623`,
  `defaultRule:80`.
- `src/server/data/recurring.ts` — schedule CRUD only; no generation.
- `src/server/data/invoices.ts` — `autosaveDraft:1862` (real draft, allocates a
  DB number, works with no customer), `createDraft:1658` (finalizes → needs a
  customer, unusable for recurring), `assertInvoiceInput:557`,
  `loadDerivedPartyIdentity:1415`, `assertWorkspaceCustomer:1391`.
- `src/server/data/audit.ts:184` — `recordInvoiceAudit(..., { workspaceId })`
  server-only escape hatch for system jobs.
- `src/server/data/audit-client.ts:61` — browser transport default (relative
  fetch) that a server job must NOT use.
- `src/server/invoice-mailer.ts:53` `dispatchScheduledInvoiceEmails`,
  `src/server/data/einvoice-submissions.ts:583` `dispatchDueInvoiceSubmissions`,
  `src/server/data/paystack-server.ts:372` `reconcilePendingPaystackCharges`.
- Migrations `20260815000552` (`job_runs`), `20260815003436`
  (`reminder_rules`/`runs`/`events`), `20260814234545`
  (`recurring_invoice_schedules`/`runs` unique `(schedule_id, period_key)`),
  `20260815190830` (A9 RLS for reminders/recurring), `20261020000000`
  (`allocate_invoice_number`).
- `src/server/data/testing/fake-db.ts` — in-memory Supabase double.
- `src/routes/settings.collections.tsx`, `src/routes/settings.recurring.tsx` —
  last-run surfaces, React Query + user-scoped client pattern.
- Supabase docs: `pg_net` (`create extension ... with schema extensions`, call
  `net.http_post`), Supabase Cron (`cron.schedule`, `cron.job`), `vault`
  extension already installed. Live check: `pg_cron`/`pg_net` available but not
  installed; `reminder_events` = 0 rows.

## Files likely to change or be added

- `src/server/data/reminders.ts` — owner-scope `currentRule`; tolerate the new
  unique index (23505 → skipped); add `listReminderRuns`.
- `src/server/data/recurring.ts` — add `listRecurringRuns`.
- `src/server/data/invoices.ts` — `autosaveDraft` optional
  `{ workspaceId, writer }` so a system job writes in the row's real workspace
  with the server audit sink.
- `src/server/recurring-generation.ts` (new) — idempotent due-schedule draft
  generation with a `recurring_invoice_runs` claim ledger.
- `src/server/reminder-sweep.ts` (new) — per-active-workspace reminder scan,
  records `reminder_runs`, send gated by env.
- `src/server/scheduler.ts` (new) — job registry, per-job isolation, `job_runs`
  bookkeeping, `loadSchedulerHealth`.
- `src/routes/api/cron/tick.ts` (new) — bearer `INVOICE_SCHEDULER_SECRET`.
- `src/routes/settings.collections.tsx`, `src/routes/settings.recurring.tsx` —
  honest last-run surfaces.
- `supabase/migrations/20261029000000_scheduler_pg_cron.sql` (new) — guarded
  `pg_cron` + `pg_net`, vault-driven tick job, `reminder_events` unique partial
  index.
- `src/server/data/testing/fake-db.ts` — model the reminder-events unique
  partial index.
- Tests: `src/server/scheduler.test.ts`,
  `src/server/recurring-generation.test.ts`, `src/server/reminder-sweep.test.ts`,
  `src/routes/api/cron/-tick.test.ts`,
  `src/server/data/reminders.owner-scope.test.ts`.
- Docs: `docs/DECISIONS.md`, `docs/AUDIT-2026-10.md`, this prompt.

## Implementation requirements

- Never call a *browser* audit transport from a server job; inject the
  server-only `recordInvoiceAudit` with the row's real `workspaceId`.
- Tenancy: recurring generation must scope to `schedule.workspace_id` and the
  reminder sweep to each `active_workspaces.user_id`; never rely on the
  owner's *current* active workspace for a stored row.
- Idempotency: recurring per `(schedule_id, period_key)`; reminder events per
  `(invoice_id, stage, channel)` with `status <> 'failed'`.
- One failing job must not abort the tick or the other jobs; every job writes a
  `job_runs` row (status `success`/`failure`) with duration and a JSON-safe
  result.
- No float money, no NRS/MBS claims, issued invoices stay immutable, audit log
  untouched.
- New branch/loop/money/security paths each get one focused runnable check.

## Acceptance criteria

1. `currentRule` filters by `owner_id`; all three callers pass the user id.
2. `POST /api/cron/tick` fails closed without the secret and runs the tick with
   it; a partial failure returns per-job results without aborting the others.
3. Recurring generation creates one draft per due schedule per period, is
   idempotent on re-run, advances `next_run_date`, and records
   `recurring_invoice_runs`.
4. The reminder sweep scans each active workspace, records a `reminder_runs`
   row, and does not send email unless the env switch is on.
5. Settings show the last automatic run (or "none recorded yet") and no longer
   describe the jobs as purely manual.
6. The migration is guarded and reversible, and states how to configure the
   endpoint URL/secret.
7. `pnpm test`, `pnpm typecheck`, `pnpm check` all pass.

## Checks to run

- `pnpm test` before and after (baseline 757 passed / 86 skipped).
- `pnpm typecheck`, `pnpm check`.
- Read-only SQL on the live project (duplicate check above).

## Scope changes (append-only)

- 2026-10-29: Prompt created. Design fixed: host = pg_cron/pg_net (Q-E);
  reminder email send behind `SCHEDULER_REMINDER_SEND_ENABLED`; recurring =
  drafts only.
- 2026-10-29: Dropped a planned global scheduler-health endpoint/UI. Settings
  read `reminder_runs` / `recurring_invoice_runs` with the user-scoped client
  instead, so the admin-only `job_runs` table stays out of the browser.
- 2026-10-29: Fixed an unrelated-but-load-bearing bug found while wiring the
  service-role sweep: `currentRule` had no `owner_id` filter, so the sweep
  would have applied one owner's rule to every workspace. Added
  `src/server/data/reminders.owner-scope.test.ts`.
- 2026-10-29: Migration schedule guard tightened to require **both** `pg_cron`
  and `pg_net`; otherwise no job is created (avoids a tick failing every 10
  minutes on `net.http_post`).
- 2026-10-29: `testing/fake-db.ts` now models the reminder-events partial
  unique index and the recurring-runs unique key, and its generated row ids are
  globally unique (a per-builder counter was producing duplicate ids).

## Verification (2026-10-29)

- `pnpm test` → **787 passed / 86 skipped** (baseline 757 / 86; +30 tests in
  `recurring-generation.test.ts`, `reminder-sweep.test.ts`,
  `scheduler.test.ts`, `api/cron/-tick.test.ts`, `data/recurring.test.ts`,
  `data/reminders.owner-scope.test.ts`).
- `pnpm typecheck` → clean.
- `pnpm check` → exit 0, 359 pre-existing warnings.
- `tenant-isolation-coverage.test.ts` updated (new exports/routes classified;
  `getReminderSettings`/`saveReminderSettings` moved from `rls-only` to
  `app-scoped` because the read now carries an owner filter).
- Not done in this task (needs the user): enabling
  `SCHEDULER_REMINDER_SEND_ENABLED`, and setting the matching app env vars /
  deploying to production.

## Operator go-live (2026-10-29, after the task was marked done)

The user approved and the following was done via the Supabase MCP against the
live project `kbexydkmmfabfutgkbxn`:

- Applied `20261029000000_scheduler_pg_cron.sql`: `pg_cron` 1.6.4 + `pg_net`
  0.20.4 enabled, `public.invoke_scheduler_tick()` created, the
  `reminder_events` partial unique index created, and the
  `velure-scheduler-tick` job scheduled (`*/10 * * * *`, active).
- Created the Vault secrets `velure_scheduler_url`
  (`https://velure-f2c.pages.dev/api/cron/tick`) and
  `velure_scheduler_secret` (32-byte random hex generated inside Postgres, so
  the value is not stored in this repo).
- User decision: **enable automatic reminder email sending**
  (`SCHEDULER_REMINDER_SEND_ENABLED=true`) — recorded in `docs/DECISIONS.md`.

Still the operator's (not the MCP's): set `INVOICE_SCHEDULER_SECRET` +
`SCHEDULER_REMINDER_SEND_ENABLED=true` in the Cloudflare Pages project and
deploy the T1 code. Production returns 404 for `/api/cron/tick` until then.
