export type InvoicePaymentState = {
	lineItems: Array<{ quantity: number; price: number }>;
	compliance?: {
		netPayable?: number;
		grandTotal?: number;
		withholdingTaxAmount?: number;
	};
	status?: string;
	canceledAt?: number;
	deliveredAt?: number;
	updatedAt?: number;
	paidAt?: number;
	paymentAmount?: number;
	lifecycle?: {
		sentAt?: number;
		emailDeliveredAt?: number;
		paymentReceivedAt?: number;
	};
	dueDate?: string;
};

export type CollectionSessionState = {
	status: string;
	amount: number;
	currency: string;
	expiresAt: number;
};

export function roundMoney(amount: number) {
	return Math.round(amount * 100) / 100;
}

export function invoiceAmount(invoice: {
	lineItems: Array<{ quantity: number; price: number }>;
	compliance?: {
		netPayable?: number;
		grandTotal?: number;
		withholdingTaxAmount?: number;
	};
}) {
	if (invoice.compliance?.netPayable !== undefined) {
		return Math.max(0, invoice.compliance.netPayable);
	}
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

export function currentPaymentAmount(
	invoice: Pick<InvoicePaymentState, "paymentAmount" | "status">,
	total: number,
) {
	if (typeof invoice.paymentAmount === "number") {
		return Math.max(0, invoice.paymentAmount);
	}
	return invoice.status === "paid" ? total : 0;
}

export function deliveredAtForInvoice(invoice: InvoicePaymentState) {
	return (
		invoice.deliveredAt ??
		invoice.lifecycle?.emailDeliveredAt ??
		invoice.lifecycle?.sentAt ??
		(invoice.status && invoice.status !== "draft"
			? invoice.updatedAt
			: undefined)
	);
}

export function derivedPaymentStatus(
	invoice: InvoicePaymentState,
	now = Date.now(),
) {
	const total = invoiceAmount(invoice);
	const paid = currentPaymentAmount(invoice, total);

	if (invoice.canceledAt || invoice.status === "canceled") return "canceled";
	if (total > 0 && paid >= total) return "paid";
	if (paid > 0 && paid < total) return "partially-paid";
	if (!deliveredAtForInvoice(invoice)) return "draft";

	const dueDate = invoice.dueDate
		? new Date(`${invoice.dueDate}T00:00:00`)
		: null;
	if (dueDate && !Number.isNaN(dueDate.getTime())) {
		const today = new Date(now);
		today.setHours(0, 0, 0, 0);
		if (dueDate.getTime() < today.getTime()) return "overdue";
	}

	return "unpaid";
}

export function getInvoicePaymentSnapshot(
	invoice: InvoicePaymentState,
	now = Date.now(),
) {
	const total = roundMoney(invoiceAmount(invoice));
	const paid = roundMoney(currentPaymentAmount(invoice, total));
	const balance = roundMoney(Math.max(0, total - paid));
	const status = derivedPaymentStatus(invoice, now);

	return { status, total, paid, balance };
}

export function payableInvoiceIssue(invoice: InvoicePaymentState) {
	const { status, balance } = getInvoicePaymentSnapshot(invoice);

	if (status === "draft") return "Draft invoices are not payable.";
	if (status === "paid" || balance <= 0)
		return "Paid invoices are not payable.";
	if (status === "canceled") return "Canceled invoices are not payable.";
	return null;
}

export function applyPaymentToSnapshot(
	snapshot: { total: number; paid: number; balance: number },
	amount: number,
) {
	const roundedAmount = roundMoney(amount);

	if (!Number.isFinite(roundedAmount) || roundedAmount <= 0) {
		throw new Error("Payment amount must be greater than zero.");
	}
	if (roundedAmount > snapshot.balance) {
		throw new Error("Payment amount cannot exceed the invoice balance.");
	}

	const nextPaymentAmount = roundMoney(snapshot.paid + roundedAmount);
	const remainingBalance = roundMoney(
		Math.max(0, snapshot.total - nextPaymentAmount),
	);
	const isPaid = snapshot.total > 0 && remainingBalance === 0;

	return {
		amount: roundedAmount,
		nextPaymentAmount,
		remainingBalance,
		isPaid,
		invoiceAuditAction: isPaid
			? ("invoice.paid" as const)
			: ("invoice.partially_paid" as const),
	};
}

export function isActiveCollectionSession(
	session: Pick<CollectionSessionState, "status" | "expiresAt">,
	now = Date.now(),
) {
	return session.status === "pending" && session.expiresAt > now;
}

export function canReuseCollectionSession(
	session: CollectionSessionState,
	args: { amount: number; currency: string; now?: number },
) {
	return (
		isActiveCollectionSession(session, args.now) &&
		roundMoney(session.amount) === roundMoney(args.amount) &&
		session.currency === args.currency
	);
}

export function staleCollectionSessionReason(
	session: CollectionSessionState,
	args: { amount: number; currency: string; now?: number },
) {
	if (session.status !== "pending") return null;
	if (session.expiresAt <= (args.now ?? Date.now())) return "expired";
	if (
		roundMoney(session.amount) !== roundMoney(args.amount) ||
		session.currency !== args.currency
	) {
		return "balance_changed";
	}
	return null;
}
