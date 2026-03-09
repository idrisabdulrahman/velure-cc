import { randomUUID } from 'node:crypto'
import { ConvexHttpClient } from 'convex/browser'
import type { Id } from '../../convex/_generated/dataModel'
import type { InvoiceRecord, InvoiceStatus } from '#/features/invoices/types'
import { api } from '../../convex/_generated/api'

export type Invoice = InvoiceRecord

let convexClient: ConvexHttpClient | null = null

function getConvexClient() {
  if (convexClient) return convexClient

  const deploymentUrl =
    process.env.CONVEX_URL ||
    process.env.VITE_CONVEX_URL ||
    process.env.NUXT_CONVEX_URL ||
    ''

  if (!deploymentUrl) {
    throw new Error('Missing CONVEX_URL or VITE_CONVEX_URL')
  }

  convexClient = new ConvexHttpClient(deploymentUrl)
  return convexClient
}

function nextInvoiceNumber(invoices: Invoice[]) {
  return `INV-2026-${String(invoices.length + 1).padStart(3, '0')}`
}

function randomId(prefix: string) {
  return `${prefix}-${randomUUID()}`
}

export async function listInvoices(filter?: {
  q?: string
  status?: 'all' | InvoiceStatus
}) {
  const convex = getConvexClient()

  return (await convex.query(api.invoices.list, {
    q: filter?.q,
    status: filter?.status,
  })) as Invoice[]
}

export async function getInvoiceById(id: string) {
  const convex = getConvexClient()

  return (await convex.query(api.invoices.getById, {
    id: id as Id<'invoices'>,
  })) as Invoice | null
}

export async function getInvoiceByToken(token: string) {
  const convex = getConvexClient()

  return (await convex.query(api.invoices.getByToken, {
    token,
  })) as Invoice | null
}

export async function createDraftInvoice() {
  const convex = getConvexClient()

  const existing = await listInvoices({ status: 'all' })
  const now = new Date()
  const dueDate = new Date(now)
  dueDate.setDate(dueDate.getDate() + 14)

  const draft = {
    token: randomId('pub'),
    invoiceNumber: nextInvoiceNumber(existing),
    customerName: '',
    currency: 'USD',
    issueDate: now.toISOString().slice(0, 10),
    dueDate: dueDate.toISOString().slice(0, 10),
    lineItems: [{ id: randomId('li'), name: '', quantity: 1, price: 0 }],
  }

  return (await convex.mutation(api.invoices.createDraft, draft)) as Invoice
}

export async function saveInvoice(input: Invoice) {
  const convex = getConvexClient()

  return (await convex.mutation(api.invoices.save, {
    ...input,
    id: input.id as Id<'invoices'>,
  })) as Invoice
}

export async function invoiceSummary() {
  const convex = getConvexClient()

  return (await convex.query(api.invoices.summary, {})) as {
    open: number
    paid: number
    overdue: number
  }
}

export async function listInvoiceProducts() {
  const convex = getConvexClient()

  return (await convex.query(api.invoices.products, {})) as Array<{
    name: string
    quantity: number
    amount: number
    currency: string
    usedIn: number
  }>
}
