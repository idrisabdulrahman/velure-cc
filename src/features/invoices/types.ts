export type InvoiceStatus =
  | 'draft'
  | 'unpaid'
  | 'paid'
  | 'overdue'
  | 'canceled'
  | 'scheduled'

export type InvoiceLineItem = {
  id: string
  name: string
  quantity: number
  price: number
}

export type InvoiceType = 'one-time' | 'recurring'
export type InvoiceSize = 'A4' | 'LETTER'
export type InvoiceDateFormat = 'iso' | 'us'

export type InvoiceRecord = {
  id: string
  token: string
  invoiceNumber: string
  customerName: string
  logoUrl?: string
  currency: string
  type: InvoiceType
  invoiceSize: InvoiceSize
  dateFormat: InvoiceDateFormat
  paymentTermsDays: number
  template: string
  issueDate: string
  dueDate: string
  status: InvoiceStatus
  paymentDetails?: string
  notes?: string
  lineItems: InvoiceLineItem[]
  createdAt: number
  updatedAt: number
}
