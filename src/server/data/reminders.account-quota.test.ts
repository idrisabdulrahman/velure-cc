import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendQueuedEmails } from "./reminders-send-queue";
import { createFakeSupabase, type FakeTables } from "./testing/fake-db";

/**
 * The daily Resend cap is per SHARED platform account (100 emails/day), not per
 * workspace. `sendQueuedEmails` used to count `reminder_events` filtered by
 * `owner_id`, so every workspace saw its own 100/day budget and the shared
 * account could exceed the real cap. These tests prove the count now aggregates
 * every owner's sent email events for the UTC day: one workspace's usage
 * reduces every workspace's remaining capacity.
 *
 * The account-capable read is reached through the `quotaClient` test seam (the
 * service-role client is absent locally); `RESEND_API_KEY` is mocked present
 * and `resend` is mocked, so nothing leaves the process.
 */

const { resendSendSpy } = vi.hoisted(() => ({
	resendSendSpy: vi.fn(async () => ({
		data: { id: "email-1" },
		error: null,
	})),
}));

vi.mock("#/server/env", () => ({
	getServerEnv: (key: string) =>
		key === "RESEND_API_KEY" ? "re_test_key" : `${key}@velure.test`,
}));
vi.mock("resend", () => ({
	Resend: class {
		emails = { send: resendSendSpy };
	},
}));

const USER_A = "user-a";
const USER_B = "user-b";
const WS_A = "ws-a";
const WS_B = "ws-b";
const INV_A = "inv-a";
const INV_B = "inv-b";

const NOW = new Date("2026-11-07T12:00:00.000Z");
const TODAY_SENT_AT = "2026-11-07T01:00:00.000Z";

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
		token: `pub-token-${id}`,
		token_revoked_at: null,
		document_type: "standard",
		invoice_number: `INV-2026-${id.toUpperCase()}`,
		customer_name: `Customer ${id}`,
		customer_id: null,
		currency: "NGN",
		invoice_type: "one-time",
		issue_date: "2026-11-01",
		due_date: "2026-11-05",
		status: "unpaid",
		payment_amount: 0,
		paid_at: null,
		payment_reference: null,
		canceled_at: null,
		deleted_at: null,
		delivered_at: "2026-11-01T00:00:00.000Z",
		finalized_at: "2026-11-01T00:00:00.000Z",
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
		compliance: { buyer: { email: `buyer-${id}@example.test` } },
		fiscalization: null,
		reminder: { enabled: true, paused: false, stage: "none" },
		sync: null,
		lifecycle: { sentAt: 1_762_000_000_000 },
		notes: null,
		internal_notes: null,
		created_at: "2026-11-01T00:00:00.000Z",
		updated_at: "2026-11-01T00:00:00.000Z",
	};
}

function sentRow(id: string, ownerId: string, invoiceId: string) {
	return {
		id,
		owner_id: ownerId,
		invoice_id: invoiceId,
		stage: "before_due",
		channel: "email",
		scheduled_for: TODAY_SENT_AT,
		sent_at: TODAY_SENT_AT,
		status: "sent",
		error: null,
		meta: null,
		created_at: TODAY_SENT_AT,
		updated_at: TODAY_SENT_AT,
	};
}

function queuedRow(id: string, ownerId: string, invoiceId: string) {
	return {
		id,
		owner_id: ownerId,
		invoice_id: invoiceId,
		stage: "before_due",
		channel: "email",
		scheduled_for: TODAY_SENT_AT,
		sent_at: null,
		status: "queued",
		error: null,
		meta: null,
		created_at: TODAY_SENT_AT,
		updated_at: TODAY_SENT_AT,
	};
}

function seed(events: Array<Record<string, unknown>>): FakeTables {
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
		invoices: [invoiceRow(INV_A, WS_A), invoiceRow(INV_B, WS_B)],
		reminder_events: events,
		reminder_rules: [],
		reminder_runs: [],
	};
}

