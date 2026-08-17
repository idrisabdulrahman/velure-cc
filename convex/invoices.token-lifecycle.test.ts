import { describe, expect, it } from "vitest";
import { isPublicInvoiceAvailable, mapPublicInvoice } from "./invoices";

describe("invoice public token lifecycle", () => {
	it("rejects revoked, canceled, and deleted invoices", () => {
		expect(isPublicInvoiceAvailable({})).toBe(true);
		expect(isPublicInvoiceAvailable({ tokenRevokedAt: 1 })).toBe(false);
		expect(isPublicInvoiceAvailable({ canceledAt: 1 })).toBe(false);
		expect(isPublicInvoiceAvailable({ deletedAt: 1 })).toBe(false);
	});

	it("keeps internal notes and lifecycle controls private", () => {
		const result = mapPublicInvoice({
			_id: "invoice-1",
			token: "public-token",
			tokenRevokedAt: undefined,
			invoiceNumber: "INV-2026-000001",
			customerName: "Acme",
			currency: "NGN",
			issueDate: "2026-08-13",
			dueDate: "2026-08-27",
			status: "unpaid",
			paymentAmount: 0,
			notes: "Visible note",
			internalNotes: "Private collection context",
			lineItems: [{ id: "line-1", name: "Service", quantity: 1, price: 100 }],
			createdAt: 1,
			updatedAt: 1,
		});

		expect(result.notes).toBe("Visible note");
		expect(result).not.toHaveProperty("internalNotes");
		expect(result).not.toHaveProperty("tokenRevokedAt");
	});
});
