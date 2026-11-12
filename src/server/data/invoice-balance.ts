import type { InvoiceStatus } from "#/features/invoices/types";

/**
 * WS3 — the ONE collectible-balance authority.
 *
 * Invoices, Clients, Reports and Reminders all read the same rule from here, so
 * "open", "overdue" and "amount due" cannot drift between surfaces:
 *
 * - **Collectible/open balance** = `netPayable − paymentAmount`, floored at 0,
 *   and only for derived statuses in `COLLECTIBLE_STATUSES`
 *   (`unpaid`, `partially-paid`, `overdue`) **and** for collectible document
 *   types (`standard` only). Drafts, scheduled, canceled, pro-formas and
 *   correction documents (credit/debit notes) are never open. Drafts are
 *   reported as a separate figure by each surface.
 * - **Overdue** = collectible balance > 0 AND the due date is past AND there is
 *   delivery evidence (`deliveredAt` / `lifecycle.emailDeliveredAt` /
 *   `lifecycle.sentAt` / `finalizedAt`, plus the guarded `updatedAt` fallback
 *   for a stored status other than `draft`). A never-issued draft is never
 *   overdue.
 * - **Amount basis everywhere** = net payable (WHT deducted), never the gross
 *   `grandTotal`.
 *
 * Pure: no client, no query, no session. Every function is a projection over an
 * already-loaded invoice.
 */

export type CollectibleInvoice = {
	status?: string;
	/**
	 * `documentType` decides whether a document can ever open a collectible
	 * balance. Undefined is treated as `"standard"`.
	 */
	documentType?: string;
	canceledAt?: number;
	scheduledAt?: number;
	scheduleVersion?: unknown;
	dueDate?: string;
	paymentAmount?: number;
	deliveredAt?: number;
	finalizedAt?: number;
	updatedAt?: number;
	lifecycle?: {
		sentAt?: number;
		emailDeliveredAt?: number;
	} | null;
	/**
	 * `compliance` is an opaque Supabase `Json` column, so it is typed `unknown`
	 * here and narrowed below. Only `netPayable` / `grandTotal` /
	 * `withholdingTaxAmount` are read, and only as numbers.
	 */
	compliance?: unknown;
	lineItems?: Array<{ quantity: number; price: number }>;
};

function safeMoney(value: number | undefined): number {
	return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function complianceRecord(value: unknown):
	| {
			netPayable?: unknown;
			grandTotal?: unknown;
			withholdingTaxAmount?: unknown;
	  }
	| undefined {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as {
			netPayable?: unknown;
			grandTotal?: unknown;
			withholdingTaxAmount?: unknown;
		};
	}
	return undefined;
}

