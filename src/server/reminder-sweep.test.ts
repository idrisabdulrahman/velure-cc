import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeTables } from "./data/testing/fake-db";
import {
	REMINDER_SWEEP_DEFAULT_BATCH_SIZE,
	REMINDER_SWEEP_DEFAULT_BUDGET_MS,
	runReminderSweep,
} from "./reminder-sweep";

/**
 * T1 — server-side reminder sweep.
 *
 * Before this module, reminders only moved when an operator pressed *Scan
 * invoices*. These tests pin the replacement behaviour:
 *
 *   * every active workspace is scanned exactly once and gets its own
 *     `reminder_runs` bookkeeping row;
 *   * an outbound email is NEVER sent unless
 *     `SCHEDULER_REMINDER_SEND_ENABLED === "true"` (customer email is
 *     irreversible, so it is one explicit switch);
 *   * one failing workspace does not stop the sweep for the others.
 *
 * `RESEND_API_KEY` is stubbed empty in every test so the send path can be
 * exercised without any network call.
 */

const USER_A = "user-a";
const USER_B = "user-b";
const WS_A = "ws-a";
const WS_B = "ws-b";

function workspaceRow(id: string, ownerId: string) {
	return {
		id,
		owner_id: ownerId,
		name: id,
		legal_name: `${id} Legal`,
		email: `${id}@example.test`,
		address: "1 Test Way",
		address_street: "1 Test Way",
		address_lga: "Lagos Mainland",
		address_state: "Lagos",
		country_code: "NG",
		tax_id: "8129473650",
		rc_number: "RC-1234567",
		invoice_number_mode: "prefix",
		invoice_number_prefix: "INV",
		next_invoice_sequence: 1,
		updated_at: "2026-01-01T00:00:00.000Z",
	};
}

function invoiceRow(
	id: string,
	workspaceId: string,
	overrides: Record<string, unknown> = {},
) {
	return {
		id,
		workspace_id: workspaceId,
		token: `pub-token-${id}`,
		token_revoked_at: null,
		document_type: "standard",
		invoice_number: `INV-2026-${id.toUpperCase()}`,
		customer_name: `Customer ${id}`,
		customer_id: null,
		currency: "NGN",
		invoice_type: "one-time",
		issue_date: "2026-01-01",
		// Exactly today: the default rule queues the `due_date` stage.
		due_date: "2026-10-29",
		status: "unpaid",
		payment_amount: 0,
		paid_at: null,
		payment_reference: null,
		canceled_at: null,
		deleted_at: null,
		delivered_at: "2026-01-05T00:00:00.000Z",
		finalized_at: "2026-01-05T00:00:00.000Z",
		line_items: [
			{
				id: "li-1",
				name: "Item",
				quantity: 1,
				price: 100,
				unit: "unit",
				vatCategory: "standard",
				classificationCode: "GOOD-01",
			},
		],
		compliance: { buyer: { email: `${id}@example.test` } },
		fiscalization: null,
		reminder: { enabled: true, paused: false, stage: "none" },
		sync: null,
		// `runReminderBatch` only queues for a delivered invoice.
		lifecycle: { sentAt: 1_767_225_600_000 },
		notes: null,
		internal_notes: null,
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-06T00:00:00.000Z",
		...overrides,
	};
}

function seed(
	invoices: Array<Record<string, unknown>>,
	extra: Partial<FakeTables> = {},
): FakeTables {
	return {
		workspaces: [workspaceRow(WS_A, USER_A), workspaceRow(WS_B, USER_B)],
		active_workspaces: [
			{ user_id: USER_A, workspace_id: WS_A },
			{ user_id: USER_B, workspace_id: WS_B },
		],
		workspace_members: [
			{ workspace_id: WS_A, user_id: USER_A, role: "owner" },
			{ workspace_id: WS_B, user_id: USER_B, role: "owner" },
		],
		reminder_rules: [],
		reminder_events: [],
		reminder_runs: [],
		invoices,
		...extra,
	};
}

const NOW = new Date("2026-10-29T09:00:00.000Z");

function rows(tables: FakeTables, table: keyof FakeTables) {
	return tables[table] as Array<Record<string, unknown>>;
}

