import type {
	Invoice as MiddayInvoice,
	Template,
} from "#/lib/midday-invoice/types";
import { normalizeCurrencyCode, resolveCurrencyLocale } from "./format";
import type { InvoiceRecord } from "./types";

type EditorDoc = {
	type: "doc";
	content: Array<{
		type: "paragraph";
		content: Array<{ type: "text"; text: string }>;
	}>;
};

function toEditorDoc(text: string | null | undefined): EditorDoc | null {
	if (!text || text.trim().length === 0) return null;

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

function amountFromLineItems(invoice: InvoiceRecord) {
	return invoice.lineItems.reduce(
		(sum, item) => sum + item.quantity * item.price,
		0,
	);
}

function buildTemplate(invoice: InvoiceRecord): Template {
	const templateSize = invoice.invoiceSize === "LETTER" ? "letter" : "a4";
	const dateFormat = invoice.dateFormat === "us" ? "MM/dd/yyyy" : "yyyy-MM-dd";
	const currency = normalizeCurrencyCode(invoice.currency);

	return {
		customerLabel: "To",
		title: "Invoice",
		fromLabel: "From",
		invoiceNoLabel: "Invoice No",
		issueDateLabel: "Issue Date",
		dueDateLabel: "Due Date",
		descriptionLabel: "Description",
		priceLabel: "Price",
		quantityLabel: "Quantity",
		totalLabel: "Total",
		totalSummaryLabel: "Total",
		vatLabel: "VAT",
		subtotalLabel: "Subtotal",
		taxLabel: "Tax",
		discountLabel: "Discount",
		timezone: "UTC",
		paymentLabel: "Payment Details",
		noteLabel: "Note",
		logoUrl: invoice.logoUrl?.trim() ? invoice.logoUrl.trim() : null,
		currency,
		paymentDetails: toEditorDoc(invoice.paymentDetails),
		fromDetails: toEditorDoc(
			"Invoice Gen\n123 Main St\nhello@invoice-gen.local",
		),
		noteDetails: null,
		dateFormat,
		includeVat: false,
		includeTax: false,
		includeDiscount: false,
		includeDecimals: true,
		includeUnits: false,
		includeQr: false,
		taxRate: 0,
		vatRate: 0,
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
	const amount = amountFromLineItems(invoice);
	const customerName = invoice.customerName || null;

	return {
		id: invoice.id,
		dueDate: invoice.dueDate,
		invoiceNumber: invoice.invoiceNumber,
		createdAt: new Date().toISOString(),
		amount,
		currency: normalizeCurrencyCode(invoice.currency),
		lineItems: invoice.lineItems,
		paymentDetails: template.paymentDetails,
		customerDetails: toEditorDoc(invoice.customerName || "Untitled customer"),
		reminderSentAt: null,
		updatedAt: null,
		note: null,
		internalNote: null,
		paidAt: null,
		vat: null,
		tax: null,
		filePath: null,
		status: invoice.status,
		viewedAt: null,
		fromDetails: template.fromDetails,
		issueDate: invoice.issueDate,
		sentAt: null,
		template,
		noteDetails: toEditorDoc(invoice.notes),
		customerName,
		token: invoice.token,
		sentTo: null,
		discount: null,
		topBlock: null,
		bottomBlock: null,
		customer: {
			name: customerName,
			website: null,
			email: null,
		},
		customerId: null,
		team: {
			name: "Invoice Gen",
		},
	};
}
