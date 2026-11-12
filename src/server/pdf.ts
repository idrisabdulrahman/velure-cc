import { toInvoiceDocument } from "#/features/invoices/invoice-document-adapter";
import { getInvoicePaymentReference } from "#/lib/invoice-document/payment-reference";
import type { Invoice } from "./invoice-repository";

/**
 * The renderer is loaded on first use, never at module scope.
 *
 * `@react-pdf/renderer` reaches `@react-pdf/pdfkit`, which evaluates
 * `new URL("./data/sRGB_IEC61966_2_1.icc", import.meta.url)` while its module is
 * being initialised, and it needs the yoga WASM layout engine to lay a document
 * out. Static imports pull that evaluation into the server entry's own startup,
 * where `import.meta.url` is not a URL, so a single bad PDF dependency fails
 * every route with "Invalid URL string." (observed on the Workers deployment).
 * Loading it inside `renderInvoicePdf` keeps the Node-only failure on the PDF
 * path, where `renderFallbackPdf` already handles it.
 */
async function loadPdfRenderer() {
	const [renderer, template] = await Promise.all([
		import("@react-pdf/renderer"),
		import("#/lib/invoice-document/templates/pdf"),
	]);
	return {
		renderToBuffer: renderer.renderToBuffer,
		PdfTemplate: template.PdfTemplate,
	};
}

type PdfRenderer = Awaited<ReturnType<typeof loadPdfRenderer>>;

let pdfRendererPromise: Promise<PdfRenderer> | null = null;

function getPdfRenderer(): Promise<PdfRenderer> {
	if (!pdfRendererPromise) {
		pdfRendererPromise = loadPdfRenderer().catch((error: unknown) => {
			// Do not cache a rejected import: the next request retries it, and the
			// caller still gets the fallback PDF in the meantime.
			pdfRendererPromise = null;
			throw error;
		});
	}
	return pdfRendererPromise;
}

function escapePdfText(value: string) {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/\(/g, "\\(")
		.replace(/\)/g, "\\)");
}

/** Rows a single A4/letter page holds at the fallback's fixed 18pt leading. */
const FALLBACK_PDF_ROWS_PER_PAGE = 42;

