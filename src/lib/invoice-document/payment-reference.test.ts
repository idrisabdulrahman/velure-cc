import { describe, expect, it } from "vitest";
import {
	DEFAULT_PAYMENT_REFERENCE_LABEL,
	getInvoicePaymentReference,
} from "./payment-reference";
import type { Invoice } from "./types";

type Status = Invoice["status"];

function reference(invoiceNumber: string | null, status: Status) {
	return getInvoicePaymentReference({ invoiceNumber, status });
}

describe("getInvoicePaymentReference", () => {
	it("returns the invoice number as the reference for a payable invoice", () => {
		expect(reference("INV-2026-1", "unpaid")).toEqual({
			label: DEFAULT_PAYMENT_REFERENCE_LABEL,
			value: "INV-2026-1",
		});
	});

	it("still shows a reference for partially-paid and overdue invoices", () => {
		expect(reference("INV-2", "partially-paid")?.value).toBe("INV-2");
		expect(reference("INV-3", "overdue")?.value).toBe("INV-3");
		expect(reference("INV-4", "draft")?.value).toBe("INV-4");
	});

	it("hides the reference once the invoice is settled", () => {
		expect(reference("INV-5", "paid")).toBeNull();
		expect(reference("INV-6", "canceled")).toBeNull();
	});

	it("returns null when there is no invoice number", () => {
		expect(reference(null, "unpaid")).toBeNull();
		expect(reference("", "unpaid")).toBeNull();
		expect(reference("   ", "unpaid")).toBeNull();
	});

	it("trims surrounding whitespace from the reference", () => {
		expect(reference("  INV-7  ", "unpaid")?.value).toBe("INV-7");
	});

	it("uses the documented default label", () => {
		expect(DEFAULT_PAYMENT_REFERENCE_LABEL).toBe("Payment reference");
	});
});
