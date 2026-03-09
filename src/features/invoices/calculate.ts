import type { InvoiceRecord } from './types'

export function invoiceTotal(invoice: InvoiceRecord) {
  return invoice.lineItems.reduce((sum, item) => sum + item.quantity * item.price, 0)
}
