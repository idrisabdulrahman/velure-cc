type Id<_Table extends string> = string;

import type { EditorDoc } from "../../lib/midday-invoice/types";
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
	| "canceled"
	| "scheduled";

export type InvoiceLineItem = {
	id: string;
	name: string;
	quantity: number;
	price: number;
	productId?: Id<"products">;
	unit?: string;
	vatCategory?: VatCategory;
	classificationCode?: string;
};

export type VatCategory = "standard" | "zero_rated" | "exempt";

export type InvoiceTemplateSettings = {
	title?: string;
	customerLabel?: string;
	fromLabel?: string;
	invoiceNoLabel?: string;
	issueDateLabel?: string;
	dueDateLabel?: string;
	descriptionLabel?: string;
	quantityLabel?: string;
	priceLabel?: string;
	totalLabel?: string;
	totalSummaryLabel?: string;
	subtotalLabel?: string;
	discountLabel?: string;
	paymentLabel?: string;
	noteLabel?: string;
	includeDecimals?: boolean;
	includeDiscount?: boolean;
	includeUnits?: boolean;
	includeQr?: boolean;
	discount?: number;
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
	tokenRevokedAt?: number;
	documentType?: InvoiceDocumentType;
	convertedToInvoiceId?: Id<"invoices">;
	shipmentDetails?: InvoiceShipmentDetails;
	depositRequest?: InvoiceDepositRequest;
	invoiceNumber: string;
	customerId?: Id<"clients">;
	customerName: string;
	logoUrl?: string;
	customerPoNumber?: string;
	currency: string;
	type: InvoiceType;
	invoiceSize: InvoiceSize;
	dateFormat: InvoiceDateFormat;
	paymentTermsDays: number;
	template: string;
	templateSettings?: InvoiceTemplateSettings;
	topBlock?: EditorDoc;
	bottomBlock?: EditorDoc;
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
	finalizedAt?: number;
	scheduledAt?: number;
	deliveredAt?: number;
	canceledAt?: number;
	deletedAt?: number;
	notes?: string | EditorDoc;
	internalNotes?: string;
	lineItems: InvoiceLineItem[];
	compliance?: InvoiceComplianceSnapshot;
	fiscalization?: FiscalizationSnapshot;
	reminder?: ReminderSnapshot;
	sync?: InvoiceSyncSnapshot;
	lifecycle?: LifecycleSnapshot;
	createdAt: number;
	updatedAt: number;
};
