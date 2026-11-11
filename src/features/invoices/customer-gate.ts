/**
 * B2 — customer required to leave Draft.
 *
 * Spec: docs/e-invoicing/SPEC.md §3.1 P3 ("a buyer-less invoice cannot be
 * submitted"), §5.B row B2 ("customer required to send; drafts may be
 * buyer-less"), §6.2 item 7.
 *
 * Pure transition matrix. The server write paths (createDraft finalize,
 * updateStatus, markInvoiceSent, convertProformaToInvoice) call
 * `transitionLeavesDraft` with the derived status of the invoice before and
 * after the change; when it returns true they additionally require a linked
 * customer record (`invoices.customer_id` resolving inside the caller's
 * workspace — see `assertCustomerForIssueTransition` in
 * src/server/data/invoices.ts). A free-text customer name does NOT satisfy
 * the gate: only a saved client record does.
 */

import type { InvoiceStatus, VatCategory } from "./types";

export const CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE =
	"A customer is required before an invoice can leave Draft. Select or create a client first.";

export const INVOICE_LINE_CLASSIFICATION_REQUIRED_MESSAGE =
	"Each invoice line needs a unit, VAT category, and goods/service code before leaving Draft.";

/**
 * VAT categories the persisted line snapshot accepts (SPEC §5.B B3).
 *
 * Shared with the composer: the fields this gate demands have to be reachable
 * in the form that triggers it. They were not for a seller whose tax treatment
 * applies no VAT (the composer hid the row behind `isVatEnabled`) while the
 * server demanded them for every line, which left the user with a rejection
 * they could not act on.
 */
export const LINE_VAT_CATEGORIES: ReadonlySet<string> = new Set([
	"standard",
	"zero_rated",
	"exempt",
]);

type LineClassificationFields = {
	unit?: string;
	vatCategory?: VatCategory | string;
	classificationCode?: string;
};

/**
 * True when a line is missing the structured classification the leave-Draft
 * gate requires, whatever the invoice's tax treatment. Single source of truth
 * for the composer's Submit blocker and the server's gate.
 */
export function lineMissingClassification(
	item: LineClassificationFields,
): boolean {
	return (
		!item.unit?.trim() ||
		!LINE_VAT_CATEGORIES.has(item.vatCategory ?? "") ||
		!item.classificationCode?.trim()
	);
}

/**
 * B2 companion rule (audit round-2): the gate makes the buyer link load
 * bearing, so an ISSUED invoice may swap its customer but never lose it.
 * `save()` patches `customer_id` straight from its input and the
 * details-sheet payload omits `customerId` entirely, which used to write
 * NULL behind the gate; the server now threads the stored id and refuses an
 * explicit clear (null / blank) on any non-Draft invoice.
 */
export const CUSTOMER_LINK_CLEARED_ON_ISSUED_MESSAGE =
	"A customer link cannot be removed from an issued invoice. Select a different client instead.";

/**
 * True when a transition moves an invoice out of Draft into any state other
 * than canceled. Canceling a draft is a soft discard, not an issuance, so it
 * stays customer-less; every other exit from Draft (ready/unpaid/overdue/
 * paid/scheduled) issues the invoice to a buyer and requires a customer
 * record.
 */
export function transitionLeavesDraft(
	from: InvoiceStatus,
	to: InvoiceStatus,
): boolean {
	if (from !== "draft") return false;
	return to !== "draft" && to !== "canceled";
}
