import { afterEach, describe, expect, it, vi } from "vitest";
import type { InvoiceRecord } from "#/features/invoices/types";

// Force the pure-JS fallback writer (what the Cloudflare Worker actually uses,
// because `@react-pdf/renderer` is stubbed there).
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
	id: "invoice-branding",
	token: "public-token",
	invoiceNumber: "INV-2026-9",
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
	compliance: {
		seller: {
			legalName: "Brand Co Ltd",
			tradingName: "BrandCo",
			email: "billing@brandco.test",
			taxId: "12345678-0001",
			rcNumber: "RC-7654321",
		},
		buyer: {
			legalName: "Buyer Ltd",
			email: "buyer@example.com",
			taxId: "87654321-0002",
		},
	},
	createdAt: 1,
	updatedAt: 1,
} as unknown as InvoiceRecord;

function pdfText(bytes: Uint8Array) {
	return Buffer.from(bytes).toString("utf8");
}

describe("worker fallback PDF branding parity", () => {
	afterEach(() => vi.restoreAllMocks());

	it("prints seller, buyer, template and payment reference", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const text = pdfText(
			await renderInvoicePdf({ ...baseInvoice, status: "unpaid" }),
		);

		expect(text).toContain("From: Brand Co Ltd");
		expect(text).toContain("Trading as: BrandCo");
		expect(text).toContain("billing@brandco.test");
		expect(text).toContain("CAC RC Number: RC-7654321");
		expect(text).toContain("To: Buyer Ltd");
		expect(text).toContain("buyer@example.com");
		expect(text).toContain("Buyer TIN: 87654321-0002");
		expect(text).toContain("Template: Default");
		expect(text).toContain("Payment reference: INV-2026-9");
	}, 15_000);

	it("omits the payment reference for settled invoices", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const text = pdfText(
			await renderInvoicePdf({ ...baseInvoice, status: "paid" }),
		);

		expect(text).not.toContain("Payment reference: INV-2026-9");
	}, 15_000);

	it("paginates when the invoice is longer than one page", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const lineItems = Array.from({ length: 60 }, (_, index) => ({
			id: `line-${index}`,
			name: `Item ${index}`,
			quantity: 1,
			price: 10,
		}));
		const text = pdfText(await renderInvoicePdf({ ...baseInvoice, lineItems }));

		expect(text).toContain("/Count 2");
	}, 15_000);
});
