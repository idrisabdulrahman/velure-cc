import type { Id } from "../../../convex/_generated/dataModel";
import type {
	FiscalizationSnapshot,
	InvoiceComplianceSnapshot,
} from "../compliance/types";
import type { InvoiceSyncSnapshot } from "../integrations/types";
import type { ReminderSnapshot } from "../reminders/types";

export type InvoiceStatus =
	| "draft"
	| "unpaid"
	| "partially-paid"
	| "paid"
	| "overdue"
	| "canceled";

export type InvoiceLineItem = {
	id: string;
	name: string;
	quantity: number;
	price: number;
	productId?: Id<"products">;
};

export type InvoiceType = "one-time" | "recurring";
export type InvoiceDocumentType = "standard" | "proforma";
export type InvoiceSize = "A4" | "LETTER";
export type InvoiceDateFormat = "iso" | "us" | "ng";

export type InvoiceShipmentDetails = {
	weight?: string;
	packageCount?: number;
	hsCode?: string;
	incoterms?: string;
	portOfLoading?: string;
	portOfDischarge?: string;
};

export type InvoiceDepositRequest = {
	kind: "amount" | "percentage";
	value: number;
	dueDate?: string;
};

export type LifecycleSnapshot = {
	sentAt?: number;
	emailDeliveredAt?: number;
	firstViewedAt?: number;
	paymentReceivedAt?: number;
};

export type InvoiceRecord = {
	id: string;
	token: string;
	documentType?: InvoiceDocumentType;
	convertedToInvoiceId?: Id<"invoices">;
	shipmentDetails?: InvoiceShipmentDetails;
	depositRequest?: InvoiceDepositRequest;
	invoiceNumber: string;
	customerName: string;
	logoUrl?: string;
	customerPoNumber?: string;
	currency: string;
	type: InvoiceType;
	invoiceSize: InvoiceSize;
	dateFormat: InvoiceDateFormat;
	paymentTermsDays: number;
	template: string;
	issueDate: string;
	dueDate: string;
	status: InvoiceStatus;
	total: number;
	balance: number;
	paymentAmount: number;
	paymentDetails?: string;
	paymentLink?: string;
	paymentProvider?: "manual" | "paystack";
	paidAt?: number;
	paymentReference?: string;
	deliveredAt?: number;
	canceledAt?: number;
	deletedAt?: number;
	notes?: string;
	lineItems: InvoiceLineItem[];
	compliance?: InvoiceComplianceSnapshot;
	fiscalization?: FiscalizationSnapshot;
	reminder?: ReminderSnapshot;
	sync?: InvoiceSyncSnapshot;
	lifecycle?: LifecycleSnapshot;
	createdAt: number;
	updatedAt: number;
};
