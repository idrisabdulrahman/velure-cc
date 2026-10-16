type ComplianceWarningCode =
	| "missing_seller_tax_id"
	| "missing_buyer_tax_id"
	| "cross_border_review"
	| "reverse_charge_review"
	| "unknown_jurisdiction"
	| "domestic_vat_not_applied"
	| "missing_workspace_tax_status"
	| "manual_tax_override"
	| "manual_wht_override"
	| "legacy_wht_mapping";

type InvoiceLike = {
	_id?: string;
	id?: string;
	invoiceNumber: string;
	customerName: string;
	currency: string;
	issueDate: string;
	status?: string;
	canceledAt?: number;
	lineItems: Array<{
		quantity: number;
		price: number;
	}>;
	compliance?: {
		buyer?: {
			taxId?: string;
			countryCode?: string;
		};
		seller?: {
			taxId?: string;
			countryCode?: string;
		};
		placeOfSupply?: string;
		taxTreatment?: string;
		taxRate?: number;
		taxLabel?: string;
		subtotal?: number;
		totalTax?: number;
		withholdingTaxAmount?: number;
		withholdingTaxRate?: number;
		withholdingTaxLabel?: string;
		withholding?: {
			category?: string;
			manualOverride?: boolean;
		};
		warnings?: ComplianceWarningCode[];
		grandTotal?: number;
		netPayable?: number;
	};
};

type ReportWindow = {
	from: string;
	to: string;
};

type CurrencySummary = {
	currency: string;
	invoiceCount: number;
	taxableInvoiceCount: number;
	taxableBase: number;
	vatAmount: number;
	whtAmount: number;
	grossAmount: number;
	netPayable: number;
	warningCount: number;
	manualOverrideCount: number;
	missingBuyerTaxIdCount: number;
};

type MonthlySummary = {
	key: string;
	label: string;
	currency: string;
	vatAmount: number;
	whtAmount: number;
	invoiceCount: number;
	warningCount: number;
};

type WarningSummary = {
	code: ComplianceWarningCode;
	count: number;
};

type CustomerComplianceContext = {
	customerName: string;
	currency: string;
	invoiceCount: number;
	taxableBase: number;
	vatAmount: number;
	whtAmount: number;
	warningCount: number;
	missingBuyerTaxIdCount: number;
	crossBorderInvoiceCount: number;
};

type ReviewInvoice = {
	id: string;
	invoiceNumber: string;
	customerName: string;
	currency: string;
	issueDate: string;
	vatAmount: number;
	whtAmount: number;
	warnings: ComplianceWarningCode[];
};

function normalizeCurrency(value: string | undefined, fallback = "NGN") {
	const normalized = value?.trim().toUpperCase();
	return normalized && normalized.length === 3 ? normalized : fallback;
}

function normalizeText(value: string | undefined) {
	return (value ?? "").trim().replace(/\s+/g, " ");
}

