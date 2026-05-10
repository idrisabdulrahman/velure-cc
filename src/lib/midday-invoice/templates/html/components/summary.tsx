import { formatAmount } from "#/shims/midday-utils/format";
import type { LineItem } from "../../../types";
import { calculateTotal } from "../../../utils/calculate";

type Props = {
  includeVat: boolean;
  includeTax: boolean;
  includeDiscount: boolean;
  discount?: number | null;
  discountLabel: string;
  withholdingTaxAmount?: number | null;
  withholdingTaxLabel: string;
  withholdingTaxRate?: number;
  netPayable?: number | null;
  netAmountLabel: string;
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
  appearance?: "print" | "app" | "public";
};

export function Summary({
  includeVat,
  includeTax,
  includeDiscount,
  discountLabel,
  locale,
  discount,
  withholdingTaxAmount,
  withholdingTaxLabel,
  withholdingTaxRate,
  netPayable,
  netAmountLabel,
  taxRate,
  vatRate,
  currency,
  vatLabel,
  taxLabel,
  totalLabel,
  lineItems,
  includeDecimals,
  subtotalLabel,
  appearance = "print",
}: Props) {
  const maximumFractionDigits = includeDecimals ? 2 : 0;
  const isPublicAppearance = appearance === "public";
  const currencyDisplay = isPublicAppearance || currency !== "NGN" ? "code" : "symbol";
  const labelClassName = isPublicAppearance
    ? "text-[12px] text-[var(--invoice-muted)]"
    : "text-[11px] text-[var(--invoice-muted)] font-mono";
  const amountClassName = isPublicAppearance
    ? "text-right text-[13px] text-[var(--invoice-muted)]"
    : "text-right text-[11px] text-[var(--invoice-muted)]";

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
    <div className="flex w-[320px] flex-col">
      <div className="flex justify-between items-center py-1">
        <span className={labelClassName}>{subtotalLabel}</span>
        <span className={amountClassName}>
          {currency &&
            formatAmount({
              amount: subTotal,
              currency,
              locale,
              maximumFractionDigits,
              currencyDisplay,
            })}
        </span>
      </div>

      {includeDiscount && (
        <div className="flex justify-between items-center py-1">
          <span className={labelClassName}>{discountLabel}</span>
          <span className={amountClassName}>
            {currency &&
              formatAmount({
                amount: discount ?? 0,
                currency,
                locale,
                maximumFractionDigits,
                currencyDisplay,
              })}
          </span>
        </div>
      )}

      {includeVat && (
        <div className="flex justify-between items-center py-1">
          <span className={labelClassName}>
            {vatLabel} ({vatRate}%)
          </span>
          <span className={amountClassName}>
            {currency &&
              formatAmount({
                amount: totalVAT,
                currency,
                locale,
                maximumFractionDigits: 2,
                currencyDisplay,
              })}
          </span>
        </div>
      )}

      {includeTax && (
        <div className="flex justify-between items-center py-1">
          <span className={labelClassName}>
            {taxLabel} ({taxRate}%)
          </span>
          <span className={amountClassName}>
            {currency &&
              formatAmount({
                amount: totalTax,
                currency,
                locale,
                maximumFractionDigits: 2,
                currencyDisplay,
              })}
          </span>
        </div>
      )}

      {(withholdingTaxAmount ?? 0) > 0 && (
        <div className="flex justify-between items-center py-1">
          <span className={labelClassName}>
            {withholdingTaxLabel} ({withholdingTaxRate ?? 0}%)
          </span>
          <span className={amountClassName}>
            {currency &&
              formatAmount({
                amount: -(withholdingTaxAmount ?? 0),
                currency,
                locale,
                maximumFractionDigits: 2,
                currencyDisplay,
              })}
          </span>
        </div>
      )}

      <div
        className={`mt-2 flex items-center justify-between border-t ${isPublicAppearance ? "py-5" : "py-4"}`}
        style={{ borderColor: "var(--invoice-rule)" }}
      >
        <span className={labelClassName}>{totalLabel}</span>
        <span className={`text-right ${isPublicAppearance ? "text-[26px]" : "text-[21px]"}`}>
          {currency &&
            formatAmount({
              amount: total,
              currency,
              locale,
              maximumFractionDigits: includeTax || includeVat ? 2 : maximumFractionDigits,
              currencyDisplay,
            })}
        </span>
      </div>

      {(netPayable ?? total) !== total && (
        <div className="flex justify-between items-center pb-1">
          <span className={labelClassName}>{netAmountLabel}</span>
          <span
            className={`text-right font-medium ${isPublicAppearance ? "text-[16px]" : "text-[15px]"}`}
          >
            {currency &&
              formatAmount({
                amount: netPayable ?? total,
                currency,
                locale,
                maximumFractionDigits: 2,
                currencyDisplay,
              })}
          </span>
        </div>
      )}
    </div>
  );
}
