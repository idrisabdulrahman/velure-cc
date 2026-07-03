import { formatAmount } from "#/shims/midday-utils/format";
import type { LineItem } from "../../../types";
import { calculateLineItemTotal } from "../../../utils/calculate";
import { Description } from "./description";

type Props = {
	lineItems: LineItem[];
	currency: string | null;
	descriptionLabel: string;
	quantityLabel: string;
	priceLabel: string;
	totalLabel: string;
	includeDecimals?: boolean;
	locale: string;
	includeUnits?: boolean;
	appearance?: "print" | "app" | "public";
};

export function LineItems({
	lineItems,
	currency,
	descriptionLabel,
	quantityLabel,
	priceLabel,
	totalLabel,
	includeDecimals = false,
	includeUnits = false,
	locale,
	appearance = "print",
}: Props) {
	const maximumFractionDigits = includeDecimals ? 2 : 0;
	const isPublicAppearance = appearance === "public";
	const currencyDisplay =
		isPublicAppearance || currency !== "NGN" ? "code" : "symbol";
	const wrapperClassName = isPublicAppearance ? "mt-7" : "mt-5 font-mono";
	const gridClassName = isPublicAppearance
		? "grid grid-cols-[1.7fr_72px_120px_136px] gap-5"
		: "grid grid-cols-[1.5fr_15%_15%_15%] gap-4";
	const headerTextClassName = isPublicAppearance
		? "text-[12px] text-[var(--invoice-muted)]"
		: "text-[11px] text-[var(--invoice-muted)]";
	const rowTextClassName = isPublicAppearance ? "text-[13px]" : "text-[11px]";

	return (
		<div className={wrapperClassName}>
			<div
				className={`${gridClassName} relative mb-2 w-full items-end border-b pb-2`}
				style={{ borderColor: "var(--invoice-rule)" }}
			>
				<div className={headerTextClassName}>{descriptionLabel}</div>
				<div className={headerTextClassName}>{quantityLabel}</div>
				<div className={headerTextClassName}>{priceLabel}</div>
				<div className={`${headerTextClassName} text-right`}>{totalLabel}</div>
			</div>

			{lineItems.map((item, index) => (
				<div
					key={`line-item-${index.toString()}`}
					className={`${gridClassName} relative mb-1 w-full items-start py-1`}
				>
					<div className="self-start">
						<Description content={item.name} />
					</div>
					<div className={`${rowTextClassName} self-start`}>
						{item.quantity ?? 0}
					</div>
					<div className={`${rowTextClassName} self-start`}>
						{currency && includeUnits && item.unit
							? `${formatAmount({
									currency,
									amount: item.price ?? 0,
									maximumFractionDigits,
									locale,
									currencyDisplay,
								})}/${item.unit}`
							: currency &&
								formatAmount({
									currency,
									amount: item.price ?? 0,
									maximumFractionDigits,
									locale,
									currencyDisplay,
								})}
					</div>
					<div className={`${rowTextClassName} self-start text-right`}>
						{currency &&
							formatAmount({
								maximumFractionDigits,
								currency,
								amount: calculateLineItemTotal({
									price: item.price,
									quantity: item.quantity,
								}),
								locale,
								currencyDisplay,
							})}
					</div>
				</div>
			))}
		</div>
	);
}
