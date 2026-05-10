import { createStore } from "zustand";
import type { InvoiceRecord } from "./types";

type InvoiceState = {
  invoices: InvoiceRecord[];
};

function createSeedInvoices(): InvoiceRecord[] {
  const now = Date.now();

  const defaults = {
    type: "one-time" as const,
    invoiceSize: "A4" as const,
    dateFormat: "iso" as const,
    paymentTermsDays: 14,
    template: "Default",
    createdAt: now,
    updatedAt: now,
  };

  return [
    {
      ...defaults,
      id: "inv-1",
      token: "pub-inv-1",
      invoiceNumber: "INV-2026-001",
      customerName: "Acme Studio",
      currency: "USD",
      issueDate: "2026-02-01",
      dueDate: "2026-02-21",
      status: "unpaid",
      notes: "Thanks for your business.",
      lineItems: [
        { id: "li-1", name: "Design Retainer", quantity: 1, price: 2500 },
        { id: "li-2", name: "Landing Page Build", quantity: 1, price: 1800 },
      ],
    },
    {
      ...defaults,
      id: "inv-2",
      token: "pub-inv-2",
      invoiceNumber: "INV-2026-002",
      customerName: "Northwind Labs",
      currency: "USD",
      issueDate: "2026-01-15",
      dueDate: "2026-02-10",
      status: "paid",
      lineItems: [{ id: "li-3", name: "Product Discovery", quantity: 10, price: 120 }],
    },
    {
      ...defaults,
      id: "inv-3",
      token: "pub-inv-3",
      invoiceNumber: "INV-2026-003",
      customerName: "Blue Ocean LLC",
      currency: "USD",
      issueDate: "2026-01-10",
      dueDate: "2026-01-24",
      status: "overdue",
      lineItems: [{ id: "li-4", name: "Engineering Hours", quantity: 24, price: 95 }],
    },
  ];
}

export const invoiceStore = createStore<InvoiceState>(() => ({
  invoices: createSeedInvoices(),
}));

export function getInvoiceById(id: string) {
  return invoiceStore.getState().invoices.find((invoice) => invoice.id === id) ?? null;
}

export function getInvoiceByToken(token: string) {
  return invoiceStore.getState().invoices.find((invoice) => invoice.token === token) ?? null;
}

export function createDraftInvoice() {
  const now = new Date();
  const dueDate = new Date(now);
  dueDate.setDate(dueDate.getDate() + 14);

  const next = invoiceStore.getState().invoices.length + 1;
  const pad = String(next).padStart(3, "0");
  const invoice: InvoiceRecord = {
    id: `inv-${crypto.randomUUID()}`,
    token: `pub-${crypto.randomUUID()}`,
    invoiceNumber: `INV-2026-${pad}`,
    customerName: "",
    currency: "USD",
    type: "one-time",
    invoiceSize: "A4",
    dateFormat: "iso",
    paymentTermsDays: 14,
    template: "Default",
    issueDate: now.toISOString().slice(0, 10),
    dueDate: dueDate.toISOString().slice(0, 10),
    status: "draft",
    lineItems: [{ id: `li-${crypto.randomUUID()}`, name: "", quantity: 1, price: 0 }],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  invoiceStore.setState((state) => ({
    ...state,
    invoices: [invoice, ...state.invoices],
  }));

  return invoice;
}

export function saveInvoice(updated: InvoiceRecord) {
  invoiceStore.setState((state) => ({
    ...state,
    invoices: state.invoices.map((invoice) => (invoice.id === updated.id ? updated : invoice)),
  }));
}
