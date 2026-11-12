import { afterEach, describe, expect, it, vi } from "vitest";
import { getPaymentCapabilities, payableInvoiceIssue } from "./payments";

afterEach(() => vi.unstubAllEnvs());

describe("getPaymentCapabilities (Paystack collection flag)", () => {
	const off = { automaticBankTransfer: false, provider: null };
	const on = { automaticBankTransfer: true, provider: "paystack" };

	it("is off for a Nigerian workspace by default", () => {
		vi.stubEnv("PAYSTACK_COLLECTION_ENABLED", "");
		expect(getPaymentCapabilities({ countryCode: "NG" })).toEqual(off);
	});

	it("turns on for Nigeria only when the env flag is true", () => {
		vi.stubEnv("PAYSTACK_COLLECTION_ENABLED", "true");
		expect(getPaymentCapabilities({ countryCode: "ng" })).toEqual(on);
		expect(getPaymentCapabilities({ countryCode: "GH" })).toEqual(off);
		expect(getPaymentCapabilities(null)).toEqual(off);
	});

	it("lets an explicit option override the env flag", () => {
		vi.stubEnv("PAYSTACK_COLLECTION_ENABLED", "true");
		expect(
			getPaymentCapabilities(
				{ countryCode: "NG" },
				{ paystackCollectionEnabled: false },
			),
		).toEqual(off);
		vi.stubEnv("PAYSTACK_COLLECTION_ENABLED", "");
		expect(
			getPaymentCapabilities(
				{ countryCode: "NG" },
				{ paystackCollectionEnabled: true },
			),
		).toEqual(on);
	});
});

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
});