function numberOf(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

/**
 * Net payable (WHT deducted) in the invoice's currency, never negative. This is
 * the amount basis for every surface; `grandTotal` is the gross total and must
 * not be used for balances.
 */
export function invoiceNetPayable(invoice: CollectibleInvoice): number {
	const compliance = complianceRecord(invoice.compliance);
	const netPayable = numberOf(compliance?.netPayable);
	if (netPayable !== undefined) {
		return safeMoney(netPayable);
	}
	const grandTotal = numberOf(compliance?.grandTotal);
	if (grandTotal !== undefined) {
		return safeMoney(
			grandTotal - (numberOf(compliance?.withholdingTaxAmount) ?? 0),
		);
	}
	return safeMoney(
		(invoice.lineItems ?? []).reduce(
			(total, item) => total + item.quantity * item.price,
			0,
		),
	);
}

function paymentAmountForInvoice(invoice: CollectibleInvoice): number {
	if (typeof invoice.paymentAmount === "number") {
		return Math.max(0, invoice.paymentAmount);
	}
	// Legacy rows without a stored payment amount: a stored `paid` status is the
	// only payment evidence available.
	return invoice.status === "paid" ? invoiceNetPayable(invoice) : 0;
}

/**
 * True delivery evidence. The `updatedAt` fallback only applies once a row has
 * left the stored `draft` status, so a created-but-unsent draft never reads as
 * delivered. `finalizedAt` is the issue stamp used by the invoice domain.
 */
export function deliveredAtForInvoice(
	invoice: CollectibleInvoice,
): number | undefined {
	return (
		invoice.deliveredAt ??
		invoice.lifecycle?.emailDeliveredAt ??
		invoice.lifecycle?.sentAt ??
		invoice.finalizedAt ??
		(invoice.status && invoice.status !== "draft"
			? invoice.updatedAt
			: undefined)
	);
}

function startOfDay(date: Date): Date {
	const next = new Date(date);
	next.setHours(0, 0, 0, 0);
	return next;
}

function isPastDue(invoice: CollectibleInvoice, now: Date): boolean {
	if (!invoice.dueDate) return false;
	const dueDate = new Date(`${invoice.dueDate}T00:00:00`);
	if (Number.isNaN(dueDate.getTime())) return false;
	return dueDate.getTime() < startOfDay(now).getTime();
}

/** Derived statuses whose remaining balance is collectible. */
export const COLLECTIBLE_STATUSES: ReadonlySet<string> = new Set([
	"unpaid",
	"partially-paid",
	"overdue",
]);

export function isCollectibleStatus(status: string | undefined): boolean {
	return status !== undefined && COLLECTIBLE_STATUSES.has(status);
}

/**
 * Only a standard invoice can open a collectible balance. A pro-forma is a
 * quote (a "sold pro-forma" becomes a standard invoice on acceptance), and a
 * credit/debit note is a correction against another document rather than a
 * bill of its own. An undefined type is treated as `"standard"`.
 */
export function isCollectibleDocument(invoice: {
	documentType?: string;
}): boolean {
	return (invoice.documentType ?? "standard") === "standard";
}

/**
 * True when an invoice both is a collectible document type AND derives a
 * collectible status. This is the single gate every surface shares.
 */
export function isCollectibleInvoice(
	invoice: CollectibleInvoice,
	now: Date = new Date(),
): boolean {
	return (
		isCollectibleDocument(invoice) &&
		isCollectibleStatus(deriveInvoiceStatus(invoice, now))
	);
}

export function deriveInvoiceStatus(
	invoice: CollectibleInvoice,
	now: Date = new Date(),
): InvoiceStatus {
	const total = invoiceNetPayable(invoice);
	const paymentAmount = paymentAmountForInvoice(invoice);

	if (invoice.canceledAt || invoice.status === "canceled") return "canceled";
	if (invoice.scheduledAt && invoice.scheduleVersion) return "scheduled";
	if (total > 0 && paymentAmount >= total) return "paid";
	if (paymentAmount > 0 && paymentAmount < total) return "partially-paid";
	if (!deliveredAtForInvoice(invoice)) return "draft";
	if (isPastDue(invoice, now)) return "overdue";
	return "unpaid";
}

/**
 * `netPayable − paymentAmount`, floored at 0. Zero unless the document is a
 * collectible type (a standard invoice) AND the derived status is collectible,
 * so a draft, scheduled, canceled, pro-forma or correction document can never
 * contribute an open balance.
 */
export function collectibleBalance(invoice: CollectibleInvoice): number {
	if (!isCollectibleInvoice(invoice)) return 0;
	return Math.max(
		0,
		invoiceNetPayable(invoice) - paymentAmountForInvoice(invoice),
	);
}

/**
 * A positive collectible balance, a past due date, and delivery evidence.
 * Drafts and never-delivered rows are never overdue.
 */
export function isOverdueInvoice(
	invoice: CollectibleInvoice,
	now: Date = new Date(),
): boolean {
	if (!isCollectibleInvoice(invoice, now)) return false;
	if (collectibleBalance(invoice) <= 0) return false;
	return (
		isPastDue(invoice, now) && deliveredAtForInvoice(invoice) !== undefined
	);
}
