import { describe, expect, it } from "vitest";
import { createFakeSupabase, type FakeTables } from "./data/testing/fake-db";
import {
	addCalendarDays,
	addCalendarMonths,
	advanceRecurringDate,
	buildRecurringInvoiceInput,
	runRecurringGeneration,
} from "./recurring-generation";

/**
 * T1 — recurring draft generation.
 *
 * The generator is the only automatic writer of invoices, so these tests pin
 * the three properties that keep it safe:
 *
 *   1. tenancy — the draft lands in the SCHEDULE's workspace even when the
 *      owner's current active workspace is a different one;
 *   2. idempotency — one draft per (schedule, period), whether the second tick
 *      sees an advanced schedule or a crash-recovery ledger row;
 *   3. isolation — a due schedule that cannot be generated (here: a foreign
 *      currency without the CBN notice) fails alone and leaves a `failed`
 *      ledger row instead of aborting the tick.
 *
 * Everything runs against the in-memory Supabase double; the audit sink is a
 * captured spy, so no browser transport is involved.
 */

const USER_A = "user-a";
const WS_A = "ws-a";
const WS_OTHER = "ws-other";

function workspaceRow(id = WS_A, ownerId = USER_A) {
	return {
		id,
		owner_id: ownerId,
		name: "Alpha",
		legal_name: "Alpha Legal",
		email: "alpha@example.test",
		phone: "",
		address: "1 Test Way",
		address_street: "1 Test Way",
		address_lga: "Lagos Mainland",
		address_state: "Lagos",
		country_code: "NG",
		base_currency: "NGN",
		tax_id: "8129473650",
		rc_number: "RC-1234567",
		seller_tax_status: "vat_registered",
		invoice_number_mode: "prefix",
		invoice_number_prefix: "INV",
		next_invoice_sequence: 1,
		updated_at: "2026-01-01T00:00:00.000Z",
	};
}

function scheduleRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "sched-a",
		workspace_id: WS_A,
		owner_id: USER_A,
		name: "Monthly retainer",
		status: "active",
		frequency: "monthly",
		interval: 1,
		start_date: "2026-01-01",
		next_run_date: "2026-10-01",
		end_date: null,
		auto_send: false,
		customer_name: "Acme Ltd",
		logo_url: null,
		currency: "NGN",
		invoice_size: "A4",
		date_format: "ng",
		payment_terms_days: 14,
		template: "Default",
		payment_details: null,
		payment_link: null,
		payment_provider: null,
		notes: "Thanks for your business",
		line_items: [
			{ id: "line-1", name: "Retainer", quantity: 1, price: 250_000 },
		],
		compliance: null,
		last_generated_at: null,
		last_generated_invoice_id: null,
		last_generated_period: null,
		generated_count: 0,
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

function seed(
	schedules: Array<Record<string, unknown>>,
	runs: Array<Record<string, unknown>> = [],
	extra: Partial<FakeTables> = {},
): FakeTables {
	return {
		workspaces: [workspaceRow()],
		// The owner's CURRENT workspace deliberately differs from the schedule's
		// workspace: generation must follow the row, not the session.
		active_workspaces: [{ user_id: USER_A, workspace_id: WS_OTHER }],
		workspace_members: [{ workspace_id: WS_A, user_id: USER_A, role: "owner" }],
		recurring_invoice_schedules: schedules,
		recurring_invoice_runs: runs,
		invoices: [],
		invoice_number_sequences: [],
		...extra,
	};
}

const NOW = new Date("2026-10-29T09:00:00.000Z");

function auditSpy() {
	const entries: Array<{ action: string; resourceId?: string }> = [];
	return {
		entries,
		writeAudit: (async (
			_client: unknown,
			_userId: unknown,
			entry: { action: string; resourceId?: string },
		) => {
			entries.push(entry);
		}) as never,
	};
}

function rows(tables: FakeTables, table: keyof FakeTables) {
	return tables[table] as Array<Record<string, unknown>>;
}