function renderFallbackPdf(invoice: Invoice): Uint8Array {
	const seller = invoice.compliance?.seller;
	const buyer = invoice.compliance?.buyer;
	const sellerName =
		seller?.legalName?.trim() || seller?.tradingName?.trim() || "Invoicly";
	const tradingName = seller?.tradingName?.trim();

	const rows: string[] = [`Invoice ${invoice.invoiceNumber}`];

	// Seller identity (brand) — mirrors the HTML "From" block so a Worker
	// fallback download is not a bare list of numbers.
	rows.push("");
	rows.push(`From: ${sellerName}`);
	if (tradingName && tradingName !== sellerName) {
		rows.push(`Trading as: ${tradingName}`);
	}
	if (seller?.address?.trim()) rows.push(seller.address.trim());
	if (seller?.email?.trim()) rows.push(seller.email.trim());
	if (seller?.phone?.trim()) rows.push(seller.phone.trim());
	if (seller?.taxId?.trim()) rows.push(`Seller TIN: ${seller.taxId.trim()}`);
	if (seller?.rcNumber?.trim())
		rows.push(`CAC RC Number: ${seller.rcNumber.trim()}`);

	// Buyer identity, including the reminders email the HTML "To" block shows.
	rows.push("");
	rows.push(`To: ${invoice.customerName || "Untitled customer"}`);
	if (buyer?.email?.trim()) rows.push(buyer.email.trim());
	if (buyer?.phone?.trim()) rows.push(buyer.phone.trim());
	if (buyer?.taxId?.trim()) rows.push(`Buyer TIN: ${buyer.taxId.trim()}`);

	rows.push("");
	rows.push(`Status: ${invoice.status}`);
	if (invoice.customerPoNumber) {
		rows.push(`Customer PO: ${invoice.customerPoNumber}`);
	}
	rows.push(`Issue Date: ${invoice.issueDate}`);
	rows.push(`Due Date: ${invoice.dueDate}`);
	if (invoice.template?.trim())
		rows.push(`Template: ${invoice.template.trim()}`);

	rows.push("");
	rows.push("Line Items:");
	for (const item of invoice.lineItems) {
		const total = item.quantity * item.price;
		rows.push(
			`- ${item.name || "Untitled item"} | qty ${item.quantity} | price ${item.price.toFixed(2)} | total ${total.toFixed(2)}`,
		);
	}

	const subtotal =
		invoice.compliance?.subtotal ??
		invoice.lineItems.reduce(
			(sum, item) => sum + item.quantity * item.price,
			0,
		);
	const vat = invoice.compliance?.totalTax ?? 0;
	const wht = invoice.compliance?.withholdingTaxAmount ?? 0;
	const grandTotal = invoice.compliance?.grandTotal ?? subtotal + vat;
	const netPayable = grandTotal - wht;

	rows.push("");
	rows.push(`Subtotal: ${subtotal.toFixed(2)} ${invoice.currency}`);
	if (vat > 0) rows.push(`VAT: ${vat.toFixed(2)} ${invoice.currency}`);
	if (wht > 0)
		rows.push(`WHT deduction: ${wht.toFixed(2)} ${invoice.currency}`);
	rows.push(`Total: ${grandTotal.toFixed(2)} ${invoice.currency}`);
	rows.push(`Net payable: ${netPayable.toFixed(2)} ${invoice.currency}`);

	// Same reference convention the HTML renderer prints, so a payer can use it
	// in a transfer narration. `scheduled` prints as `draft` (the adapters map
	// it that way), so a scheduled draft does not print a reference either.
	const referenceStatus =
		invoice.status === "scheduled" ? "draft" : invoice.status;
	const paymentReference = getInvoicePaymentReference({
		invoiceNumber: invoice.invoiceNumber,
		status: referenceStatus,
	});
	if (paymentReference) {
		rows.push(`${paymentReference.label}: ${paymentReference.value}`);
	}

	const fiscalization = invoice.fiscalization;
	if (
		fiscalization?.status === "mock_cleared" &&
		fiscalization.mock === true &&
		fiscalization.provider === "mock" &&
		fiscalization.environment === "sandbox" &&
		typeof fiscalization.mockIrn === "string" &&
		fiscalization.mockIrn.startsWith("MOCK-IRN-") &&
		typeof fiscalization.qrCodePayload === "string" &&
		fiscalization.qrCodePayload.startsWith("MOCK-SANDBOX|NOT-NRS-CLEARED|")
	) {
		rows.push("MOCK SANDBOX — NOT NRS CLEARED");
		rows.push(`Mock IRN: ${fiscalization.mockIrn}`);
		rows.push(`Mock QR payload: ${fiscalization.qrCodePayload}`);
	}
	if (invoice.notes) rows.push(`Notes: ${invoice.notes}`);

	// Paginate so the richer header cannot push totals off a single page.
	const pages: string[][] = [];
	for (let i = 0; i < rows.length; i += FALLBACK_PDF_ROWS_PER_PAGE) {
		pages.push(rows.slice(i, i + FALLBACK_PDF_ROWS_PER_PAGE));
	}
	if (pages.length === 0) pages.push([""]);

	const fontObjectNumber = 3;
	const kidRefs = pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ");

	const objects: Array<{ num: number; body: string }> = [];
	objects.push({
		num: 1,
		body: "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
	});
	objects.push({
		num: 2,
		body: `2 0 obj << /Type /Pages /Kids [${kidRefs}] /Count ${pages.length} >> endobj`,
	});
	objects.push({
		num: fontObjectNumber,
		body: `3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj`,
	});

	pages.forEach((pageRows, index) => {
		const pageObjectNumber = 4 + index * 2;
		const contentObjectNumber = pageObjectNumber + 1;
		const textOps = pageRows
			.map((line, rowIndex) => {
				const y = 800 - rowIndex * 18;
				return `BT /F1 12 Tf 50 ${y} Td (${escapePdfText(line)}) Tj ET`;
			})
			.join("\n");
		const stream = `${textOps}\n`;
		const streamLength = Buffer.byteLength(stream, "utf8");
		objects.push({
			num: pageObjectNumber,
			body: `${pageObjectNumber} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${fontObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >> endobj`,
		});
		objects.push({
			num: contentObjectNumber,
			body: `${contentObjectNumber} 0 obj << /Length ${streamLength} >> stream\n${stream}endstream endobj`,
		});
	});

	objects.sort((a, b) => a.num - b.num);

	let body = "";
	const offsets = new Map<number, number>();
	for (const object of objects) {
		offsets.set(object.num, Buffer.byteLength(body, "utf8"));
		body += `${object.body}\n`;
	}

	const maxObjectNumber = objects[objects.length - 1]?.num ?? 0;
	const xrefStart = Buffer.byteLength(`%PDF-1.4\n${body}`, "utf8");
	const xrefRows = ["xref", `0 ${maxObjectNumber + 1}`, "0000000000 65535 f "];
	for (let num = 1; num <= maxObjectNumber; num++) {
		const offset = offsets.get(num);
		if (offset === undefined) {
			xrefRows.push("0000000000 00000 f ");
			continue;
		}
		const absolute = offset + Buffer.byteLength("%PDF-1.4\n", "utf8");
		xrefRows.push(`${String(absolute).padStart(10, "0")} 00000 n `);
	}

	const trailer = [
		"trailer",
		`<< /Size ${maxObjectNumber + 1} /Root 1 0 R >>`,
		"startxref",
		String(xrefStart),
		"%%EOF",
	].join("\n");

	const pdf = `%PDF-1.4\n${body}${xrefRows.join("\n")}\n${trailer}\n`;
	return new Uint8Array(Buffer.from(pdf, "utf8"));
}

export async function renderInvoicePdf(invoice: Invoice): Promise<Uint8Array> {
	try {
		const { PdfTemplate, renderToBuffer } = await getPdfRenderer();
		const document = await PdfTemplate(toInvoiceDocument(invoice));

		const buffer = await renderToBuffer(document);
		return new Uint8Array(buffer);
	} catch (error) {
		console.error(
			"Failed to render invoice PDF template, using fallback PDF.",
			error,
		);
		return renderFallbackPdf(invoice);
	}
}
