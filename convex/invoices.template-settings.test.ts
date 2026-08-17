import { describe, expect, it } from "vitest";
import { assertInvoiceInput } from "./invoices";

const base = {
	invoiceNumber: "INV-2026-000001",
	currency: "NGN",
	lineItems: [{ id: "line-1", name: "Service", quantity: 1, price: 100 }],
};

describe("invoice template settings", () => {
	it("rejects a discount greater than the invoice subtotal", () => {
		expect(() =>
			assertInvoiceInput({
				...base,
				templateSettings: { includeDiscount: true, discount: 100.01 },
			}),
		).toThrow("Discount must be between zero and the invoice subtotal.");
	});

	it("accepts a discount equal to the subtotal", () => {
		expect(() =>
			assertInvoiceInput({
				...base,
				templateSettings: { includeDiscount: true, discount: 100 },
			}),
		).not.toThrow();
	});
});
