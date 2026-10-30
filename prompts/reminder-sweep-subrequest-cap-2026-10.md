# Bound the reminder sweep under the free-tier tick ceilings

Status: done
Task: fix the live T1 defect where the reminder sweep's cursor row is never
persisted, so the sweep restarts from the front every tick.

## Goal

Make the scheduler tick fit inside the two ceilings the production host imposes
on `POST /api/cron/tick`, so the `reminder_sweep` `job_runs` row (which carries
the resume cursor) is actually written and every workspace is eventually swept.

## Live defect (verified, not assumed)

- `job_runs` has **zero** `reminder_sweep` rows, ever. `readPreviousCursor`
  therefore always returns `null`, the sweep restarts from the front every tick,
  and it re-sweeps the *same* first ~9–11 of **111** active workspaces. The
  `reminder_runs` ledger proves it: the 08:45 and 08:50 ticks wrote rows for the
  same owner ids.
- The tick's **50th** Supabase request — the `reminder_sweep` bookkeeping insert
  — is dropped, so `result_json.nextCursor` never lands.
- Evidence: a captured tick made **49** requests to Supabase
  (`active_workspaces` ×11, `invoices` ×10, `reminder_rules` ×10,
  `reminder_runs` ×9, `job_runs` ×5, other ×4). The worker logged
  `"Scheduler job bookkeeping failed", "[object Object]"`.
- Root cause: **Cloudflare Pages Functions' free-plan cap of 50 external
  subrequests per invocation** (documented; paid is 10,000). A direct probe with
  the identical payload + service-role key inserted fine, ruling out permissions,
  schema, and payload data.
- Secondary: the scheduled 08:50 tick (`net._http_response` id 104) **timed out**
  (`status_code: null`). The pg_net timeout is `10000` ms
  (`supabase/migrations/20261029000000_scheduler_pg_cron.sql:109`) and the tick
  ran ~8.4–10 s, so it is marginal on **time** as well as subrequests.

## Decisions / assumptions (confirmed with user)

- **User answer 2026-10-30:** chose **"bound the sweep to fit"** over giving the
  sweep its own cron invocation or upgrading Cloudflare to Paid. So: reduce the
  sweep's batch/time budget so the whole tick stays under both ceilings, fix the
  opaque error logging, and document the ceilings. Free, small, reversible.
- Consequence accepted: coverage returns to ~8 workspaces/tick, so a full
  111-workspace pass takes ~2–3 h at a 10-minute cadence. Acceptable for
  daily-cadence reminders.
- The sweep stays behind `SCHEDULER_REMINDER_SEND_ENABLED`; this slice does not
  turn on outbound customer email.

## Skills read

- Repo governance (`AGENTS.md` §8 tenancy, §9 smallest complete change, §10
  verified) applied by hand. No listed skill maps to a server-only scheduler
  bounds fix; existing Vitest harnesses are used.

## Existing code inspected (concrete files and line ranges)

- `src/server/reminder-sweep.ts:79-99` — `SEND_SWITCH`/`BATCH_SWITCH`/
  `BUDGET_SWITCH`, `DEFAULT_BUDGET_MS = 7000`, `DEFAULT_BATCH_SIZE = 50`,
  private `errorMessage` (:92).
- `src/server/reminder-sweep.ts:139-168` — cursor read + bounded `active_workspaces`
  page (`.limit(batchSize)`, `.gt("user_id", cursor)`).
- `src/server/reminder-sweep.ts:170-250` — deadline loop; per workspace
  `runReminderBatch` + `reminder_runs` insert; cursor returned as `nextCursor`.
- `src/server/scheduler.ts:52-54` — private `errorMessage` (`String(error)` →
  `[object Object]` for a PostgrestError plain object); `:105-129`
  `recordJobRun`; `:202-211` `safeRecordJobRun`.
- `src/server/recurring-generation.ts:136-138` — a third identical
  `errorMessage`.
- `src/server/data/reminders.ts:750-815` — `runReminderBatch` calls
  `resolveActiveWorkspaceId` (1 request) + `currentRule` (1) + `invoices` (1);
  the sweep adds the `reminder_runs` insert (1) → ~4 subrequests/workspace.
- `supabase/migrations/20261029000000_scheduler_pg_cron.sql:102-110` —
  `net.http_post(..., timeout_milliseconds := 10000)`.
- `src/server/scheduler.test.ts`, `src/server/reminder-sweep.test.ts` — existing
  fake-supabase harnesses.

