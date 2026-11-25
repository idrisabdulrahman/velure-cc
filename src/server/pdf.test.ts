import { describe, expect, it, vi } from "vitest";

vi.mock("./pdf-layout", async (importOriginal) => ({
	...(await importOriginal<typeof import("./pdf-layout")>()),
	renderInvoicePdfDocument: vi.fn(),
}));

import { renderInvoicePdf } from "./pdf";
import { renderInvoicePdfDocument } from "./pdf-layout";

/**
 * A minimal record the adapter accepts, so the test reaches the renderer call
 * rather than failing earlier in `toInvoiceDocument`.
 */
const record = {
	id: "invoice-1",
	token: "public-token",
	invoiceNumber: "INV-2026-0042",
	customerName: "Acme Services Ltd",
	currency: "NGN",
	type: "one-time",
	invoiceSize: "A4",
	dateFormat: "ng",
	template: "default",
	issueDate: "2026-06-01",
	dueDate: "2026-06-15",
	status: "unpaid",
	total: 530_000,
	lineItems: [
		{ id: "line-1", name: "Consulting", quantity: 1, price: 530_000 },
	],
	createdAt: 0,
	updatedAt: 0,
} as never;

describe("renderInvoicePdf", () => {
	it("returns the vector renderer's bytes", async () => {
		const bytes = new Uint8Array([1, 2, 3]);
		vi.mocked(renderInvoicePdfDocument).mockResolvedValue(bytes);

		await expect(renderInvoicePdf(record)).resolves.toBe(bytes);
	});

	it("propagates a renderer failure instead of substituting a document", async () => {
		vi.mocked(renderInvoicePdfDocument).mockRejectedValue(
			new Error("renderer exploded"),
		);

		await expect(renderInvoicePdf(record)).rejects.toThrow("renderer exploded");
	});
});
