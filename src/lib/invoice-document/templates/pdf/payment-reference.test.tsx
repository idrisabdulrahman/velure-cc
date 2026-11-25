import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { toInvoiceDocument } from "#/features/invoices/invoice-document-adapter";
import type { InvoiceRecord } from "#/features/invoices/types";

/* The PDF renderer is a native module; mock it to plain passthrough components
 * so the element tree can be flattened to markup and the payment-reference
 * wiring asserted. Styles are irrelevant to this check. */
vi.mock("@react-pdf/renderer", () => {
	const Component = ({ children }: { children?: unknown }) => children ?? null;
	return {
		Document: Component,
		Page: Component,
		Image: Component,
		Text: Component,
		View: Component,
	};
});

import { PdfTemplate } from "./index";

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

async function renderPdfInvoice(
	status: InvoiceRecord["status"],
	invoiceNumber: string | null,
) {
	const record = { ...baseInvoice, status, invoiceNumber } as InvoiceRecord;
	const element = await PdfTemplate(toInvoiceDocument(record));
	return renderToStaticMarkup(element as ReactElement);
}

describe("invoice PDF prints the payment reference", () => {
	it("shows the invoice number as a payment reference on a payable invoice", async () => {
		const markup = await renderPdfInvoice("unpaid", "INV-2026-1");

		expect(markup).toContain("Payment reference");
		expect(markup).toContain("INV-2026-1");
	});

	it("hides the reference once the invoice is paid", async () => {
		const markup = await renderPdfInvoice("paid", "INV-2026-1");

		expect(markup).not.toContain("Payment reference");
	});

	it("omits the reference when the invoice has no number", async () => {
		const markup = await renderPdfInvoice("unpaid", null);

		expect(markup).not.toContain("Payment reference");
	});
});
