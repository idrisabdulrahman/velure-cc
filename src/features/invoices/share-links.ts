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
	/** Pre-formatted amount due, e.g. "₦666,500". Optional. */
	amountLabel?: string;
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
	amountLabel,
}: InvoiceShareLinkInput): InvoiceShareLinks {
	const publicUrl = `${origin}/i/${token}`;
	const downloadUrl = `${publicUrl}?download=1`;
	const label = INVOICE_DOCUMENT_TYPE_LABELS[documentType ?? "standard"];
	const text = `${label} ${invoiceNumber} for ${customerName}`;
	// A payer reading the message should see what to pay before they tap the
	// link. Optional, so a caller without the value keeps the original
	// two-line message byte-for-byte. The invoice number in `text` is already
	// the payment reference, so it is not repeated.
	const detailLines: string[] = [];
	if (amountLabel) detailLines.push(`Amount: ${amountLabel}`);
	const body = [
		text,
		...detailLines,
		"",
		`View & download: ${downloadUrl}`,
	].join("\n");

	const telegramHref = `https://t.me/share/url?url=${encodeURIComponent(publicUrl)}&text=${encodeURIComponent(body)}`;
	const whatsappHref = `https://wa.me/?text=${encodeURIComponent(body)}`;

	return { publicUrl, downloadUrl, text, body, telegramHref, whatsappHref };
}
