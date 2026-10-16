type ClientLike = {
	name: string;
	email: string;
	currency: string;
};

type InvoiceLike = {
	_id?: string;
	id?: string;
	invoiceNumber: string;
	customerName: string;
	currency: string;
	issueDate: string;
	dueDate: string;
	status?: string;
	paymentAmount?: number;
	paidAt?: number;
	deliveredAt?: number;
	canceledAt?: number;
	updatedAt?: number;
	lifecycle?: {
		sentAt?: number;
		emailDeliveredAt?: number;
		paymentReceivedAt?: number;
	};
	compliance?: {
		buyer?: {
			email?: string;
		};
		netPayable?: number;
		grandTotal?: number;
		withholdingTaxAmount?: number;
	};
	lineItems: Array<{
		name: string;
		quantity: number;
		price: number;
		productId?: string;
	}>;
};

type ProductSummary = {
	name: string;
	quantity: number;
	revenue: number;
	invoiceCount: number;
};

type CurrencySummary = {
	currency: string;
	totalRevenue: number;
	outstandingBalance: number;
	paidRevenue: number;
	averageInvoiceValue: number;
	invoiceCount: number;
	paidInvoiceCount: number;
	overdueInvoiceCount: number;
};

function normalizeText(value: string | undefined) {
	return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function invoiceTotal(invoice: InvoiceLike) {
	if (typeof invoice.compliance?.netPayable === "number") {
		return Math.max(0, invoice.compliance.netPayable);
	}

	if (typeof invoice.compliance?.grandTotal === "number") {
		return Math.max(
			0,
			invoice.compliance.grandTotal -
				(invoice.compliance.withholdingTaxAmount ?? 0),
		);
	}

	return Math.max(
		0,
		invoice.lineItems.reduce(
			(total, item) => total + item.quantity * item.price,
			0,
		),
	);
}

function deliveredAtForInvoice(invoice: InvoiceLike) {
	return (
		invoice.deliveredAt ??
		invoice.lifecycle?.emailDeliveredAt ??
		invoice.lifecycle?.sentAt ??
		(invoice.status && invoice.status !== "draft"
			? invoice.updatedAt
			: undefined)
	);
}

function deriveInvoiceStatus(invoice: InvoiceLike, now = new Date()) {
	const total = invoiceTotal(invoice);
	const paymentAmount = Math.max(0, invoice.paymentAmount ?? 0);

	if (invoice.canceledAt || invoice.status === "canceled") return "canceled";
	if (total > 0 && paymentAmount >= total) return "paid";
	if (paymentAmount > 0 && paymentAmount < total) return "partially-paid";
	if (!deliveredAtForInvoice(invoice)) return "draft";

	const dueDate = new Date(`${invoice.dueDate}T00:00:00`);
	if (!Number.isNaN(dueDate.getTime())) {
		const today = new Date(now);
		today.setHours(0, 0, 0, 0);
		if (dueDate.getTime() < today.getTime()) return "overdue";
	}

	return "unpaid";
}

function daysBetween(start: string, end: number | undefined) {
	if (!end) return null;
	const startDate = new Date(`${start}T00:00:00.000Z`);
	if (Number.isNaN(startDate.getTime())) return null;
	return Math.max(
		0,
		Math.round((end - startDate.getTime()) / (1000 * 60 * 60 * 24)),
	);
}

function hasOverdueBalance(
	invoice: InvoiceLike,
	balance: number,
	now = new Date(),
) {
	if (balance <= 0 || invoice.canceledAt || invoice.status === "canceled") {
		return false;
	}

	const deliveredAt = deliveredAtForInvoice(invoice);
	if (!deliveredAt) return false;

	const dueDate = new Date(`${invoice.dueDate}T00:00:00`);
	if (Number.isNaN(dueDate.getTime())) return false;

	const today = new Date(now);
	today.setHours(0, 0, 0, 0);
	return dueDate.getTime() < today.getTime();
}

export function buildClientIntelligence({
	client,
	invoices,
	now,
}: {
	client: ClientLike;
	invoices: InvoiceLike[];
	now?: Date;
}) {
	const clientEmail = normalizeText(client.email);
	const clientName = normalizeText(client.name);
	const matchedInvoices = invoices.filter((invoice) => {
		const buyerEmail = normalizeText(invoice.compliance?.buyer?.email);
		const customerName = normalizeText(invoice.customerName);
		return (
			(clientEmail.length > 0 && buyerEmail === clientEmail) ||
			(clientName.length > 0 && customerName === clientName)
		);
	});

	const currencyBuckets = new Map<string, CurrencySummary>();
	const productBuckets = new Map<string, ProductSummary>();
	const paymentDelayDays: number[] = [];

	for (const invoice of matchedInvoices) {
		const total = invoiceTotal(invoice);
		const paymentAmount = Math.max(0, invoice.paymentAmount ?? 0);
		const balance = Math.max(0, total - paymentAmount);
		const status = deriveInvoiceStatus(invoice, now);
		const currency = invoice.currency.trim().toUpperCase() || client.currency;
		const bucket = currencyBuckets.get(currency) ?? {
			currency,
			totalRevenue: 0,
			outstandingBalance: 0,
			paidRevenue: 0,
			averageInvoiceValue: 0,
			invoiceCount: 0,
			paidInvoiceCount: 0,
			overdueInvoiceCount: 0,
		};

		bucket.totalRevenue += total;
		bucket.outstandingBalance += balance;
		bucket.paidRevenue += Math.min(paymentAmount, total);
		bucket.invoiceCount += 1;
		if (status === "paid") bucket.paidInvoiceCount += 1;
		if (hasOverdueBalance(invoice, balance, now))
			bucket.overdueInvoiceCount += 1;
		currencyBuckets.set(currency, bucket);

		const paymentReceivedAt =
			invoice.lifecycle?.paymentReceivedAt ?? invoice.paidAt;
		const delay = daysBetween(invoice.dueDate, paymentReceivedAt);
		if (delay !== null && status === "paid") paymentDelayDays.push(delay);

		for (const item of invoice.lineItems) {
			const name = item.name.trim() || "Unnamed item";
			const product = productBuckets.get(name) ?? {
				name,
				quantity: 0,
				revenue: 0,
				invoiceCount: 0,
			};
			product.quantity += item.quantity;
			product.revenue += item.quantity * item.price;
			product.invoiceCount += 1;
			productBuckets.set(name, product);
		}
	}

	const currencySummaries = Array.from(currencyBuckets.values())
		.map((bucket) => ({
			...bucket,
			averageInvoiceValue:
				bucket.invoiceCount > 0 ? bucket.totalRevenue / bucket.invoiceCount : 0,
		}))
		.sort((a, b) => {
			if (a.currency === client.currency) return -1;
			if (b.currency === client.currency) return 1;
			return b.totalRevenue - a.totalRevenue;
		});

	const primaryCurrency = currencySummaries.find(
		(summary) => summary.currency === client.currency,
	) ??
		currencySummaries[0] ?? {
			currency: client.currency,
			totalRevenue: 0,
			outstandingBalance: 0,
			paidRevenue: 0,
			averageInvoiceValue: 0,
			invoiceCount: 0,
			paidInvoiceCount: 0,
			overdueInvoiceCount: 0,
		};

	const lastInvoice = [...matchedInvoices].sort((a, b) =>
		b.issueDate.localeCompare(a.issueDate),
	)[0];

	return {
		clientName: client.name,
		primaryCurrency,
		currencySummaries,
		invoiceCount: matchedInvoices.length,
		averagePaymentDelayDays:
			paymentDelayDays.length > 0
				? paymentDelayDays.reduce((sum, value) => sum + value, 0) /
					paymentDelayDays.length
				: null,
		lastInvoiceDate: lastInvoice?.issueDate ?? null,
		topProducts: Array.from(productBuckets.values())
			.sort((a, b) => b.revenue - a.revenue)
			.slice(0, 5),
		recentInvoices: [...matchedInvoices]
			.sort((a, b) => b.issueDate.localeCompare(a.issueDate))
			.slice(0, 5)
			.map((invoice) => {
				const total = invoiceTotal(invoice);
				return {
					id: invoice._id ?? invoice.id ?? "",
					invoiceNumber: invoice.invoiceNumber,
					issueDate: invoice.issueDate,
					dueDate: invoice.dueDate,
					currency: invoice.currency,
					total,
					balance: Math.max(0, total - (invoice.paymentAmount ?? 0)),
					status: deriveInvoiceStatus(invoice, now),
				};
			}),
	};
}
