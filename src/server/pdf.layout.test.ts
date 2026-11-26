import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	decodePDFRawStream,
	PDFDocument,
	PDFHexString,
	PDFRawStream,
	PDFRef,
	StandardFonts,
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

type TextRun = {
	page: number;
	x: number;
	y: number;
	font: "regular" | "bold";
	size: number;
	text: string;
};

/**
 * Every text run on every page with the exact matrix origin (`Tm`), face and
 * point size it is drawn at, so a run's real drawn extent can be measured and
 * not just its origin.
 */
async function extractTextRuns(bytes: Uint8Array): Promise<TextRun[]> {
	const pdf = await PDFDocument.load(bytes);
	const decoder = new TextDecoder("windows-1252");
	const runs: TextRun[] = [];

	pdf.getPages().forEach((page, index) => {
		const contents = page.node.normalizedEntries().Contents;
		if (!contents) return;
		const entries =
			contents instanceof PDFRawStream ? [contents] : contents.asArray();

		for (const entry of entries) {
			const stream =
				entry instanceof PDFRef ? pdf.context.lookup(entry) : entry;
			if (!(stream instanceof PDFRawStream)) continue;
			const content = decoder.decode(decodePDFRawStream(stream).decode());
			// `pdf-lib` wraps each `drawText` in `BT … ET`; a hex `Tj` operand
			// never contains the letters `B`/`T`, so the boundaries are exact.
			for (const block of content.matchAll(/BT([\s\S]*?)ET/g)) {
				const body = block[1] ?? "";
				const tf = /\/(\S+) ([\d.]+) Tf/.exec(body);
				const tm = /([\d.-]+) ([\d.-]+) Tm/.exec(body);
				const hex = /<([0-9A-Fa-f]+)>\s*Tj/.exec(body);
				if (!tf || !tm || !hex) continue;
				const text = decoder.decode(
					Uint8Array.from(
						(hex[1] ?? "")
							.match(/.{2}/g)
							?.map((pair) => Number.parseInt(pair, 16)) ?? [],
					),
				);
				runs.push({
					page: index + 1,
					x: Number(tm[1]),
					y: Number(tm[2]),
					font: /Bold/i.test(tf[1] ?? "") ? "bold" : "regular",
					size: Number(tf[2]),
					text,
				});
			}
		}
	});

	return runs;
}

/** MediaBox dimensions of every page. */
async function pageSizes(bytes: Uint8Array) {
	const pdf = await PDFDocument.load(bytes);
	return pdf.getPages().map((page) => ({
		width: page.getWidth(),
		height: page.getHeight(),
	}));
}

/** The `w 0 0 h 0 0 cm` matrices that place an image (the workspace logo). */
async function imageScales(
	bytes: Uint8Array,
): Promise<Array<[number, number]>> {
	const pdf = await PDFDocument.load(bytes);
	const decoder = new TextDecoder("windows-1252");
	const scales: Array<[number, number]> = [];

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
			for (const match of content.matchAll(/([\d.]+) 0 0 ([\d.]+) 0 0 cm/g)) {
				const width = Number(match[1]);
				const height = Number(match[2]);
				if (width > 1 && height > 1) scales.push([width, height]);
			}
		}
	}

	return scales;
}

function logoDataUrl() {
	const png = readFileSync(
		fileURLToPath(new URL("../../public/icon-192.png", import.meta.url)),
	);
	return `data:image/png;base64,${png.toString("base64")}`;
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

	it("prints on A4 by default and switches to US Letter when selected", async () => {
		const a4 = await pageSizes(
			await renderInvoicePdfDocument(await render(buildIssuedInvoice())),
		);
		expect(a4[0]?.width).toBeCloseTo(595.28, 1);
		expect(a4[0]?.height).toBeCloseTo(841.89, 1);

		const letter = await pageSizes(
			await renderInvoicePdfDocument(
				await render(buildIssuedInvoice({ invoiceSize: "LETTER" })),
			),
		);
		expect(letter[0]?.width).toBeCloseTo(612, 1);
		expect(letter[0]?.height).toBeCloseTo(792, 1);
	});

	it("keeps every drawn line inside the page margins", async () => {
		const bytes = await renderInvoicePdfDocument(
			await render(buildIssuedInvoice()),
		);
		const runs = await extractTextRuns(bytes);
		expect(runs.length).toBeGreaterThan(20);

		// The renderer uses the standard Helvetica faces, so their metrics
		// reproduce the drawn width of every run exactly.
		const scratch = await PDFDocument.create();
		const fonts = {
			regular: await scratch.embedFont(StandardFonts.Helvetica),
			bold: await scratch.embedFont(StandardFonts.HelveticaBold),
		};
		const sizes = await pageSizes(bytes);

		for (const run of runs) {
			const page = sizes[run.page - 1];
			if (!page) throw new Error(`no size for page ${run.page}`);
			const width = fonts[run.font].widthOfTextAtSize(run.text, run.size);
			// `p-8` = 32pt on all four sides, allowing for rounding. Checking
			// the drawn right edge, not just the origin, catches a long
			// right-aligned or unbreakable token overflowing the margin.
			expect(run.x).toBeGreaterThanOrEqual(31.5);
			expect(run.x + width).toBeLessThanOrEqual(page.width - 32 + 0.5);
			expect(run.y).toBeGreaterThanOrEqual(31.5);
			expect(run.y).toBeLessThanOrEqual(page.height - 32 + 1);
		}

		// A right-aligned value must actually reach the right margin, which
		// proves the widths are measured and the bound above is not vacuous.
		const reachesRightEdge = runs.some((run) => {
			const page = sizes[run.page - 1];
			if (!page) return false;
			const width = fonts[run.font].widthOfTextAtSize(run.text, run.size);
			return Math.abs(run.x + width - (page.width - 32)) < 1;
		});
		expect(reachesRightEdge).toBe(true);
	});

	it("never prints the NRS authority label as a seller identity line", async () => {
		const bytes = await renderInvoicePdfDocument(
			await render(buildIssuedInvoice()),
		);
		const text = await extractPdfText(bytes);
		expect(text).not.toContain("Nigeria Revenue Service");
		expect(text).not.toContain("NRS");
		// The real seller identity is still there.
		expect(text).toContain("Invoicly Ltd");
		expect(text).toContain("TIN: 12345678-0001");
	});

	it("embeds the workspace logo at a bounded size", async () => {
		const bytes = await renderInvoicePdfDocument(
			await render(buildIssuedInvoice({ logoUrl: logoDataUrl() })),
		);
		const scales = await imageScales(bytes);
		expect(scales.length).toBe(1);
		const [width, height] = scales[0] ?? [0, 0];
		// The 192×192 source is scaled to fit the 80pt height cap.
		expect(width).toBeLessThanOrEqual(80.5);
		expect(height).toBeLessThanOrEqual(80.5);
		expect(width).toBeGreaterThan(40);
		expect(height).toBeGreaterThan(40);
	});

	it("skips a logo whose format the PDF cannot embed", async () => {
		const bytes = await renderInvoicePdfDocument(
			await render(
				buildIssuedInvoice({
					logoUrl:
						"data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoB",
				}),
			),
		);
		expect(await imageScales(bytes)).toEqual([]);
		// The rest of the invoice still renders.
		expect(await extractPdfText(bytes)).toContain("Invoicly Ltd");
	});
});