function rows(tables: FakeTables, table: keyof FakeTables) {
	return tables[table] as Array<Record<string, unknown>>;
}

async function drain(
	userId: string,
	client: ReturnType<typeof createFakeSupabase>["client"],
) {
	return sendQueuedEmails(client, userId, { quotaClient: client, now: NOW });
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("sendQueuedEmails — account-wide Resend daily cap", () => {
	it("counts every owner's sent emails, so another workspace's usage blocks the caller", async () => {
		// 60 sent for A + 50 sent for B = 110 today. The caller (B) has 50 of
		// its own; a per-owner counter would report 50 remaining and send.
		const events: Array<Record<string, unknown>> = [];
		for (let i = 0; i < 60; i++) {
			events.push(sentRow(`sent-a-${i}`, USER_A, INV_A));
		}
		for (let i = 0; i < 50; i++) {
			events.push(sentRow(`sent-b-${i}`, USER_B, INV_B));
		}
		events.push(queuedRow("queued-b", USER_B, INV_B));
		const tables = seed(events);
		const { client } = createFakeSupabase(tables);

		const result = await drain(USER_B, client);

		expect(result).toEqual({ sent: 0, skipped: 1 });
		expect(resendSendSpy).not.toHaveBeenCalled();
		const queued = rows(tables, "reminder_events").find(
			(row) => row.id === "queued-b",
		);
		expect(queued).toMatchObject({ status: "failed" });
		expect(String(queued?.error)).toBe(
			"Daily email sending limit reached for the account; this reminder will send after 00:00 UTC.",
		);
	});

	it("leaves exactly one send when 99 sent emails are present account-wide", async () => {
		const events: Array<Record<string, unknown>> = [];
		for (let i = 0; i < 99; i++) {
			events.push(
				sentRow(
					`sent-${i}`,
					i % 2 === 0 ? USER_A : USER_B,
					i % 2 === 0 ? INV_A : INV_B,
				),
			);
		}
		events.push(queuedRow("queued-b", USER_B, INV_B));
		const tables = seed(events);
		const { client } = createFakeSupabase(tables);

		const result = await drain(USER_B, client);

		expect(result).toEqual({ sent: 1, skipped: 0 });
		expect(resendSendSpy).toHaveBeenCalledTimes(1);
	});

	it("blocks the final send when 100 sent emails are present account-wide", async () => {
		const events: Array<Record<string, unknown>> = [];
		for (let i = 0; i < 100; i++) {
			events.push(
				sentRow(
					`sent-${i}`,
					i % 2 === 0 ? USER_A : USER_B,
					i % 2 === 0 ? INV_A : INV_B,
				),
			);
		}
		events.push(queuedRow("queued-b", USER_B, INV_B));
		const tables = seed(events);
		const { client } = createFakeSupabase(tables);

		const result = await drain(USER_B, client);

		expect(result).toEqual({ sent: 0, skipped: 1 });
		expect(resendSendSpy).not.toHaveBeenCalled();
	});

	it("ignores sent emails from before the UTC day and non-email channels", async () => {
		const tables = seed([
			// Yesterday: outside the window.
			{
				...sentRow("sent-yesterday", USER_A, INV_A),
				sent_at: "2026-11-06T23:59:59.000Z",
			},
			// Internal audit event, not a Resend send.
			{
				...sentRow("sent-internal", USER_A, INV_A),
				channel: "internal",
			},
			{
				...sentRow("sent-a", USER_A, INV_A),
				sent_at: "2026-11-07T02:00:00.000Z",
			},
			queuedRow("queued-b", USER_B, INV_B),
		]);
		const { client } = createFakeSupabase(tables);

		const result = await drain(USER_B, client);

		// Only one in-window email counts, so B's single queued email sends.
		expect(result).toEqual({ sent: 1, skipped: 0 });
	});
});
