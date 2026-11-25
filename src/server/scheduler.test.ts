import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeTables } from "./data/testing/fake-db";
import type { Supabase } from "./data/workspaces";
import {
	runSchedulerTick,
	SCHEDULER_JOB_NAMES,
	type SchedulerJob,
} from "./scheduler";

/**
 * T1 — the scheduler tick contract.
 *
 * The tick is the single thing Supabase `pg_cron` calls, so its failure
 * behaviour matters more than any individual job:
 *
 *   * every registered job runs, sequentially;
 *   * a throwing job does NOT abort the tick or the remaining jobs;
 *   * each job writes exactly one `job_runs` row (success or failure) with
 *     timing and a JSON-safe result, so a broken scheduler is visible in SQL;
 *   * a failed BOOKKEEPING write is logged and swallowed rather than skipping
 *     the remaining jobs.
 *
 * The jobs themselves are injected here so the test pins the runner, not the
 * downstream data functions (those have their own tests).
 */

const NOW = new Date("2026-10-29T09:00:00.000Z");

function jobRuns(tables: FakeTables) {
	return (tables.job_runs ?? []) as Array<Record<string, unknown>>;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("scheduler job registry", () => {
	it("registers the previously missing reminder and recurring jobs", () => {
		expect(SCHEDULER_JOB_NAMES).toEqual([
			"scheduled_invoice_emails",
			"einvoice_submissions",
			"paystack_reconcile",
			"recurring_generation",
			// The bounded sweep runs last so it cannot starve the cheap jobs.
			"reminder_sweep",
		]);
	});
});

describe("runSchedulerTick", () => {
	it("runs every job in order and records a success row for each", async () => {
		const calls: string[] = [];
		const jobs: SchedulerJob[] = [
			{
				name: "first",
				run: async () => {
					calls.push("first");
					return { created: 1 };
				},
			},
			{
				name: "second",
				run: async () => {
					calls.push("second");
					return { skipped: 2 };
				},
			},
		];
		const tables: FakeTables = { job_runs: [] };
		const { client } = createFakeSupabase(tables);

		const summary = await runSchedulerTick({
			admin: client,
			now: NOW,
			jobs,
		});

		expect(calls).toEqual(["first", "second"]);
		expect(summary.ok).toBe(true);
		expect(summary.jobs.map((job) => job.name)).toEqual(["first", "second"]);
		expect(summary.jobs.every((job) => job.status === "success")).toBe(true);

		const recorded = jobRuns(tables);
		expect(recorded).toHaveLength(2);
		expect(recorded[0]).toMatchObject({
			workspace_id: null,
			job_name: "first",
			status: "success",
			retries: 0,
			error: null,
			result_json: { created: 1 },
		});
		expect(recorded[1]).toMatchObject({
			job_name: "second",
			status: "success",
			result_json: { skipped: 2 },
		});
		for (const row of recorded) {
			expect(Number(row.duration_ms)).toBeGreaterThanOrEqual(0);
			expect(Date.parse(String(row.completed_at))).toBeGreaterThanOrEqual(
				Date.parse(String(row.started_at)),
			);
		}
	});

	it("keeps running after a job throws and records the failure", async () => {
		const jobs: SchedulerJob[] = [
			{
				name: "broken",
				run: async () => {
					throw new Error("provider exploded");
				},
			},
			{
				name: "healthy",
				run: async () => ({ ok: true }),
			},
		];
		const tables: FakeTables = { job_runs: [] };
		const { client } = createFakeSupabase(tables);

		const summary = await runSchedulerTick({
			admin: client,
			now: NOW,
			jobs,
		});

		expect(summary.ok).toBe(false);
		expect(summary.jobs).toHaveLength(2);
		expect(summary.jobs[0]).toMatchObject({
			name: "broken",
			status: "failure",
			error: "provider exploded",
		});
		expect(summary.jobs[1]).toMatchObject({
			name: "healthy",
			status: "success",
		});

		const recorded = jobRuns(tables);
		expect(recorded).toHaveLength(2);
		expect(recorded[0]).toMatchObject({
			job_name: "broken",
			status: "failure",
			error: "provider exploded",
			result_json: null,
		});
		expect(recorded[1]).toMatchObject({
			job_name: "healthy",
			status: "success",
		});
	});

	it("logs but never aborts when job bookkeeping is unavailable", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		// No `job_runs` table in the store: `from("job_runs")` throws, exactly
		// like a missing/denied table would.
		const { client } = createFakeSupabase({} as FakeTables);
		const jobs: SchedulerJob[] = [
			{ name: "first", run: async () => ({ ok: true }) },
			{ name: "second", run: async () => ({ ok: true }) },
		];

		const summary = await runSchedulerTick({
			admin: client,
			now: NOW,
			jobs,
		});

		expect(summary.ok).toBe(true);
		expect(summary.jobs).toHaveLength(2);
		expect(errorSpy).toHaveBeenCalled();
		expect(String(errorSpy.mock.calls[0]?.[0])).toContain(
			"Scheduler job bookkeeping failed",
		);
	});

	it("serializes a plain-object bookkeeping error instead of [object Object]", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		// The real production failure: supabase-js returns a PostgREST error as a
		// PLAIN OBJECT, and `String(error)` hid it as "[object Object]" behind
		// "Scheduler job bookkeeping failed", so the cause was invisible.
		const admin = {
			from() {
				return {
					insert: () =>
						Promise.resolve({
							error: {
								message: "Too many subrequests",
								code: "CF-50",
								details: "exceeded 50 subrequests",
								hint: "upgrade the plan",
							},
						}),
				};
			},
		} as unknown as Supabase;
		const jobs: SchedulerJob[] = [
			{ name: "solo", run: async () => ({ ok: true }) },
		];

		await runSchedulerTick({ admin, now: NOW, jobs });

		expect(errorSpy).toHaveBeenCalled();
		const logged = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
		expect(logged).not.toContain("[object Object]");
		expect(logged).toContain("Too many subrequests");
		expect(logged).toContain("CF-50");
	});

	it("does not leak a non-JSON job result into the tick summary", async () => {
		const tables: FakeTables = { job_runs: [] };
		const { client } = createFakeSupabase(tables);
		const jobs: SchedulerJob[] = [
			{
				name: "with-undefined",
				run: async () => ({ kept: "yes", dropped: undefined }),
			},
		];

		const summary = await runSchedulerTick({ admin: client, now: NOW, jobs });

		expect(summary.jobs[0].result).toEqual({ kept: "yes" });
		expect(jobRuns(tables)[0].result_json).toEqual({ kept: "yes" });
	});
});
