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

type PaymentLike = {
	invoiceId: string;
	amount: number;
	currency: string;
	source: "manual" | "paystack";
	provider?: "paystack";
	reference?: string;
	createdAt: number;
};

type ProductLike = {
	_id?: string;
	id?: string;
	name: string;
	type: "product" | "service";
	deletedAt?: number;
};

type ReportWindow = {
	from: string;
	to: string;
};

type CurrencyBucket = {
	currency: string;
	billedAmount: number;
	collectedAmount: number;
	outstandingAmount: number;
	overdueAmount: number;
	invoiceCount: number;
	paidInvoiceCount: number;
	openInvoiceCount: number;
	overdueInvoiceCount: number;
	averageInvoiceValue: number;
	collectionRate: number;
};

type TimelineBucket = {
	key: string;
	label: string;
	currency: string;
	billedAmount: number;
	collectedAmount: number;
	invoiceCount: number;
	paymentCount: number;
};

type CustomerBucket = {
	customerName: string;
	currency: string;
	billedAmount: number;
	collectedAmount: number;
	outstandingAmount: number;
	overdueAmount: number;
	invoiceCount: number;
	overdueInvoiceCount: number;
	averagePaymentDelayDays: number | null;
};

type LatePayerBucket = {
	customerName: string;
	currency: string;
	overdueAmount: number;
	overdueInvoiceCount: number;
	averageDaysOverdue: number;
	oldestDueDate: string;
};

type ProductBucket = {
	productId: string | null;
	name: string;
	type: "product" | "service" | "unknown";
	currency: string;
	revenue: number;
	quantitySold: number;
	invoiceCount: number;
};

type OpenInvoice = {
	id: string;
	invoiceNumber: string;
	customerName: string;
	currency: string;
	dueDate: string;
	status: string;
	total: number;
	balance: number;
	daysOverdue: number;
};

function normalizeCurrency(value: string | undefined, fallback = "NGN") {
	const normalized = value?.trim().toUpperCase();
	return normalized && normalized.length === 3 ? normalized : fallback;
}

function normalizeText(value: string | undefined) {
	return (value ?? "").trim().replace(/\s+/g, " ");
}

function invoiceIdFor(invoice: InvoiceLike) {
	return invoice._id ?? invoice.id ?? invoice.invoiceNumber;
}

function productIdFor(product: ProductLike) {
	return product._id ?? product.id ?? "";
}

