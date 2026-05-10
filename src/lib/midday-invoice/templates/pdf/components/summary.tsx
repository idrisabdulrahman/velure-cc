import { Text, View } from "@react-pdf/renderer";
import { calculateTotal } from "../../../utils/calculate";
import { formatCurrencyForPDF } from "../../../utils/pdf-format";

interface SummaryProps {
  amount?: number | null;
  tax?: number | null;
  taxRate?: number;
  vat?: number | null;
  vatRate?: number;
  currency?: string | null;
  totalLabel: string;
  taxLabel: string;
  vatLabel: string;
  locale: string;
  discount?: number | null;
  discountLabel: string;
  withholdingTaxAmount?: number | null;
  withholdingTaxLabel: string;
  withholdingTaxRate?: number;
  netPayable?: number | null;
  netAmountLabel: string;
  includeDiscount: boolean;
  includeVat: boolean;
  includeTax: boolean;
  includeDecimals: boolean;
  subtotalLabel: string;
  lineItems: { price?: number; quantity?: number }[];
}

export function Summary({
  amount,
  tax,
  taxRate,
  vat,
  vatRate,
  currency,
  totalLabel,
  taxLabel,
  vatLabel,
  locale,
  discount,
  discountLabel,
  withholdingTaxAmount,
  withholdingTaxLabel,
  withholdingTaxRate,
  netPayable,
  netAmountLabel,
  includeDiscount,
  includeVat,
  includeTax,
  includeDecimals,
  subtotalLabel,
  lineItems,
}: SummaryProps) {
  const maximumFractionDigits = includeDecimals ? 2 : 0;
  const currencyDisplay = currency === "NGN" ? "symbol" : "code";

  // Calculate subtotal dynamically from line items (same as HTML template)
  const { subTotal: calculatedSubtotal } = calculateTotal({
    lineItems,
    taxRate: taxRate ?? 0,
    vatRate: vatRate ?? 0,
    discount: discount ?? 0,
    includeVat,
    includeTax,
  });

  const displayTotal = amount ?? 0;
  const displaySubtotal = calculatedSubtotal;
  const displayVat = vat ?? 0;
  const displayTax = tax ?? 0;

  return (
    <View
      style={{
        marginTop: 60,
        marginBottom: 40,
        alignItems: "flex-end",
        marginLeft: "auto",
        width: 250,
      }}
    >
      <View style={{ flexDirection: "row", marginBottom: 5, width: "100%" }}>
        <Text style={{ fontSize: 9, flex: 1 }}>{subtotalLabel}</Text>
        <Text style={{ fontSize: 9, textAlign: "right" }}>
          {currency &&
            formatCurrencyForPDF({
              amount: displaySubtotal,
              currency,
              locale,
              maximumFractionDigits,
              currencyDisplay,
            })}
        </Text>
      </View>

      {includeDiscount && discount && (
        <View style={{ flexDirection: "row", marginBottom: 5, width: "100%" }}>
          <Text style={{ fontSize: 9, flex: 1 }}>{discountLabel}</Text>
          <Text style={{ fontSize: 9, textAlign: "right" }}>
            {currency &&
              formatCurrencyForPDF({
                amount: discount,
                currency,
                locale,
                maximumFractionDigits,
                currencyDisplay,
              })}
          </Text>
        </View>
      )}

      {includeVat && (
        <View style={{ flexDirection: "row", marginBottom: 5, width: "100%" }}>
          <Text style={{ fontSize: 9, flex: 1 }}>
            {vatLabel} ({vatRate}%)
          </Text>
          <Text style={{ fontSize: 9, textAlign: "right" }}>
            {currency &&
              formatCurrencyForPDF({
                amount: displayVat,
                currency,
                locale,
                maximumFractionDigits: 2,
                currencyDisplay,
              })}
          </Text>
        </View>
      )}

      {includeTax && (
        <View style={{ flexDirection: "row", marginBottom: 5, width: "100%" }}>
          <Text style={{ fontSize: 9, flex: 1 }}>
            {taxLabel} ({taxRate}%)
          </Text>
          <Text style={{ fontSize: 9, textAlign: "right" }}>
            {currency &&
              formatCurrencyForPDF({
                amount: displayTax,
                currency,
                locale,
                maximumFractionDigits: 2,
                currencyDisplay,
              })}
          </Text>
        </View>
      )}

      {(withholdingTaxAmount ?? 0) > 0 && (
        <View style={{ flexDirection: "row", marginBottom: 5, width: "100%" }}>
          <Text style={{ fontSize: 9, flex: 1 }}>
            {withholdingTaxLabel} ({withholdingTaxRate ?? 0}%)
          </Text>
          <Text style={{ fontSize: 9, textAlign: "right" }}>
            {currency &&
              formatCurrencyForPDF({
                amount: -(withholdingTaxAmount ?? 0),
                currency,
                locale,
                maximumFractionDigits: 2,
                currencyDisplay,
              })}
          </Text>
        </View>
      )}

      <View
        style={{
          flexDirection: "row",
          marginTop: 5,
          borderTopWidth: 0.5,
          borderTopColor: "#000",
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: 5,
          width: "100%",
        }}
      >
        <Text style={{ fontSize: 9, marginRight: 10 }}>{totalLabel}</Text>
        <Text style={{ fontSize: 21 }}>
          {currency &&
            formatCurrencyForPDF({
              amount: displayTotal,
              currency,
              locale,
              maximumFractionDigits: includeTax || includeVat ? 2 : maximumFractionDigits,
              currencyDisplay,
            })}
        </Text>
      </View>

      {(netPayable ?? displayTotal) !== displayTotal && (
        <View style={{ flexDirection: "row", marginTop: 6, width: "100%" }}>
          <Text style={{ fontSize: 9, flex: 1 }}>{netAmountLabel}</Text>
          <Text style={{ fontSize: 14, textAlign: "right", fontWeight: 500 }}>
            {currency &&
              formatCurrencyForPDF({
                amount: netPayable ?? displayTotal,
                currency,
                locale,
                maximumFractionDigits: 2,
                currencyDisplay,
              })}
          </Text>
        </View>
      )}
    </View>
  );
}