beforeEach(() => {
	// Never reach Resend: an empty key makes `sendQueuedEmails` return early.
	vi.stubEnv("RESEND_API_KEY", "");
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe("runReminderSweep", () => {
	it("scans every active workspace, queues due reminders, and records a run", async () => {
		const tables = seed([invoiceRow("inv-a", WS_A), invoiceRow("inv-b", WS_B)]);
		const { client } = createFakeSupabase(tables);

		const summary = await runReminderSweep({ admin: client, now: NOW });

		expect(summary).toMatchObject({
			workspaceCount: 2,
			scannedCount: 2,
			queuedCount: 2,
			sentCount: 0,
			failedCount: 0,
			sendEnabled: false,
		});
		expect(summary.errors).toEqual([]);

		const runs = rows(tables, "reminder_runs");
		expect(runs).toHaveLength(2);
		expect(runs.map((run) => run.owner_id).sort()).toEqual([USER_A, USER_B]);
		for (const run of runs) {
			expect(run).toMatchObject({
				run_date: "2026-10-29",
				status: "completed",
				scanned_count: 1,
				queued_count: 1,
				sent_count: 0,
			});
			expect(String(run.notes)).toContain("SCHEDULER_REMINDER_SEND_ENABLED");
		}

		const events = rows(tables, "reminder_events");
		expect(events).toHaveLength(2);
		expect(events.every((event) => event.status === "queued")).toBe(true);
		expect(events.every((event) => event.stage === "due_date")).toBe(true);
	});

	it("does not queue a duplicate event on a second sweep", async () => {
		const tables = seed([invoiceRow("inv-a", WS_A)]);
		const { client } = createFakeSupabase(tables);

		await runReminderSweep({ admin: client, now: NOW });
		const second = await runReminderSweep({ admin: client, now: NOW });

		expect(second.queuedCount).toBe(0);
		expect(rows(tables, "reminder_events")).toHaveLength(1);
		// One bookkeeping row per workspace per sweep (2 workspaces × 2 sweeps).
		expect(rows(tables, "reminder_runs")).toHaveLength(4);
	});

	it("engages the send path only when the env switch is on", async () => {
		const off = seed([invoiceRow("inv-a", WS_A)]);
		const offClient = createFakeSupabase(off).client;
		await runReminderSweep({ admin: offClient, now: NOW });
		expect(String(rows(off, "reminder_runs")[0].notes)).toContain(
			"Automatic sending is off",
		);

		const on = seed([invoiceRow("inv-a", WS_A)]);
		const onClient = createFakeSupabase(on).client;
		const summary = await runReminderSweep({
			admin: onClient,
			now: NOW,
			send: true,
		});

		expect(summary.sendEnabled).toBe(true);
		// The send path ran and reported the missing key instead of posting.
		expect(String(rows(on, "reminder_runs")[0].notes)).toBe(
			"RESEND_API_KEY missing",
		);
		expect(rows(on, "reminder_events")[0].status).toBe("queued");
	});

	it("isolates one failing workspace from the others", async () => {
		const tables = seed([
			invoiceRow("inv-a", WS_A),
			// Soft-deleted: the batch scan sees it, but `getById` refuses to
			// resolve it, so `queueReminderEvent` throws for workspace B only.
			invoiceRow("inv-b-deleted", WS_B, { deleted_at: "2026-10-01" }),
		]);
		const { client } = createFakeSupabase(tables);

		const summary = await runReminderSweep({ admin: client, now: NOW });

		expect(summary.workspaceCount).toBe(2);
		expect(summary.queuedCount).toBe(1);
		expect(summary.failedCount).toBe(1);
		expect(summary.errors).toHaveLength(1);
		expect(summary.errors[0]).toContain(USER_B);

		const runs = rows(tables, "reminder_runs");
		const failed = runs.find((run) => run.owner_id === USER_B);
		const completed = runs.find((run) => run.owner_id === USER_A);
		expect(failed).toMatchObject({ status: "failed" });
		expect(String(failed?.notes)).toContain("Invoice not found");
		expect(completed).toMatchObject({ status: "completed", queued_count: 1 });
	});

	describe("bounded per tick (2026-10-30 fix)", () => {
		it("sweeps a bounded batch and returns the resume cursor", async () => {
			const tables = seed([
				invoiceRow("inv-a", WS_A),
				invoiceRow("inv-b", WS_B),
			]);
			const { client } = createFakeSupabase(tables);

			const first = await runReminderSweep({
				admin: client,
				now: NOW,
				cursor: null,
				batchSize: 1,
			});
			// One workspace this tick; the cursor is that workspace.
			expect(first.workspaceCount).toBe(1);
			expect(first.nextCursor).toBe(USER_A);
			expect(first.truncated).toBe(false);

			const second = await runReminderSweep({
				admin: client,
				now: NOW,
				cursor: first.nextCursor,
				batchSize: 1,
			});
			expect(second.workspaceCount).toBe(1);
			expect(second.nextCursor).toBe(USER_B);

			// Next tick sees an empty/short page and wraps to the front.
			const third = await runReminderSweep({
				admin: client,
				now: NOW,
				cursor: second.nextCursor,
				batchSize: 1,
			});
			expect(third.workspaceCount).toBe(0);
			expect(third.nextCursor).toBeNull();

			// The whole list was covered across the ticks, exactly once each.
			expect(
				rows(tables, "reminder_runs")
					.map((run) => run.owner_id)
					.sort(),
			).toEqual([USER_A, USER_B]);
		});

		it("resumes from the cursor persisted in job_runs", async () => {
			const tables = seed(
				[invoiceRow("inv-a", WS_A), invoiceRow("inv-b", WS_B)],
				{
					job_runs: [
						{
							id: "jr-1",
							workspace_id: null,
							job_name: "reminder_sweep",
							status: "success",
							started_at: "2026-10-29T08:50:00.000Z",
							result_json: { nextCursor: USER_A },
						},
					],
				},
			);
			const { client } = createFakeSupabase(tables);

			const summary = await runReminderSweep({ admin: client, now: NOW });

			// Resumed after USER_A, so only USER_B is swept.
			expect(summary.workspaceCount).toBe(1);
			expect(rows(tables, "reminder_runs").map((run) => run.owner_id)).toEqual([
				USER_B,
			]);
		});

		it("stops early on the time budget but always makes progress", async () => {
			const tables = seed([
				invoiceRow("inv-a", WS_A),
				invoiceRow("inv-b", WS_B),
			]);
			const { client } = createFakeSupabase(tables);

			const summary = await runReminderSweep({
				admin: client,
				now: NOW,
				cursor: null,
				budgetMs: 0,
			});

			// Exactly one workspace is always swept, then the budget trips.
			expect(summary.workspaceCount).toBe(1);
			expect(summary.truncated).toBe(true);
			expect(summary.nextCursor).toBe(USER_A);
		});
	});

	describe("stays inside the production tick ceilings (2026-10-30 fix)", () => {
		// A live tick that swept 11 workspaces made 49 subrequests and ran ~8.5 s.
		// The Cloudflare Pages Function allows 50 subrequests (free plan) and the
		// pg_net timeout is 10 s, so the sweep's own `job_runs` cursor row — the
		// very last request — was dropped. These constants must keep the whole
		// tick under BOTH ceilings with headroom for the other four jobs.
		const FIXED_SUBREQUESTS_PER_TICK = 10; // cursor read + page + 4 jobs + bookkeeping
		const SUBREQUESTS_PER_WORKSPACE = 4; // active_workspaces, reminder_rules, invoices, reminder_runs

		it("keeps the worst-case subrequest count well under the free-plan cap of 50", () => {
			expect(REMINDER_SWEEP_DEFAULT_BATCH_SIZE).toBe(8);
			expect(
				FIXED_SUBREQUESTS_PER_TICK +
					REMINDER_SWEEP_DEFAULT_BATCH_SIZE * SUBREQUESTS_PER_WORKSPACE,
			).toBeLessThan(50);
		});

		it("keeps the sweep budget well inside the 10 s pg_net timeout", () => {
			expect(REMINDER_SWEEP_DEFAULT_BUDGET_MS).toBeLessThanOrEqual(5000);
		});

		it("sweeps only the default batch and still returns a cursor to resume from", async () => {
			const owners = Array.from({ length: 10 }, (_, i) => `user-${i}`);
			const tables = seed([], {
				active_workspaces: owners.map((ownerId, i) => ({
					user_id: ownerId,
					workspace_id: `ws-${i}`,
				})),
				workspaces: owners.map((ownerId, i) =>
					workspaceRow(`ws-${i}`, ownerId),
				),
				workspace_members: owners.map((ownerId, i) => ({
					workspace_id: `ws-${i}`,
					user_id: ownerId,
					role: "owner",
				})),
			});
			const { client } = createFakeSupabase(tables);

			const summary = await runReminderSweep({
				admin: client,
				now: NOW,
				cursor: null,
			});

			// Ten workspaces exist, but one tick must not try to sweep them all:
			// it stops at the default batch and hands back a resume cursor.
			expect(summary.workspaceCount).toBe(REMINDER_SWEEP_DEFAULT_BATCH_SIZE);
			expect(summary.nextCursor).toBe(
				owners[REMINDER_SWEEP_DEFAULT_BATCH_SIZE - 1],
			);
			expect(summary.truncated).toBe(false);
		});
	});
});
