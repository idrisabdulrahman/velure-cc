import {
	decodePDFRawStream,
	PDFDocument,
	PDFHexString,
	PDFRawStream,
	PDFRef,
} from "pdf-lib";
import { describe, expect, it } from "vitest";
import { toInvoiceDocument } from "#/features/invoices/invoice-document-adapter";
import type { InvoiceRecord } from "#/features/invoices/types";
import type { Invoice } from "#/lib/invoice-document/types";
import { renderInvoicePdfDocument } from "./pdf-layout";

/**
 * Layout-parity checks for the vector PDF.
 *
 * The text is read back from the generated content streams, not from a
 * snapshot: every page is inflated, every `Tj` operand is decoded with the
 * face's WinAnsi encoding, and the Naira sign is read from the `/ActualText`
 * marked content that `pdf/text.ts` wraps around its outline glyph. That makes
 * the assertions below prove what a reader actually sees.
 */

function buildIssuedInvoice(
	overrides: Partial<InvoiceRecord> = {},
): InvoiceRecord {
	return {
		id: "invoice-1",
		token: "public-token",
		invoiceNumber: "INV-2026-0042",
		customerName: "Acme Services Ltd",
		customerPoNumber: "PO-ACME-42",
		currency: "NGN",
		type: "one-time",
		invoiceSize: "A4",
		dateFormat: "ng",
		paymentTermsDays: 14,
		template: "default",
		issueDate: "2026-06-01",
		dueDate: "2026-06-15",
		status: "partially-paid",
		total: 519_400,
		balance: 200_000,
		paymentAmount: 319_400,
		paymentDetails: "Bank: GTBank\nAccount: 0123456789\nName: Invoicly Ltd",
		lineItems: [
			{
				id: "line-1",
				name: "Website redesign and build",
				quantity: 1,
				price: 530_000,
			},
		],
		compliance: {
			seller: {
				legalName: "Invoicly Ltd",
				tradingName: "Invoicly",
				address: "12 Adeola Odeku Street, Victoria Island, Lagos",
				email: "billing@invoicly.cv",
				phone: "+234 800 000 0000",
				taxId: "12345678-0001",
				countryCode: "NG",
			},
			buyer: {
				legalName: "Acme Services Ltd",
				address: "9 Marina Road, Lagos",
				email: "accounts@acme.example",
				countryCode: "NG",
			},
			sellerTaxStatus: "vat_registered",
			placeOfSupply: "NG",
			taxRuleSetVersion: "test",
			taxTreatment: "none",
			subtotal: 530_000,
			totalTax: 0,
			taxLabel: "VAT",
			taxRate: 0,
			taxLines: [],
			templateVariant: "vat_ready",
			withholdingTaxAmount: 10_600,
			withholdingTaxLabel: "WHT",
			withholdingTaxRate: 2,
			withholdingTaxPreset: "contracts_supplies",
			withholding: {
				mode: "rule_based",
				category: "general_services",
				recipientEntityType: "corporate",
				recipientResidency: "resident",
				rate: 2,
				amount: 10_600,
				ruleVersion: "test",
				manualOverride: false,
			},
			grandTotal: 530_000,
			netPayable: 519_400,
			warnings: [],
		},
		createdAt: Date.parse("2026-06-01T00:00:00.000Z"),
		updatedAt: Date.parse("2026-06-01T00:00:00.000Z"),
		...overrides,
	};
}

