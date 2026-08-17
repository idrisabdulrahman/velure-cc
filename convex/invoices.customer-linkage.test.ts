import { describe, expect, it } from "vitest";
import { customerBelongsToWorkspace, mapPublicInvoice } from "./invoices";

describe("invoice customer linkage", () => {
	it("accepts only customers in the invoice workspace", () => {
		expect(
			customerBelongsToWorkspace(
				{ workspaceId: "workspace-1" as never },
				"workspace-1" as never,
			),
		).toBe(true);
		expect(
			customerBelongsToWorkspace(
				{ workspaceId: "workspace-2" as never },
				"workspace-1" as never,
			),
		).toBe(false);
		expect(customerBelongsToWorkspace(null, "workspace-1" as never)).toBe(
			false,
		);
	});

	it("keeps the linked customer private while preserving its snapshot", () => {
		const result = mapPublicInvoice({
			_id: "invoice-1",
			token: "public-token",
			invoiceNumber: "INV-2026-000001",
			customerId: "customer-1",
			customerName: "Duplicate Name",
			currency: "NGN",
			issueDate: "2026-08-13",
			dueDate: "2026-08-27",
			status: "unpaid",
			paymentAmount: 0,
			lineItems: [{ id: "line-1", name: "Service", quantity: 1, price: 100 }],
			createdAt: 1,
			updatedAt: 1,
		});

		expect(result.customerName).toBe("Duplicate Name");
		expect(result).not.toHaveProperty("customerId");
	});
});
