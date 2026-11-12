import { describe, expect, it } from "vitest";
import { payableInvoiceIssue } from "./payments";

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
