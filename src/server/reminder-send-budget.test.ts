import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeTables } from "./data/testing/fake-db";
import { runReminderSweep } from "./reminder-sweep";
import { sendQueuedEmails } from "./data/reminders-send-queue";

/**
 * The tick's send budget (2026-11-22 fix).
 *
 * With `SCHEDULER_REMINDER_SEND_ENABLED=true` the sweep drains queued reminder
 * emails inside the same tick that scans every workspace — and the whole tick
 * shares the Workers 50-subrequest ceiling. The first live send tick blew the
 * ceiling mid-drain on a workspace with a large queue ("Too many subrequests"),
 * failing the sweep every tick. The drain now draws from an explicit per-tick
 * send budget: capped emails STAY `queued` (never marked `failed` — the
 * reminder is merely deferred to the next tick, 10 minutes later) and the
 * Resend daily quota keeps its own, different "failed until 00:00 UTC"
 * semantics.
 *
 * `resend` is mocked, so nothing leaves the process.
 */

const { resendSendSpy } = vi.hoisted(() => ({
	resendSendSpy: vi.fn(async () => ({
		data: { id: "email-1" },
		error: null,
	})),
}));

vi.mock("#/server/env", () => ({
	getServerEnv: (key: string) =>
		key === "RESEND_API_KEY" ? "re_test_key" : `${key}@invoicly.test`,
}));
vi.mock("resend", () => ({
	Resend: class {
		emails = { send: resendSendSpy };
	},
}));

const USER_A = "user-a";
const WS_A = "ws-a";

const NOW = new Date("2026-11-22T09:00:00.000Z");

function workspaceRow(id: string, ownerId: string) {
	return {
		id,
		owner_id: ownerId,
		name: id,
		invoice_number_mode: "prefix",
		invoice_number_prefix: "INV",
		next_invoice_sequence: 1,
		updated_at: "2026-01-01T00:00:00.000Z",
	};
}

function invoiceRow(id: string, workspaceId: string) {
	return {
		id,
		workspace_id: workspaceId,
		invoice_number: `INV-${id}`,
		customer_name: `Customer ${id}`,
		status: "unpaid",
		currency: "NGN",
		compliance: { buyer: { email: `${id}@buyer.test` } },
	};
}

function queuedEvent(id: string, ownerId: string, invoiceId: string) {
	return {
		id,
		owner_id: ownerId,
		invoice_id: invoiceId,
		stage: "due_date",
		channel: "email",
		status: "queued",
		created_at: "2026-11-22T00:00:00.000Z",
	};
}

function seed(invoices: Array<Record<string, unknown>>, events: Array<Record<string, unknown>>): FakeTables {
	return {
		workspaces: [workspaceRow(WS_A, USER_A)],
		active_workspaces: [{ user_id: USER_A, workspace_id: WS_A }],
		workspace_members: [{ workspace_id: WS_A, user_id: USER_A, role: "owner" }],
		reminder_rules: [],
		reminder_events: events,
		reminder_runs: [],
		invoices,
	};
}

function rows(tables: FakeTables, table: keyof FakeTables) {
	return tables[table] as Array<Record<string, unknown>>;
}

beforeEach(() => {
	resendSendSpy.mockClear();
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe("tick send budget", () => {
	it("drains at most maxSends per call and leaves capped events queued", async () => {
		const invoices = ["inv-1", "inv-2", "inv-3", "inv-4"].map((id) =>
			invoiceRow(id, WS_A),
		);
		const events = ["inv-1", "inv-2", "inv-3", "inv-4"].map((id) =>
			queuedEvent(`evt-${id}`, USER_A, id),
		);
		const tables = seed(invoices, events);
		const { client } = createFakeSupabase(tables);

		const result = await sendQueuedEmails(client, USER_A, {
			maxSends: 2,
			now: NOW,
		});

		expect(result.sent).toBe(2);
		// Deferred ≠ failed: nothing is marked failed for the cap, and the two
		// undrained events stay queued for the next tick.
		expect(result.skipped).toBe(0);
		const statuses = rows(tables, "reminder_events").map((e) => e.status);
		expect(statuses.filter((s) => s === "sent")).toHaveLength(2);
		expect(statuses.filter((s) => s === "queued")).toHaveLength(2);
		expect(statuses.filter((s) => s === "failed")).toHaveLength(0);
	});

	it("counts skipped events toward the cap so unsendable queues stay bounded", async () => {
		// Invoices with no buyer email: every drain iteration takes the skip
		// path and never increments `sent`. The cap must bound events TOUCHED,
		// or a large unsendable queue would walk the whole list (2-3
		// subrequests per event) into the Workers ceiling.
		const invoices = [1, 2, 3, 4, 5].map((n) => ({
			...invoiceRow(`inv-u${n}`, WS_A),
			compliance: { buyer: { email: "" } },
		}));
		const events = [1, 2, 3, 4, 5].map((n) =>
			queuedEvent(`evt-u${n}`, USER_A, `inv-u${n}`),
		);
		const tables = seed(invoices, events);
		const { client } = createFakeSupabase(tables);

		const result = await sendQueuedEmails(client, USER_A, {
			maxSends: 2,
			now: NOW,
		});

		expect(result.sent).toBe(0);
		expect(result.skipped).toBe(2);
		// Exactly two events were touched (marked failed); three remain queued.
		const statuses = rows(tables, "reminder_events").map((e) => e.status);
		expect(statuses.filter((s) => s === "failed")).toHaveLength(2);
		expect(statuses.filter((s) => s === "queued")).toHaveLength(3);
		expect(resendSendSpy).not.toHaveBeenCalled();
	});

	it("returns before the quota read when the queue is empty", async () => {
		const tables = seed([invoiceRow("inv-e1", WS_A)], []);
		const { client } = createFakeSupabase(tables);

		const result = await sendQueuedEmails(client, USER_A, { now: NOW });

		expect(result).toMatchObject({ sent: 0, skipped: 0 });
		expect(resendSendSpy).not.toHaveBeenCalled();
	});

	it("spends the sweep budget across workspaces and defers the rest", async () => {
		const invoices = [1, 2, 3].map((n) => invoiceRow(`inv-s${n}`, WS_A));
		const events = [1, 2, 3].map((n) => queuedEvent(`evt-s${n}`, USER_A, `inv-s${n}`));
		const tables = seed(invoices, events);
		const { client } = createFakeSupabase(tables);

		const summary = await runReminderSweep({
			admin: client,
			now: NOW,
			send: true,
			sendBudget: 1,
		});

		expect(summary.sendEnabled).toBe(true);
		expect(summary.sentCount).toBe(1);
		const statuses = rows(tables, "reminder_events").map((e) => e.status);
		expect(statuses.filter((s) => s === "sent")).toHaveLength(1);
		expect(statuses.filter((s) => s === "queued")).toHaveLength(2);
		expect(statuses.filter((s) => s === "failed")).toHaveLength(0);
		// The workspace's own run still reports success — deferral is normal.
		expect(rows(tables, "reminder_runs")[0].status).toBe("completed");
	});
});
