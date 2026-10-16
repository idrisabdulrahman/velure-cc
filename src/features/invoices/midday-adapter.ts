import { calculateInvoiceCompliance } from "#/features/compliance/calculate";
import { NIGERIA_AUTHORITY_LABEL } from "#/features/compliance/nigeria";
import type {
	EditorDoc,
	EditorNode,
	Invoice as MiddayInvoice,
	Template,
} from "#/lib/midday-invoice/types";
import { normalizeCurrencyCode, resolveCurrencyLocale } from "./format";
import type { InvoiceRecord } from "./types";

export function toEditorDoc(
	text: string | EditorDoc | null | undefined,
): EditorDoc | null {
	if (!text) return null;
	if (typeof text === "object") {
		return text.content?.length ? text : null;
	}
	if (text.trim().length === 0) return null;

	const paragraphs = text
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0);

	if (paragraphs.length === 0) return null;

	return {
		type: "doc",
		content: paragraphs.map((line) => ({
			type: "paragraph",
			content: [{ type: "text", text: line }],
		})),
	};
}

export function mergeDocBlocks(docs: Array<EditorDoc | null | undefined>) {
	const blocks: EditorNode[] = [];
	for (const doc of docs) {
		if (doc) blocks.push(...doc.content);
	}
	return blocks.length ? { type: "doc" as const, content: blocks } : null;
}

function amountFromLineItems(invoice: InvoiceRecord) {
	return invoice.lineItems.reduce(
		(sum, item) => sum + item.quantity * item.price,
		0,
	);
}

function buildIdentityDoc(lines: Array<string | null | undefined>) {
	return toEditorDoc(
		lines
			.map((line) => line?.trim())
			.filter((line): line is string => Boolean(line && line.length > 0))
			.join("\n"),
	);
}

function buildTemplate(invoice: InvoiceRecord): Template {
	const isProforma = invoice.documentType === "proforma";
	const templateSize = invoice.invoiceSize === "LETTER" ? "letter" : "a4";
	const dateFormat =
		invoice.dateFormat === "us"
			? "MM/dd/yyyy"
			: invoice.dateFormat === "ng"
				? "dd/MM/yyyy"
				: "yyyy-MM-dd";
	const currency = normalizeCurrencyCode(invoice.currency);
	const compliance =
		invoice.compliance ??
		calculateInvoiceCompliance({
			seller: { legalName: "Velure", countryCode: "NG" },
			buyer: {
				legalName: invoice.customerName,
				countryCode: "NG",
			},
			currency: invoice.currency,
			lineItems: invoice.lineItems,
		});

	const settings = invoice.templateSettings ?? {};
	return {
		customerLabel: settings.customerLabel ?? "To",
		title: settings.title ?? (isProforma ? "Pro-forma Invoice" : "Invoice"),
		fromLabel: settings.fromLabel ?? "From",
		invoiceNoLabel:
			settings.invoiceNoLabel ?? (isProforma ? "Pro-forma No" : "Invoice No"),
		issueDateLabel: settings.issueDateLabel ?? "Issue Date",
		dueDateLabel: settings.dueDateLabel ?? "Due Date",
		descriptionLabel: settings.descriptionLabel ?? "Description",
		priceLabel: settings.priceLabel ?? "Price",
		quantityLabel: settings.quantityLabel ?? "Quantity",
		totalLabel: settings.totalLabel ?? "Total",
		totalSummaryLabel: settings.totalSummaryLabel ?? "Total",
		vatLabel: "VAT",
		subtotalLabel: settings.subtotalLabel ?? "Subtotal",
		taxLabel: "Tax",
		discountLabel: settings.discountLabel ?? "Discount",
		withholdingTaxLabel: compliance.withholdingTaxLabel,
		netAmountLabel:
			compliance.withholding.category === "none"
				? "Amount Payable"
				: "Net Amount Payable",
		timezone: "UTC",
		paymentLabel:
			settings.paymentLabel ??
			(isProforma ? "Deposit / Payment Details" : "Payment Details"),
		noteLabel: settings.noteLabel ?? "Note",
		logoUrl: invoice.logoUrl?.trim() ? invoice.logoUrl.trim() : null,
		currency,
		paymentDetails: toEditorDoc(invoice.paymentDetails),
		fromDetails: buildIdentityDoc([
			compliance.seller.legalName ?? compliance.seller.tradingName ?? "Velure",
			compliance.seller.address,
			compliance.seller.email,
			compliance.seller.phone,
			compliance.seller.taxId ? `TIN: ${compliance.seller.taxId}` : undefined,
			compliance.seller.rcNumber
				? `CAC RC Number: ${compliance.seller.rcNumber}`
				: undefined,
			NIGERIA_AUTHORITY_LABEL,
		]),
		noteDetails: null,
		dateFormat,
		includeVat:
			compliance.taxLabel.toUpperCase() === "VAT" &&
			compliance.taxLines.length > 0,
		includeTax:
			compliance.taxLabel.toUpperCase() !== "VAT" &&
			compliance.taxLines.length > 0,
		includeDiscount: settings.includeDiscount ?? false,
		includeDecimals: settings.includeDecimals ?? true,
		includeUnits: settings.includeUnits ?? false,
		includeQr: settings.includeQr ?? false,
		taxRate:
			compliance.taxLabel.toUpperCase() === "VAT" ? 0 : compliance.taxRate,
		vatRate:
			compliance.taxLabel.toUpperCase() === "VAT" ? compliance.taxRate : 0,
		withholdingTaxRate: compliance.withholdingTaxRate,
		size: templateSize,
		deliveryType: "create",
		locale: resolveCurrencyLocale(currency),
	};
}

