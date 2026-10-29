import type { Json } from "#/types/database.types";
import { dispatchDueInvoiceSubmissions } from "./data/einvoice-submissions";
import { reconcilePendingPaystackCharges } from "./data/paystack-server";
import type { Supabase } from "./data/workspaces";
import { dispatchScheduledInvoiceEmails } from "./invoice-mailer";
import { runRecurringGeneration } from "./recurring-generation";
import { runReminderSweep } from "./reminder-sweep";
import { getSupabaseAdminClient } from "./supabase";

/**
 * T1 — the one scheduler tick.
 *
 * Every production job that used to rely on an operator or on a hand-wired
 * cron pinger now runs from a single secret endpoint, `POST /api/cron/tick`,
 * invoked by Supabase `pg_cron` + `pg_net` (migration
 * `20261029000000_scheduler_pg_cron.sql`).
 *
 * Contract:
 *   * jobs run sequentially; one job failing NEVER aborts the tick or the
 *     remaining jobs (the failure is recorded and reported);
 *   * each job writes exactly one `job_runs` row (service-role only table)
 *     with status, duration, error and a JSON-safe result, so a stopped or
 *     failing scheduler is visible in SQL rather than silently absent;
 *   * the tick itself is idempotent end to end: each job carries its own
 *     idempotency key (invoice schedule/period, reminder invoice/stage/channel,
 *     delivery lease) so overlapping ticks cannot double-charge or
 *     double-send.
 */

export type SchedulerJobResult = Record<string, unknown>;

export type SchedulerJob = {
	name: string;
	run: (context: { admin: Supabase; now: Date }) => Promise<SchedulerJobResult>;
};

export type SchedulerJobOutcome = {
	name: string;
	status: "success" | "failure";
	durationMs: number;
	error?: string;
	result?: SchedulerJobResult;
};

export type SchedulerTickSummary = {
	ok: boolean;
	startedAt: string;
	completedAt: string;
	jobs: SchedulerJobOutcome[];
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Coerce a job's return value to something `jsonb` accepts. */
function toJobResult(value: unknown): SchedulerJobResult {
	if (value === null || value === undefined) return {};
	return JSON.parse(JSON.stringify(value)) as SchedulerJobResult;
}

export const SCHEDULER_JOBS: SchedulerJob[] = [
	{
		name: "scheduled_invoice_emails",
		run: async ({ now }) =>
			toJobResult(await dispatchScheduledInvoiceEmails(now)),
	},
	{
		name: "einvoice_submissions",
		run: async ({ admin, now }) =>
			toJobResult(
				await dispatchDueInvoiceSubmissions({
					now: () => now,
					adminClient: admin,
				}),
			),
	},
	{
		name: "paystack_reconcile",
		run: async ({ admin, now }) =>
			toJobResult(
				await reconcilePendingPaystackCharges({
					now: () => now,
					adminClient: admin,
				}),
			),
	},
	{
		name: "reminder_sweep",
		run: async ({ admin, now }) =>
			toJobResult(await runReminderSweep({ admin, now })),
	},
	{
		name: "recurring_generation",
		run: async ({ admin, now }) =>
			toJobResult(await runRecurringGeneration({ admin, now })),
	},
];

export const SCHEDULER_JOB_NAMES = SCHEDULER_JOBS.map((job) => job.name);

async function recordJobRun(
	admin: Supabase,
	args: {
		name: string;
		status: "success" | "failure";
		durationMs: number;
		error: string | null;
		result: SchedulerJobResult | null;
		startedAt: Date;
		completedAt: Date;
	},
): Promise<void> {
	const { error } = await admin.from("job_runs").insert({
		workspace_id: null,
		job_name: args.name,
		status: args.status,
		duration_ms: Math.max(0, Math.round(args.durationMs)),
		retries: 0,
		error: args.error,
		result_json: (args.result ?? null) as Json | null,
		started_at: args.startedAt.toISOString(),
		completed_at: args.completedAt.toISOString(),
	});
	if (error) throw error;
}

/**
 * Run every registered job once. `now` is fixed for the whole tick so the jobs
 * agree on the day boundary (reminder cadence and recurring due dates).
 */
export async function runSchedulerTick(
	options: Readonly<{
		admin?: Supabase;
		now?: Date;
		jobs?: SchedulerJob[];
	}> = {},
): Promise<SchedulerTickSummary> {
	const admin =
		options.admin ?? (getSupabaseAdminClient() as unknown as Supabase);
	const now = options.now ?? new Date();
	const jobs = options.jobs ?? SCHEDULER_JOBS;
	const startedAt = now.toISOString();
	const outcomes: SchedulerJobOutcome[] = [];

	for (const job of jobs) {
		const jobStarted = Date.now();
		try {
			const result = await job.run({ admin, now });
			const completed = Date.now();
			outcomes.push({
				name: job.name,
				status: "success",
				durationMs: completed - jobStarted,
				result,
			});
			await safeRecordJobRun(admin, {
				name: job.name,
				status: "success",
				durationMs: completed - jobStarted,
				error: null,
				result,
				startedAt: new Date(jobStarted),
				completedAt: new Date(completed),
			});
		} catch (error) {
			const completed = Date.now();
			const message = errorMessage(error).slice(0, 1000);
			outcomes.push({
				name: job.name,
				status: "failure",
				durationMs: completed - jobStarted,
				error: message,
			});
			await safeRecordJobRun(admin, {
				name: job.name,
				status: "failure",
				durationMs: completed - jobStarted,
				error: message,
				result: null,
				startedAt: new Date(jobStarted),
				completedAt: new Date(completed),
			});
		}
	}

	return {
		ok: outcomes.every((outcome) => outcome.status === "success"),
		startedAt,
		completedAt: new Date().toISOString(),
		jobs: outcomes,
	};
}

/**
 * Bookkeeping must never abort the tick (a missing/denied `job_runs` write
 * would otherwise skip every remaining job). Log loudly instead.
 */
async function safeRecordJobRun(
	admin: Supabase,
	args: Parameters<typeof recordJobRun>[1],
): Promise<void> {
	try {
		await recordJobRun(admin, args);
	} catch (error) {
		console.error("Scheduler job bookkeeping failed", errorMessage(error));
	}
}