## Files likely to change or be added

- **Add** `src/server/error-message.ts` — one shared `formatErrorMessage`.
- **Add** `src/server/error-message.test.ts`.
- **Edit** `src/server/reminder-sweep.ts` — lower the default batch/budget,
  document both ceilings, use `formatErrorMessage`.
- **Edit** `src/server/scheduler.ts` — use `formatErrorMessage`.
- **Edit** `src/server/recurring-generation.ts` — use `formatErrorMessage`
  (same class of hidden error in a scheduler job).
- **Edit** `src/server/reminder-sweep.test.ts` — pin the default caps + a
  behavioural bound test.
- **Add** `prompts/reminder-sweep-subrequest-cap-2026-10.md` (this file).

## Implementation requirements

1. No schema, migration, route, or stored-field change. Reversible.
2. The default batch × per-workspace subrequests + fixed overhead must stay well
   under 50, and the sweep budget + other jobs must stay well under 10 s.
   Record the arithmetic in the code comment so the next reader can re-derive it.
3. `formatErrorMessage` must serialize supabase-js's plain-object errors
   (`message`/`code`/`details`/`hint`) instead of `[object Object]`, and keep the
   existing `Error` → `.message` and primitive behaviour.
4. Env overrides (`SCHEDULER_REMINDER_SWEEP_BATCH`,
   `SCHEDULER_REMINDER_SWEEP_BUDGET_MS`) keep working.
5. Do not enable outbound email; do not touch numbering, money, or issued-invoice
   behaviour.

## Acceptance criteria

1. The sweep's default batch/time caps are the safe values, asserted by test. ✅
2. With more workspaces than the default batch, one tick sweeps exactly the
   default batch and returns a non-null `nextCursor` (headroom preserved). ✅
3. `formatErrorMessage` turns `{ message, code, details, hint }` into a readable
   string; `Error`, string, number, `{}`, and circular inputs degrade safely. ✅
4. `pnpm typecheck`, focused tests, `pnpm test`, `pnpm check` pass. ✅

## Checks to run

- `pnpm typecheck`
- `pnpm vitest run src/server/error-message.test.ts
  src/server/reminder-sweep.test.ts src/server/scheduler.test.ts
  src/server/recurring-generation.test.ts`
- `pnpm test` (expect ≥835 passed, 86 skipped)
- `pnpm check` (expect exit 0, 359 pre-existing warnings)
- After deploy: trigger one tick and confirm a `reminder_sweep` `job_runs` row
  exists and `nextCursor` differs from the previous tick (cursor advances).

## Scope changes (append-only)

- 2026-10-30: Prompt created.
- 2026-10-30: Implemented. Added `src/server/error-message.ts` (+ test) and
  replaced the three identical private `errorMessage` copies (`scheduler.ts`,
  `reminder-sweep.ts`, `recurring-generation.ts`) with `formatErrorMessage`.
  Lowered the sweep defaults to `REMINDER_SWEEP_DEFAULT_BATCH_SIZE = 8` /
  `REMINDER_SWEEP_DEFAULT_BUDGET_MS = 5000` and documented both ceilings in
  `reminder-sweep.ts`.

## Checks run (2026-10-30)

- `pnpm typecheck` → clean.
- Focused: `pnpm vitest run src/server/error-message.test.ts
  src/server/reminder-sweep.test.ts src/server/scheduler.test.ts
  src/server/recurring-generation.test.ts` → 31 passed.
- `pnpm test` → **844 passed / 86 skipped** (9 new tests).
- `pnpm check` → exit 0, 359 pre-existing warnings.

## Acceptance evidence

1. `REMINDER_SWEEP_DEFAULT_BATCH_SIZE === 8` and
   `REMINDER_SWEEP_DEFAULT_BUDGET_MS <= 5000`, and the derived worst-case
   subrequest count (10 + 8 × 4 = 42) is asserted `< 50`. ✅
2. `sweeps only the default batch and still returns a cursor to resume from`
   seeds 10 workspaces and asserts one tick sweeps exactly 8 and returns
   `user-7` as `nextCursor`. ✅
3. `error-message.test.ts` covers `{ message, code, details, hint }`, partial
   objects, `Error`, string, number, `{}`, circular, and nullish input. ✅
4. All four checks pass. ✅

## Post-deploy verification

- Trigger one tick, then confirm `job_runs` has a `reminder_sweep` row and its
  `result_json.nextCursor` differs on the following tick (cursor advances).
