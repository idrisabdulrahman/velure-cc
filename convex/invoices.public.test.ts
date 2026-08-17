import { describe, expect, it } from "vitest";
import { mapPublicInvoice } from "./invoices";

describe("mapPublicInvoice", () => {
	it("allowlists public fields and excludes payment-provider secrets", () => {
		const result = mapPublicInvoice({
			_id: "invoice-1",
			token: "public-token",
			invoiceNumber: "INV-2026-000001",
			customerName: "Acme",
			currency: "NGN",
			issueDate: "2026-08-13",
			dueDate: "2026-08-27",
			status: "unpaid",
			paymentAmount: 0,
			paymentLink: "https://private.example/pay",
			paymentProvider: "paystack",
			paymentReference: "private-reference",
			lineItems: [{ id: "line-1", name: "Service", quantity: 1, price: 100 }],
			createdAt: 1,
			updatedAt: 1,
		});

		expect(result).toMatchObject({
			id: "invoice-1",
			token: "public-token",
			invoiceNumber: "INV-2026-000001",
			total: 100,
			balance: 100,
		});
		expect(result).not.toHaveProperty("paymentLink");
		expect(result).not.toHaveProperty("paymentProvider");
		expect(result).not.toHaveProperty("paymentReference");
		expect(result).not.toHaveProperty("workspaceId");
		expect(result).not.toHaveProperty("userId");
	});

	it("rounds fallback public totals and balances to currency precision", () => {
		const result = mapPublicInvoice({
			_id: "invoice-decimal",
			token: "public-token",
			invoiceNumber: "INV-2026-000002",
			customerName: "Decimal Ltd",
			currency: "NGN",
			issueDate: "2026-08-13",
			dueDate: "2026-08-27",
			status: "partial",
			paymentAmount: 0.1,
			lineItems: [{ id: "line-1", name: "Service", quantity: 1, price: 1.005 }],
			createdAt: 1,
			updatedAt: 1,
		});

		expect(result.total).toBe(1.01);
		expect(result.balance).toBe(0.91);
	});
});
