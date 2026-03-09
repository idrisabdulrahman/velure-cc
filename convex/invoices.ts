import { mutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  invoices: defineTable({
    token: v.string(),
    invoiceNumber: v.string(),
    customerName: v.string(),
    logoUrl: v.optional(v.string()),
    currency: v.string(),
    type: v.optional(v.union(v.literal('one-time'), v.literal('recurring'))),
    invoiceSize: v.optional(v.union(v.literal('A4'), v.literal('LETTER'))),
    dateFormat: v.optional(v.union(v.literal('iso'), v.literal('us'))),
    paymentTermsDays: v.optional(v.number()),
    template: v.optional(v.string()),
    issueDate: v.string(),
    dueDate: v.string(),
    status: v.union(
      v.literal('draft'),
      v.literal('unpaid'),
      v.literal('paid'),
      v.literal('overdue'),
      v.literal('canceled'),
      v.literal('scheduled'),
    ),
    paymentDetails: v.optional(v.string()),
    notes: v.optional(v.string()),
    lineItems: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        quantity: v.number(),
        price: v.number(),
      }),
    ),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  }).index('by_token', ['token']),
})
const statusValidator = v.union(
  v.literal('draft'),
  v.literal('unpaid'),
  v.literal('paid'),
  v.literal('overdue'),
  v.literal('canceled'),
  v.literal('scheduled'),
)

const typeValidator = v.union(v.literal('one-time'), v.literal('recurring'))
const invoiceSizeValidator = v.union(v.literal('A4'), v.literal('LETTER'))
const dateFormatValidator = v.union(v.literal('iso'), v.literal('us'))

const lineItemValidator = v.object({
  id: v.string(),
  name: v.string(),
  quantity: v.number(),
  price: v.number(),
})

const invoiceValidator = v.object({
  id: v.id('invoices'),
  token: v.string(),
  invoiceNumber: v.string(),
  customerName: v.string(),
  logoUrl: v.optional(v.string()),
  currency: v.string(),
  type: typeValidator,
  invoiceSize: invoiceSizeValidator,
  dateFormat: dateFormatValidator,
  paymentTermsDays: v.number(),
  template: v.string(),
  issueDate: v.string(),
  dueDate: v.string(),
  status: statusValidator,
  paymentDetails: v.optional(v.string()),
  notes: v.optional(v.string()),
  lineItems: v.array(lineItemValidator),
})

const mapInvoice = (invoice: {
  _id: Id<'invoices'>
  token: string
  invoiceNumber: string
  customerName: string
  logoUrl?: string
  currency: string
  type?: 'one-time' | 'recurring'
  invoiceSize?: 'A4' | 'LETTER'
  dateFormat?: 'iso' | 'us'
  paymentTermsDays?: number
  template?: string
  issueDate: string
  dueDate: string
  status: 'draft' | 'unpaid' | 'paid' | 'overdue' | 'canceled' | 'scheduled'
  paymentDetails?: string
  notes?: string
  lineItems: Array<{ id: string; name: string; quantity: number; price: number }>
  createdAt?: number
  updatedAt?: number
}) => ({
  id: invoice._id,
  token: invoice.token,
  invoiceNumber: invoice.invoiceNumber,
  customerName: invoice.customerName,
  logoUrl: invoice.logoUrl,
  currency: invoice.currency,
  type: invoice.type ?? 'one-time',
  invoiceSize: invoice.invoiceSize ?? 'A4',
  dateFormat: invoice.dateFormat ?? 'iso',
  paymentTermsDays: invoice.paymentTermsDays ?? 14,
  template: invoice.template ?? 'Default',
  issueDate: invoice.issueDate,
  dueDate: invoice.dueDate,
  status: invoice.status,
  paymentDetails: invoice.paymentDetails,
  notes: invoice.notes,
  lineItems: invoice.lineItems,
  createdAt: invoice.createdAt ?? Date.now(),
  updatedAt: invoice.updatedAt ?? Date.now(),
})

