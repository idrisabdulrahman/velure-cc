import {
	INVOICE_DOCUMENT_TYPE_LABELS,
	type InvoiceDocumentType,
} from "#/features/invoices/types";

export type InvoiceShareLinkInput = {
	token: string;
	origin: string;
	invoiceNumber: string;
	customerName: string;
	documentType?: InvoiceDocumentType;
};

export type InvoiceShareLinks = {
	publicUrl: string;
	downloadUrl: string;
	text: string;
	body: string;
	telegramHref: string;
	whatsappHref: string;
};

/**
 * Builds the public invoice URL and click-to-chat share hrefs.
 *
 * Pure and framework-free: callers pass `window.location.origin` (or `""`)
 * themselves. No API and no WhatsApp Business account are involved — the
 * WhatsApp/Telegram hrefs are plain `wa.me`/`t.me` click-to-chat links.
 *
 * The output is intentionally identical to the link-building that previously
 * lived inside `invoice-details-sheet.tsx`, so all share surfaces stay in sync.
 */
export function buildInvoiceShareLinks({
	token,
	origin,
	invoiceNumber,
	customerName,
	documentType,
}: InvoiceShareLinkInput): InvoiceShareLinks {
	const publicUrl = `${origin}/i/${token}`;
	const downloadUrl = `${publicUrl}?download=1`;
	const label = INVOICE_DOCUMENT_TYPE_LABELS[documentType ?? "standard"];
	const text = `${label} ${invoiceNumber} for ${customerName}`;
	const body = `${text}\n\nView & download: ${downloadUrl}`;

	const telegramHref = `https://t.me/share/url?url=${encodeURIComponent(publicUrl)}&text=${encodeURIComponent(body)}`;
	const whatsappHref = `https://wa.me/?text=${encodeURIComponent(body)}`;

	return { publicUrl, downloadUrl, text, body, telegramHref, whatsappHref };
}
