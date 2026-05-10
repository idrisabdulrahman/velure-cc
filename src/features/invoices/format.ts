import { formatNigerianDate } from "#/features/compliance/nigeria";

const CURRENCY_LOCALES: Record<string, string> = {
	USD: "en-US",
	GBP: "en-GB",
	NGN: "en-NG",
};

export function normalizeCurrencyCode(currency: string | null | undefined) {
	const normalized = currency?.trim().toUpperCase();
	return normalized && normalized.length === 3 ? normalized : "NGN";
}

export function resolveCurrencyLocale(currency: string | null | undefined) {
	const normalized = normalizeCurrencyCode(currency);
	return CURRENCY_LOCALES[normalized] ?? "en-NG";
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
		currencyDisplay = normalizeCurrencyCode(currency) === "NGN"
			? "symbol"
			: "code",
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

export function formatInvoiceDate(
	value: string | number | Date,
	format: "iso" | "us" | "ng" = "ng",
) {
	const date =
		value instanceof Date
			? value
			: typeof value === "number"
				? new Date(value)
				: new Date(value);

	if (Number.isNaN(date.getTime())) {
		return String(value);
	}

	if (format === "ng") {
		return formatNigerianDate(date);
	}

	if (format === "us") {
		return date.toLocaleDateString("en-US");
	}

	return date.toISOString().slice(0, 10);
}
