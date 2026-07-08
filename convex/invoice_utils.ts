import {
	defaultTaxTreatmentForSellerTaxStatus,
	defaultWithholdingSelection,
	NIGERIA_TAX_RULE_SET_VERSION,
	NIGERIA_VAT_RATE,
} from "./nigeria";

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

export type InvoiceLifecycleStatus =
	| "draft"
	| "unpaid"
	| "partially-paid"
	| "paid"
	| "overdue"
	| "canceled";

export function roundMoney(amount: number) {
	return Math.round(amount * 100) / 100;
}

export function safeMoney(value: number | undefined) {
	return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

export function invoiceAmount(invoice: {
	lineItems: Array<{ quantity: number; price: number }>;
	compliance?: {
		netPayable?: number;
		grandTotal?: number;
		withholdingTaxAmount?: number;
	};
}) {
	if (typeof invoice.compliance?.netPayable === "number") {
		return safeMoney(invoice.compliance.netPayable);
	}
	if (typeof invoice.compliance?.grandTotal === "number") {
		return safeMoney(
			invoice.compliance.grandTotal -
				(invoice.compliance.withholdingTaxAmount ?? 0),
		);
	}
	return safeMoney(
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

export function deriveInvoiceStatus(
	invoice: InvoicePaymentState,
	now: number | Date = Date.now(),
): InvoiceLifecycleStatus {
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

export const derivedPaymentStatus = deriveInvoiceStatus;

export function getInvoicePaymentSnapshot(
	invoice: InvoicePaymentState,
	now = Date.now(),
) {
	const total = roundMoney(invoiceAmount(invoice));
	const paid = roundMoney(currentPaymentAmount(invoice, total));
	const balance = roundMoney(Math.max(0, total - paid));
	const status = deriveInvoiceStatus(invoice, now);

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

export function defaultInvoiceCompliance(args: {
	customerName: string;
	lineItems: Array<{ quantity: number; price: number }>;
}) {
	const subtotal = args.lineItems.reduce(
		(sum, item) => sum + item.quantity * item.price,
		0,
	);
	const taxTreatment = defaultTaxTreatmentForSellerTaxStatus("vat_registered");
	const totalTax =
		taxTreatment === "exclusive_rate"
			? roundMoney((subtotal * NIGERIA_VAT_RATE) / 100)
			: 0;
	const withholding = defaultWithholdingSelection();

	return {
		seller: { legalName: "Velure", countryCode: "NG" as const },
		buyer: {
			legalName: args.customerName || undefined,
			countryCode: "NG" as const,
		},
		sellerTaxStatus: "vat_registered" as const,
		placeOfSupply: "NG" as const,
		taxRuleSetVersion: NIGERIA_TAX_RULE_SET_VERSION,
		taxTreatment,
		taxRate: NIGERIA_VAT_RATE,
		taxLabel: "VAT",
		taxLines:
			taxTreatment === "exclusive_rate"
				? [
						{
							label: "VAT",
							rate: NIGERIA_VAT_RATE,
							amount: totalTax,
							treatment: "exclusive_rate" as const,
							jurisdictionCode: "NG" as const,
						},
					]
				: [],
		warnings: [],
		templateVariant: "vat_ready" as const,
		subtotal,
		totalTax,
		withholding: { ...withholding, amount: 0 },
		withholdingTaxPreset: "none" as const,
		withholdingTaxLabel: "WHT",
		withholdingTaxRate: withholding.rate,
		withholdingTaxAmount: 0,
		regulatoryNotice: undefined as string | undefined,
		grandTotal: subtotal + totalTax,
		fiscalization: { status: "not_configured" as const },
	};
}
