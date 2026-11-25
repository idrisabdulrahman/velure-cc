import {
	collectibleBalance,
	deliveredAtForInvoice,
	deriveInvoiceStatus,
	invoiceNetPayable,
	isCollectibleInvoice,
} from "./invoice-balance";

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
	documentType?: string;
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
	draftBalance: number;
	paidRevenue: number;
	averageInvoiceValue: number;
	invoiceCount: number;
	draftInvoiceCount: number;
	paidInvoiceCount: number;
	overdueInvoiceCount: number;
};

function normalizeText(value: string | undefined) {
	return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function invoiceTotal(invoice: InvoiceLike) {
	return invoiceNetPayable(invoice);
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
		const balance = collectibleBalance(invoice);
		const status = deriveInvoiceStatus(invoice, now);
		const currency = invoice.currency.trim().toUpperCase() || client.currency;
		const bucket = currencyBuckets.get(currency) ?? {
			currency,
			totalRevenue: 0,
			outstandingBalance: 0,
			draftBalance: 0,
			paidRevenue: 0,
			averageInvoiceValue: 0,
			invoiceCount: 0,
			draftInvoiceCount: 0,
			paidInvoiceCount: 0,
			overdueInvoiceCount: 0,
		};

		bucket.totalRevenue += total;
		bucket.paidRevenue += Math.min(paymentAmount, total);
		bucket.invoiceCount += 1;
		if (status === "paid") bucket.paidInvoiceCount += 1;
		if (isCollectibleInvoice(invoice, now)) {
			// Only collectible documents (a standard invoice deriving unpaid /
			// partially-paid / overdue) contribute to the client's outstanding
			// balance. Drafts, scheduled, canceled, pro-formas and correction
			// documents are never owed.
			bucket.outstandingBalance += balance;
			if (hasOverdueBalance(invoice, balance, now))
				bucket.overdueInvoiceCount += 1;
		} else if (status === "draft") {
			// An unsent draft is not an open balance; surface it on its own so the
			// "no invoices yet" and balance views stay honest.
			bucket.draftBalance += Math.max(0, total - paymentAmount);
			bucket.draftInvoiceCount += 1;
		}
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
			draftBalance: 0,
			paidRevenue: 0,
			averageInvoiceValue: 0,
			invoiceCount: 0,
			draftInvoiceCount: 0,
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

export type CustomerStatementLine = {
	id: string;
	invoiceNumber: string;
	issueDate: string;
	dueDate: string;
	currency: string;
	status: string;
	total: number;
	paid: number;
	balance: number;
	overdue: boolean;
};

export type CustomerStatementTotals = {
	currency: string;
	billed: number;
	paid: number;
	outstanding: number;
	overdue: number;
	invoiceCount: number;
};

export type CustomerStatement = {
	clientName: string;
	clientEmail: string;
	currency: string;
	from: string | null;
	to: string | null;
	generatedAt: string;
	invoiceCount: number;
	lines: CustomerStatementLine[];
	totalsByCurrency: CustomerStatementTotals[];
	primaryTotals: CustomerStatementTotals;
};

/**
 * A statement is the payer-facing payable history, so documents the payer never
 * received are left out: a `draft` was never delivered and a `canceled` invoice
 * is void. `buildClientIntelligence` keeps both (its totals are an internal
 * view); a statement must not bill either.
 */
const STATEMENT_EXCLUDED_STATUSES = new Set(["draft", "canceled"]);

function emptyStatementTotals(currency: string): CustomerStatementTotals {
	return {
		currency,
		billed: 0,
		paid: 0,
		outstanding: 0,
		overdue: 0,
		invoiceCount: 0,
	};
}

/**
 * Customer statement of account — a pure render over the invoices already
 * fetched for one client. Reuses the same matcher, money and status helpers as
 * `buildClientIntelligence`, so "amount due" cannot drift between the client
 * panel and the statement. Optional `from`/`to` bound the issue date
 * (inclusive, `YYYY-MM-DD`).
 */
export function buildCustomerStatement({
	client,
	invoices,
	now,
	from,
	to,
}: {
	client: ClientLike;
	invoices: InvoiceLike[];
	now?: Date;
	from?: string;
	to?: string;
}): CustomerStatement {
	const clientEmail = normalizeText(client.email);
	const clientName = normalizeText(client.name);
	const clientCurrency = client.currency;
	const lines: CustomerStatementLine[] = [];
	const totalsByCurrency = new Map<string, CustomerStatementTotals>();

	for (const invoice of invoices) {
		const buyerEmail = normalizeText(invoice.compliance?.buyer?.email);
		const customerName = normalizeText(invoice.customerName);
		const matchesClient =
			(clientEmail.length > 0 && buyerEmail === clientEmail) ||
			(clientName.length > 0 && customerName === clientName);
		if (!matchesClient) continue;
		if (from && invoice.issueDate < from) continue;
		if (to && invoice.issueDate > to) continue;

		const status = deriveInvoiceStatus(invoice, now);
		if (STATEMENT_EXCLUDED_STATUSES.has(status)) continue;

		const total = invoiceTotal(invoice);
		const paid = Math.max(0, Math.min(invoice.paymentAmount ?? 0, total));
		// Shared authority: a pro-forma or correction document never opens an
		// "amount due", so the statement must not show one either.
		const balance = collectibleBalance(invoice);
		const overdue = hasOverdueBalance(invoice, balance, now);
		const currency = invoice.currency.trim().toUpperCase() || clientCurrency;

		lines.push({
			id: invoice._id ?? invoice.id ?? "",
			invoiceNumber: invoice.invoiceNumber,
			issueDate: invoice.issueDate,
			dueDate: invoice.dueDate,
			currency,
			status,
			total,
			paid,
			balance,
			overdue,
		});

		const bucket =
			totalsByCurrency.get(currency) ?? emptyStatementTotals(currency);
		bucket.billed += total;
		bucket.paid += paid;
		bucket.outstanding += balance;
		if (overdue) bucket.overdue += balance;
		bucket.invoiceCount += 1;
		totalsByCurrency.set(currency, bucket);
	}

	lines.sort((a, b) => {
		const byDate = a.issueDate.localeCompare(b.issueDate);
		return byDate !== 0
			? byDate
			: a.invoiceNumber.localeCompare(b.invoiceNumber);
	});

	const currencySummaries = Array.from(totalsByCurrency.values()).sort(
		(a, b) => {
			if (a.currency === clientCurrency) return -1;
			if (b.currency === clientCurrency) return 1;
			return b.outstanding - a.outstanding;
		},
	);

	return {
		clientName: client.name,
		clientEmail: client.email,
		currency: clientCurrency,
		from: from ?? null,
		to: to ?? null,
		generatedAt: (now ?? new Date()).toISOString(),
		invoiceCount: lines.length,
		lines,
		totalsByCurrency: currencySummaries,
		primaryTotals:
			currencySummaries.find(
				(summary) => summary.currency === clientCurrency,
			) ??
			currencySummaries[0] ??
			emptyStatementTotals(clientCurrency),
	};
}
