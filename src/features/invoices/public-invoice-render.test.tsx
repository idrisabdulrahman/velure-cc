import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HtmlTemplate } from "#/lib/midday-invoice/templates/html";
import { getInvoiceTemplateSize, toMiddayInvoice } from "./midday-adapter";
import type { InvoiceRecord } from "./types";

/* Critique T2: the public customer page must never render a mock sandbox IRN
 * or QR payload. The PDF path intentionally renders them with a visible
 * "MOCK SANDBOX — NOT NRS CLEARED" label; the *public HTML* path must omit
 * them entirely. The mocked invoice below carries a fully marked mock clearance
 * so the assertion cannot pass vacuously. */

const mockClearedInvoice = {
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
	fiscalization: {
		status: "mock_cleared",
		provider: "mock",
		environment: "sandbox",
		mock: true,
		mockIrn: "MOCK-IRN-demo-1",
		qrCodePayload: "MOCK-SANDBOX|NOT-NRS-CLEARED|IRN=MOCK-IRN-demo-1",
	},
} as InvoiceRecord;

describe("public invoice HTML page hides mock clearance artifacts", () => {
	it("renders no mock IRN or QR payload even when the invoice is mock-cleared", () => {
		const midday = toMiddayInvoice(mockClearedInvoice);
		const { width, height } = getInvoiceTemplateSize(midday.template);
		const html = renderToStaticMarkup(
			<HtmlTemplate
				data={midday}
				width={width}
				height={height}
				appearance="public"
			/>,
		);

		expect(html).not.toContain("MOCK-IRN");
		expect(html).not.toContain("MOCK-SANDBOX");
		expect(html).not.toContain("NOT-NRS-CLEARED");
		// Positive control: the real invoice content does render.
		expect(html).toContain("INV-2026-1");
		expect(html).toContain("Buyer Ltd");
	});
});