describe("recurring date helpers", () => {
	it("adds calendar months and clamps to the target month length", () => {
		expect(addCalendarMonths("2026-01-31", 1)).toBe("2026-02-28");
		expect(addCalendarMonths("2024-01-31", 1)).toBe("2024-02-29");
		expect(addCalendarMonths("2026-11-30", 3)).toBe("2027-02-28");
	});

	it("models quarterly as three monthly intervals", () => {
		expect(advanceRecurringDate("2026-10-01", "monthly", 2)).toBe("2026-12-01");
		expect(advanceRecurringDate("2026-10-01", "quarterly", 1)).toBe(
			"2027-01-01",
		);
	});

	it("computes the due date from the payment terms", () => {
		expect(addCalendarDays("2026-10-01", 14)).toBe("2026-10-15");
	});
});

describe("buildRecurringInvoiceInput", () => {
	it("copies presentation data and leaves the number to the allocator", () => {
		const input = buildRecurringInvoiceInput(
			scheduleRow() as never,
			"2026-10-01",
		);
		expect(input.invoiceNumber).toBe("");
		expect(input.type).toBe("recurring");
		expect(input.customerName).toBe("Acme Ltd");
		expect(input.dueDate).toBe("2026-10-15");
		expect(input.customerId).toBeUndefined();
		expect(input.lineItems).toEqual([
			{ id: "line-1", name: "Retainer", quantity: 1, price: 250_000 },
		]);
	});
});

