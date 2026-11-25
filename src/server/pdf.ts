import { toInvoiceDocument } from "#/features/invoices/invoice-document-adapter";
import type { Invoice } from "./invoice-repository";
import { renderInvoicePdfDocument } from "./pdf-layout";

/**
 * Renders the invoice's customer-facing PDF.
 *
 * The document is drawn with `pdf-lib` in `pdf-layout.ts`: pure JavaScript, the
 * built-in PDF faces, no WASM, no font files and no filesystem, so it runs
 * natively on the Cloudflare Worker. The design mirrors the HTML preview's
 * `print` appearance one-for-one.
 *
 * A rendering failure is thrown to the caller. The download and email paths
 * turn it into a clear, retryable error — the renderer never substitutes a
 * different (plain-text) document behind the customer's back.
 */
export async function renderInvoicePdf(invoice: Invoice): Promise<Uint8Array> {
	return renderInvoicePdfDocument(toInvoiceDocument(invoice));
}
