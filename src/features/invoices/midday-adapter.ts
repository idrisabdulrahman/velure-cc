import type { Invoice as MiddayInvoice, Template } from "#/lib/midday-invoice/types";
import { calculateInvoiceCompliance } from "#/features/compliance/calculate";
import { NIGERIA_AUTHORITY_LABEL } from "#/features/compliance/nigeria";
import { normalizeCurrencyCode, resolveCurrencyLocale } from "./format";
import type { InvoiceRecord } from "./types";

type EditorDoc = {
  type: "doc";
  content: Array<{
    type: "paragraph";
    content: Array<{ type: "text"; text: string }>;
  }>;
};

function toEditorDoc(text: string | null | undefined): EditorDoc | null {
  if (!text || text.trim().length === 0) return null;

  const paragraphs = text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (paragraphs.length === 0) return null;

  return {
    type: "doc",
    content: paragraphs.map((line) => ({
      type: "paragraph",
      content: [{ type: "text", text: line }],
    })),
  };
}

function amountFromLineItems(invoice: InvoiceRecord) {
  return invoice.lineItems.reduce((sum, item) => sum + item.quantity * item.price, 0);
}

function buildIdentityDoc(lines: Array<string | null | undefined>) {
  return toEditorDoc(
    lines
      .map((line) => line?.trim())
      .filter((line): line is string => Boolean(line && line.length > 0))
      .join("\n"),
  );
}

function buildTemplate(invoice: InvoiceRecord): Template {
  const templateSize = invoice.invoiceSize === "LETTER" ? "letter" : "a4";
  const dateFormat =
    invoice.dateFormat === "us"
      ? "MM/dd/yyyy"
      : invoice.dateFormat === "ng"
        ? "dd/MM/yyyy"
        : "yyyy-MM-dd";
  const currency = normalizeCurrencyCode(invoice.currency);
  const compliance =
    invoice.compliance ??
    calculateInvoiceCompliance({
      seller: { legalName: "Velure", countryCode: "NG" },
      buyer: {
        legalName: invoice.customerName,
        countryCode: "NG",
      },
      currency: invoice.currency,
      lineItems: invoice.lineItems,
    });

  return {
    customerLabel: "To",
    title: "Invoice",
    fromLabel: "From",
    invoiceNoLabel: "Invoice No",
    issueDateLabel: "Issue Date",
    dueDateLabel: "Due Date",
    descriptionLabel: "Description",
    priceLabel: "Price",
    quantityLabel: "Quantity",
    totalLabel: "Total",
    totalSummaryLabel: "Total",
    vatLabel: "VAT",
    subtotalLabel: "Subtotal",
    taxLabel: "Tax",
    discountLabel: "Discount",
    withholdingTaxLabel: compliance.withholdingTaxLabel,
    netAmountLabel:
      compliance.withholding.category === "none" ? "Amount Payable" : "Net Amount Payable",
    timezone: "UTC",
    paymentLabel: "Payment Details",
    noteLabel: "Note",
    logoUrl: invoice.logoUrl?.trim() ? invoice.logoUrl.trim() : null,
    currency,
    paymentDetails: toEditorDoc(invoice.paymentDetails),
    fromDetails: buildIdentityDoc([
      compliance.seller.legalName ?? compliance.seller.tradingName ?? "Velure",
      compliance.seller.address,
      compliance.seller.email,
      compliance.seller.phone,
      compliance.seller.taxId ? `TIN: ${compliance.seller.taxId}` : undefined,
      compliance.seller.rcNumber ? `CAC RC Number: ${compliance.seller.rcNumber}` : undefined,
      NIGERIA_AUTHORITY_LABEL,
    ]),
    noteDetails: null,
    dateFormat,
    includeVat: compliance.taxLabel.toUpperCase() === "VAT" && compliance.taxLines.length > 0,
    includeTax: compliance.taxLabel.toUpperCase() !== "VAT" && compliance.taxLines.length > 0,
    includeDiscount: false,
    includeDecimals: true,
    includeUnits: false,
    includeQr: false,
    taxRate: compliance.taxLabel.toUpperCase() === "VAT" ? 0 : compliance.taxRate,
    vatRate: compliance.taxLabel.toUpperCase() === "VAT" ? compliance.taxRate : 0,
    withholdingTaxRate: compliance.withholdingTaxRate,
    size: templateSize,
    deliveryType: "create",
    locale: resolveCurrencyLocale(currency),
  };
}

export function getInvoiceTemplateSize(template: Template) {
  if (template.size === "letter") {
    return { width: 750, height: 1056 };
  }

  return { width: 595, height: 842 };
}

export function toMiddayInvoice(invoice: InvoiceRecord): MiddayInvoice {
  const template = buildTemplate(invoice);
  const compliance =
    invoice.compliance ??
    calculateInvoiceCompliance({
      seller: { legalName: "Velure", countryCode: "NG" },
      buyer: {
        legalName: invoice.customerName,
        countryCode: "NG",
      },
      currency: invoice.currency,
      lineItems: invoice.lineItems,
    });
  const amount = compliance.grandTotal || amountFromLineItems(invoice);
  const netPayable = amount - (compliance.withholdingTaxAmount || 0);
  const customerName = invoice.customerName || null;

  return {
    id: invoice.id,
    dueDate: invoice.dueDate,
    invoiceNumber: invoice.invoiceNumber,
    createdAt: new Date().toISOString(),
    amount,
    currency: normalizeCurrencyCode(invoice.currency),
    lineItems: invoice.lineItems,
    paymentDetails: template.paymentDetails,
    customerDetails: buildIdentityDoc([
      invoice.customerName || "Untitled customer",
      compliance.buyer.email,
      compliance.buyer.phone,
      compliance.buyer.taxId ? `Buyer TIN: ${compliance.buyer.taxId}` : undefined,
    ]),
    reminderSentAt: null,
    updatedAt: null,
    note: null,
    internalNote: null,
    paidAt: invoice.reminder?.paidAt ? new Date(invoice.reminder.paidAt).toISOString() : null,
    vat: template.includeVat ? compliance.totalTax : null,
    tax: template.includeTax ? compliance.totalTax : null,
    withholdingTax: compliance.withholdingTaxAmount || null,
    netPayable,
    regulatoryNotice: compliance.regulatoryNotice ?? null,
    filePath: null,
    status: invoice.status,
    viewedAt: null,
    fromDetails: template.fromDetails,
    issueDate: invoice.issueDate,
    sentAt: null,
    template,
    noteDetails: toEditorDoc(
      [invoice.notes, compliance.regulatoryNotice].filter(Boolean).join("\n\n"),
    ),
    customerName,
    token: invoice.token,
    sentTo: null,
    discount: null,
    topBlock: null,
    bottomBlock: null,
    customer: {
      name: customerName,
      website: null,
      email: null,
    },
    customerId: null,
    team: {
      name: "Velure",
    },
  };
}
