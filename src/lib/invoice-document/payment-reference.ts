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

/**
 * Statuses where a payment reference must not print: settled (`paid`/
 * `canceled`) documents are closed, and a `draft` is not payable yet, so a
 * payer has nothing to narrate against. `scheduled` prints as `draft` (the
 * adapters map it before calling), so it is covered by `draft`.
 */
const NON_PAYABLE_REFERENCE_STATUSES = new Set<Invoice["status"]>([
	"draft",
	"paid",
	"canceled",
]);

/**
 * Resolves the payment reference to print, or `null` when there is nothing to
 * show. Returns `null` for a missing/blank invoice number, and for an invoice
 * that is a draft or already settled (`paid`/`canceled`) so a reference never
 * appears on a document nobody can pay. Both renderers call this so the HTML
 * and PDF cannot drift.
 */
export function getInvoicePaymentReference(
	invoice: Pick<Invoice, "invoiceNumber" | "status">,
): InvoicePaymentReference | null {
	const value = invoice.invoiceNumber?.trim();
	if (!value) return null;
	if (NON_PAYABLE_REFERENCE_STATUSES.has(invoice.status)) return null;
	return { label: DEFAULT_PAYMENT_REFERENCE_LABEL, value };
}
