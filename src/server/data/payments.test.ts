import { beforeEach, describe, expect, it, vi } from "vitest";
import { payableInvoiceIssue, recordPayment } from "./payments";
import { createFakeSupabase, type FakeTables } from "./testing/fake-db";
import type { Supabase } from "./workspaces";

const lineItems = [{ quantity: 1, price: 1000 }];

function draftInvoice() {
	return {
		status: "draft",
		lineItems,
		paymentAmount: 0,
	};
}

function canceledInvoice() {
	return {
		status: "canceled",
		canceledAt: 1_700_000_000_000,
		lineItems,
		paymentAmount: 0,
	};
}

function paidInvoice() {
	return {
		status: "paid",
		lineItems,
		paymentAmount: 1000,
	};
}

describe("payableInvoiceIssue", () => {
	it("blocks drafts by default — public payment context and Paystack charges stay closed", () => {
		expect(payableInvoiceIssue(draftInvoice())).toBe(
			"Draft invoices are not payable.",
		);
	});

	it("allows a draft when the owner records payment manually", () => {
		expect(payableInvoiceIssue(draftInvoice(), { allowDraft: true })).toBe(
			null,
		);
	});

	it("keeps canceled invoices blocked even for manual payment", () => {
		expect(payableInvoiceIssue(canceledInvoice(), { allowDraft: true })).toBe(
			"Canceled invoices are not payable.",
		);
		expect(payableInvoiceIssue(canceledInvoice())).toBe(
			"Canceled invoices are not payable.",
		);
	});

	it("keeps paid invoices blocked even for manual payment", () => {
		expect(payableInvoiceIssue(paidInvoice(), { allowDraft: true })).toBe(
			"Paid invoices are not payable.",
		);
	});

	it("still accepts an unsent draft that already received part of the money", () => {
		const partiallyPaidDraft = {
			status: "draft",
			lineItems,
			paymentAmount: 400,
		};
		expect(payableInvoiceIssue(partiallyPaidDraft, { allowDraft: true })).toBe(
			null,
		);
	});

	it("does not enable collection for correction notes", () => {
		for (const documentType of ["credit_note", "debit_note"] as const) {
			expect(
				payableInvoiceIssue({
					...paidInvoice(),
					documentType,
				}),
			).toBe("Payments are not enabled for credit or debit notes.");
		}
	});

	it("blocks a scheduled invoice by its projected status", () => {
		const scheduled = {
			...draftInvoice(),
			// `mapPublicInvoice`/`mapInvoice` project the derived status; the
			// public claim handler reads this field directly.
			status: "scheduled",
		};
		expect(payableInvoiceIssue(scheduled)).toBe(
			"Scheduled invoices are not payable until they are issued.",
		);
		// Not even the owner's manual settlement path may pay it.
		expect(payableInvoiceIssue(scheduled, { allowDraft: true })).toBe(
			"Scheduled invoices are not payable until they are issued.",
		);
	});

	it("blocks a scheduled invoice through the schedule columns too", () => {
		// A public projection may drop the schedule columns but still carry the
		// scheduled status; conversely a derived snapshot needs the columns. Both
		// routes must be refused.
		expect(
			payableInvoiceIssue({
				...draftInvoice(),
				status: "unpaid",
				scheduledAt: Date.parse("2026-09-01T00:00:00.000Z"),
				scheduleVersion: "v1",
			}),
		).toBe("Scheduled invoices are not payable until they are issued.");
	});
});

/**
 * A payment recorded from a server request handler must inject the in-process
 * audit writer. `recordPayment`'s default writer is the browser transport
 * (`./audit-client`), whose relative `fetch("/api/invoice/audit")` cannot run
 * inside the worker — it throws AFTER the invoice patch commits, so the money
 * lands without an audit row and the caller 500s. This pins both halves:
 * the injected writer is used verbatim, and relying on the default fails.
 */
describe("recordPayment audit writer injection", () => {
	const USER = "user-a";
	const WS = "ws-a";
	const INV = "inv-a";

	function invoiceRow() {
		return {
			id: INV,
			workspace_id: WS,
			token: `token-${INV}`,
			token_revoked_at: null,
			document_type: "standard",
			invoice_number: "INV-2026-1",
			customer_name: "Buyer",
			customer_id: null,
			currency: "NGN",
			invoice_type: "one-time",
			issue_date: "2026-01-01",
			due_date: "2026-02-01",
			status: "unpaid",
			payment_amount: 0,
			paid_at: null,
			payment_reference: null,
			canceled_at: null,
			deleted_at: null,
			delivered_at: "2026-01-05T00:00:00.000Z",
			line_items: [{ id: "li-1", name: "Service", quantity: 1, price: 100 }],
			compliance: { buyer: { email: "buyer@example.test" } },
			fiscalization: null,
			reminder: { enabled: true, paused: false, stage: "none" },
			sync: null,
			lifecycle: { sentAt: Date.parse("2026-01-05T00:00:00Z") },
			notes: null,
			internal_notes: null,
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: "2026-01-06T00:00:00.000Z",
		};
	}

	let tables: FakeTables;
	let client: Supabase;

	beforeEach(() => {
		tables = {
			workspaces: [{ id: WS, name: "Alpha", invoice_number_prefix: "INV" }],
			active_workspaces: [{ user_id: USER, workspace_id: WS }],
			invoices: [invoiceRow()],
			payment_transactions: [],
		};
		client = createFakeSupabase(tables).client;
	});

	it("uses an injected server writer and records the payment", async () => {
		const entries: { action: string; message: string }[] = [];
		const result = await recordPayment(
			client,
			USER,
			{ invoiceId: INV, amount: 40 },
			async (_c, _u, entry) => {
				entries.push(entry as { action: string; message: string });
			},
		);

		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({
			action: "invoice.edit",
			message: "Recorded a payment.",
		});
		expect(result).toMatchObject({ ok: true, duplicate: false });
		expect(tables.invoices?.[0]?.payment_amount).toBe(40);
	});

	it("fails closed when no writer is injected (server cannot use the browser transport)", async () => {
		const write = vi.fn(async () => {});
		await expect(
			recordPayment(client, USER, { invoiceId: INV, amount: 40 }),
		).rejects.toThrow();
		expect(write).not.toHaveBeenCalled();
	});
});