describe("runRecurringGeneration", () => {
	it("creates one draft in the schedule's workspace and records the period", async () => {
		const tables = seed([scheduleRow()]);
		const { client } = createFakeSupabase(tables);
		const { entries, writeAudit } = auditSpy();

		const summary = await runRecurringGeneration({
			admin: client,
			now: NOW,
			writeAudit,
		});

		expect(summary).toMatchObject({
			createdCount: 1,
			skippedCount: 0,
			failedCount: 0,
		});
		const invoices = rows(tables, "invoices");
		expect(invoices).toHaveLength(1);
		expect(invoices[0]).toMatchObject({
			workspace_id: WS_A,
			user_id: USER_A,
			status: "draft",
			customer_name: "Acme Ltd",
			currency: "NGN",
			invoice_type: "recurring",
			issue_date: "2026-10-01",
			due_date: "2026-10-15",
		});
		expect(String(invoices[0].invoice_number)).toMatch(
			/[A-Z0-9]{2,12}-\d{4}-\d{4,6}/,
		);

		const ledger = rows(tables, "recurring_invoice_runs");
		expect(ledger).toHaveLength(1);
		expect(ledger[0]).toMatchObject({
			schedule_id: "sched-a",
			workspace_id: WS_A,
			period_key: "2026-10-01",
			status: "created",
			invoice_id: invoices[0].id,
		});

		expect(rows(tables, "recurring_invoice_schedules")[0]).toMatchObject({
			next_run_date: "2026-11-01",
			generated_count: 1,
			last_generated_period: "2026-10-01",
			last_generated_invoice_id: invoices[0].id,
		});
		expect(entries.map((entry) => entry.action)).toEqual(["invoice.create"]);
	});

	it("does not create a second draft when the tick runs again", async () => {
		const tables = seed([scheduleRow()]);
		const { client } = createFakeSupabase(tables);
		const { writeAudit } = auditSpy();

		await runRecurringGeneration({ admin: client, now: NOW, writeAudit });
		const second = await runRecurringGeneration({
			admin: client,
			now: NOW,
			writeAudit,
		});

		expect(second.createdCount).toBe(0);
		expect(rows(tables, "invoices")).toHaveLength(1);
		expect(rows(tables, "recurring_invoice_runs")).toHaveLength(1);
	});

	it("skips a period that already has a created ledger row (crash recovery)", async () => {
		const tables = seed(
			[scheduleRow()],
			[
				{
					id: "run-existing",
					workspace_id: WS_A,
					schedule_id: "sched-a",
					period_key: "2026-10-01",
					invoice_id: "already-made",
					status: "created",
					error: null,
					created_at: "2026-10-01T00:00:00.000Z",
					updated_at: "2026-10-01T00:00:00.000Z",
				},
			],
		);
		const { client } = createFakeSupabase(tables);

		const summary = await runRecurringGeneration({
			admin: client,
			now: NOW,
			writeAudit: auditSpy().writeAudit,
		});

		expect(summary).toMatchObject({ createdCount: 0, skippedCount: 1 });
		expect(rows(tables, "invoices")).toHaveLength(0);
	});

	it("waits out the retry window on a recent failure, then retries an old one", async () => {
		const recent = seed(
			[scheduleRow()],
			[
				{
					id: "run-failed",
					workspace_id: WS_A,
					schedule_id: "sched-a",
					period_key: "2026-10-01",
					invoice_id: null,
					status: "failed",
					error: "boom",
					created_at: "2026-10-29T08:55:00.000Z",
					updated_at: "2026-10-29T08:55:00.000Z",
				},
			],
		);
		const recentClient = createFakeSupabase(recent).client;
		const skipped = await runRecurringGeneration({
			admin: recentClient,
			now: NOW,
			writeAudit: auditSpy().writeAudit,
		});
		expect(skipped).toMatchObject({ createdCount: 0, skippedCount: 1 });
		expect(rows(recent, "invoices")).toHaveLength(0);

		const stale = seed(
			[scheduleRow()],
			[
				{
					id: "run-failed",
					workspace_id: WS_A,
					schedule_id: "sched-a",
					period_key: "2026-10-01",
					invoice_id: null,
					status: "failed",
					error: "boom",
					created_at: "2026-10-29T06:00:00.000Z",
					updated_at: "2026-10-29T06:00:00.000Z",
				},
			],
		);
		const staleClient = createFakeSupabase(stale).client;
		const retried = await runRecurringGeneration({
			admin: staleClient,
			now: NOW,
			writeAudit: auditSpy().writeAudit,
		});
		expect(retried).toMatchObject({ createdCount: 1, failedCount: 0 });
		expect(rows(stale, "invoices")).toHaveLength(1);
	});

	it("ends a schedule whose next period would pass its end date", async () => {
		const tables = seed([scheduleRow({ end_date: "2026-10-15" })]);
		const { client } = createFakeSupabase(tables);

		await runRecurringGeneration({
			admin: client,
			now: NOW,
			writeAudit: auditSpy().writeAudit,
		});

		expect(rows(tables, "recurring_invoice_schedules")[0]).toMatchObject({
			status: "ended",
			next_run_date: "2026-10-01",
			generated_count: 1,
		});
	});

	it("isolates a failing schedule and still generates the healthy one", async () => {
		const tables = seed([
			scheduleRow({
				id: "sched-bad",
				next_run_date: "2026-10-01",
				// Foreign currency without the CBN settlement notice: the
				// invoice validator refuses it, so this schedule fails alone.
				currency: "USD",
				customer_name: "Bad Currency Ltd",
			}),
			scheduleRow({
				id: "sched-good",
				next_run_date: "2026-10-02",
				customer_name: "Good Currency Ltd",
			}),
		]);
		const { client } = createFakeSupabase(tables);

		const summary = await runRecurringGeneration({
			admin: client,
			now: NOW,
			writeAudit: auditSpy().writeAudit,
		});

		expect(summary.createdCount).toBe(1);
		expect(summary.failedCount).toBe(1);
		expect(summary.errors).toHaveLength(1);
		expect(summary.errors[0]).toContain("sched-bad");

		const invoices = rows(tables, "invoices");
		expect(invoices).toHaveLength(1);
		expect(invoices[0].customer_name).toBe("Good Currency Ltd");

		const ledger = rows(tables, "recurring_invoice_runs");
		const bad = ledger.find((row) => row.schedule_id === "sched-bad");
		const good = ledger.find((row) => row.schedule_id === "sched-good");
		expect(bad).toMatchObject({ status: "failed" });
		expect(String(bad?.error)).toContain("CBN settlement warning");
		expect(good).toMatchObject({ status: "created" });

		// The failing schedule keeps its original due date so the next tick
		// retries it once the retry window passes.
		const badSchedule = rows(tables, "recurring_invoice_schedules").find(
			(row) => row.id === "sched-bad",
		);
		expect(badSchedule?.next_run_date).toBe("2026-10-01");
	});
});
