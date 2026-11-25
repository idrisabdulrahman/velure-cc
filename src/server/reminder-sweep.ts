import { runReminderBatch } from "./data/reminders";
import { sendQueuedEmails } from "./data/reminders-send-queue";
import type { Supabase } from "./data/workspaces";
import { formatErrorMessage } from "./error-message";
import { getSupabaseAdminClient } from "./supabase";

/**
 * T1 — server-side reminder sweep.
 *
 * Until now reminders were only ever scanned/sent when an operator pressed
 * *Scan invoices* / *Send queue* in Settings, so nothing happened between
 * visits. This sweep runs the same data functions for active workspaces and
 * records one `reminder_runs` row per workspace (the bookkeeping table the
 * collections page reads).
 *
 * **Bounded per tick (2026-10-30).** Sweeping every workspace in one pass does
 * not fit the tick: pg_net times the tick out at 10 s, and each workspace costs
 * a few hundred milliseconds (several Supabase round trips, and the default
 * rule scans every invoice), so the first live tick died after 10 of 111
 * workspaces and starved every later job. The sweep now walks active
 * workspaces in `user_id` order from a persisted **cursor**, sweeping at most
 * `SCHEDULER_REMINDER_SWEEP_BATCH` workspaces and stopping once it has spent
 * `SCHEDULER_REMINDER_SWEEP_BUDGET_MS` of wall clock, then records the cursor it
 * reached so the next tick resumes. When it reaches the end of the list the
 * cursor resets to `null` and the next tick starts over, so every workspace is
 * swept within a bounded number of ticks. The scheduler runs this job **last**,
 * so a slow sweep can never starve the cheap jobs.
 *
 * The cursor is read from and written to the latest `reminder_sweep` row in
 * `job_runs` (`result_json.nextCursor`). That table already records one row per
 * run, so the resume point lives with the run that produced it instead of
 * needing another server-only table; a missing/denied table or a failed run
 * simply restarts from the beginning, which is safe because every downstream
 * write is idempotent.
 *
 * Sending customer email is IRREVERSIBLE, so the outbound step stays behind the
 * `SCHEDULER_REMINDER_SEND_ENABLED === "true"` switch: by default the sweep only
 * scans and queues, exactly the safe half of the manual flow. The queue is
 * drained on the next tick after the switch is turned on.
 *
 * Tenancy: workspaces come from `active_workspaces` (one row per user) and each
 * call is scoped by that `user_id`; the sweep never crosses a workspace
 * boundary because every downstream query filters by the owner's workspace.
 */

export type ReminderSweepSummary = {
	workspaceCount: number;
	scannedCount: number;
	queuedCount: number;
	sentCount: number;
	skippedCount: number;
	failedCount: number;
	sendEnabled: boolean;
	errors: string[];
	/**
	 * Resume point for the next tick: the last swept owner id, or `null` when
	 * the sweep reached the end of the workspace list and wrapped. Persisted by
	 * the scheduler in `job_runs.result_json`.
	 */
	nextCursor: string | null;
	/** True when the batch cap or the time budget stopped the sweep early. */
	truncated: boolean;
};

export type ReminderSweepOptions = Readonly<{
	admin?: Supabase;
	now?: Date;
	/** Override the env switch (tests). */
	send?: boolean;
	/**
	 * Resume after this owner id. Omit to read the persisted cursor; pass
	 * `null` to force a restart from the beginning (tests).
	 */
	cursor?: string | null;
	/** Max workspaces this tick. Defaults to the env var or 50. */
	batchSize?: number;
	/** Wall-clock budget in ms. Defaults to the env var or 7000. */
	budgetMs?: number;
}>;

const SEND_SWITCH = "SCHEDULER_REMINDER_SEND_ENABLED";
const BATCH_SWITCH = "SCHEDULER_REMINDER_SWEEP_BATCH";
const BUDGET_SWITCH = "SCHEDULER_REMINDER_SWEEP_BUDGET_MS";
const SWEEP_JOB_NAME = "reminder_sweep";
/**
 * The tick faces TWO ceilings in production, both imposed on the Cloudflare
 * Pages Function behind `/api/cron/tick`:
 *
 *   * **50 external subrequests per invocation** (free plan; paid is 10,000 —
 *     documented by Cloudflare), and
 *   * **10 s** — the `pg_net` timeout set by the cron migration.
 *
 * A live tick that swept ~11 workspaces made **49** requests (≈4 per workspace:
 * `active_workspaces`, `reminder_rules`, `invoices`, `reminder_runs`) and ran
 * ~8.5 s. The sweep's own `job_runs` row — the only writer of the resume cursor
 * — was therefore the 50th request and was **dropped**: `nextCursor` never
 * persisted, the sweep restarted from the front every tick, and ~100 of 111
 * workspaces were never swept. These caps keep the whole tick under BOTH
 * ceilings with headroom for the four cheaper jobs and their bookkeeping:
 *
 *   8 workspaces × 4 + ~10 fixed ≈ 42 subrequests, and
 *   5 s sweep budget + ~2 s other jobs ≈ 7 s wall clock.
 *
 * The per-workspace cost is an ESTIMATE: a workspace with many due invoices adds
 * one `queueReminderEvent` request per queued invoice, and the time budget — not
 * the batch cap — is what stops a pathological workspace from eating the tick.
 */
