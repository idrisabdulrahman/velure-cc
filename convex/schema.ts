import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  clients: defineTable({
    name: v.string(),
    company: v.optional(v.string()),
    email: v.string(),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    billingAddress: v.optional(v.string()),
    taxId: v.optional(v.string()),
    currency: v.string(),
    paymentTerms: v.string(),
    internalNotes: v.optional(v.string()),
    contact: v.object({
      fullName: v.optional(v.string()),
      role: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
    }),
    favorite: v.boolean(),
    status: v.union(
      v.literal('active'),
      v.literal('pending'),
      v.literal('inactive'),
      v.literal('archived'),
    ),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
  })
    .index('by_email', ['email'])
    .index('by_status', ['status'])
    .index('by_updatedAt', ['updatedAt']),
  products: defineTable({
    title: v.string(),
    imageId: v.string(),
    price: v.number(),
  }),
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
  })
    .index('by_token', ['token'])
    .index('by_invoice_number', ['invoiceNumber'])
    .index('by_status', ['status'])
    .index('by_updatedAt', ['updatedAt']),
  todos: defineTable({
    text: v.string(),
    completed: v.boolean(),
  }),
})
