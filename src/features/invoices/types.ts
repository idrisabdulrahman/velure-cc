type Id<_Table extends string> = string;

import type { EditorDoc } from "../../lib/invoice-document/types";
import type {
	DiscountMode,
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

/**
 * WP-D quote lifecycle. A quote is a pro-forma invoice carrying one of these
 * states; acceptance converts it to a standard invoice (see `quoteStatus` on
 * `InvoiceRecord`). `draft`/`expired`/`declined` are not client-facing here —
 * only `sent` and `accepted` are surfaced.
 */
export type QuoteStatus =
	| "draft"
	| "sent"
	| "accepted"
	| "declined"
	| "expired";

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
	draft: "Draft quote",
	sent: "Quote sent",
	accepted: "Quote accepted",
	declined: "Quote declined",
	expired: "Quote expired",
};

export type InvoiceLineItem = {
	id: string;
	name: string;
	quantity: number;
	price: number;
	productId?: Id<"products">;
	unit?: string;
	vatCategory?: VatCategory;
	classificationCode?: string;
	/** Line-level discount in major units; only used by the `line` mode. */
	discount?: number;
};

export type VatCategory = "standard" | "zero_rated" | "exempt";

export type InvoiceTemplateSettings = {
	defaultVatCategory?: VatCategory;
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
	/** How `discount` is applied; mutually exclusive per invoice. */
	discountMode?: DiscountMode;
};

export type InvoiceType = "one-time" | "recurring";
export type InvoiceDocumentType =
	| "standard"
	| "credit_note"
	| "debit_note"
	| "proforma";

export const INVOICE_DOCUMENT_TYPE_LABELS: Record<InvoiceDocumentType, string> =
	{
		standard: "Standard invoice",
		credit_note: "Credit note",
		debit_note: "Debit note",
		proforma: "Pro-forma",
	};

export function isCorrectionDocumentType(
	documentType: InvoiceDocumentType,
): documentType is "credit_note" | "debit_note" {
	return documentType === "credit_note" || documentType === "debit_note";
}
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
	correctsInvoiceId?: Id<"invoices">;
	convertedToInvoiceId?: Id<"invoices">;
	/** WP-D: quote lifecycle state when this document is a pro-forma quote. */
	quoteStatus?: QuoteStatus;
	quoteSentAt?: number;
	quoteAcceptedAt?: number;
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
