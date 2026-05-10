import {
	formatMoney,
	normalizeCurrencyCode,
	resolveCurrencyLocale,
} from "#/features/invoices/format";

/**
 * Workaround for react-pdf negative currency formatting issue.
 * React-pdf strips minus signs from Intl.NumberFormat formatted currency values.
 * This function manually handles negative values by formatting the absolute value
 * and prepending the minus sign for negative amounts.
 *
 * @param amount - The numeric amount to format
 * @param currency - The currency code (e.g., "USD", "SEK")
 * @param locale - The locale for formatting (e.g., "en-US", "sv-SE")
 * @param maximumFractionDigits - Maximum number of decimal places
 * @returns Properly formatted currency string with minus sign preserved
 */
export function formatCurrencyForPDF({
	amount,
	currency,
	locale,
	maximumFractionDigits,
	currencyDisplay = "code",
}: {
	amount: number;
	currency: string;
	locale?: string;
	maximumFractionDigits?: number;
	currencyDisplay?: "symbol" | "code" | "narrowSymbol" | "name";
}): string {
	if (!currency) return "";

	const isNegative = amount < 0;
	const absoluteAmount = Math.abs(amount);
	const formatted = formatMoney(
		absoluteAmount,
		normalizeCurrencyCode(currency),
		{
			locale: locale || resolveCurrencyLocale(currency),
			maximumFractionDigits,
			currencyDisplay,
		},
	);

	// Manually prepend minus sign for negative values
	return isNegative ? `-${formatted}` : formatted || "";
}
