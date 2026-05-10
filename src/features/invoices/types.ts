import type { FiscalizationSnapshot, InvoiceComplianceSnapshot } from "../compliance/types";
import type { InvoiceSyncSnapshot } from "../integrations/types";
import type { ReminderSnapshot } from "../reminders/types";

export type InvoiceStatus = "draft" | "unpaid" | "paid" | "overdue" | "canceled" | "scheduled";

export type InvoiceLineItem = {
  id: string;
  name: string;
  quantity: number;
  price: number;
};

export type InvoiceType = "one-time" | "recurring";
export type InvoiceSize = "A4" | "LETTER";
export type InvoiceDateFormat = "iso" | "us" | "ng";

export type InvoiceRecord = {
  id: string;
  token: string;
  invoiceNumber: string;
  customerName: string;
  logoUrl?: string;
  currency: string;
  type: InvoiceType;
  invoiceSize: InvoiceSize;
  dateFormat: InvoiceDateFormat;
  paymentTermsDays: number;
  template: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  paymentDetails?: string;
  paymentLink?: string;
  paymentProvider?: "manual" | "paystack";
  paidAt?: number;
  paymentReference?: string;
  notes?: string;
  lineItems: InvoiceLineItem[];
  compliance?: InvoiceComplianceSnapshot;
  fiscalization?: FiscalizationSnapshot;
  reminder?: ReminderSnapshot;
  sync?: InvoiceSyncSnapshot;
  createdAt: number;
  updatedAt: number;
};
