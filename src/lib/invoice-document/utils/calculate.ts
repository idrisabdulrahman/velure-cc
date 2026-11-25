import { roundCurrency } from "#/features/compliance/calculate";
import type { DiscountMode } from "#/features/compliance/types";

export function calculateTotal({
	lineItems,
	taxRate = 0,
	vatRate = 0,
	discount = 0,
	discountMode = "invoice_after_tax",
	includeVat = true,
	includeTax = true,
}: {
	lineItems: Array<{ price?: number; quantity?: number; discount?: number }>;
	taxRate?: number;
	vatRate?: number;
	discount?: number;
	discountMode?: DiscountMode;
	includeVat?: boolean;
	includeTax?: boolean;
}) {
	// Handle cases where lineItems might be undefined or null
	const safeLineItems = lineItems || [];

	// Calculate Subtotal: Sum of all Base Prices for line items
	const subTotal = roundCurrency(
		safeLineItems.reduce((acc, item) => {
			// Handle cases where item might be undefined or null
			if (!item) return acc;

			const safePrice = item.price ?? 0;
			const safeQuantity = item.quantity ?? 0;

			return acc + safePrice * safeQuantity;
		}, 0),
	);

	// Handle cases where rates might be undefined
	const safeTaxRate = taxRate ?? 0;
	const safeVatRate = vatRate ?? 0;
	const safeDiscount = discount ?? 0;
	const mode: DiscountMode = discountMode ?? "invoice_after_tax";
	const lineDiscountTotal = roundCurrency(
		safeLineItems.reduce((acc, item) => acc + (item?.discount ?? 0), 0),
	);

	// Before-tax and per-line discounts reduce the base tax is charged on; an
	// after-tax discount is subtracted from the total instead.
	const baseReduction =
		mode === "invoice_before_tax"
			? safeDiscount
			: mode === "line"
				? lineDiscountTotal
				: 0;
	const taxableBase = roundCurrency(subTotal - baseReduction);

	// Calculate VAT (Total) and tax on the (possibly discounted) taxable base.
	const totalVAT = includeVat
		? roundCurrency((taxableBase * safeVatRate) / 100)
		: 0;
	const tax = includeTax ? roundCurrency((taxableBase * safeTaxRate) / 100) : 0;

	const afterTaxDiscount = mode === "invoice_after_tax" ? safeDiscount : 0;
	const total = roundCurrency(
		taxableBase + (includeVat ? totalVAT : 0) + tax - afterTaxDiscount,
	);

	return {
		subTotal,
		total,
		vat: totalVAT,
		tax,
	};
}

export function calculateLineItemTotal({
	price = 0,
	quantity = 0,
}: {
	price?: number;
	quantity?: number;
}) {
	// Handle cases where undefined is explicitly passed
	const safePrice = price ?? 0;
	const safeQuantity = quantity ?? 0;

	// Calculate and return total price
	return roundCurrency(safePrice * safeQuantity);
}
