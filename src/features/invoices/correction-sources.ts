import type { InvoiceDocumentType, InvoiceStatus } from "./types";

/**
 * Structural subset of an invoice that decides whether it may be corrected.
 * Both the server invoice row and the editor's invoice view satisfy it.
 */
export type CorrectionSourceCandidate = {
	documentType?: InvoiceDocumentType;
	status?: InvoiceStatus;
	paymentAmount?: number;
	paidAt?: number;
	paymentReference?: string;
	deliveredAt?: number;
	lifecycle?: Record<string, unknown> | null;
};

/**
 * A credit or debit note may only correct a standard invoice that actually
 * left the workspace. Drafts and cancelled documents are not valid sources,
 * and neither is an issued standard invoice that was never delivered, paid,
 * or marked sent in its lifecycle.
 */
export function isCorrectionSource(invoice: CorrectionSourceCandidate) {
	if (invoice.documentType !== "standard") return false;
	if (invoice.status === "draft" || invoice.status === "canceled") return false;
	return Boolean(
		invoice.deliveredAt ||
			invoice.paidAt ||
			invoice.paymentReference ||
			(invoice.paymentAmount ?? 0) > 0 ||
			invoice.lifecycle?.sentAt ||
			invoice.lifecycle?.emailDeliveredAt ||
			invoice.lifecycle?.paymentReceivedAt,
	);
}
