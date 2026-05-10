import type { InvoiceRecord } from "./types";

export function invoiceSubtotal(invoice: InvoiceRecord) {
  return invoice.lineItems.reduce((sum, item) => sum + item.quantity * item.price, 0);
}

export function invoiceTotal(invoice: InvoiceRecord) {
  if (invoice.compliance?.grandTotal !== undefined) {
    return invoice.compliance.grandTotal - (invoice.compliance.withholdingTaxAmount ?? 0);
  }

  return invoiceSubtotal(invoice);
}