export const list = query({
  args: {
    q: v.optional(v.string()),
    status: v.optional(v.union(v.literal('all'), statusValidator)),
    type: v.optional(v.union(v.literal('all'), typeValidator)),
    customer: v.optional(v.string()),
    dueDateFrom: v.optional(v.string()),
    dueDateTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let invoices = await ctx.db.query('invoices').order('desc').collect()

    if (args.status && args.status !== 'all') {
      invoices = invoices.filter((invoice) => invoice.status === args.status)
    }

    if (args.type && args.type !== 'all') {
      invoices = invoices.filter(
        (invoice) => (invoice.type ?? 'one-time') === args.type,
      )
    }

    if (args.customer && args.customer.trim().length > 0) {
      const customer = args.customer.trim().toLowerCase()
      invoices = invoices.filter((invoice) =>
        invoice.customerName.toLowerCase().includes(customer),
      )
    }

    const dueDateFrom = args.dueDateFrom
    if (dueDateFrom) {
      invoices = invoices.filter((invoice) => invoice.dueDate >= dueDateFrom)
    }

    const dueDateTo = args.dueDateTo
    if (dueDateTo) {
      invoices = invoices.filter((invoice) => invoice.dueDate <= dueDateTo)
    }

    const queryText = (args.q ?? '').toLowerCase().trim()
    if (queryText.length > 0) {
      invoices = invoices.filter(
        (invoice) =>
          invoice.customerName.toLowerCase().includes(queryText) ||
          invoice.invoiceNumber.toLowerCase().includes(queryText),
      )
    }

    return invoices.map(mapInvoice)
  },
})

export const getById = query({
  args: { id: v.id('invoices') },
  handler: async (ctx, args) => {
    const invoice = await ctx.db.get(args.id)
    if (!invoice) return null

    return mapInvoice(invoice)
  },
})

export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const invoice = await ctx.db
      .query('invoices')
      .withIndex('by_token', (q) => q.eq('token', args.token))
      .first()

    if (!invoice) return null

    return mapInvoice(invoice)
  },
})

export const createDraft = mutation({
  args: {
    token: v.string(),
    invoiceNumber: v.string(),
    customerName: v.string(),
    logoUrl: v.optional(v.string()),
    currency: v.string(),
    type: v.optional(typeValidator),
    invoiceSize: v.optional(invoiceSizeValidator),
    dateFormat: v.optional(dateFormatValidator),
    paymentTermsDays: v.optional(v.number()),
    template: v.optional(v.string()),
    issueDate: v.string(),
    dueDate: v.string(),
    paymentDetails: v.optional(v.string()),
    notes: v.optional(v.string()),
    lineItems: v.array(lineItemValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const id = await ctx.db.insert('invoices', {
      token: args.token,
      invoiceNumber: args.invoiceNumber,
      customerName: args.customerName,
      logoUrl: args.logoUrl,
      currency: args.currency,
      type: args.type ?? 'one-time',
      invoiceSize: args.invoiceSize ?? 'A4',
      dateFormat: args.dateFormat ?? 'iso',
      paymentTermsDays: args.paymentTermsDays ?? 14,
      template: args.template ?? 'Default',
      issueDate: args.issueDate,
      dueDate: args.dueDate,
      status: 'draft',
      paymentDetails: args.paymentDetails,
      notes: args.notes,
      lineItems: args.lineItems,
      createdAt: now,
      updatedAt: now,
    })

    return mapInvoice({
      _id: id,
      token: args.token,
      invoiceNumber: args.invoiceNumber,
      customerName: args.customerName,
      logoUrl: args.logoUrl,
      currency: args.currency,
      type: args.type,
      invoiceSize: args.invoiceSize,
      dateFormat: args.dateFormat,
      paymentTermsDays: args.paymentTermsDays,
      template: args.template,
      issueDate: args.issueDate,
      dueDate: args.dueDate,
      status: 'draft',
      paymentDetails: args.paymentDetails,
      notes: args.notes,
      lineItems: args.lineItems,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const save = mutation({
  args: invoiceValidator,
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      token: args.token,
      invoiceNumber: args.invoiceNumber,
      customerName: args.customerName,
      logoUrl: args.logoUrl,
      currency: args.currency,
      type: args.type,
      invoiceSize: args.invoiceSize,
      dateFormat: args.dateFormat,
      paymentTermsDays: args.paymentTermsDays,
      template: args.template,
      issueDate: args.issueDate,
      dueDate: args.dueDate,
      status: args.status,
      paymentDetails: args.paymentDetails,
      notes: args.notes,
      lineItems: args.lineItems,
      updatedAt: Date.now(),
    })

    return args
  },
})

export const saveDraftSettings = mutation({
  args: {
    id: v.id('invoices'),
    invoiceSize: invoiceSizeValidator,
    dateFormat: dateFormatValidator,
    paymentTermsDays: v.number(),
    template: v.string(),
    currency: v.string(),
    type: typeValidator,
    dueDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      invoiceSize: args.invoiceSize,
      dateFormat: args.dateFormat,
      paymentTermsDays: args.paymentTermsDays,
      template: args.template,
      currency: args.currency,
      type: args.type,
      dueDate: args.dueDate,
      updatedAt: Date.now(),
    })
    return { ok: true }
  },
})

export const updateStatus = mutation({
  args: {
    id: v.id('invoices'),
    status: statusValidator,
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.status,
      updatedAt: Date.now(),
    })

    return { ok: true }
  },
})

