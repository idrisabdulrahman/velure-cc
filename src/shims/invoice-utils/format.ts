import {
	formatMoney,
	normalizeCurrencyCode,
	resolveCurrencyLocale,
} from "#/features/invoices/format";

type FormatAmountInput = {
	amount: number;
	currency: string;
	locale?: string;
	maximumFractionDigits?: number;
	currencyDisplay?: "symbol" | "code" | "narrowSymbol" | "name";
};

export function formatAmount({
	amount,
	currency,
	locale,
	maximumFractionDigits = 2,
	currencyDisplay = "code",
}: FormatAmountInput) {
	return formatMoney(amount, normalizeCurrencyCode(currency), {
		locale: locale ?? resolveCurrencyLocale(currency),
		maximumFractionDigits,
		currencyDisplay,
	});
}
