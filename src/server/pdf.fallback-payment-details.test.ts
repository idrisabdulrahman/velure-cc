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

/**
 * Issue #3 finding 1: the plain fallback PDF dropped the issued invoice's bank
 * instructions. The download and email attachment share this renderer, so an
 * issued fallback must carry the payment label, the instructions, and the
 * reference; a draft/scheduled document must keep both hidden.
 */
const baseInvoice = {
	id: "invoice-payment-details",
	token: "public-token",
	invoiceNumber: "INV-2026-42",
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
	paymentDetails:
		"Bank: Zenith Bank\nAccount name: Brand Co Ltd\nAccount: 1234567890",
	lineItems: [{ id: "line-a", name: "Service", quantity: 1, price: 100 }],
	compliance: {
		seller: { legalName: "Brand Co Ltd" },
		buyer: { legalName: "Buyer Ltd" },
	},
	createdAt: 1,
	updatedAt: 1,
} as unknown as InvoiceRecord;

function pdfText(bytes: Uint8Array) {
	return Buffer.from(bytes).toString("utf8");
}

describe("worker fallback PDF payment details", () => {
	afterEach(() => vi.restoreAllMocks());

	it("preserves the issued invoice's instructions and reference", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const text = pdfText(await renderInvoicePdf({ ...baseInvoice }));

		expect(text).toContain("Payment Details");
		expect(text).toContain("Bank: Zenith Bank");
		expect(text).toContain("Account: 1234567890");
		expect(text).toContain("Payment reference: INV-2026-42");
	}, 15_000);

	it("keeps instructions and reference hidden on a draft", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const text = pdfText(
			await renderInvoicePdf({ ...baseInvoice, status: "draft" }),
		);

		expect(text).not.toContain("Zenith Bank");
		expect(text).not.toContain("Payment Details");
		expect(text).not.toContain("Payment reference");
	}, 15_000);

	it("keeps instructions and reference hidden on a scheduled invoice", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const text = pdfText(
			await renderInvoicePdf({ ...baseInvoice, status: "scheduled" }),
		);

		expect(text).not.toContain("Zenith Bank");
		expect(text).not.toContain("Payment reference");
	}, 15_000);
});
