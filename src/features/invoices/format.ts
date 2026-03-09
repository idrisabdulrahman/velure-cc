const CURRENCY_LOCALES: Record<string, string> = {
	USD: "en-US",
	EUR: "en-IE",
	GBP: "en-GB",
	NGN: "en-NG",
};

export function normalizeCurrencyCode(currency: string | null | undefined) {
	const normalized = currency?.trim().toUpperCase();
	return normalized && normalized.length === 3 ? normalized : "USD";
}

export function resolveCurrencyLocale(currency: string | null | undefined) {
	const normalized = normalizeCurrencyCode(currency);
	return CURRENCY_LOCALES[normalized] ?? "en-US";
}

type FormatMoneyOptions = {
	locale?: string;
	maximumFractionDigits?: number;
	currencyDisplay?: "symbol" | "code" | "narrowSymbol" | "name";
};

export function formatMoney(
	value: number,
	currency = "NGN",
	{
		locale,
		maximumFractionDigits = 2,
		currencyDisplay = "code",
	}: FormatMoneyOptions = {},
) {
	const normalizedCurrency = normalizeCurrencyCode(currency);
	const formatted = new Intl.NumberFormat(
		locale ?? resolveCurrencyLocale(normalizedCurrency),
		{
			style: "currency",
			currency: normalizedCurrency,
			currencyDisplay,
			maximumFractionDigits,
		},
	).format(value);

	return formatted.replace(/[\u00A0\u202F]/g, " ");
}
