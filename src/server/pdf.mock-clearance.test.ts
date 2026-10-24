import { afterEach, describe, expect, it, vi } from "vitest";
import type { InvoiceRecord } from "#/features/invoices/types";

vi.mock("@react-pdf/renderer", () => {
	const Component = ({ children }: { children?: unknown }) => children ?? null;
	return {
		Document: Component,
		Page: Component,
		Image: Component,
		Text: Component,
		View: Component,
		renderToBuffer: async () => {
			throw new Error("force the server fallback PDF renderer in this test");
		},
	};
});

import { renderInvoicePdf } from "./pdf";

const baseInvoice = {
	id: "invoice-a",
	token: "public-token",
	invoiceNumber: "INV-2026-1",
	customerName: "Buyer Ltd",
	currency: "NGN",
	type: "one-time",
	invoiceSize: "A4",
	dateFormat: "ng",
	paymentTermsDays: 14,
	template: "Default",
	issueDate: "2026-01-01",
	dueDate: "2026-01-15",
	status: "unpaid",
	total: 100,
	balance: 100,
	paymentAmount: 0,
	lineItems: [{ id: "line-a", name: "Service", quantity: 1, price: 100 }],
	createdAt: 1,
	updatedAt: 1,
} as InvoiceRecord;

describe("invoice PDF mock-clearance gate", () => {
	afterEach(() => vi.restoreAllMocks());

	it("hides artifacts before explicit mock clearance and renders labeled artifacts after it", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const beforeClearance = await renderInvoicePdf({
			...baseInvoice,
			fiscalization: {
				status: "not_configured",
				mockIrn: "MOCK-IRN-should-not-render",
				qrCodePayload: "MOCK-SANDBOX|NOT-NRS-CLEARED|should-not-render",
			},
		});
		const hiddenPdf = Buffer.from(beforeClearance).toString("utf8");
		expect(hiddenPdf).not.toContain("MOCK SANDBOX");
		expect(hiddenPdf).not.toContain("should-not-render");

		const clearedPdf = await renderInvoicePdf({
			...baseInvoice,
			fiscalization: {
				status: "mock_cleared",
				provider: "mock",
				environment: "sandbox",
				mock: true,
				mockIrn: "MOCK-IRN-demo-1",
				qrCodePayload: "MOCK-SANDBOX|NOT-NRS-CLEARED|IRN=MOCK-IRN-demo-1",
			},
		});
		const visiblePdf = Buffer.from(clearedPdf).toString("utf8");
		expect(visiblePdf).toContain("MOCK SANDBOX — NOT NRS CLEARED");
		expect(visiblePdf).toContain("Mock IRN: MOCK-IRN-demo-1");
		expect(visiblePdf).toContain("MOCK-SANDBOX|NOT-NRS-CLEARED|");
		expect(log).toHaveBeenCalledTimes(2);
	});
});