/** Every text run on every page, in the order the stream draws them. */
async function extractPdfText(bytes: Uint8Array): Promise<string> {
	const pdf = await PDFDocument.load(bytes);
	const decoder = new TextDecoder("windows-1252");
	const runs: string[] = [];

	for (const page of pdf.getPages()) {
		const contents = page.node.normalizedEntries().Contents;
		if (!contents) continue;
		const entries =
			contents instanceof PDFRawStream ? [contents] : contents.asArray();

		for (const entry of entries) {
			const stream =
				entry instanceof PDFRef ? pdf.context.lookup(entry) : entry;
			if (!(stream instanceof PDFRawStream)) continue;
			const content = decoder.decode(decodePDFRawStream(stream).decode());

			// A single scan keeps the drawing order: a `/ActualText` marked
			// content (the Naira outline glyph) or the hex operand of a `Tj`.
			const token = /\/ActualText\s*<([0-9A-Fa-f]+)>|<([0-9A-Fa-f]+)>\s*Tj\b/g;
			for (const match of content.matchAll(token)) {
				if (match[1] !== undefined) {
					runs.push(PDFHexString.of(match[1]).decodeText());
					continue;
				}
				const hex = match[2] ?? "";
				runs.push(
					decoder.decode(
						Uint8Array.from(
							hex.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ??
								[],
						),
					),
				);
			}
		}
	}

	return runs.join("");
}

async function render(record: InvoiceRecord): Promise<Invoice> {
	return toInvoiceDocument(record);
}

describe("invoice PDF layout", () => {
	it("prints the preview's header, parties, table, totals and payment details", async () => {
		const bytes = await renderInvoicePdfDocument(
			await render(buildIssuedInvoice()),
		);
		const text = await extractPdfText(bytes);

		// Header + meta block.
		expect(text).toContain("Standard invoice");
		expect(text).toContain("Standard invoice No:");
		expect(text).toContain("INV-2026-0042");
		expect(text).toContain("Customer PO:");
		expect(text).toContain("PO-ACME-42");
		expect(text).toContain("01/06/2026");
		expect(text).toContain("15/06/2026");

		// From / To.
		expect(text).toContain("From");
		expect(text).toContain("To");
		expect(text).toContain("Invoicly Ltd");
		expect(text).toContain("Acme Services Ltd");

		// Line-item table headers and the row itself.
		expect(text).toContain("Description");
		expect(text).toContain("Quantity");
		expect(text).toContain("Price");
		expect(text).toContain("Total");
		expect(text).toContain("Website redesign and build");

		// Totals hierarchy, with the WHT shown as a negative deduction.
		expect(text).toContain("Subtotal");
		expect(text).toContain("WHT (2%)");
		expect(text).toContain("Net Amount Payable");

		// Money uses the Naira sign and the preview's 2-decimal format.
		expect(text).toContain("₦530,000.00");
		expect(text).toContain("₦10,600.00");
		expect(text).toContain("-₦10,600.00");
		expect(text).toContain("₦519,400.00");

		// Payment block for an issued invoice.
		expect(text).toContain("Payment Details");
		expect(text).toContain("GTBank");
		expect(text).toContain("Payment reference:");
		expect(text).toContain("INV-2026-0042");
	});

	it("omits payment instructions and the reference from a draft", async () => {
		const bytes = await renderInvoicePdfDocument(
			await render(buildIssuedInvoice({ status: "draft" })),
		);
		const text = await extractPdfText(bytes);

		expect(text).toContain("Standard invoice No:");
		expect(text).not.toContain("Payment Details");
		expect(text).not.toContain("GTBank");
		expect(text).not.toContain("Payment reference:");
	});

	it("paginates long invoices without losing the totals", async () => {
		const longName = Array.from(
			{ length: 40 },
			(_, index) => `Deliverable ${index + 1} with a detailed description`,
		).join(" ");
		const bytes = await renderInvoicePdfDocument(
			await render(
				buildIssuedInvoice({
					lineItems: [
						{
							id: "line-1",
							name: longName,
							quantity: 1,
							price: 530_000,
						},
					],
				}),
			),
		);

		const pdf = await PDFDocument.load(bytes);
		expect(pdf.getPageCount()).toBeGreaterThan(1);

		const text = await extractPdfText(bytes);
		expect(text).toContain("Net Amount Payable");
		expect(text).toContain("₦519,400.00");
	});
});
