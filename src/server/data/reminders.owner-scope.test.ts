import { describe, expect, it } from "vitest";
import {
	getReminderSettings,
	listReminderRuns,
	runReminderBatch,
	saveReminderSettings,
} from "./reminders";
import { createFakeSupabase, type FakeTables } from "./testing/fake-db";

/**
 * T1 — owner scoping for the reminder rule read.
 *
 * `reminder_rules` is owner-scoped. Under the user-scoped RLS client that is
 * enforced by RLS, but the scheduler sweep runs with the SERVICE-ROLE client
 * where RLS is bypassed, so `currentRule` must filter by `owner_id` in the
 * query itself. Before this fix it read `.limit(1)` with no owner filter: the
 * sweep would apply whichever owner's rule came first to every workspace.
 *
 * Each case seeds the OTHER owner's rule first, so an unscoped read returns
 * the wrong row.
 */

const USER_A = "user-a";
const USER_B = "user-b";
const WS_A = "ws-a";

function ruleRow(
	id: string,
	ownerId: string,
	overrides: Record<string, unknown> = {},
) {
	return {
		id,
		owner_id: ownerId,
		enabled: true,
		days_before_due: 3,
		on_due_date: true,
		overdue_cadence_days: 3,
		max_overdue_reminders: 3,
		escalate_after_count: 3,
		business_signature: `${ownerId} signature`,
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

function invoiceRow(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		workspace_id: WS_A,
		token: `pub-token-${id}`,
		token_revoked_at: null,
		document_type: "standard",
		invoice_number: `INV-2026-${id.toUpperCase()}`,
		customer_name: `Customer ${id}`,
		customer_id: null,
		currency: "NGN",
		invoice_type: "one-time",
		issue_date: "2026-01-01",
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
		lifecycle: { sentAt: 1_767_225_600_000 },
		notes: null,
		internal_notes: null,
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-06T00:00:00.000Z",
		...overrides,
	};
}

function seed(extra: Partial<FakeTables> = {}): FakeTables {
	return {
		workspaces: [
			{
				id: WS_A,
				owner_id: USER_A,
				name: "Alpha",
				invoice_number_mode: "prefix",
				invoice_number_prefix: "INV",
				next_invoice_sequence: 1,
				updated_at: "2026-01-01T00:00:00.000Z",
			},
		],
		active_workspaces: [{ user_id: USER_A, workspace_id: WS_A }],
		workspace_members: [{ workspace_id: WS_A, user_id: USER_A, role: "owner" }],
		// B's rule is inserted FIRST on purpose.
		reminder_rules: [
			ruleRow("rule-b", USER_B, { business_signature: "B signature" }),
			ruleRow("rule-a", USER_A, { business_signature: "A signature" }),
		],
		reminder_events: [],
		reminder_runs: [],
		invoices: [],
		...extra,
	};
}

describe("currentRule owner scoping", () => {
	it("returns the caller's rule, not the first row in the table", async () => {
		const { client } = createFakeSupabase(seed());

		const rule = await getReminderSettings(client, USER_A);

		expect(rule._id).toBe("rule-a");
		expect(rule.ownerId).toBe(USER_A);
		expect(rule.businessSignature).toBe("A signature");
	});

	it("updates only the caller's row when settings are saved", async () => {
		const tables = seed();
		const { client } = createFakeSupabase(tables);

		await saveReminderSettings(client, USER_A, {
			enabled: false,
			daysBeforeDue: 7,
			onDueDate: false,
			overdueCadenceDays: 5,
			maxOverdueReminders: 2,
			escalateAfterCount: 1,
			businessSignature: "Updated",
		});

		const rules = tables.reminder_rules as Array<Record<string, unknown>>;
		const a = rules.find((row) => row.id === "rule-a");
		const b = rules.find((row) => row.id === "rule-b");
		expect(a).toMatchObject({
			enabled: false,
			days_before_due: 7,
			business_signature: "Updated",
		});
		// B's rule is untouched.
		expect(b).toMatchObject({
			enabled: true,
			days_before_due: 3,
			business_signature: "B signature",
		});
	});

	it("applies the caller's disabled rule to the sweep, not another owner's", async () => {
		const tables = seed({
			reminder_rules: [
				// B enabled, A disabled — inserted first so an unscoped read
				// would pick the enabled B rule and queue.
				ruleRow("rule-b", USER_B, { enabled: true }),
				ruleRow("rule-a", USER_A, { enabled: false }),
			],
			invoices: [invoiceRow("inv-a")],
		});
		const { client } = createFakeSupabase(tables);

		const result = await runReminderBatch(client, USER_A, {
			date: "2026-10-29",
		});

		expect(result.scannedCount).toBe(1);
		expect(result.queuedCount).toBe(0);
		expect(tables.reminder_events).toHaveLength(0);
	});
});

describe("listReminderRuns", () => {
	it("returns only the owner's runs, newest first, capped by the limit", async () => {
		const tables = seed({
			reminder_runs: [
				{
					id: "run-a-old",
					owner_id: USER_A,
					run_date: "2026-10-27",
					status: "completed",
					scanned_count: 1,
					queued_count: 1,
					sent_count: 0,
					escalated_count: 0,
					notes: null,
					created_at: "2026-10-27T09:00:00.000Z",
				},
				{
					id: "run-b",
					owner_id: USER_B,
					run_date: "2026-10-29",
					status: "completed",
					scanned_count: 9,
					queued_count: 9,
					sent_count: 9,
					escalated_count: 0,
					notes: null,
					created_at: "2026-10-29T09:00:00.000Z",
				},
				{
					id: "run-a-new",
					owner_id: USER_A,
					run_date: "2026-10-29",
					status: "failed",
					scanned_count: 2,
					queued_count: 0,
					sent_count: 0,
					escalated_count: 0,
					notes: "boom",
					created_at: "2026-10-29T10:00:00.000Z",
				},
			],
		});
		const { client } = createFakeSupabase(tables);

		const runs = await listReminderRuns(client, USER_A, 5);

		expect(runs.map((run) => run._id)).toEqual(["run-a-new", "run-a-old"]);
		expect(runs[0]).toMatchObject({ status: "failed", notes: "boom" });
		expect(await listReminderRuns(client, USER_A, 1)).toHaveLength(1);
	});
});