export function getInvoiceTemplateSize(template: Template) {
	if (template.size === "letter") {
		return { width: 750, height: 1056 };
	}

	return { width: 595, height: 842 };
}

export function toMiddayInvoice(invoice: InvoiceRecord): MiddayInvoice {
	const template = buildTemplate(invoice);
	const compliance =
		invoice.compliance ??
		calculateInvoiceCompliance({
			seller: { legalName: "Velure", countryCode: "NG" },
			buyer: {
				legalName: invoice.customerName,
				countryCode: "NG",
			},
			currency: invoice.currency,
			lineItems: invoice.lineItems,
		});
	const amount = compliance.grandTotal || amountFromLineItems(invoice);
	const netPayable = amount - (compliance.withholdingTaxAmount || 0);
	const customerName = invoice.customerName || null;
	const shipmentLines = invoice.shipmentDetails
		? [
				invoice.shipmentDetails.weight
					? `Weight: ${invoice.shipmentDetails.weight}`
					: null,
				invoice.shipmentDetails.packageCount
					? `Packages: ${invoice.shipmentDetails.packageCount}`
					: null,
				invoice.shipmentDetails.hsCode
					? `HS code: ${invoice.shipmentDetails.hsCode}`
					: null,
				invoice.shipmentDetails.incoterms
					? `Incoterms: ${invoice.shipmentDetails.incoterms}`
					: null,
				invoice.shipmentDetails.portOfLoading
					? `Port of loading: ${invoice.shipmentDetails.portOfLoading}`
					: null,
				invoice.shipmentDetails.portOfDischarge
					? `Port of discharge: ${invoice.shipmentDetails.portOfDischarge}`
					: null,
			].filter(Boolean)
		: [];
	const depositLine = invoice.depositRequest
		? `Deposit requested: ${
				invoice.depositRequest.kind === "percentage"
					? `${invoice.depositRequest.value}%`
					: `${invoice.currency} ${invoice.depositRequest.value}`
			}${invoice.depositRequest.dueDate ? ` by ${invoice.depositRequest.dueDate}` : ""}`
		: null;

	return {
		id: invoice.id,
		dueDate: invoice.dueDate,
		invoiceNumber: invoice.invoiceNumber,
		customerPoNumber: invoice.customerPoNumber ?? null,
		createdAt: new Date().toISOString(),
		amount,
		currency: normalizeCurrencyCode(invoice.currency),
		lineItems: invoice.lineItems,
		paymentDetails: template.paymentDetails,
		customerDetails: buildIdentityDoc([
			invoice.customerName || "Untitled customer",
			compliance.buyer.email,
			compliance.buyer.phone,
			compliance.buyer.taxId
				? `Buyer TIN: ${compliance.buyer.taxId}`
				: undefined,
		]),
		reminderSentAt: null,
		updatedAt: null,
		note: null,
		internalNote: null,
		paidAt: invoice.paidAt
			? new Date(invoice.paidAt).toISOString()
			: invoice.reminder?.paidAt
				? new Date(invoice.reminder.paidAt).toISOString()
				: null,
		vat: template.includeVat ? compliance.totalTax : null,
		tax: template.includeTax ? compliance.totalTax : null,
		withholdingTax: compliance.withholdingTaxAmount || null,
		netPayable,
		regulatoryNotice: compliance.regulatoryNotice ?? null,
		filePath: null,
		status: invoice.status === "scheduled" ? "draft" : invoice.status,
		viewedAt: null,
		fromDetails: template.fromDetails,
		issueDate: invoice.issueDate,
		sentAt: null,
		template,
		noteDetails: mergeDocBlocks([
			toEditorDoc(
				[
					invoice.documentType === "proforma"
						? "Pro-forma invoice - not a final tax invoice until converted."
						: null,
					depositLine,
					shipmentLines.length > 0 ? shipmentLines.join("\n") : null,
				]
					.filter(Boolean)
					.join("\n\n"),
			),
			typeof invoice.notes === "string"
				? toEditorDoc(invoice.notes)
				: invoice.notes,
			toEditorDoc(compliance.regulatoryNotice),
		]),
		customerName,
		token: invoice.token,
		sentTo: null,
		discount: invoice.templateSettings?.discount ?? null,
		topBlock: invoice.topBlock ?? null,
		bottomBlock: invoice.bottomBlock ?? null,
		customer: {
			name: customerName,
			website: null,
			email: null,
		},
		customerId: null,
		team: {
			name: "Velure",
		},
	};
}
