import { describe, expect, it } from "vitest";
import { getCollectionOverview } from "./reminders";
import { createFakeSupabase, type FakeTables } from "./testing/fake-db";

/**
 * WS3 — the reminder queue must agree with Invoices.
 *
 * The overview derives each row's status, net payable and overdue flag from the
 * one shared authority: a draft is never overdue and never enters the eligible
 * count, and the displayed amount is net payable, not the gross `grandTotal`.
 */

const USER = "user-a";
const WS = "ws-a";

function invoiceRow(id: string, overrides: Record<string, unknown> = {}) {
	return {
		id,
		workspace_id: WS,
		invoice_number: `INV-2026-${id.toUpperCase()}`,
		customer_name: `Customer ${id}`,
		currency: "NGN",
		issue_date: "2026-06-01",
		due_date: "2026-06-15",
		status: "unpaid",
		payment_amount: 0,
		paid_at: null,
		payment_reference: null,
		canceled_at: null,
		deleted_at: null,
		delivered_at: "2026-06-01T00:00:00.000Z",
		finalized_at: "2026-06-01T00:00:00.000Z",
		line_items: [],
		compliance: {
			buyer: { email: `${id}@example.test` },
			netPayable: 1_000,
		},
		reminder: { paused: false, escalationStatus: "idle" },
		lifecycle: { sentAt: Date.parse("2026-06-01T00:00:00.000Z") },
		created_at: "2026-06-01T00:00:00.000Z",
		updated_at: "2026-06-01T00:00:00.000Z",
		...overrides,
	};
}

function seed(invoices: Array<Record<string, unknown>>): FakeTables {
	return {
		active_workspaces: [{ user_id: USER, workspace_id: WS }],
		workspaces: [
			{
				id: WS,
				owner_id: USER,
				name: "Alpha",
				invoice_number_mode: "prefix",
				invoice_number_prefix: "INV",
				next_invoice_sequence: 1,
				updated_at: "2026-01-01T00:00:00.000Z",
			},
		],
		workspace_members: [{ workspace_id: WS, user_id: USER, role: "owner" }],
		invoices,
		reminder_rules: [],
	};
}

describe("getCollectionOverview reconciles against the shared balance rule", () => {
	it("never counts a draft as overdue and keeps it out of the eligible queue", async () => {
		const tables = seed([
			invoiceRow("draft", {
				status: "draft",
				due_date: "2026-01-01",
				delivered_at: null,
				finalized_at: null,
				lifecycle: null,
				compliance: {
					buyer: { email: "draft@example.test" },
					netPayable: 519_400,
					grandTotal: 530_000,
					withholdingTaxAmount: 10_600,
				},
			}),
		]);
		const { client } = createFakeSupabase(tables);

		const overview = await getCollectionOverview(client, USER, {
			daysBeforeDue: 300,
		});

		expect(overview.stats).toMatchObject({
			overdueCount: 0,
			actionableCount: 0,
			missingEmailCount: 0,
			pausedOrManualCount: 0,
		});
		const draft = overview.invoices.find((row) => row.id === "draft");
		expect(draft).toMatchObject({
			status: "draft",
			overdue: false,
			balance: 0,
			netPayable: 519_400,
		});
	});

	it("reports net payable (WHT deducted), not the gross grand total", async () => {
		const tables = seed([
			invoiceRow("delivered", {
				compliance: {
					buyer: { email: "delivered@example.test" },
					netPayable: 519_400,
					grandTotal: 530_000,
					withholdingTaxAmount: 10_600,
				},
			}),
		]);
		const { client } = createFakeSupabase(tables);

		const overview = await getCollectionOverview(client, USER);
		expect(overview.invoices[0]).toMatchObject({
			netPayable: 519_400,
			balance: 519_400,
		});
	});

	it("marks a delivered past-due invoice overdue and drops paid/canceled rows", async () => {
		const tables = seed([
			invoiceRow("overdue", { due_date: "2026-06-01" }),
			invoiceRow("paid", {
				status: "paid",
				payment_amount: 1_000,
			}),
			invoiceRow("canceled", {
				status: "canceled",
				canceled_at: "2026-06-02T00:00:00.000Z",
			}),
		]);
		const { client } = createFakeSupabase(tables);

		const overview = await getCollectionOverview(client, USER);
		expect(overview.stats.overdueCount).toBe(1);
		expect(overview.invoices.map((row) => row.id)).toEqual(["overdue"]);
		expect(overview.invoices[0]).toMatchObject({
			status: "overdue",
			overdue: true,
		});
	});

	it("does not count a collectible invoice without a buyer email as actionable", async () => {
		const tables = seed([
			invoiceRow("noemail", {
				compliance: { netPayable: 1_000 },
			}),
		]);
		const { client } = createFakeSupabase(tables);

		const overview = await getCollectionOverview(client, USER, {
			daysBeforeDue: 300,
		});
		expect(overview.stats.missingEmailCount).toBe(1);
		expect(overview.stats.actionableCount).toBe(0);
		expect(overview.invoices[0]).toMatchObject({
			missingEmail: true,
			netPayable: 1_000,
			balance: 1_000,
		});
	});
});
