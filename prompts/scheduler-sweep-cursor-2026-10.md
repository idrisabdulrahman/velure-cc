# Reminder sweep: cursor-bounded batches per tick

Status: done

Task source: the T1 live defect found on deploy 2026-10-30
(`prompts/scheduler-tick-2026-10.md`, `docs/DECISIONS.md`): the first post-deploy
tick (06:30 UTC) hit pg_net's `timeout_milliseconds := 10000`, recording only
3 of 5 jobs and sweeping only 10 of 111 active workspaces before the worker was
killed (`recurring_generation` never ran). User decision (2026-10-30): fix by a
**cursor-bounded sweep** that resumes next tick and runs last.

## Goal

Make the reminder sweep complete within the tick's time budget and cover every
active workspace across a bounded number of ticks, without starving the other
scheduler jobs.

## Decisions / assumptions (confirmed with user)

- **Cursor-bounded sweep** chosen over raising the pg_net timeout or fanning the
  sweep out (user, 2026-10-30).
- **Sweep runs last** in `SCHEDULER_JOBS` so a slow sweep can never starve the
  cheap jobs above it.
- The cursor lives in the latest `reminder_sweep` `job_runs.result_json`
  (`nextCursor`). No new table/migration: `job_runs` already records one row per
  run, so the resume point lives with the run that produced it. A missing table
  or a failed run restarts from the front, which is safe because every
  downstream write is idempotent.
- Defaults: `SCHEDULER_REMINDER_SWEEP_BATCH=50`,
  `SCHEDULER_REMINDER_SWEEP_BUDGET_MS=7000` (leaves ~1.5 s of the 10 s tick for
  the other jobs).
- No pg_net timeout change. `timeout_milliseconds := 10000` stays.

## Skills read

`architect`, `systematic-debugging` (root-cause first), `api-design-principles`
(contract of the sweep summary), `code-review` — plus AGENTS.md §4 workflow and
§8 tenancy floor. No Next.js/Midday port involved.

## Existing code inspected

- `src/server/reminder-sweep.ts:49-150` — the previous unbounded
  offset-paged sweep (one `runReminderBatch` per active workspace).
- `src/server/scheduler.ts:62-98` — `SCHEDULER_JOBS` order and the sequential
  tick loop with per-job try/catch (`:146-185`).
- `src/server/data/reminders.ts:750-909` — `runReminderBatch`; `defaultRule`
  (`:80-94`, `enabled: true`) scans every invoice per workspace.
- `supabase/migrations/20261029000000_scheduler_pg_cron.sql` —
  `invoke_scheduler_tick()` with `timeout_milliseconds := 10000`.
- `src/server/reminder-sweep.test.ts`, `src/server/scheduler.test.ts` —
  behaviour pinned by the old sweep and the old job order.

## Files changed

- `src/server/reminder-sweep.ts` — cursor + batch cap + wall-clock budget;
  `nextCursor`/`truncated` in the summary; `readPreviousCursor` from `job_runs`.
- `src/server/scheduler.ts` — `reminder_sweep` moved last.
- `src/server/reminder-sweep.test.ts` — 3 new tests (batch+cursor sequence,
  resume from persisted `job_runs` cursor, time-budget early stop).
- `src/server/scheduler.test.ts` — expected job order updated.

## Implementation requirements

- One bounded `active_workspaces` read per tick in `user_id` order, filtered by
  `.gt("user_id", cursor)` and capped at `batchSize` (no offset scan, so it can
  never be silently capped by PostgREST `max-rows`).
- Stop early once `budgetMs` is spent, but never before sweeping one workspace,
  so the cursor always advances.
- A short page means the end of the list: set `nextCursor = null` to wrap.
- Cursor read is best-effort (missing table / unreadable row → `null`).
- Tenancy unchanged: each workspace is still swept under its owner `user_id`.

## Acceptance criteria

1. `SCHEDULER_JOBS` runs `reminder_sweep` last; a sweep can never run before the
   cheap jobs.
2. With `batchSize: 1` and two workspaces, three ticks sweep each workspace
   exactly once and then wrap (`nextCursor` `user-a` → `user-b` → `null`).
3. A cursor persisted in `job_runs.result_json.nextCursor` is honoured on the
   next tick.
4. A `budgetMs` of 0 sweeps exactly one workspace and reports `truncated`.
5. All prior sweep behaviour is preserved (idempotent queueing, send switch,
   per-workspace failure isolation).
6. `pnpm test`, `pnpm typecheck`, `pnpm check` pass.

## Checks to run

- `pnpm test` before and after (baseline 790 passed / 86 skipped).
- `pnpm typecheck`, `pnpm check`.
- Focused: `pnpm vitest run src/server/reminder-sweep.test.ts
  src/server/scheduler.test.ts`.

## Scope changes (append-only)

- 2026-10-30: Prompt created after the user chose the cursor-bounded direction.

## Verification

- `pnpm typecheck` clean.
- `pnpm test` → **793 passed / 86 skipped** (baseline 790; +3 new tests).
- `pnpm check` exit 0 (359 pre-existing warnings).
- Deploy note: the fix is code-only; it takes effect on the next Pages deploy of
  `development`. Not deployed as part of this task (the user holds deploys).