function safeMoney(value: number | undefined) {
	return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function invoiceIdFor(invoice: InvoiceLike) {
	return invoice._id ?? invoice.id ?? invoice.invoiceNumber;
}

function invoiceSubtotal(invoice: InvoiceLike) {
	return safeMoney(
		invoice.compliance?.subtotal ??
			invoice.lineItems.reduce(
				(total, item) => total + item.quantity * item.price,
				0,
			),
	);
}

function invoiceGrandTotal(invoice: InvoiceLike) {
	return safeMoney(invoice.compliance?.grandTotal ?? invoiceSubtotal(invoice));
}

function invoiceNetPayable(invoice: InvoiceLike) {
	return safeMoney(
		invoiceGrandTotal(invoice) -
			safeMoney(invoice.compliance?.withholdingTaxAmount),
	);
}

function isCanceled(invoice: InvoiceLike) {
	return Boolean(invoice.canceledAt || invoice.status === "canceled");
}

function dateFromIsoDay(value: string | undefined) {
	if (!value) return null;
	const date = new Date(`${value}T00:00:00.000Z`);
	return Number.isNaN(date.getTime()) ? null : date;
}

function isoDay(date: Date) {
	return date.toISOString().slice(0, 10);
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

function inWindowIso(value: string, window: ReportWindow) {
	return value >= window.from && value <= window.to;
}

function monthKeyFromIsoDay(value: string) {
	return value.slice(0, 7);
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

function emptyCurrencySummary(currency: string): CurrencySummary {
	return {
		currency,
		invoiceCount: 0,
		taxableInvoiceCount: 0,
		taxableBase: 0,
		vatAmount: 0,
		whtAmount: 0,
		grossAmount: 0,
		netPayable: 0,
		warningCount: 0,
		manualOverrideCount: 0,
		missingBuyerTaxIdCount: 0,
	};
}

function getCurrencySummary(
	buckets: Map<string, CurrencySummary>,
	currency: string,
) {
	const existing = buckets.get(currency);
	if (existing) return existing;
	const bucket = emptyCurrencySummary(currency);
	buckets.set(currency, bucket);
	return bucket;
}

function getMonthlySummary(
	buckets: Map<string, MonthlySummary>,
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
		vatAmount: 0,
		whtAmount: 0,
		invoiceCount: 0,
		warningCount: 0,
	};
	buckets.set(bucketKey, bucket);
	return bucket;
}

function getCustomerContext(
	buckets: Map<string, CustomerComplianceContext>,
	customerName: string,
	currency: string,
) {
	const key = `${currency}:${customerName.toLowerCase()}`;
	const existing = buckets.get(key);
	if (existing) return existing;
	const bucket = {
		customerName,
		currency,
		invoiceCount: 0,
		taxableBase: 0,
		vatAmount: 0,
		whtAmount: 0,
		warningCount: 0,
		missingBuyerTaxIdCount: 0,
		crossBorderInvoiceCount: 0,
	};
	buckets.set(key, bucket);
	return bucket;
}

function warningSetFor(invoice: InvoiceLike) {
	return new Set(invoice.compliance?.warnings ?? []);
}

function isCrossBorder(invoice: InvoiceLike) {
	const sellerCountry = invoice.compliance?.seller?.countryCode;
	const buyerCountry = invoice.compliance?.buyer?.countryCode;
	return Boolean(
		sellerCountry && buyerCountry && sellerCountry !== buyerCountry,
	);
}

export function buildComplianceDashboardReport({
	invoices,
	baseCurrency = "NGN",
	currency,
	window,
	now = new Date(),
	limit = 8,
}: {
	invoices: InvoiceLike[];
	baseCurrency?: string;
	currency?: string;
	window?: Partial<ReportWindow>;
	now?: Date;
	limit?: number;
}) {
	const reportWindow = resolvedWindow(window, now);
	const normalizedBaseCurrency = normalizeCurrency(baseCurrency);
	const selectedCurrency = currency ? normalizeCurrency(currency) : null;
	const currencyBuckets = new Map<string, CurrencySummary>();
	const monthlyBuckets = new Map<string, MonthlySummary>();
	const warningBuckets = new Map<ComplianceWarningCode, WarningSummary>();
	const customerBuckets = new Map<string, CustomerComplianceContext>();
	const reviewInvoices: ReviewInvoice[] = [];
	const cappedLimit = Math.min(Math.max(limit, 1), 20);

	for (const invoice of invoices) {
		if (isCanceled(invoice) || !inWindowIso(invoice.issueDate, reportWindow)) {
			continue;
		}

		const invoiceCurrency = normalizeCurrency(
			invoice.currency,
			normalizedBaseCurrency,
		);
		if (selectedCurrency && invoiceCurrency !== selectedCurrency) continue;

		const customerName =
			normalizeText(invoice.customerName) || "Unknown customer";
		const warnings = warningSetFor(invoice);
		const subtotal = invoiceSubtotal(invoice);
		const vatAmount = safeMoney(invoice.compliance?.totalTax);
		const whtAmount = safeMoney(invoice.compliance?.withholdingTaxAmount);
		const grossAmount = invoiceGrandTotal(invoice);
		const netPayable = invoiceNetPayable(invoice);
		const hasVat = vatAmount > 0;
		const hasWht = whtAmount > 0;
		const hasManualOverride =
			warnings.has("manual_tax_override") ||
			warnings.has("manual_wht_override") ||
			Boolean(invoice.compliance?.withholding?.manualOverride);
		const missingBuyerTaxId =
			warnings.has("missing_buyer_tax_id") ||
			((hasVat || hasWht) && !invoice.compliance?.buyer?.taxId);
		const currencySummary = getCurrencySummary(
			currencyBuckets,
			invoiceCurrency,
		);
		const month = getMonthlySummary(
			monthlyBuckets,
			monthKeyFromIsoDay(invoice.issueDate),
			invoiceCurrency,
		);
		const customer = getCustomerContext(
			customerBuckets,
			customerName,
			invoiceCurrency,
		);

		currencySummary.invoiceCount += 1;
		currencySummary.taxableBase += subtotal;
		currencySummary.vatAmount += vatAmount;
		currencySummary.whtAmount += whtAmount;
		currencySummary.grossAmount += grossAmount;
		currencySummary.netPayable += netPayable;
		currencySummary.warningCount += warnings.size;
		if (hasVat || hasWht) currencySummary.taxableInvoiceCount += 1;
		if (hasManualOverride) currencySummary.manualOverrideCount += 1;
		if (missingBuyerTaxId) currencySummary.missingBuyerTaxIdCount += 1;

		month.invoiceCount += 1;
		month.vatAmount += vatAmount;
		month.whtAmount += whtAmount;
		month.warningCount += warnings.size;

		customer.invoiceCount += 1;
		customer.taxableBase += subtotal;
		customer.vatAmount += vatAmount;
		customer.whtAmount += whtAmount;
		customer.warningCount += warnings.size;
		if (missingBuyerTaxId) customer.missingBuyerTaxIdCount += 1;
		if (isCrossBorder(invoice)) customer.crossBorderInvoiceCount += 1;

		for (const code of warnings) {
			const existing = warningBuckets.get(code) ?? { code, count: 0 };
			existing.count += 1;
			warningBuckets.set(code, existing);
		}

		if (warnings.size > 0 || missingBuyerTaxId || hasManualOverride) {
			reviewInvoices.push({
				id: invoiceIdFor(invoice),
				invoiceNumber: invoice.invoiceNumber,
				customerName,
				currency: invoiceCurrency,
				issueDate: invoice.issueDate,
				vatAmount,
				whtAmount,
				warnings: Array.from(warnings),
			});
		}
	}

	const currencySummaries = Array.from(currencyBuckets.values()).sort(
		(a, b) => {
			if (a.currency === normalizedBaseCurrency) return -1;
			if (b.currency === normalizedBaseCurrency) return 1;
			return b.vatAmount + b.whtAmount - (a.vatAmount + a.whtAmount);
		},
	);
	const primaryCurrency =
		currencySummaries.find(
			(summary) =>
				summary.currency === (selectedCurrency ?? normalizedBaseCurrency),
		) ??
		currencySummaries[0] ??
		emptyCurrencySummary(selectedCurrency ?? normalizedBaseCurrency);

	return {
		window: reportWindow,
		baseCurrency: normalizedBaseCurrency,
		primaryCurrency,
		currencySummaries,
		monthly: Array.from(monthlyBuckets.values()).sort((a, b) => {
			if (a.key !== b.key) return a.key.localeCompare(b.key);
			return a.currency.localeCompare(b.currency);
		}),
		warnings: Array.from(warningBuckets.values())
			.sort((a, b) => b.count - a.count)
			.slice(0, cappedLimit),
		customerContexts: Array.from(customerBuckets.values())
			.sort((a, b) => {
				if (b.warningCount !== a.warningCount) {
					return b.warningCount - a.warningCount;
				}
				return b.vatAmount + b.whtAmount - (a.vatAmount + a.whtAmount);
			})
			.slice(0, cappedLimit),
		invoicesNeedingReview: reviewInvoices
			.sort((a, b) => {
				if (b.warnings.length !== a.warnings.length) {
					return b.warnings.length - a.warnings.length;
				}
				return b.issueDate.localeCompare(a.issueDate);
			})
			.slice(0, cappedLimit),
	};
}