function safeMoney(value: number | undefined) {
	return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function invoiceTotal(invoice: InvoiceLike) {
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
	const paymentAmount = safeMoney(invoice.paymentAmount);

	if (invoice.canceledAt || invoice.status === "canceled") return "canceled";
	if (total > 0 && paymentAmount >= total) return "paid";
	if (paymentAmount > 0 && paymentAmount < total) return "partially-paid";
	if (!deliveredAtForInvoice(invoice)) return "draft";

	const dueDate = dateFromIsoDay(invoice.dueDate);
	if (dueDate) {
		const today = startOfDay(now);
		if (dueDate.getTime() < today.getTime()) return "overdue";
	}

	return "unpaid";
}

function startOfDay(date: Date) {
	const next = new Date(date);
	next.setHours(0, 0, 0, 0);
	return next;
}

function dateFromIsoDay(value: string | undefined) {
	if (!value) return null;
	const date = new Date(`${value}T00:00:00.000Z`);
	return Number.isNaN(date.getTime()) ? null : date;
}

function isoDay(date: Date) {
	return date.toISOString().slice(0, 10);
}

function monthKeyFromIsoDay(value: string) {
	return value.slice(0, 7);
}

function monthKeyFromTimestamp(value: number) {
	return new Date(value).toISOString().slice(0, 7);
}

function monthLabel(key: string) {
	const [year, month] = key.split("-");
	const date = new Date(Number(year), Number(month) - 1, 1);
	if (Number.isNaN(date.getTime())) return key;
	return date.toLocaleDateString("en-NG", {
		month: "short",
		year: "numeric",
	});
}

function daysBetweenIsoAndTimestamp(start: string, end: number | undefined) {
	if (!end) return null;
	const startDate = dateFromIsoDay(start);
	if (!startDate) return null;
	return Math.max(
		0,
		Math.round((end - startDate.getTime()) / (1000 * 60 * 60 * 24)),
	);
}

function daysOverdue(dueDate: string, now: Date) {
	const [year, month, day] = dueDate.split("-").map(Number);
	if (!year || !month || !day) return 0;
	const due = Date.UTC(year, month - 1, day);
	const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
	return Math.max(0, Math.floor((today - due) / 86_400_000));
}

function inWindowIso(value: string, window: ReportWindow) {
	return value >= window.from && value <= window.to;
}

function inWindowTimestamp(value: number, window: ReportWindow) {
	const day = isoDay(new Date(value));
	return day >= window.from && day <= window.to;
}

function defaultWindow(now: Date): ReportWindow {
	const from = new Date(now);
	from.setMonth(from.getMonth() - 11, 1);
	return {
		from: isoDay(from),
		to: isoDay(now),
	};
}

function resolvedWindow(window: Partial<ReportWindow> | undefined, now: Date) {
	const fallback = defaultWindow(now);
	const from =
		dateFromIsoDay(window?.from)?.toISOString().slice(0, 10) ?? fallback.from;
	const to =
		dateFromIsoDay(window?.to)?.toISOString().slice(0, 10) ?? fallback.to;

	return from <= to ? { from, to } : { from: to, to: from };
}

function emptyCurrencyBucket(currency: string): CurrencyBucket {
	return {
		currency,
		billedAmount: 0,
		collectedAmount: 0,
		outstandingAmount: 0,
		overdueAmount: 0,
		invoiceCount: 0,
		paidInvoiceCount: 0,
		openInvoiceCount: 0,
		overdueInvoiceCount: 0,
		averageInvoiceValue: 0,
		collectionRate: 0,
	};
}

function getCurrencyBucket(
	buckets: Map<string, CurrencyBucket>,
	currency: string,
) {
	const existing = buckets.get(currency);
	if (existing) return existing;
	const bucket = emptyCurrencyBucket(currency);
	buckets.set(currency, bucket);
	return bucket;
}

function getTimelineBucket(
	buckets: Map<string, TimelineBucket>,
	key: string,
	currency: string,
) {
	const bucketKey = `${currency}:${key}`;
	const existing = buckets.get(bucketKey);
	if (existing) return existing;
	const bucket = {
		key,
		label: monthLabel(key),
		currency,
		billedAmount: 0,
		collectedAmount: 0,
		invoiceCount: 0,
		paymentCount: 0,
	};
	buckets.set(bucketKey, bucket);
	return bucket;
}

function getCustomerBucket(
	buckets: Map<string, CustomerBucket & { _delayDays: number[] }>,
	customerName: string,
	currency: string,
) {
	const key = `${currency}:${customerName.toLowerCase()}`;
	const existing = buckets.get(key);
	if (existing) return existing;
	const bucket = {
		customerName,
		currency,
		billedAmount: 0,
		collectedAmount: 0,
		outstandingAmount: 0,
		overdueAmount: 0,
		invoiceCount: 0,
		overdueInvoiceCount: 0,
		averagePaymentDelayDays: null,
		_delayDays: [],
	};
	buckets.set(key, bucket);
	return bucket;
}

function getProductBucket(
	buckets: Map<string, ProductBucket & { _invoiceIds: Set<string> }>,
	args: {
		productId: string | null;
		name: string;
		type: ProductBucket["type"];
		currency: string;
	},
) {
	const key = `${args.currency}:${args.productId ?? args.name.toLowerCase()}`;
	const existing = buckets.get(key);
	if (existing) return existing;
	const bucket = {
		...args,
		revenue: 0,
		quantitySold: 0,
		invoiceCount: 0,
		_invoiceIds: new Set<string>(),
	};
	buckets.set(key, bucket);
	return bucket;
}

export function buildRevenueCashFlowReport({
	invoices,
	payments,
	products = [],
	baseCurrency = "NGN",
	window,
	now = new Date(),
	limit = 8,
}: {
	invoices: InvoiceLike[];
	payments: PaymentLike[];
	products?: ProductLike[];
	baseCurrency?: string;
	window?: Partial<ReportWindow>;
	now?: Date;
	limit?: number;
}) {
	const reportWindow = resolvedWindow(window, now);
	const normalizedBaseCurrency = normalizeCurrency(baseCurrency);
	const productById = new Map(
		products
			.filter((product) => !product.deletedAt)
			.map((product) => [productIdFor(product), product]),
	);
	const invoiceById = new Map(
		invoices.map((invoice) => [invoiceIdFor(invoice), invoice]),
	);
	const paymentsByInvoiceId = new Map<string, PaymentLike[]>();
	const currencyBuckets = new Map<string, CurrencyBucket>();
	const timelineBuckets = new Map<string, TimelineBucket>();
	const customerBuckets = new Map<
		string,
		CustomerBucket & { _delayDays: number[] }
	>();
	const productBuckets = new Map<
		string,
		ProductBucket & { _invoiceIds: Set<string> }
	>();
	const latePayers = new Map<
		string,
		LatePayerBucket & { _daysOverdue: number[] }
	>();
	const openInvoices: OpenInvoice[] = [];

	for (const payment of payments) {
		const invoice = invoiceById.get(payment.invoiceId);
		if (!invoice || deriveInvoiceStatus(invoice, now) === "canceled") continue;

		const invoiceCurrency = normalizeCurrency(
			invoice.currency,
			normalizedBaseCurrency,
		);
		const currency = normalizeCurrency(payment.currency, invoiceCurrency);
		const invoicePayments = paymentsByInvoiceId.get(payment.invoiceId) ?? [];
		invoicePayments.push(payment);
		paymentsByInvoiceId.set(payment.invoiceId, invoicePayments);

		if (!inWindowTimestamp(payment.createdAt, reportWindow)) continue;

		const amount = safeMoney(payment.amount);
		const currencyBucket = getCurrencyBucket(currencyBuckets, currency);
		currencyBucket.collectedAmount += amount;

		const month = monthKeyFromTimestamp(payment.createdAt);
		const timelineBucket = getTimelineBucket(timelineBuckets, month, currency);
		timelineBucket.collectedAmount += amount;
		timelineBucket.paymentCount += 1;

		const customerName =
			normalizeText(invoice.customerName) || "Unknown customer";
		const customer = getCustomerBucket(customerBuckets, customerName, currency);
		customer.collectedAmount += amount;
	}

	for (const invoice of invoices) {
		const status = deriveInvoiceStatus(invoice, now);
		if (status === "canceled") continue;

		const id = invoiceIdFor(invoice);
		const total = invoiceTotal(invoice);
		const paymentAmount = safeMoney(invoice.paymentAmount);
		const balance = Math.max(0, total - paymentAmount);
		const currency = normalizeCurrency(
			invoice.currency,
			normalizedBaseCurrency,
		);
		const customerName =
			normalizeText(invoice.customerName) || "Unknown customer";
		const issueInWindow = inWindowIso(invoice.issueDate, reportWindow);
		const isPaid = status === "paid";
		const overdueDays = daysOverdue(invoice.dueDate, now);
		const isOverdue =
			balance > 0 && overdueDays > 0 && deliveredAtForInvoice(invoice);
		const currencyBucket = getCurrencyBucket(currencyBuckets, currency);
		const customer = getCustomerBucket(customerBuckets, customerName, currency);

		if (issueInWindow) {
			currencyBucket.billedAmount += total;
			currencyBucket.invoiceCount += 1;
			if (isPaid) currencyBucket.paidInvoiceCount += 1;
			customer.billedAmount += total;
			customer.invoiceCount += 1;

			const month = monthKeyFromIsoDay(invoice.issueDate);
			const timelineBucket = getTimelineBucket(
				timelineBuckets,
				month,
				currency,
			);
			timelineBucket.billedAmount += total;
			timelineBucket.invoiceCount += 1;

			for (const item of invoice.lineItems) {
				const product = item.productId ? productById.get(item.productId) : null;
				const name =
					normalizeText(product?.name ?? item.name) || "Unnamed item";
				const lineRevenue = safeMoney(item.quantity * item.price);
				const productBucket = getProductBucket(productBuckets, {
					productId: item.productId ?? null,
					name,
					type: product?.type ?? "unknown",
					currency,
				});
				productBucket.revenue += lineRevenue;
				productBucket.quantitySold += item.quantity;
				productBucket._invoiceIds.add(id);
			}
		}

		if (balance > 0) {
			currencyBucket.outstandingAmount += balance;
			currencyBucket.openInvoiceCount += 1;
			customer.outstandingAmount += balance;
			openInvoices.push({
				id,
				invoiceNumber: invoice.invoiceNumber,
				customerName,
				currency,
				dueDate: invoice.dueDate,
				status,
				total,
				balance,
				daysOverdue: isOverdue ? overdueDays : 0,
			});
		}

		if (isOverdue) {
			currencyBucket.overdueAmount += balance;
			currencyBucket.overdueInvoiceCount += 1;
			customer.overdueAmount += balance;
			customer.overdueInvoiceCount += 1;

			const key = `${currency}:${customerName.toLowerCase()}`;
			const late = latePayers.get(key) ?? {
				customerName,
				currency,
				overdueAmount: 0,
				overdueInvoiceCount: 0,
				averageDaysOverdue: 0,
				oldestDueDate: invoice.dueDate,
				_daysOverdue: [],
			};
			late.overdueAmount += balance;
			late.overdueInvoiceCount += 1;
			late.oldestDueDate =
				invoice.dueDate < late.oldestDueDate
					? invoice.dueDate
					: late.oldestDueDate;
			late._daysOverdue.push(overdueDays);
			latePayers.set(key, late);
		}

		const paymentReceivedAt =
			invoice.lifecycle?.paymentReceivedAt ?? invoice.paidAt;
		const paymentDelay = daysBetweenIsoAndTimestamp(
			invoice.dueDate,
			paymentReceivedAt,
		);
		if (paymentDelay !== null && isPaid) {
			customer._delayDays.push(paymentDelay);
		}

		if (
			paymentAmount > 0 &&
			paymentReceivedAt &&
			inWindowTimestamp(paymentReceivedAt, reportWindow) &&
			(paymentsByInvoiceId.get(id)?.length ?? 0) === 0
		) {
			const amount = Math.min(paymentAmount, total);
			currencyBucket.collectedAmount += amount;
			customer.collectedAmount += amount;
			const month = monthKeyFromTimestamp(paymentReceivedAt);
			const timelineBucket = getTimelineBucket(
				timelineBuckets,
				month,
				currency,
			);
			timelineBucket.collectedAmount += amount;
			timelineBucket.paymentCount += 1;
		}
	}

	const currencySummaries = Array.from(currencyBuckets.values())
		.map((bucket) => ({
			...bucket,
			averageInvoiceValue:
				bucket.invoiceCount > 0 ? bucket.billedAmount / bucket.invoiceCount : 0,
			collectionRate:
				bucket.billedAmount > 0
					? Math.min(1, bucket.collectedAmount / bucket.billedAmount)
					: 0,
		}))
		.sort((a, b) => {
			if (a.currency === normalizedBaseCurrency) return -1;
			if (b.currency === normalizedBaseCurrency) return 1;
			return b.billedAmount - a.billedAmount;
		});

	const primaryCurrency =
		currencySummaries.find(
			(bucket) => bucket.currency === normalizedBaseCurrency,
		) ??
		currencySummaries[0] ??
		emptyCurrencyBucket(normalizedBaseCurrency);

	return {
		window: reportWindow,
		baseCurrency: normalizedBaseCurrency,
		primaryCurrency,
		currencySummaries,
		timeline: Array.from(timelineBuckets.values()).sort((a, b) => {
			if (a.key !== b.key) return a.key.localeCompare(b.key);
			return a.currency.localeCompare(b.currency);
		}),
		topCustomers: Array.from(customerBuckets.values())
			.map(({ _delayDays, ...customer }) => ({
				...customer,
				averagePaymentDelayDays:
					_delayDays.length > 0
						? _delayDays.reduce((sum, days) => sum + days, 0) /
							_delayDays.length
						: null,
			}))
			.sort((a, b) => {
				if (b.billedAmount !== a.billedAmount) {
					return b.billedAmount - a.billedAmount;
				}
				return b.outstandingAmount - a.outstandingAmount;
			})
			.slice(0, limit),
		latePayers: Array.from(latePayers.values())
			.map(({ _daysOverdue, ...late }) => ({
				...late,
				averageDaysOverdue:
					_daysOverdue.length > 0
						? _daysOverdue.reduce((sum, days) => sum + days, 0) /
							_daysOverdue.length
						: 0,
			}))
			.sort((a, b) => b.overdueAmount - a.overdueAmount)
			.slice(0, limit),
		topProducts: Array.from(productBuckets.values())
			.map(({ _invoiceIds, ...product }) => ({
				...product,
				invoiceCount: _invoiceIds.size,
			}))
			.sort((a, b) => b.revenue - a.revenue)
			.slice(0, limit),
		openInvoices: openInvoices
			.sort((a, b) => {
				if (b.daysOverdue !== a.daysOverdue)
					return b.daysOverdue - a.daysOverdue;
				return b.balance - a.balance;
			})
			.slice(0, limit),
	};
}
