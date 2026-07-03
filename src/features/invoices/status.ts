import type { InvoiceRecord, InvoiceStatus } from "./types";

type InvoiceLike = Pick<
	InvoiceRecord,
	"lineItems" | "compliance" | "dueDate" | "paymentAmount" | "canceledAt"
> & {
	lifecycle?: Pick<
		NonNullable<InvoiceRecord["lifecycle"]>,
		"sentAt" | "emailDeliveredAt"
	>;
	deliveredAt?: number;
};

export function getInvoiceTotal(
	invoice: Pick<InvoiceLike, "lineItems" | "compliance">,
) {
	if (invoice.compliance?.grandTotal !== undefined) {
		return Math.max(
			0,
			invoice.compliance.grandTotal -
				(invoice.compliance.withholdingTaxAmount ?? 0),
		);
	}

	return Math.max(
		0,
		invoice.lineItems.reduce(
			(sum, item) => sum + item.quantity * item.price,
			0,
		),
	);
}

export function getInvoiceBalance(invoice: InvoiceLike) {
	return Math.max(0, getInvoiceTotal(invoice) - (invoice.paymentAmount ?? 0));
}

export function getInvoiceStatus(
	invoice: InvoiceLike,
	now: Date = new Date(),
): InvoiceStatus {
	if (invoice.canceledAt) return "canceled";

	const total = getInvoiceTotal(invoice);
	const paymentAmount = Math.max(0, invoice.paymentAmount ?? 0);

	if (total > 0 && paymentAmount >= total) return "paid";
	if (paymentAmount > 0 && paymentAmount < total) return "partially-paid";

	const deliveredAt =
		invoice.deliveredAt ??
		invoice.lifecycle?.emailDeliveredAt ??
		invoice.lifecycle?.sentAt;
	if (!deliveredAt) return "draft";

	const dueDate = new Date(`${invoice.dueDate}T00:00:00`);
	if (!Number.isNaN(dueDate.getTime())) {
		const today = new Date(now);
		today.setHours(0, 0, 0, 0);
		if (dueDate.getTime() < today.getTime()) return "overdue";
	}

	return "unpaid";
}

export function getInvoiceStatusLabel(status: InvoiceStatus) {
	if (status === "unpaid") return "Sent";
	if (status === "partially-paid") return "Partially paid";
	return status.charAt(0).toUpperCase() + status.slice(1);
}
