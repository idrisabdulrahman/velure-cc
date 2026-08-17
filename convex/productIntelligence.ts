type ProductLike = {
	_id?: string;
	id?: string;
	type: "product" | "service";
	name: string;
	sku?: string;
	unitName?: string;
	defaultUnitPrice: number;
	isActive: boolean;
	deletedAt?: number;
};

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
		name: string;
		quantity: number;
		price: number;
		productId?: string;
	}>;
};

type ProductClientSummary = {
	customerName: string;
	usageCount: number;
	quantitySold: number;
	revenue: number;
	lastSoldAt: number | null;
};

export type ProductIntelligenceMetric = {
	productId: string;
	name: string;
	type: "product" | "service";
	sku?: string;
	unitName?: string;
	defaultUnitPrice: number;
	isActive: boolean;
	usageCount: number;
	invoiceCount: number;
	customerCount: number;
	quantitySold: number;
	revenue: number;
	averagePrice: number;
	lastSoldAt: number | null;
	lastInvoiceNumber: string | null;
	topClients: ProductClientSummary[];
	coSoldProducts: Array<{
		productId: string;
		name: string;
		coInvoiceCount: number;
	}>;
	trend: "new" | "rising" | "steady" | "declining" | "inactive";
};

export type ProductSuggestion = {
	id: string;
	name: string;
	type: "product" | "service";
	sku?: string;
	unitName?: string;
	defaultUnitPrice: number;
	reason: "client_repeat" | "popular" | "high_revenue";
	usageCount: number;
	revenue: number;
	lastSoldAt: number | null;
};

function productIdFor(product: ProductLike) {
	return product._id ?? product.id ?? "";
}

function invoiceIdFor(invoice: InvoiceLike) {
	return invoice._id ?? invoice.id ?? invoice.invoiceNumber;
}

