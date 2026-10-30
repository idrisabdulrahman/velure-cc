import type { Invoice } from "./types";

/**
 * Printed payment reference for an invoice: the invoice number, so a payer
 * transferring into the workspace's own bank account can put a unique,
 * matcher-friendly value in the narration. Same convention as the manually
 * recorded `paymentReference` field the user types when reconciling.
 */
export const DEFAULT_PAYMENT_REFERENCE_LABEL = "Payment reference";

export type InvoicePaymentReference = {
	label: string;
	value: string;
};

/** Statuses where the invoice no longer needs paying. */
const SETTLED_STATUSES = new Set<Invoice["status"]>(["paid", "canceled"]);

/**
 * Resolves the payment reference to print, or `null` when there is nothing to
 * show. Returns `null` for a missing/blank invoice number, and for an invoice
 * that is already settled (`paid`/`canceled`) so a reference never appears on a
 * closed document. Both renderers call this so the HTML and PDF cannot drift.
 */
export function getInvoicePaymentReference(
	invoice: Pick<Invoice, "invoiceNumber" | "status">,
): InvoicePaymentReference | null {
	const value = invoice.invoiceNumber?.trim();
	if (!value) return null;
	if (SETTLED_STATUSES.has(invoice.status)) return null;
	return { label: DEFAULT_PAYMENT_REFERENCE_LABEL, value };
}
