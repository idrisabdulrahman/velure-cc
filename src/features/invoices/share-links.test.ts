import { describe, expect, it } from "vitest";
import { buildInvoiceShareLinks } from "./share-links";

const base = {
	token: "tok_abc123",
	origin: "https://velure.app",
	invoiceNumber: "INV-0001",
	customerName: "Ada Lovelace",
	documentType: "standard" as const,
};

describe("buildInvoiceShareLinks", () => {
	it("builds the public URL and the ?download=1 body link", () => {
		const links = buildInvoiceShareLinks(base);

		expect(links.publicUrl).toBe("https://velure.app/i/tok_abc123");
		expect(links.downloadUrl).toBe(
			"https://velure.app/i/tok_abc123?download=1",
		);
		expect(links.body).toBe(
			"Standard invoice INV-0001 for Ada Lovelace\n\nView & download: https://velure.app/i/tok_abc123?download=1",
		);
	});

	it("uses the standard document-type label by default", () => {
		const links = buildInvoiceShareLinks({
			...base,
			documentType: undefined,
		});

		expect(links.text).toBe("Standard invoice INV-0001 for Ada Lovelace");
	});

	it("uses the credit-note document-type label", () => {
		const links = buildInvoiceShareLinks({
			...base,
			documentType: "credit_note",
		});

		expect(links.text).toBe("Credit note INV-0001 for Ada Lovelace");
	});

	it("encodes the WhatsApp and Telegram hrefs", () => {
		const links = buildInvoiceShareLinks({
			...base,
			invoiceNumber: "INV 2/3",
			customerName: "Ann & Co #1",
		});

		expect(links.whatsappHref).toBe(
			`https://wa.me/?text=${encodeURIComponent(links.body)}`,
		);
		expect(links.telegramHref).toBe(
			`https://t.me/share/url?url=${encodeURIComponent(links.publicUrl)}&text=${encodeURIComponent(links.body)}`,
		);

		// Special characters must be percent-encoded, never left raw.
		expect(links.whatsappHref).toContain("%26"); // &
		expect(links.whatsappHref).toContain("%23"); // #
		expect(links.whatsappHref).toContain("%2F"); // /
		expect(links.whatsappHref).not.toContain("Ann & Co");
		expect(links.telegramHref).not.toContain("Ann & Co");
	});

	it("percent-encodes the download link inside the message body", () => {
		const links = buildInvoiceShareLinks(base);

		expect(links.whatsappHref).toContain(encodeURIComponent(links.downloadUrl));
		expect(links.telegramHref).toContain(encodeURIComponent(links.downloadUrl));
	});
});
