import { runReminderBatch, sendQueuedEmails } from "./data/reminders";
import type { Supabase } from "./data/workspaces";
import { getSupabaseAdminClient } from "./supabase";

/**
 * T1 — server-side reminder sweep.
 *
 * Until now reminders were only ever scanned/sent when an operator pressed
 * *Scan invoices* / *Send queue* in Settings, so nothing happened between
 * visits. This sweep runs the same data functions for every active workspace
 * and records one `reminder_runs` row per workspace (the bookkeeping table the
 * collections page reads).
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
};

export type ReminderSweepOptions = Readonly<{
	admin?: Supabase;
	now?: Date;
	/** Override the env switch (tests). */
	send?: boolean;
}>;

const SEND_SWITCH = "SCHEDULER_REMINDER_SEND_ENABLED";
const WORKSPACE_PAGE_SIZE = 200;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
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

	const summary: ReminderSweepSummary = {
		workspaceCount: 0,
		scannedCount: 0,
		queuedCount: 0,
		sentCount: 0,
		skippedCount: 0,
		failedCount: 0,
		sendEnabled,
		errors: [],
	};

	let offset = 0;
	for (;;) {
		// Explicit paging: an unbounded read is capped by PostgREST
		// (`max-rows`), which would silently starve workspaces past the cap.
		const { data, error } = await admin
			.from("active_workspaces")
			.select("user_id")
			.order("user_id", { ascending: true })
			.range(offset, offset + WORKSPACE_PAGE_SIZE - 1);
		if (error) throw error;
		const rows = (data ?? []) as Array<{ user_id: string }>;
		for (const row of rows) {
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
				summary.errors.push(`${userId}: ${errorMessage(error)}`);
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
						notes: errorMessage(error).slice(0, 500),
						created_at: timestamp,
						updated_at: timestamp,
					});
				} catch {
					// Ignore: the failure is already reported in the summary.
				}
			}
		}
		if (rows.length < WORKSPACE_PAGE_SIZE) break;
		offset += WORKSPACE_PAGE_SIZE;
	}

	return summary;
}
