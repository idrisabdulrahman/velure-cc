import { describe, expect, it } from "vitest";
import { buildClientIntelligence } from "./client-intelligence";
import { buildInvoiceListSummary, mapInvoice } from "./invoices";
import { getCollectionOverview } from "./reminders";
import { buildRevenueCashFlowReport } from "./revenue-reporting";
import { createFakeSupabase, type FakeTables } from "./testing/fake-db";

/**
 * The reviewer's cross-surface check for the WS3 rule: the SAME documents fed
 * into Invoices, Clients, Reports and Reminders must report the same open
 * balance. Only the standard invoice is collectible; the pro-forma, the
 * credit/debit notes and the scheduled invoice are never owed.
 *
 * Invoices/Clients/Reports read the mapped invoice shape; Reminders reads raw
 * rows through the RLS-pure data layer, so the same values are seeded into both
 * shapes deliberately.
 */

const USER = "user-a";
const WS = "ws-a";
const CLIENT = {
	name: "Acme Ltd",
	email: "billing@acme.test",
	currency: "NGN",
};
const now = new Date("2026-06-23T12:00:00.000Z");
const DELIVERED = "2026-06-01T00:00:00.000Z";

type Doc = {
	id: string;
	documentType?: string;
	scheduled?: boolean;
};

const DOCS: Doc[] = [
	{ id: "std" },
	{ id: "quote", documentType: "proforma" },
	{ id: "credit", documentType: "credit_note" },
	{ id: "debit", documentType: "debit_note" },
	{ id: "sched", scheduled: true },
];

/** The mapped-invoice shape Invoices / Clients / Reports consume. */
function mappedInvoice({ id, documentType = "standard", scheduled }: Doc) {
	return mapInvoice({
		id,
		token: `pub-${id}`,
		documentType,
		invoiceNumber: `INV-${id}`,
		customerName: CLIENT.name,
		currency: "NGN",
		issueDate: "2026-06-05",
		dueDate: "2027-06-30",
		status: scheduled ? "scheduled" : "unpaid",
		scheduledAt: scheduled ? Date.parse("2027-07-01T00:00:00.000Z") : undefined,
		scheduleVersion: scheduled ? "v1" : undefined,
		deliveredAt: scheduled ? undefined : Date.parse(DELIVERED),
		finalizedAt: scheduled ? undefined : Date.parse(DELIVERED),
		lifecycle: scheduled ? {} : { sentAt: Date.parse(DELIVERED) },
		paymentAmount: 0,
		compliance: {
			buyer: { email: CLIENT.email },
			netPayable: 1_000,
			grandTotal: 1_000,
			withholdingTaxAmount: 0,
		},
		lineItems: [{ name: "Item", quantity: 1, price: 1_000 }],
	});
}

/** The raw-row shape the Reminders query reads. */
function reminderRow({ id, documentType = "standard", scheduled }: Doc) {
	return {
		id,
		workspace_id: WS,
		invoice_number: `INV-${id}`,
		customer_name: CLIENT.name,
		currency: "NGN",
		issue_date: "2026-06-05",
		due_date: "2027-06-30",
		status: scheduled ? "scheduled" : "unpaid",
		document_type: documentType,
		scheduled_at: scheduled ? "2027-07-01T00:00:00.000Z" : null,
		schedule_version: scheduled ? "v1" : null,
		payment_amount: 0,
		paid_at: null,
		payment_reference: null,
		canceled_at: null,
		deleted_at: null,
		delivered_at: scheduled ? null : DELIVERED,
		finalized_at: scheduled ? null : DELIVERED,
		line_items: [{ name: "Item", quantity: 1, price: 1_000 }],
		compliance: {
			buyer: { email: CLIENT.email },
			netPayable: 1_000,
			grandTotal: 1_000,
		},
		reminder: { paused: false, escalationStatus: "idle" },
		lifecycle: scheduled ? {} : { sentAt: Date.parse(DELIVERED) },
		created_at: "2026-06-01T00:00:00.000Z",
		updated_at: "2026-06-01T00:00:00.000Z",
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

describe("open balance agrees across Invoices, Clients, Reports and Reminders", () => {
	it("reports only the standard invoice as collectible, the same figure everywhere", async () => {
		const docs = DOCS.map(mappedInvoice);

		// Invoices — the list KPI open figure.
		const invoiceSummary = buildInvoiceListSummary(docs).currencySummaries.find(
			(summary) => summary.currency === "NGN",
		);
		const invoicesOpen = invoiceSummary?.openAmount ?? 0;

		// Clients — the client panel outstanding balance.
		const clientsOpen = buildClientIntelligence({
			client: CLIENT,
			invoices: docs,
			now,
		}).primaryCurrency.outstandingBalance;

		// Reports — the workspace outstanding aggregate.
		const reportsOpen = buildRevenueCashFlowReport({
			baseCurrency: "NGN",
			invoices: docs,
			payments: [],
			now,
		}).primaryCurrency.outstandingAmount;

		// Reminders — the queue's per-row balances.
		const { client } = createFakeSupabase(seed(DOCS.map(reminderRow)));
		const overview = await getCollectionOverview(client, USER, {
			daysBeforeDue: 300,
		});
		const remindersOpen = overview.invoices.reduce(
			(sum, invoice) => sum + invoice.balance,
			0,
		);

		// The one collectible document.
		expect(invoicesOpen).toBe(1_000);
		expect(clientsOpen).toBe(1_000);
		expect(reportsOpen).toBe(1_000);
		expect(remindersOpen).toBe(1_000);

		// Every non-standard document is zero on every surface.
		for (const id of ["quote", "credit", "debit", "sched"]) {
			const row = overview.invoices.find((invoice) => invoice.id === id);
			expect(row?.balance ?? 0).toBe(0);
		}
	});
});
