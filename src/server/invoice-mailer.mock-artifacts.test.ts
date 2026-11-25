import { describe, expect, it, vi } from "vitest";

const send = vi
	.fn()
	.mockResolvedValue({ data: { id: "email-1" }, error: null });
vi.mock("resend", () => ({
	Resend: class {
		emails = { send };
	},
}));
vi.mock("./env", () => ({
	getServerEnv: (name: string) =>
		({
			RESEND_API_KEY: "key",
			RESEND_FROM_EMAIL: "Invoicly <billing@example.com>",
			SITE_URL: "https://invoicly.cv",
		})[name],
}));
vi.mock("./pdf", () => ({
	renderInvoicePdf: async () => Buffer.from("stamped-pdf"),
}));

import { sendInvoiceWithResend } from "./invoice-mailer";

/* E-invoicing SPEC C4 / critique T2: a mock sandbox IRN or QR payload must
 * never appear in the customer-facing email body. The real PDF attachment is
 * covered separately (src/server/pdf.mock-clearance.test.ts), which asserts the
 * artifacts are only rendered with the visible "MOCK SANDBOX — NOT NRS CLEARED"
 * label. This pins the message itself. */

const mockedInvoice = {
	id: "invoice-a",
	token: "public-token",
	invoiceNumber: "INV-2026-1",
	customerName: "Buyer Ltd",
	documentType: "standard",
	fiscalization: {
		status: "mock_cleared",
		provider: "mock",
		environment: "sandbox",
		mock: true,
		mockIrn: "MOCK-IRN-demo-1",
		qrCodePayload: "MOCK-SANDBOX|NOT-NRS-CLEARED|IRN=MOCK-IRN-demo-1",
	},
};

describe("invoice email body has no mock clearance artifacts", () => {
	it("never puts a mock IRN or mock QR payload in the message", async () => {
		await sendInvoiceWithResend(
			mockedInvoice as never,
			"buyer@example.com",
			"invoice_share",
		);

		const message = send.mock.calls[0]?.[0] as {
			html: string;
			text: string;
			attachments: Array<{ content: unknown }>;
		};
		expect(message.html).not.toContain("MOCK-IRN");
		expect(message.text).not.toContain("MOCK-IRN");
		expect(message.html).not.toContain("MOCK-SANDBOX");
		expect(message.text).not.toContain("MOCK-SANDBOX");
		// The stamped PDF is still attached for the customer.
		expect(message.attachments).toHaveLength(1);
	});

	it("still sends the public invoice link", async () => {
		send.mockClear();
		await sendInvoiceWithResend(
			mockedInvoice as never,
			"buyer@example.com",
			"invoice_share",
		);
		const message = send.mock.calls[0]?.[0] as { html: string; text: string };
		expect(message.html).toContain("https://invoicly.cv/i/public-token");
		expect(message.text).toContain("https://invoicly.cv/i/public-token");
	});
});