export const remove = mutation({
  args: { id: v.id('invoices') },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id)
    return { ok: true }
  },
})

export const duplicate = mutation({
  args: { id: v.id('invoices') },
  handler: async (ctx, args) => {
    const source = await ctx.db.get(args.id)
    if (!source) {
      throw new Error('Invoice not found.')
    }

    const invoices = await ctx.db.query('invoices').collect()
    const maxSequence = invoices.reduce((max, invoice) => {
      const match = invoice.invoiceNumber.match(/(\d+)$/)
      if (!match) return max
      return Math.max(max, Number(match[1]))
    }, 0)

    const nextSequence = String(maxSequence + 1).padStart(3, '0')
    const nextInvoiceNumber = source.invoiceNumber.replace(/\d+$/, nextSequence)

    const now = Date.now()
    const id = await ctx.db.insert('invoices', {
      token: `pub-${crypto.randomUUID()}`,
      invoiceNumber: nextInvoiceNumber,
      customerName: source.customerName,
      logoUrl: source.logoUrl,
      currency: source.currency,
      type: source.type ?? 'one-time',
      invoiceSize: source.invoiceSize ?? 'A4',
      dateFormat: source.dateFormat ?? 'iso',
      paymentTermsDays: source.paymentTermsDays ?? 14,
      template: source.template ?? 'Default',
      issueDate: source.issueDate,
      dueDate: source.dueDate,
      status: 'draft',
      paymentDetails: source.paymentDetails,
      notes: source.notes,
      lineItems: source.lineItems,
      createdAt: now,
      updatedAt: now,
    })

    return { id }
  },
})

export const summary = query({
  args: {},
  handler: async (ctx) => {
    const invoices = await ctx.db.query('invoices').collect()

    const totalForStatuses = (
      statuses: Array<
        'draft' | 'unpaid' | 'paid' | 'overdue' | 'canceled' | 'scheduled'
      >,
    ) => {
      return invoices
        .filter((invoice) => statuses.includes(invoice.status))
        .reduce(
          (sum, invoice) =>
            sum +
            invoice.lineItems.reduce(
              (lineItemSum, item) => lineItemSum + item.quantity * item.price,
              0,
            ),
          0,
        )
    }

    return {
      open: totalForStatuses(['draft', 'unpaid', 'overdue']),
      paid: totalForStatuses(['paid']),
      overdue: totalForStatuses(['overdue']),
    }
  },
})

export const products = query({
  args: {},
  handler: async (ctx) => {
    const invoices = await ctx.db.query('invoices').collect()
    const map = new Map<
      string,
      { quantity: number; amount: number; currency: string; usedIn: number }
    >()

    for (const invoice of invoices) {
      for (const item of invoice.lineItems) {
        const name = item.name.trim() || 'Untitled Item'
        const existing = map.get(name)

        if (existing) {
          existing.quantity += item.quantity
          existing.amount += item.quantity * item.price
          existing.usedIn += 1
        } else {
          map.set(name, {
            quantity: item.quantity,
            amount: item.quantity * item.price,
            currency: invoice.currency,
            usedIn: 1,
          })
        }
      }
    }

    return [...map.entries()]
      .map(([name, value]) => ({ name, ...value }))
      .sort((a, b) => b.amount - a.amount)
  },
})
