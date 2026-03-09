import { formatAmount } from "#/shims/midday-utils/format";
import type { LineItem } from "../../../types";
import { calculateTotal } from "../../../utils/calculate";

type Props = {
	includeVat: boolean;
	includeTax: boolean;
	includeDiscount: boolean;
	discount?: number | null;
	discountLabel: string;
	taxRate: number;
	vatRate: number;
	locale: string;
	currency: string | null;
	vatLabel: string;
	taxLabel: string;
	totalLabel: string;
	lineItems: LineItem[];
	includeDecimals?: boolean;
	subtotalLabel: string;
};

export function Summary({
	includeVat,
	includeTax,
	includeDiscount,
	discountLabel,
	locale,
	discount,
	taxRate,
	vatRate,
	currency,
	vatLabel,
	taxLabel,
	totalLabel,
	lineItems,
	includeDecimals,
	subtotalLabel,
}: Props) {
	const maximumFractionDigits = includeDecimals ? 2 : 0;

	const {
		subTotal,
		total,
		vat: totalVAT,
		tax: totalTax,
	} = calculateTotal({
		lineItems,
		taxRate,
		vatRate,
		discount: discount ?? 0,
		includeVat,
		includeTax,
	});

	return (
		<div className="w-[320px] flex flex-col">
			<div className="flex justify-between items-center py-1">
				<span className="text-[11px] text-[var(--invoice-muted)] font-mono">
					{subtotalLabel}
				</span>
				<span className="text-right text-[11px] text-[var(--invoice-muted)]">
					{currency &&
						formatAmount({
							amount: subTotal,
							currency,
							locale,
							maximumFractionDigits,
							currencyDisplay: "code",
						})}
				</span>
			</div>

			{includeDiscount && (
				<div className="flex justify-between items-center py-1">
					<span className="text-[11px] text-[var(--invoice-muted)] font-mono">
						{discountLabel}
					</span>
					<span className="text-right text-[11px] text-[var(--invoice-muted)]">
						{currency &&
							formatAmount({
								amount: discount ?? 0,
								currency,
								locale,
								maximumFractionDigits,
								currencyDisplay: "code",
							})}
					</span>
				</div>
			)}

			{includeVat && (
				<div className="flex justify-between items-center py-1">
					<span className="text-[11px] text-[var(--invoice-muted)] font-mono">
						{vatLabel} ({vatRate}%)
					</span>
					<span className="text-right text-[11px] text-[var(--invoice-muted)]">
						{currency &&
							formatAmount({
								amount: totalVAT,
								currency,
								locale,
								maximumFractionDigits: 2,
								currencyDisplay: "code",
							})}
					</span>
				</div>
			)}

			{includeTax && (
				<div className="flex justify-between items-center py-1">
					<span className="text-[11px] text-[var(--invoice-muted)] font-mono">
						{taxLabel} ({taxRate}%)
					</span>
					<span className="text-right text-[11px] text-[var(--invoice-muted)]">
						{currency &&
							formatAmount({
								amount: totalTax,
								currency,
								locale,
								maximumFractionDigits: 2,
								currencyDisplay: "code",
							})}
					</span>
				</div>
			)}

			<div
				className="mt-2 flex items-center justify-between border-t py-4"
				style={{ borderColor: "var(--invoice-rule)" }}
			>
				<span className="text-[11px] text-[var(--invoice-muted)] font-mono">
					{totalLabel}
				</span>
				<span className="text-right text-[21px]">
					{currency &&
						formatAmount({
							amount: total,
							currency,
							locale,
							maximumFractionDigits:
								includeTax || includeVat ? 2 : maximumFractionDigits,
							currencyDisplay: "code",
						})}
				</span>
			</div>
		</div>
	);
}