export const REMINDER_SWEEP_DEFAULT_BUDGET_MS = 5000;
export const REMINDER_SWEEP_DEFAULT_BATCH_SIZE = 8;

function positiveInt(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * The cursor the previous tick recorded, read from the latest `reminder_sweep`
 * `job_runs` row. Best-effort: a missing table, an unreadable row, or a failed
 * previous run all return `null`, which restarts the sweep from the front.
 */
async function readPreviousCursor(admin: Supabase): Promise<string | null> {
	try {
		const { data, error } = await admin
			.from("job_runs")
			.select("result_json")
			.eq("job_name", SWEEP_JOB_NAME)
			.order("started_at", { ascending: false })
			.limit(1)
			.maybeSingle();
		if (error) return null;
		const result = (data as { result_json?: unknown } | null)?.result_json;
		const cursor = (result as { nextCursor?: unknown } | null)?.nextCursor;
		return typeof cursor === "string" && cursor.length > 0 ? cursor : null;
	} catch {
		return null;
	}
}

export async function runReminderSweep(
	options: ReminderSweepOptions = {},
): Promise<ReminderSweepSummary> {
	const admin =
		options.admin ?? (getSupabaseAdminClient() as unknown as Supabase);
	const now = options.now ?? new Date();
	const today = now.toISOString().slice(0, 10);
	const timestamp = now.toISOString();
	const sendEnabled = options.send ?? process.env[SEND_SWITCH] === "true";
	const batchSize =
		options.batchSize ??
		positiveInt(process.env[BATCH_SWITCH], REMINDER_SWEEP_DEFAULT_BATCH_SIZE);
	const budgetMs =
		options.budgetMs ??
		positiveInt(process.env[BUDGET_SWITCH], REMINDER_SWEEP_DEFAULT_BUDGET_MS);
	const cursor =
		options.cursor === undefined
			? await readPreviousCursor(admin)
			: options.cursor;

	const summary: ReminderSweepSummary = {
		workspaceCount: 0,
		scannedCount: 0,
		queuedCount: 0,
		sentCount: 0,
		skippedCount: 0,
		failedCount: 0,
		sendEnabled,
		errors: [],
		nextCursor: cursor,
		truncated: false,
	};

	// Bounded single page in a stable order. The cursor filter makes this the
	// next window of workspaces rather than an ever-growing offset scan, so the
	// read can never be silently capped by PostgREST's `max-rows`.
	let query = admin
		.from("active_workspaces")
		.select("user_id")
		.order("user_id", { ascending: true })
		.limit(batchSize);
	if (cursor) query = query.gt("user_id", cursor);
	const { data, error } = await query;
	if (error) throw error;
	const rows = (data ?? []) as Array<{ user_id: string }>;

	const deadline = Date.now() + budgetMs;
	let processed = 0;
	for (const row of rows) {
		// Always make progress: check the budget only once a workspace has been
		// swept, so a single slow workspace can never stall the cursor.
		if (processed > 0 && Date.now() >= deadline) {
			summary.truncated = true;
			break;
		}
		const userId = row.user_id;
		summary.workspaceCount += 1;
		let scannedCount = 0;
		let queuedCount = 0;
		let escalatedCount = 0;
		try {
			const batch = await runReminderBatch(admin, userId, { date: today });
			scannedCount = batch.scannedCount;
			queuedCount = batch.queuedCount;
			escalatedCount = batch.escalatedCount;

			let sentCount = 0;
			let skippedCount = 0;
			let note: string | null = null;
			if (sendEnabled) {
				const delivery = await sendQueuedEmails(admin, userId);
				sentCount = delivery.sent;
				skippedCount = delivery.skipped;
				note = (delivery as { reason?: string }).reason ?? "Automatic sweep.";
			} else {
				note = `Automatic sending is off (${SEND_SWITCH}).`;
			}

			const { error: runError } = await admin.from("reminder_runs").insert({
				owner_id: userId,
				run_date: today,
				status: "completed",
				scanned_count: scannedCount,
				queued_count: queuedCount,
				sent_count: sentCount,
				escalated_count: escalatedCount,
				notes: note,
				created_at: timestamp,
				updated_at: timestamp,
			});
			if (runError) throw runError;

			summary.scannedCount += scannedCount;
			summary.queuedCount += queuedCount;
			summary.sentCount += sentCount;
			summary.skippedCount += skippedCount;
		} catch (error) {
			summary.failedCount += 1;
			summary.errors.push(`${userId}: ${formatErrorMessage(error)}`);
			// Best-effort failure bookkeeping; never mask the original error.
			try {
				await admin.from("reminder_runs").insert({
					owner_id: userId,
					run_date: today,
					status: "failed",
					scanned_count: scannedCount,
					queued_count: queuedCount,
					sent_count: 0,
					escalated_count: escalatedCount,
					notes: formatErrorMessage(error).slice(0, 500),
					created_at: timestamp,
					updated_at: timestamp,
				});
			} catch {
				// Ignore: the failure is already reported in the summary.
			}
		}
		summary.nextCursor = userId;
		processed += 1;
	}

	// A short page means this was the last window: wrap so the next tick starts
	// from the front. An exactly-full page keeps the cursor; the following tick
	// returns an empty (short) page and wraps then.
	if (!summary.truncated && rows.length < batchSize) {
		summary.nextCursor = null;
	}

	return summary;
}