function issueTimestamp(issueDate: string) {
	const timestamp = new Date(`${issueDate}T00:00:00.000Z`).getTime();
	return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeCustomerName(value: string | undefined) {
	return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isBillableInvoice(invoice: InvoiceLike) {
	return !invoice.canceledAt && invoice.status !== "canceled";
}

function trendFor({
	recentRevenue,
	previousRevenue,
}: {
	recentRevenue: number;
	previousRevenue: number;
}): ProductIntelligenceMetric["trend"] {
	if (recentRevenue <= 0 && previousRevenue <= 0) return "inactive";
	if (recentRevenue > 0 && previousRevenue <= 0) return "new";
	if (recentRevenue < previousRevenue * 0.5) return "declining";
	if (recentRevenue > previousRevenue * 1.25) return "rising";
	return "steady";
}

export function buildProductIntelligence({
	products,
	invoices,
	now = new Date(),
}: {
	products: ProductLike[];
	invoices: InvoiceLike[];
	now?: Date;
}) {
	const metrics = new Map<
		string,
		ProductIntelligenceMetric & {
			_invoiceIds: Set<string>;
			_customerNames: Set<string>;
			_clientBuckets: Map<string, ProductClientSummary>;
			_recentRevenue: number;
			_previousRevenue: number;
			_coSold: Map<
				string,
				{ productId: string; name: string; coInvoiceCount: number }
			>;
		}
	>();

	for (const product of products.filter((item) => !item.deletedAt)) {
		const productId = productIdFor(product);
		if (!productId) continue;
		metrics.set(productId, {
			productId,
			name: product.name,
			type: product.type,
			sku: product.sku,
			unitName: product.unitName,
			defaultUnitPrice: product.defaultUnitPrice,
			isActive: product.isActive,
			usageCount: 0,
			invoiceCount: 0,
			customerCount: 0,
			quantitySold: 0,
			revenue: 0,
			averagePrice: 0,
			lastSoldAt: null,
			lastInvoiceNumber: null,
			topClients: [],
			coSoldProducts: [],
			trend: "inactive",
			_invoiceIds: new Set(),
			_customerNames: new Set(),
			_clientBuckets: new Map(),
			_recentRevenue: 0,
			_previousRevenue: 0,
			_coSold: new Map(),
		});
	}

	const nowTime = now.getTime();
	const recentStart = nowTime - 90 * 24 * 60 * 60 * 1000;
	const previousStart = nowTime - 180 * 24 * 60 * 60 * 1000;

	for (const invoice of invoices.filter(isBillableInvoice)) {
		const invoiceTime = issueTimestamp(invoice.issueDate);
		const invoiceProductIds = new Set(
			invoice.lineItems
				.map((item) => item.productId)
				.filter((id): id is string => Boolean(id)),
		);

		for (const item of invoice.lineItems) {
			if (!item.productId) continue;
			const metric = metrics.get(item.productId);
			if (!metric) continue;
			const invoiceId = invoiceIdFor(invoice);
			const firstProductUseOnInvoice = !metric._invoiceIds.has(invoiceId);

			const lineRevenue = item.quantity * item.price;
			const customerName = invoice.customerName.trim() || "Unknown customer";
			const normalizedCustomer = normalizeCustomerName(customerName);

			if (firstProductUseOnInvoice) metric.usageCount += 1;
			metric.quantitySold += item.quantity;
			metric.revenue += lineRevenue;
			metric._invoiceIds.add(invoiceId);
			if (normalizedCustomer) metric._customerNames.add(normalizedCustomer);

			if (invoiceTime >= recentStart) {
				metric._recentRevenue += lineRevenue;
			} else if (invoiceTime >= previousStart) {
				metric._previousRevenue += lineRevenue;
			}

			if (!metric.lastSoldAt || invoiceTime > metric.lastSoldAt) {
				metric.lastSoldAt = invoiceTime;
				metric.lastInvoiceNumber = invoice.invoiceNumber;
			}

			const client = metric._clientBuckets.get(normalizedCustomer) ?? {
				customerName,
				usageCount: 0,
				quantitySold: 0,
				revenue: 0,
				lastSoldAt: null,
			};
			client.usageCount += 1;
			client.quantitySold += item.quantity;
			client.revenue += lineRevenue;
			if (!client.lastSoldAt || invoiceTime > client.lastSoldAt) {
				client.lastSoldAt = invoiceTime;
				client.customerName = customerName;
			}
			metric._clientBuckets.set(normalizedCustomer, client);

			for (const coSoldProductId of invoiceProductIds) {
				if (coSoldProductId === item.productId) continue;
				const coSoldProduct = metrics.get(coSoldProductId);
				if (!coSoldProduct) continue;
				const coSold = metric._coSold.get(coSoldProductId) ?? {
					productId: coSoldProductId,
					name: coSoldProduct.name,
					coInvoiceCount: 0,
				};
				coSold.coInvoiceCount += 1;
				metric._coSold.set(coSoldProductId, coSold);
			}
		}
	}

	const productMetrics = Array.from(metrics.values()).map((metric) => {
		metric.invoiceCount = metric._invoiceIds.size;
		metric.customerCount = metric._customerNames.size;
		metric.averagePrice =
			metric.quantitySold > 0 ? metric.revenue / metric.quantitySold : 0;
		metric.topClients = Array.from(metric._clientBuckets.values())
			.sort((a, b) => b.revenue - a.revenue)
			.slice(0, 3);
		metric.coSoldProducts = Array.from(metric._coSold.values())
			.sort((a, b) => b.coInvoiceCount - a.coInvoiceCount)
			.slice(0, 3);
		metric.trend = trendFor({
			recentRevenue: metric._recentRevenue,
			previousRevenue: metric._previousRevenue,
		});

		const {
			_invoiceIds,
			_customerNames,
			_clientBuckets,
			_recentRevenue,
			_previousRevenue,
			_coSold,
			...publicMetric
		} = metric;
		void _invoiceIds;
		void _customerNames;
		void _clientBuckets;
		void _recentRevenue;
		void _previousRevenue;
		void _coSold;
		return publicMetric;
	});

	productMetrics.sort((a, b) => {
		if (b.revenue !== a.revenue) return b.revenue - a.revenue;
		return b.usageCount - a.usageCount;
	});

	const usedProducts = productMetrics.filter((metric) => metric.usageCount > 0);
	const totalRevenue = usedProducts.reduce(
		(sum, item) => sum + item.revenue,
		0,
	);
	const totalUsageCount = usedProducts.reduce(
		(sum, item) => sum + item.usageCount,
		0,
	);

	return {
		summary: {
			totalRevenue,
			totalUsageCount,
			activeProductCount: products.filter(
				(item) => !item.deletedAt && item.isActive,
			).length,
			usedProductCount: usedProducts.length,
			repeatClientProductCount: usedProducts.filter(
				(item) => item.customerCount > 1,
			).length,
			decliningProductCount: usedProducts.filter(
				(item) => item.trend === "declining",
			).length,
		},
		products: productMetrics,
		topRevenueProducts: [...productMetrics]
			.sort((a, b) => b.revenue - a.revenue)
			.slice(0, 5),
		mostUsedProducts: [...productMetrics]
			.sort((a, b) => b.usageCount - a.usageCount)
			.slice(0, 5),
		decliningProducts: productMetrics
			.filter((item) => item.trend === "declining")
			.slice(0, 5),
	};
}

export function buildProductSuggestions({
	intelligence,
	clientName,
	currentProductIds = [],
	limit = 5,
}: {
	intelligence: ReturnType<typeof buildProductIntelligence>;
	clientName?: string;
	currentProductIds?: string[];
	limit?: number;
}): ProductSuggestion[] {
	const normalizedClientName = normalizeCustomerName(clientName);
	const excluded = new Set(currentProductIds);
	const activeProducts = intelligence.products.filter(
		(product) => product.isActive && !excluded.has(product.productId),
	);

	const clientRepeatSuggestions =
		normalizedClientName.length > 0
			? activeProducts
					.map((product) => {
						const client = product.topClients.find(
							(item) =>
								normalizeCustomerName(item.customerName) ===
								normalizedClientName,
						);
						return client
							? {
									product,
									score: client.revenue * 2 + client.usageCount * 1000,
								}
							: null;
					})
					.filter(
						(
							item,
						): item is { product: ProductIntelligenceMetric; score: number } =>
							Boolean(item),
					)
					.sort((a, b) => b.score - a.score)
			: [];

	const suggestions: ProductSuggestion[] = [];
	const pushSuggestion = (
		product: ProductIntelligenceMetric,
		reason: ProductSuggestion["reason"],
	) => {
		if (suggestions.some((item) => item.id === product.productId)) return;
		suggestions.push({
			id: product.productId,
			name: product.name,
			type: product.type,
			sku: product.sku,
			unitName: product.unitName,
			defaultUnitPrice: product.defaultUnitPrice,
			reason,
			usageCount: product.usageCount,
			revenue: product.revenue,
			lastSoldAt: product.lastSoldAt,
		});
	};

	for (const { product } of clientRepeatSuggestions) {
		pushSuggestion(product, "client_repeat");
		if (suggestions.length >= limit) return suggestions;
	}

	for (const product of activeProducts.sort(
		(a, b) => b.usageCount - a.usageCount,
	)) {
		pushSuggestion(product, "popular");
		if (suggestions.length >= limit) return suggestions;
	}

	for (const product of activeProducts.sort((a, b) => b.revenue - a.revenue)) {
		pushSuggestion(product, "high_revenue");
		if (suggestions.length >= limit) return suggestions;
	}

	return suggestions;
}
