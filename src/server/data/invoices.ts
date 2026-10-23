import {
	CUSTOMER_LINK_CLEARED_ON_ISSUED_MESSAGE,
	CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE,
	transitionLeavesDraft,
} from "#/features/invoices/customer-gate";
import type { Database, Json } from "#/types/database.types";
import { type InvoiceAuditWriter, recordInvoiceAudit } from "./audit-client";
import {
	assertInvoiceNumberAvailable,
	candidateInvoiceNumber,
	commitInvoiceNumber,
	isInvoiceIssued,
	planInvoiceNumber,
	reserveInvoiceNumber,
} from "./invoice-numbering";
import {
	assertValidRcNumber,
	assertValidTin,
	defaultTaxTreatmentForSellerTaxStatus,
	defaultWithholdingSelection,
	NIGERIA_FOREIGN_CURRENCY_WARNING,
	NIGERIA_TAX_RULE_SET_VERSION,
	NIGERIA_VAT_RATE,
	normalizeNigeriaPhone,
} from "./nigeria";
import { resolveActiveWorkspaceId, type Supabase } from "./workspaces";

/**
 * A10 — invoices domain, ported to Supabase.
 *
 * RLS-pure: every function takes a USER-scoped Supabase client (the one
 * holding the OIDC-minted JWT) and never sends a user id for authorization.
 * RLS decides. A missing membership returns zero rows / null, not an error.
 *
 * Port of convex/invoices.ts (the UI-facing surface): list, listPage,
 * listSummary, listWithSummary, getById, getByToken, getPublicByToken,
 * getTemplateDefaults, saveTemplateDefaults, createDraft, autosaveDraft,
 * save, saveDraftSettings, updateStatus, cancelSchedule, reschedule,
 * remove, previewBulkCleanup, bulkDeleteOrArchive, renumberInvoices,
 * deleteEmptyDrafts, duplicate, convertProformaToInvoice, importCsv,
 * markInvoiceSent, recordInvoiceViewed, recordDeliveryEvent,
 * getInvoiceLifecycle. Return shapes match the Convex surface so call
 * sites compile unchanged.
 *
 * Convex-internal machinery (scheduled delivery actions, email sending,
 * cron) stays on Convex — this module is the RLS data surface only.
 *
 * Storage mapping notes:
 *  - Convex epoch-ms timestamps <-> Supabase timestamptz strings.
 *  - `convertedToInvoiceId` / `depositRequest` have no columns (the A8
 *    importer dropped them) — they round-trip inside the lifecycle JSON.
 */

export type SupabaseInvoices = Supabase;

export type InvoiceStatus =
	| "draft"
	| "unpaid"
	| "partially-paid"
	| "paid"
	| "overdue"
	| "canceled"
	| "scheduled";
export type InvoiceDocumentType = "standard" | "proforma";
export type InvoiceType = "one-time" | "recurring";
export type InvoiceSize = "A4" | "LETTER";
export type DateFormat = "iso" | "us" | "ng";
export type PaymentProvider = "manual" | "paystack";

export type LineItem = {
	id: string;
	name: string;
	quantity: number;
	price: number;
	productId?: string;
	unit?: string;
	vatCategory?: "standard" | "zero_rated" | "exempt";
	classificationCode?: string;
};

const VAT_CATEGORIES = new Set(["standard", "zero_rated", "exempt"]);

export type ShipmentDetails = {
	weight?: string;
	packageCount?: number;
	hsCode?: string;
	incoterms?: string;
	portOfLoading?: string;
	portOfDischarge?: string;
};

export type DepositRequest = {
	kind: "amount" | "percentage";
	value: number;
	dueDate?: string;
};

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

/**
 * The mapped invoice shape the UI consumes (mirrors convex/invoices.ts
 * mapInvoice). Timestamps are epoch-ms like the Convex surface.
 */
export type Invoice = {
	id: string;
	token: string;
	tokenRevokedAt?: number;
	documentType: InvoiceDocumentType;
	convertedToInvoiceId?: string;
	shipmentDetails?: ShipmentDetails;
	depositRequest?: DepositRequest;
	invoiceNumber: string;
	customerId?: string;
	customerName: string;
	logoUrl?: string;
	customerPoNumber?: string;
	currency: string;
	type: InvoiceType;
	invoiceSize: InvoiceSize;
	dateFormat: DateFormat;
	paymentTermsDays: number;
	template: string;
	templateSettings?: InvoiceTemplateSettings;
	topBlock?: unknown;
	bottomBlock?: unknown;
	issueDate: string;
	dueDate: string;
	status: InvoiceStatus;
	total: number;
	balance: number;
	paymentAmount: number;
	paymentDetails?: string;
	paymentLink?: string;
	paymentProvider?: PaymentProvider;
	paidAt?: number;
	paymentReference?: string;
	finalizedAt?: number;
	scheduledAt?: number;
	scheduleVersion?: string;
	deliveredAt?: number;
	canceledAt?: number;
	deletedAt?: number;
	notes?: unknown;
	internalNotes?: string;
	lineItems: LineItem[];
	compliance?: Record<string, unknown>;
	fiscalization?: Record<string, unknown>;
	reminder?: Record<string, unknown>;
	sync?: Record<string, unknown>;
	lifecycle?: Record<string, unknown>;
	createdAt: number;
	updatedAt: number;
};

/** Input shape for createDraft / autosaveDraft / save. */
export type InvoiceInput = {
	id?: string;
	token: string;
	documentType?: InvoiceDocumentType;
	shipmentDetails?: ShipmentDetails;
	depositRequest?: DepositRequest;
	invoiceNumber: string;
	customerId?: string;
	customerName: string;
	logoUrl?: string;
	customerPoNumber?: string;
	currency: string;
	type?: InvoiceType;
	invoiceSize?: InvoiceSize;
	dateFormat?: DateFormat;
	paymentTermsDays?: number;
	template?: string;
	templateSettings?: InvoiceTemplateSettings;
	topBlock?: unknown;
	bottomBlock?: unknown;
	issueDate: string;
	dueDate: string;
	paymentDetails?: string;
	paymentLink?: string;
	paymentProvider?: PaymentProvider;
	notes?: unknown;
	internalNotes?: string;
	lineItems: LineItem[];
	compliance?: Record<string, unknown>;
	fiscalization?: Record<string, unknown>;
	reminder?: Record<string, unknown>;
	sync?: Record<string, unknown>;
	deliveryType?: "create" | "create_and_send" | "scheduled";
	scheduledAt?: string;
};

export type InvoiceListArgs = {
	q?: string;
	status?: "all" | InvoiceStatus;
	type?: "all" | InvoiceType;
	documentType?: "all" | InvoiceDocumentType;
	customer?: string;
	dueDateFrom?: string;
	dueDateTo?: string;
	cursor?: string | null;
	pageSize?: number;
};

export const INVOICE_LIST_PAGE_SIZE = 25;

const MAX_INVOICE_IMPORT_ROWS = 2_000;
const INVOICE_IMPORT_INSERT_CHUNK_SIZE = 50;

// ---------------------------------------------------------------------------
// Time conversion (Convex epoch-ms <-> Supabase timestamptz)
// ---------------------------------------------------------------------------

function epoch(value?: string | null): number | undefined {
	if (!value) return undefined;
	const ms = Date.parse(value);
	return Number.isFinite(ms) ? ms : undefined;
}

function iso(value?: number | null): string | null {
	if (!value) return null;
	return new Date(value).toISOString();
}

// JSON columns (`line_items`, `compliance`) can carry numeric fields as
// strings depending on the writer path. The document contract declares them
// as numbers, so normalize at the DB boundary — money math downstream
// (invoice totals, PDF rendering) assumes real numbers.
function coerceMoney(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeLineItems(items: unknown): LineItem[] {
	if (!Array.isArray(items)) return [];
	return items.map((item) => ({
		...(item as LineItem),
		quantity: coerceMoney((item as LineItem)?.quantity),
		price: coerceMoney((item as LineItem)?.price),
	}));
}

function normalizeCompliance(value: unknown) {
	if (!value || typeof value !== "object") return undefined;
	const compliance = value as Record<string, unknown>;
	const normalized: Record<string, unknown> = { ...compliance };
	for (const key of [
		"subtotal",
		"totalTax",
		"netPayable",
		"grandTotal",
		"withholdingTaxAmount",
	]) {
		if (compliance[key] !== undefined) {
			normalized[key] = coerceMoney(compliance[key]);
		}
	}
	return normalized;
}

// ---------------------------------------------------------------------------
// Derived status + amount helpers (ported verbatim from convex/invoices.ts)
// ---------------------------------------------------------------------------

function netPayableFromCompliance(compliance?: {
	netPayable?: number;
	grandTotal?: number;
	withholdingTaxAmount?: number;
}) {
	if (!compliance) return undefined;
	if (compliance.netPayable !== undefined) return compliance.netPayable;
	if (compliance.grandTotal !== undefined) {
		return compliance.grandTotal - (compliance.withholdingTaxAmount ?? 0);
	}
	return undefined;
}

function invoiceAmount(invoice: {
	lineItems: Array<{ quantity: number; price: number }>;
	compliance?: {
		netPayable?: number;
		grandTotal?: number;
		withholdingTaxAmount?: number;
	};
}) {
	const complianceAmount = netPayableFromCompliance(invoice.compliance);
	if (complianceAmount !== undefined) return complianceAmount;

	const value = invoice.lineItems.reduce(
		(sum, item) => sum + item.quantity * item.price,
		0,
	);
	return Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;
}

function legacyPaymentAmount(invoice: any, total: number) {
	if (typeof invoice.paymentAmount === "number") {
		return Math.max(0, invoice.paymentAmount);
	}
	return invoice.status === "paid" ? total : 0;
}

function deliveredAtForInvoice(invoice: any) {
	return (
		invoice.deliveredAt ??
		invoice.lifecycle?.emailDeliveredAt ??
		invoice.lifecycle?.sentAt ??
		(invoice.status && invoice.status !== "draft"
			? invoice.updatedAt
			: undefined)
	);
}

export function getDerivedInvoiceStatus(invoice: any): InvoiceStatus {
	const total = invoiceAmount(invoice);
	const paymentAmount = legacyPaymentAmount(invoice, total);

	if (invoice.canceledAt || invoice.status === "canceled") return "canceled";
	if (invoice.scheduledAt && invoice.scheduleVersion) return "scheduled";
	if (total > 0 && paymentAmount >= total) return "paid";
	if (paymentAmount > 0 && paymentAmount < total) return "partially-paid";

	const deliveredAt = deliveredAtForInvoice(invoice);
	if (!deliveredAt && !invoice.finalizedAt) return "draft";

	const dueDate = new Date(`${invoice.dueDate}T00:00:00`);
	if (!Number.isNaN(dueDate.getTime())) {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		if (dueDate.getTime() < today.getTime()) return "overdue";
	}

	return "unpaid";
}

function patchWithDerivedStatus<T extends Record<string, unknown>>(
	current: any,
	patch: T,
) {
	const next = { ...current, ...patch };
	return {
		...patch,
		status: getDerivedInvoiceStatus(next),
	};
}

// ---------------------------------------------------------------------------
// Normalizers + compliance defaults
// ---------------------------------------------------------------------------

function normalizeComplianceSnapshot(compliance: any) {
	return {
		...compliance,
		placeOfSupply: normalizeJurisdictionCode(compliance.placeOfSupply),
		seller: {
			...compliance.seller,
			countryCode: normalizeJurisdictionCode(compliance.seller?.countryCode),
			phone: normalizeNigeriaPhone(compliance.seller?.phone),
		},
		buyer: {
			...compliance.buyer,
			countryCode: normalizeJurisdictionCode(compliance.buyer?.countryCode),
			phone: normalizeNigeriaPhone(compliance.buyer?.phone),
		},
		taxLines: (compliance.taxLines ?? []).map((line: any) => ({
			...line,
			jurisdictionCode: normalizeJurisdictionCode(line.jurisdictionCode),
		})),
	};
}

function normalizeJurisdictionCode(value: unknown) {
	return value === "NGN" ? "NG" : value;
}

function defaultCompliance(args: {
	customerName: string;
	lineItems: Array<{ quantity: number; price: number }>;
}): Record<string, unknown> {
	const subtotal = args.lineItems.reduce(
		(sum, item) => sum + item.quantity * item.price,
		0,
	);
	const taxTreatment = defaultTaxTreatmentForSellerTaxStatus("vat_registered");
	const withholding = defaultWithholdingSelection();

	return {
		seller: {
			legalName: "Velure",
			countryCode: "NG",
		},
		buyer: {
			legalName: args.customerName || undefined,
			countryCode: "NG",
		},
		sellerTaxStatus: "vat_registered",
		placeOfSupply: "NG",
		taxRuleSetVersion: NIGERIA_TAX_RULE_SET_VERSION,
		taxTreatment,
		taxRate: NIGERIA_VAT_RATE,
		taxLabel: "VAT",
		taxLines:
			taxTreatment === "exclusive_rate"
				? [
						{
							label: "VAT",
							rate: NIGERIA_VAT_RATE,
							amount:
								Math.round(((subtotal * NIGERIA_VAT_RATE) / 100) * 100) / 100,
							treatment: "exclusive_rate",
							jurisdictionCode: "NG",
						},
					]
				: [],
		warnings: [],
		templateVariant: "vat_ready",
		subtotal,
		totalTax: Math.round(((subtotal * NIGERIA_VAT_RATE) / 100) * 100) / 100,
		withholding: {
			...withholding,
			amount: 0,
		},
		withholdingTaxPreset: "none",
		withholdingTaxLabel: "WHT",
		withholdingTaxRate: withholding.rate,
		withholdingTaxAmount: 0,
		grandTotal:
			subtotal + Math.round(((subtotal * NIGERIA_VAT_RATE) / 100) * 100) / 100,
		fiscalization: {
			status: "not_configured",
		},
	};
}

function defaultReminder(): Record<string, unknown> {
	return {
		enabled: true,
		paused: false,
		stage: "none",
		escalationStatus: "idle",
	};
}

function defaultSync(): Record<string, unknown> {
	return {
		quickbooks: { status: "idle" },
		xero: { status: "idle" },
		slack: { status: "idle" },
	};
}

function normalizeCustomerPoNumber(value: string | undefined) {
	const normalized = value?.trim().replace(/\s+/g, " ");
	if (!normalized) return undefined;
	if (normalized.length > 80) {
		throw new Error("Customer PO number must be 80 characters or less.");
	}
	return normalized;
}

function normalizeTextField(value: string | undefined, maxLength: number) {
	const normalized = value?.trim().replace(/\s+/g, " ");
	if (!normalized) return undefined;
	if (normalized.length > maxLength) {
		throw new Error(`Field must be ${maxLength} characters or less.`);
	}
	return normalized;
}

function normalizeShipmentDetails(
	details: ShipmentDetails | undefined,
	documentType: InvoiceDocumentType,
) {
	if (documentType !== "proforma" || !details) return undefined;

	const normalized = {
		weight: normalizeTextField(details.weight, 80),
		packageCount:
			typeof details.packageCount === "number" && details.packageCount > 0
				? Math.floor(details.packageCount)
				: undefined,
		hsCode: normalizeTextField(details.hsCode, 40),
		incoterms: normalizeTextField(details.incoterms, 40),
		portOfLoading: normalizeTextField(details.portOfLoading, 80),
		portOfDischarge: normalizeTextField(details.portOfDischarge, 80),
	};

	return Object.values(normalized).some((value) => value !== undefined)
		? normalized
		: undefined;
}

function normalizeDepositRequest(
	request: DepositRequest | undefined,
	documentType: InvoiceDocumentType,
) {
	if (documentType !== "proforma" || !request) return undefined;
	if (!Number.isFinite(request.value) || request.value <= 0) {
		throw new Error("Deposit request must be greater than zero.");
	}
	if (request.kind === "percentage" && request.value > 100) {
		throw new Error("Deposit percentage cannot exceed 100.");
	}

	return {
		kind: request.kind,
		value: Math.round(request.value * 100) / 100,
		dueDate: normalizeTextField(request.dueDate, 20),
	};
}

export function assertInvoiceInput(args: {
	invoiceNumber: string;
	currency: string;
	lineItems: Array<{
		id: string;
		name: string;
		quantity: number;
		price: number;
	}>;
	templateSettings?: { includeDiscount?: boolean; discount?: number };
	compliance?: {
		seller?: { taxId?: string; rcNumber?: string; phone?: string };
		buyer?: { taxId?: string; phone?: string };
		regulatoryNotice?: string;
	};
}) {
	if (!/^[A-Z0-9]{2,12}-\d{4}-\d{4,6}$/.test(args.invoiceNumber.trim())) {
		throw new Error("Invoice number must use the format PREFIX-YYYY-NNNN.");
	}

	if (args.lineItems.length === 0) {
		throw new Error("At least one invoice line item is required.");
	}

	if (args.lineItems.length > 50) {
		throw new Error(
			"Invoices support a maximum of 50 line items for safe rendering.",
		);
	}

	const discount = args.templateSettings?.includeDiscount
		? (args.templateSettings.discount ?? 0)
		: 0;
	const subtotal = invoiceAmount({ lineItems: args.lineItems });
	if (discount < 0 || discount > subtotal) {
		throw new Error("Discount must be between zero and the invoice subtotal.");
	}

	assertValidTin(args.compliance?.seller?.taxId);
	assertValidTin(args.compliance?.buyer?.taxId);
	assertValidRcNumber(args.compliance?.seller?.rcNumber);

	if (
		args.currency.trim().toUpperCase() !== "NGN" &&
		args.compliance?.regulatoryNotice !== NIGERIA_FOREIGN_CURRENCY_WARNING
	) {
		throw new Error(
			"Foreign currency invoices to Nigerian buyers must include the CBN settlement warning.",
		);
	}
}

// ---------------------------------------------------------------------------
// Invoice number generation
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Invoice numbering: MOVED to ./invoice-numbering (WP8/C1). The database is
// the number authority (allocate_invoice_number RPC + unique index); the
// plan/commit helpers and the issued predicate live there and are imported
// above. `invoiceHasExternalHistory` below stays: it is the broader
// cleanup-routing predicate (it also covers firstViewedAt), while
// `isInvoiceIssued` (imported) is the C2/C3 lock predicate that mirrors
// public.invoice_is_issued 1:1.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Row <-> doc conversion + mapInvoice
// ---------------------------------------------------------------------------

type InvoiceRow = {
	id: string;
	token: string;
	token_revoked_at: string | null;
	document_type: InvoiceDocumentType;
	shipment_details: unknown | null;
	invoice_number: string;
	customer_id: string | null;
	customer_name: string;
	logo_url: string | null;
	customer_po_number: string | null;
	currency: string;
	invoice_type: string;
	invoice_size: string;
	date_format: string;
	payment_terms_days: number | null;
	template: string | null;
	issue_date: string;
	due_date: string;
	status: InvoiceStatus;
	payment_amount: number;
	delivered_at: string | null;
	canceled_at: string | null;
	payment_details: string | null;
	payment_link: string | null;
	payment_provider: PaymentProvider | null;
	paid_at: string | null;
	payment_reference: string | null;
	finalized_at: string | null;
	scheduled_at: string | null;
	schedule_version: string | null;
	notes: unknown | null;
	internal_notes: string | null;
	deleted_at: string | null;
	line_items: LineItem[];
	template_settings: unknown | null;
	top_block: unknown | null;
	bottom_block: unknown | null;
	compliance: Record<string, unknown> | null;
	fiscalization: Record<string, unknown> | null;
	reminder: Record<string, unknown> | null;
	sync: Record<string, unknown> | null;
	lifecycle: Record<string, unknown> | null;
	created_at: string;
	updated_at: string;
};

/** Supabase row -> the Convex-doc shape mapInvoice expects. */
export function rowToInvoiceDoc(row: InvoiceRow) {
	const lifecycle = row.lifecycle ?? {};
	return {
		id: row.id,
		token: row.token,
		tokenRevokedAt: epoch(row.token_revoked_at),
		documentType: row.document_type,
		convertedToInvoiceId: lifecycle.convertedToInvoiceId as string | undefined,
		shipmentDetails: (row.shipment_details as ShipmentDetails) ?? undefined,
		depositRequest: (lifecycle.depositRequest as DepositRequest) ?? undefined,
		invoiceNumber: row.invoice_number,
		customerId: row.customer_id ?? undefined,
		customerName: row.customer_name,
		logoUrl: row.logo_url ?? undefined,
		customerPoNumber: row.customer_po_number ?? undefined,
		currency: row.currency,
		type: (row.invoice_type ?? "one-time") as InvoiceType,
		invoiceSize: (row.invoice_size ?? "A4") as InvoiceSize,
		dateFormat: (row.date_format ?? "ng") as DateFormat,
		paymentTermsDays: row.payment_terms_days ?? 14,
		template: row.template ?? "Default",
		templateSettings:
			(row.template_settings as InvoiceTemplateSettings) ?? undefined,
		topBlock: row.top_block ?? undefined,
		bottomBlock: row.bottom_block ?? undefined,
		issueDate: row.issue_date,
		dueDate: row.due_date,
		status: row.status,
		paymentAmount: Number(row.payment_amount ?? 0),
		deliveredAt: epoch(row.delivered_at),
		canceledAt: epoch(row.canceled_at),
		paymentDetails: row.payment_details ?? undefined,
		paymentLink: row.payment_link ?? undefined,
		paymentProvider: row.payment_provider ?? undefined,
		paidAt: epoch(row.paid_at),
		paymentReference: row.payment_reference ?? undefined,
		finalizedAt: epoch(row.finalized_at),
		scheduledAt: epoch(row.scheduled_at),
		scheduleVersion: row.schedule_version ?? undefined,
		notes: row.notes ?? undefined,
		internalNotes: row.internal_notes ?? undefined,
		deletedAt: epoch(row.deleted_at),
		lineItems: normalizeLineItems(row.line_items),
		compliance: normalizeCompliance(row.compliance) ?? undefined,
		fiscalization: row.fiscalization ?? undefined,
		reminder: row.reminder ?? undefined,
		sync: row.sync ?? undefined,
		lifecycle,
		createdAt: epoch(row.created_at) ?? Date.now(),
		updatedAt: epoch(row.updated_at) ?? Date.now(),
	};
}

/** Port of convex/invoices.ts mapInvoice — derived status + amounts. */
export function mapInvoice(invoice: any): Invoice {
	const total = invoiceAmount(invoice);
	const paymentAmount = legacyPaymentAmount(invoice, total);
	// WP8/C2: expose the TRUTHFUL delivery evidence only (stored `delivered_at`
	// plus lifecycle delivery), mirroring `public.invoice_is_issued`
	// (20261020000000). The status-based `updatedAt` fallback in
	// `deliveredAtForInvoice` fabricates a delivery time for every created
	// but unsent invoice (stored status "unpaid"), which would make the
	// C2/C3 lock predicate treat ordinary drafts as issued. That fallback
	// stays where a delivery timestamp must be STAMPED or derived for
	// display — never in the mapped field the lock predicate reads.
	const deliveredAt =
		invoice.deliveredAt ??
		invoice.lifecycle?.emailDeliveredAt ??
		invoice.lifecycle?.sentAt;
	const status = getDerivedInvoiceStatus(invoice);

	return {
		id: invoice.id,
		token: invoice.token,
		tokenRevokedAt: invoice.tokenRevokedAt,
		documentType: invoice.documentType ?? "standard",
		convertedToInvoiceId: invoice.convertedToInvoiceId,
		shipmentDetails: invoice.shipmentDetails,
		depositRequest: invoice.depositRequest,
		invoiceNumber: invoice.invoiceNumber,
		customerId: invoice.customerId,
		customerName: invoice.customerName,
		logoUrl: invoice.logoUrl,
		customerPoNumber: invoice.customerPoNumber,
		currency: invoice.currency,
		type: invoice.type ?? "one-time",
		invoiceSize: invoice.invoiceSize ?? "A4",
		dateFormat: invoice.dateFormat ?? "ng",
		paymentTermsDays: invoice.paymentTermsDays ?? 14,
		template: invoice.template ?? "Default",
		templateSettings: invoice.templateSettings,
		topBlock: invoice.topBlock,
		bottomBlock: invoice.bottomBlock,
		issueDate: invoice.issueDate,
		dueDate: invoice.dueDate,
		status,
		total,
		balance: (() => {
			const value = Math.max(0, total - paymentAmount);
			return Math.round((value + Number.EPSILON) * 100) / 100;
		})(),
		paymentAmount,
		paymentDetails: invoice.paymentDetails,
		paymentLink: invoice.paymentLink,
		paymentProvider: invoice.paymentProvider,
		paidAt: invoice.paidAt,
		paymentReference: invoice.paymentReference,
		finalizedAt: invoice.finalizedAt,
		scheduledAt: invoice.scheduledAt,
		scheduleVersion: invoice.scheduleVersion,
		deliveredAt,
		canceledAt:
			invoice.canceledAt ??
			(invoice.status === "canceled" ? invoice.updatedAt : undefined),
		deletedAt: invoice.deletedAt,
		notes: invoice.notes,
		internalNotes: invoice.internalNotes,
		lineItems: invoice.lineItems,
		compliance:
			invoice.compliance ??
			defaultCompliance({
				customerName: invoice.customerName,
				lineItems: invoice.lineItems ?? [],
			}),
		fiscalization: invoice.fiscalization ??
			(invoice.compliance?.fiscalization as Record<string, unknown>) ?? {
				status: "not_configured",
			},
		reminder: invoice.reminder ?? defaultReminder(),
		sync: invoice.sync ?? defaultSync(),
		lifecycle: invoice.lifecycle ?? {},
		createdAt: invoice.createdAt ?? Date.now(),
		updatedAt: invoice.updatedAt ?? Date.now(),
	};
}

export function mapPublicInvoice(invoice: Parameters<typeof mapInvoice>[0]) {
	const mapped = mapInvoice(invoice);

	return {
		id: mapped.id,
		token: mapped.token,
		documentType: mapped.documentType,
		shipmentDetails: mapped.shipmentDetails,
		depositRequest: mapped.depositRequest,
		invoiceNumber: mapped.invoiceNumber,
		customerName: mapped.customerName,
		logoUrl: mapped.logoUrl,
		customerPoNumber: mapped.customerPoNumber,
		currency: mapped.currency,
		type: mapped.type,
		invoiceSize: mapped.invoiceSize,
		dateFormat: mapped.dateFormat,
		paymentTermsDays: mapped.paymentTermsDays,
		template: mapped.template,
		templateSettings: mapped.templateSettings,
		topBlock: mapped.topBlock,
		bottomBlock: mapped.bottomBlock,
		issueDate: mapped.issueDate,
		dueDate: mapped.dueDate,
		status: mapped.status,
		total: mapped.total,
		balance: mapped.balance,
		paymentAmount: mapped.paymentAmount,
		paymentDetails: mapped.paymentDetails,
		paidAt: mapped.paidAt,
		deliveredAt: mapped.deliveredAt,
		canceledAt: mapped.canceledAt,
		notes: mapped.notes,
		lineItems: mapped.lineItems,
		compliance: mapped.compliance,
		fiscalization: mapped.fiscalization,
		lifecycle: mapped.lifecycle,
		createdAt: mapped.createdAt,
		updatedAt: mapped.updatedAt,
	};
}

export function isPublicInvoiceAvailable(invoice: {
	deletedAt?: number;
	canceledAt?: number;
	tokenRevokedAt?: number;
}) {
	return !invoice.deletedAt && !invoice.canceledAt && !invoice.tokenRevokedAt;
}

export function parseFutureSchedule(value: string | undefined, now: number) {
	if (!value)
		throw new Error("scheduledAt is required for scheduled delivery.");
	const scheduledAt = Date.parse(value);
	if (!Number.isFinite(scheduledAt) || scheduledAt <= now) {
		throw new Error("scheduledAt must be a valid future date.");
	}
	return scheduledAt;
}

// ---------------------------------------------------------------------------
// List / summary helpers
// ---------------------------------------------------------------------------

function hasInvoiceListPostFilters(args: InvoiceListArgs) {
	const status = args.status && args.status !== "all" ? args.status : null;
	return Boolean(
		(args.q ?? "").trim() ||
			(args.customer ?? "").trim() ||
			(args.type && args.type !== "all") ||
			(args.documentType && args.documentType !== "all") ||
			(status !== null && (args.dueDateFrom || args.dueDateTo)),
	);
}

function offsetFromCursor(cursor: string | null | undefined) {
	if (!cursor?.startsWith("offset:")) return 0;
	const offset = Number(cursor.slice("offset:".length));
	return Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
}

function filterInvoiceListRows(invoices: any[], args: InvoiceListArgs) {
	invoices = invoices.filter((invoice) => !invoice.deletedAt);
	const status = args.status && args.status !== "all" ? args.status : null;

	if (status !== null) {
		invoices = invoices.filter(
			(invoice) => getDerivedInvoiceStatus(invoice) === status,
		);
	}

	if (args.type && args.type !== "all") {
		invoices = invoices.filter(
			(invoice) => (invoice.type ?? "one-time") === args.type,
		);
	}

	if (args.documentType && args.documentType !== "all") {
		invoices = invoices.filter(
			(invoice) => (invoice.documentType ?? "standard") === args.documentType,
		);
	}

	if (args.customer && args.customer.trim().length > 0) {
		const customer = args.customer.trim().toLowerCase();
		invoices = invoices.filter((invoice) =>
			invoice.customerName.toLowerCase().includes(customer),
		);
	}

	if (status !== null && args.dueDateFrom) {
		invoices = invoices.filter(
			(invoice) => invoice.dueDate >= args.dueDateFrom!,
		);
	}

	if (status !== null && args.dueDateTo) {
		invoices = invoices.filter((invoice) => invoice.dueDate <= args.dueDateTo!);
	}

	const queryText = (args.q ?? "").toLowerCase().trim();
	if (queryText.length > 0) {
		invoices = invoices.filter(
			(invoice) =>
				invoice.customerName.toLowerCase().includes(queryText) ||
				invoice.invoiceNumber.toLowerCase().includes(queryText),
		);
	}

	return invoices;
}

/** Fetch the workspace's invoices (RLS-scoped to the active workspace). */
async function fetchWorkspaceInvoiceRows(
	client: Supabase,
	workspaceId: string,
) {
	const { data, error } = await client
		.from("invoices")
		.select("*")
		.eq("workspace_id", workspaceId)
		.is("deleted_at", null)
		.order("updated_at", { ascending: false });
	if (error) throw error;
	return (data ?? []).map((row) =>
		rowToInvoiceDoc(row as unknown as InvoiceRow),
	);
}

export function paginateInvoiceRows(
	rows: any[],
	args: InvoiceListArgs,
	pageSize: number,
) {
	const offset = offsetFromCursor(args.cursor);
	const page = rows.slice(offset, offset + pageSize);
	const nextOffset = offset + page.length;
	const isDone = nextOffset >= rows.length;

	return {
		page: page.map(mapInvoice),
		isDone,
		continueCursor: isDone ? null : `offset:${nextOffset}`,
	};
}

function normalizeSummaryCurrency(value: unknown) {
	const currency = String(value ?? "NGN")
		.trim()
		.toUpperCase();
	return currency.length > 0 ? currency : "NGN";
}

function createEmptyCurrencySummary(currency: string) {
	return {
		currency,
		totalCount: 0,
		openAmount: 0,
		openCount: 0,
		overdueAmount: 0,
		overdueCount: 0,
		paidAmount: 0,
		paidCount: 0,
	};
}

function formatMonthLabel(date: Date) {
	return date.toLocaleDateString("en", {
		month: "short",
		year: "2-digit",
	});
}

function getRecentMonthKeys(count: number) {
	const today = new Date();
	const months = [];

	for (let offset = count - 1; offset >= 0; offset -= 1) {
		const date = new Date(today.getFullYear(), today.getMonth() - offset, 1);
		const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
		months.push({ key, label: formatMonthLabel(date) });
	}

	return months;
}

function createEmptyRevenuePoint(key: string, label: string) {
	return {
		key,
		label,
		paidRevenue: 0,
		paidCount: 0,
		unpaidRevenue: 0,
		unpaidCount: 0,
	};
}

function buildEmptyRevenueChartData() {
	return getRecentMonthKeys(6).map((month) =>
		createEmptyRevenuePoint(month.key, month.label),
	);
}

export function buildInvoicePaymentScore(rows: any[]) {
	const dayMs = 24 * 60 * 60 * 1000;
	const paid = rows.filter((invoice) => {
		if ((invoice.documentType ?? "standard") === "proforma") return false;
		return invoice.status === "paid" && Number(invoice.paidAt ?? 0) > 0;
	});

	if (paid.length === 0) {
		return {
			score: 0,
			status: "no_data" as const,
			paidInvoiceCount: 0,
			onTimeCount: 0,
			averageDaysToPay: null,
		};
	}

	let onTimeCount = 0;
	let totalDaysToPay = 0;
	for (const invoice of paid) {
		const paidAt = Number(invoice.paidAt);
		const issueAt = Date.parse(`${invoice.issueDate}T00:00:00Z`);
		const dueAt = Date.parse(`${invoice.dueDate}T23:59:59Z`);
		if (Number.isFinite(dueAt) && paidAt <= dueAt) onTimeCount += 1;
		if (Number.isFinite(issueAt)) {
			totalDaysToPay += Math.max(0, Math.ceil((paidAt - issueAt) / dayMs));
		}
	}

	const score = Math.round((onTimeCount / paid.length) * 100);
	return {
		score,
		status:
			score >= 90
				? ("excellent" as const)
				: score >= 70
					? ("good" as const)
					: score >= 50
						? ("fair" as const)
						: ("slow" as const),
		paidInvoiceCount: paid.length,
		onTimeCount,
		averageDaysToPay: Math.round(totalDaysToPay / paid.length),
	};
}

export function buildInvoiceListSummary(rows: any[]) {
	const currencySummaries = new Map<
		string,
		ReturnType<typeof createEmptyCurrencySummary>
	>();
	const chartDataByCurrency = new Map<
		string,
		Map<string, ReturnType<typeof createEmptyRevenuePoint>>
	>();
	const pendingStatuses = new Set([
		"draft",
		"unpaid",
		"partially-paid",
		"overdue",
	]);

	for (const invoice of rows) {
		const currency = normalizeSummaryCurrency(invoice.currency);
		const summary =
			currencySummaries.get(currency) ?? createEmptyCurrencySummary(currency);
		const total = Math.max(0, Number(invoice.total ?? 0));
		const balance = Math.max(0, Number(invoice.balance ?? 0));
		const isProforma = (invoice.documentType ?? "standard") === "proforma";
		const paidAmount = Math.max(0, Number(invoice.paymentAmount ?? 0));
		const receivableTotal = isProforma ? paidAmount : total;
		const receivableBalance = isProforma ? 0 : balance;

		summary.totalCount += 1;

		if (invoice.status === "paid" || (isProforma && paidAmount > 0)) {
			summary.paidAmount += receivableTotal;
			summary.paidCount += 1;
		} else if (!isProforma && invoice.status === "overdue") {
			summary.overdueAmount += receivableBalance;
			summary.overdueCount += 1;
		} else if (!isProforma && pendingStatuses.has(invoice.status)) {
			summary.openAmount += receivableBalance;
			summary.openCount += 1;
		}

		currencySummaries.set(currency, summary);

		if (invoice.status === "canceled") continue;

		const date = new Date(invoice.issueDate);
		if (Number.isNaN(date.getTime())) continue;

		const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
		const chartData = chartDataByCurrency.get(currency) ?? new Map();
		const point =
			chartData.get(key) ??
			createEmptyRevenuePoint(key, formatMonthLabel(date));

		if (invoice.status === "paid" || (isProforma && paidAmount > 0)) {
			point.paidRevenue += receivableTotal;
			point.paidCount += 1;
		} else if (!isProforma && pendingStatuses.has(invoice.status)) {
			point.unpaidRevenue += receivableBalance;
			point.unpaidCount += 1;
		}

		chartData.set(key, point);
		chartDataByCurrency.set(currency, chartData);
	}

	const summaries = Array.from(currencySummaries.values()).sort((a, b) => {
		if (a.currency === "NGN") return -1;
		if (b.currency === "NGN") return 1;
		return a.currency.localeCompare(b.currency);
	});
	const chartData = Object.fromEntries(
		summaries.map((summary) => {
			const months = new Map(
				buildEmptyRevenueChartData().map((point) => [point.key, point]),
			);
			for (const point of chartDataByCurrency.get(summary.currency)?.values() ??
				[]) {
				months.set(point.key, point);
			}
			return [
				summary.currency,
				Array.from(months.values()).sort((a, b) => a.key.localeCompare(b.key)),
			];
		}),
	);

	return {
		currencySummaries: summaries,
		chartDataByCurrency: chartData,
		paymentScore: buildInvoicePaymentScore(rows),
	};
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function list(
	client: Supabase,
	userId: string,
	args: InvoiceListArgs = {},
) {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) return [];
	const rows = await fetchWorkspaceInvoiceRows(client, workspaceId);
	return filterInvoiceListRows(rows, args).map(mapInvoice);
}

export async function listPage(
	client: Supabase,
	userId: string,
	args: InvoiceListArgs,
) {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) {
		return {
			page: [],
			isDone: true,
			continueCursor: args.cursor ?? null,
		};
	}

	const pageSize = Math.min(
		Math.max(Math.floor(args.pageSize ?? INVOICE_LIST_PAGE_SIZE), 10),
		100,
	);
	const rows = await fetchWorkspaceInvoiceRows(client, workspaceId);

	if (hasInvoiceListPostFilters(args)) {
		return paginateInvoiceRows(
			filterInvoiceListRows(rows, args),
			args,
			pageSize,
		);
	}

	return paginateInvoiceRows(rows, args, pageSize);
}

export async function listSummary(
	client: Supabase,
	userId: string,
	args: InvoiceListArgs = {},
) {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) {
		return {
			currencySummaries: [],
			chartDataByCurrency: {},
		};
	}
	const rows = await fetchWorkspaceInvoiceRows(client, workspaceId);
	return buildInvoiceListSummary(
		filterInvoiceListRows(rows, args).map(mapInvoice),
	);
}

export async function listWithSummary(
	client: Supabase,
	userId: string,
	args: InvoiceListArgs = {},
) {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) {
		return {
			rows: [],
			currencySummaries: [],
			chartDataByCurrency: {},
		};
	}
	const rows = await fetchWorkspaceInvoiceRows(client, workspaceId);
	const filtered = filterInvoiceListRows(rows, args).map(mapInvoice);
	return {
		rows: filtered,
		...buildInvoiceListSummary(filtered),
	};
}

export async function getById(
	client: Supabase,
	userId: string,
	id: string,
): Promise<Invoice | null> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) return null;

	const { data, error } = await client
		.from("invoices")
		.select("*")
		.eq("id", id)
		.eq("workspace_id", workspaceId)
		.is("deleted_at", null)
		.maybeSingle();
	if (error) throw error;
	if (!data) return null;
	return mapInvoice(rowToInvoiceDoc(data as unknown as InvoiceRow));
}

export async function getByToken(
	client: Supabase,
	userId: string,
	token: string,
): Promise<Invoice | null> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) return null;

	const { data, error } = await client
		.from("invoices")
		.select("*")
		.eq("token", token)
		.eq("workspace_id", workspaceId)
		.maybeSingle();
	if (error) throw error;
	if (!data) return null;
	return mapInvoice(rowToInvoiceDoc(data as unknown as InvoiceRow));
}

export async function getPublicByToken(client: Supabase, token: string) {
	const { data, error } = await client
		.from("invoices")
		.select("*")
		.eq("token", token)
		.maybeSingle();
	if (error) throw error;
	if (!data) return null;
	const doc = rowToInvoiceDoc(data as unknown as InvoiceRow);
	if (!isPublicInvoiceAvailable(doc)) return null;
	return mapPublicInvoice(doc);
}

export async function getTemplateDefaults(
	client: Supabase,
	userId: string,
): Promise<InvoiceTemplateSettings | null> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) return null;
	const { data, error } = await client
		.from("workspaces")
		.select("invoice_template_defaults")
		.eq("id", workspaceId)
		.maybeSingle();
	if (error) throw error;
	return (data?.invoice_template_defaults as InvoiceTemplateSettings) ?? null;
}

export async function getInvoiceLifecycle(
	client: Supabase,
	userId: string,
	id: string,
): Promise<Record<string, unknown> | null> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) return null;
	const { data, error } = await client
		.from("invoices")
		.select("lifecycle")
		.eq("id", id)
		.eq("workspace_id", workspaceId)
		.maybeSingle();
	if (error) throw error;
	return (data?.lifecycle as Record<string, unknown>) ?? null;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

async function assertWorkspaceCustomer(
	client: Supabase,
	workspaceId: string,
	customerId?: string,
) {
	if (!customerId) return;
	const { data, error } = await client
		.from("clients")
		.select("id")
		.eq("id", customerId)
		.eq("workspace_id", workspaceId)
		.maybeSingle();
	if (error) throw error;
	if (!data) throw new Error("Customer not found.");
}

/**
 * B2 — customer required to leave Draft (SPEC §5.B row B2). A draft may
 * remain customer-less, but any transition out of Draft into an issued/
 * sent/paid/scheduled state requires a linked customer record that resolves
 * inside the caller's workspace (a forged cross-workspace customer id fails
 * `assertWorkspaceCustomer`). Canceling a draft is a soft discard and stays
 * customer-less. Pure decision logic lives in
 * `#/features/invoices/customer-gate`.
 *
 * Shared by every leave-Draft write path: createDraft finalize, updateStatus,
 * markInvoiceSent, convertProformaToInvoice, recordDeliveryEvent (sent),
 * recordPayment (settlement) and the email send route.
 */
export async function assertCustomerForIssueTransition(
	client: Supabase,
	workspaceId: string,
	invoice: { customerId?: string; lineItems: LineItem[] },
	from: InvoiceStatus,
	to: InvoiceStatus,
) {
	if (!transitionLeavesDraft(from, to)) return;
	if (!invoice.customerId) {
		throw new Error(CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE);
	}
	if (
		invoice.lineItems.some(
			(item) =>
				!item.unit?.trim() ||
				!VAT_CATEGORIES.has(item.vatCategory ?? "") ||
				!item.classificationCode?.trim(),
		)
	) {
		throw new Error(
			"Each invoice line needs a unit, VAT category, and goods/service code before leaving Draft.",
		);
	}
	await assertWorkspaceCustomer(client, workspaceId, invoice.customerId);
}

/**
 * B2 gate for the email send route (`POST /api/invoice/send/:id`).
 *
 * Emailing an invoice records a `sent` delivery event, which derives a Draft
 * invoice out of Draft (delivered_at → unpaid/overdue). The route therefore
 * rejects a customer-less draft BEFORE it renders the PDF, calls the email
 * provider or writes any delivery event, so this helper only reads. Legacy
 * issued invoices that never had a customer stay sendable (a non-derived-Draft
 * invoice is not an exit from Draft). Throws
 * `CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE`, or `Customer not found.` when a
 * draft's customer id does not resolve inside the verified workspace.
 */
export async function assertSendCustomerGate(
	client: Supabase,
	userId: string,
	invoice: { customerId?: string; lineItems: LineItem[] },
): Promise<void> {
	const currentStatus = getDerivedInvoiceStatus(invoice);
	if (currentStatus !== "draft") return;
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");
	await assertCustomerForIssueTransition(
		client,
		workspaceId,
		invoice,
		currentStatus,
		"unpaid",
	);
}

type DraftDoc = {
	token: string;
	documentType: InvoiceDocumentType;
	shipmentDetails?: ShipmentDetails;
	depositRequest?: DepositRequest;
	invoiceNumber: string;
	customerId?: string;
	customerName: string;
	logoUrl?: string;
	customerPoNumber?: string;
	currency: string;
	type: InvoiceType;
	invoiceSize: InvoiceSize;
	dateFormat: DateFormat;
	paymentTermsDays: number;
	template: string;
	templateSettings?: InvoiceTemplateSettings;
	topBlock?: unknown;
	bottomBlock?: unknown;
	issueDate: string;
	dueDate: string;
	paymentAmount: number;
	paymentDetails?: string;
	paymentLink?: string;
	paymentProvider?: PaymentProvider;
	finalizedAt?: number;
	scheduledAt?: number;
	scheduleVersion?: string;
	deliveredAt?: number;
	canceledAt?: number;
	notes?: unknown;
	internalNotes?: string;
	lineItems: LineItem[];
	status?: InvoiceStatus;
	paidAt?: number;
	paymentReference?: string;
	compliance: Record<string, unknown>;
	fiscalization: Record<string, unknown>;
	reminder: Record<string, unknown>;
	sync: Record<string, unknown>;
	lifecycle: Record<string, unknown>;
	createdAt: number;
	updatedAt: number;
};

const json = (value: unknown): Json => value as Json;

type InvoiceUpdate = Database["public"]["Tables"]["invoices"]["Update"];
/** Cast a patch to the invoices Update shape (RLS module writes raw patches). */
const toUpdate = (patch: Record<string, unknown>): InvoiceUpdate =>
	patch as unknown as InvoiceUpdate;

/** Build the column payload for a draft doc (epoch-ms -> timestamptz). */
function docToInvoiceColumns(doc: DraftDoc) {
	return {
		token: doc.token,
		document_type: doc.documentType,
		shipment_details: json(doc.shipmentDetails ?? null),
		invoice_number: doc.invoiceNumber,
		customer_id: doc.customerId ?? null,
		customer_name: doc.customerName,
		logo_url: doc.logoUrl ?? null,
		customer_po_number: doc.customerPoNumber ?? null,
		currency: doc.currency,
		invoice_type: doc.type,
		invoice_size: doc.invoiceSize,
		date_format: doc.dateFormat,
		payment_terms_days: doc.paymentTermsDays,
		template: doc.template,
		template_settings: json(doc.templateSettings ?? null),
		top_block: json(doc.topBlock ?? null),
		bottom_block: json(doc.bottomBlock ?? null),
		issue_date: doc.issueDate,
		due_date: doc.dueDate,
		payment_amount: doc.paymentAmount,
		delivered_at: iso(doc.deliveredAt),
		canceled_at: iso(doc.canceledAt),
		payment_details: doc.paymentDetails ?? null,
		payment_link: doc.paymentLink ?? null,
		payment_provider: doc.paymentProvider ?? null,
		finalized_at: iso(doc.finalizedAt),
		scheduled_at: iso(doc.scheduledAt),
		schedule_version: doc.scheduleVersion ?? null,
		notes: json(doc.notes ?? null),
		internal_notes: doc.internalNotes ?? null,
		line_items: json(doc.lineItems),
		compliance: json(doc.compliance),
		fiscalization: json(doc.fiscalization),
		reminder: json(doc.reminder),
		sync: json(doc.sync),
		lifecycle: json({
			...(doc.lifecycle ?? {}),
			convertedToInvoiceId: doc.lifecycle?.convertedToInvoiceId,
			depositRequest: doc.depositRequest,
		}),
	};
}

export async function createDraft(
	client: Supabase,
	userId: string,
	args: InvoiceInput,
): Promise<Invoice> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");

	const now = Date.now();
	const compliance = args.compliance ?? defaultCompliance(args);
	const documentType = args.documentType ?? "standard";
	const existingDraft = args.id ? await getById(client, userId, args.id) : null;
	if (args.id) {
		if (!existingDraft) {
			throw new Error("Draft invoice not found.");
		}
		if (getDerivedInvoiceStatus(existingDraft) !== "draft") {
			if (isInvoiceIssued(existingDraft)) {
				// C3: a blocked edit attempt on an issued invoice is logged
				// before it is refused.
				await recordInvoiceAudit(client, userId, {
					action: "invoice.edit",
					resourceId: args.id,
					before: existingDraft,
					after: args,
					message: "Blocked: issued invoices are immutable.",
				});
			}
			throw new Error("Only draft invoices can be finalized.");
		}
	}
	await assertWorkspaceCustomer(client, workspaceId, args.customerId);
	// WP8/C1: plan the number read-only (nothing consumed), validate, then
	// commit it from the database allocator immediately before the write so
	// a validation failure never burns a sequence value. An existing draft
	// keeps its number unless a new one is requested.
	const keepExistingNumber =
		Boolean(existingDraft) && !args.invoiceNumber.trim();
	const numberPlan = keepExistingNumber
		? null
		: await planInvoiceNumber(client, {
				workspaceId,
				documentType,
				requestedInvoiceNumber: args.invoiceNumber,
				exceptId: args.id,
			});
	const numberCandidate = numberPlan
		? candidateInvoiceNumber(numberPlan)
		: null;
	const invoiceNumber =
		numberCandidate?.invoiceNumber ?? existingDraft?.invoiceNumber ?? "";
	const normalizedCompliance = normalizeComplianceSnapshot(compliance);
	assertInvoiceInput({
		invoiceNumber,
		currency: args.currency,
		lineItems: args.lineItems,
		templateSettings: args.templateSettings,
		compliance: normalizedCompliance,
	});
	const reminder = args.reminder ?? defaultReminder();
	const sync = args.sync ?? defaultSync();
	const customerPoNumber = normalizeCustomerPoNumber(args.customerPoNumber);
	const shipmentDetails = normalizeShipmentDetails(
		args.shipmentDetails,
		documentType,
	);
	const depositRequest = normalizeDepositRequest(
		args.depositRequest,
		documentType,
	);

	const deliveryType = args.deliveryType ?? "create";
	const scheduledAt =
		deliveryType === "scheduled"
			? parseFutureSchedule(args.scheduledAt, now)
			: undefined;
	const scheduleVersion = scheduledAt ? crypto.randomUUID() : undefined;
	if (
		(deliveryType === "create_and_send" || deliveryType === "scheduled") &&
		!normalizedCompliance?.buyer?.email?.trim()
	) {
		throw new Error("Customer email is required to send this invoice.");
	}

	const doc: DraftDoc = {
		token: args.token,
		documentType,
		shipmentDetails,
		depositRequest,
		invoiceNumber,
		customerId: args.customerId,
		customerName: args.customerName,
		logoUrl: args.logoUrl,
		customerPoNumber,
		currency: args.currency,
		type: args.type ?? "one-time",
		invoiceSize: args.invoiceSize ?? "A4",
		dateFormat: args.dateFormat ?? "ng",
		paymentTermsDays: args.paymentTermsDays ?? 14,
		template: args.template ?? "Default",
		templateSettings: args.templateSettings,
		topBlock: args.topBlock,
		bottomBlock: args.bottomBlock,
		issueDate: args.issueDate,
		dueDate: args.dueDate,
		paymentAmount: 0,
		finalizedAt: scheduledAt ? undefined : now,
		scheduledAt,
		scheduleVersion,
		paymentDetails: args.paymentDetails,
		paymentLink: args.paymentLink,
		paymentProvider: args.paymentProvider,
		notes: args.notes,
		internalNotes: args.internalNotes,
		lineItems: args.lineItems,
		compliance: normalizedCompliance,
		fiscalization: (args.fiscalization as Record<string, unknown>) ??
			(normalizedCompliance.fiscalization as Record<string, unknown>) ?? {
				status: "not_configured",
			},
		reminder,
		sync,
		lifecycle: {},
		createdAt: existingDraft?.createdAt ?? now,
		updatedAt: now,
	};
	if (numberPlan && numberCandidate) {
		// WP8/C1: consume the number from the database allocator right before
		// the write; under concurrency the committed number is authoritative
		// and may differ from the planned candidate.
		doc.invoiceNumber = await commitInvoiceNumber(
			client,
			numberPlan,
			numberCandidate,
		);
	}
	const status = getDerivedInvoiceStatus(doc);
	// B2: finalizing a draft always leaves Draft — a customer record is
	// required (all deliveryTypes: create, create_and_send, scheduled).
	await assertCustomerForIssueTransition(
		client,
		workspaceId,
		{ customerId: args.customerId, lineItems: doc.lineItems },
		"draft",
		status,
	);
	const columns = {
		workspace_id: workspaceId,
		user_id: existingDraft ? existingDraft.id : userId,
		status,
		...docToInvoiceColumns(doc),
	} as unknown as Database["public"]["Tables"]["invoices"]["Insert"];

	let id: string;
	if (args.id) {
		const { error } = await client
			.from("invoices")
			.update(columns)
			.eq("id", args.id)
			.eq("workspace_id", workspaceId);
		if (error) throw error;
		id = args.id;
	} else {
		const { data, error } = await client
			.from("invoices")
			.insert(columns)
			.select("id")
			.single();
		if (error) throw error;
		id = data.id;
	}

	const invoice = mapInvoice({
		id,
		workspaceId,
		userId,
		...doc,
	});
	await recordInvoiceAudit(client, userId, {
		action: "invoice.create",
		resourceId: id,
		before: existingDraft,
		after: invoice,
		message: args.id
			? "Finalized an existing draft invoice."
			: "Created an invoice draft.",
	});
	return invoice;
}

export async function autosaveDraft(
	client: Supabase,
	userId: string,
	args: InvoiceInput,
): Promise<Invoice> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");

	const now = Date.now();
	const lineItems =
		args.lineItems.length > 0
			? args.lineItems
			: [{ id: "draft-line", name: "", quantity: 1, price: 0 }];
	const compliance =
		args.compliance ??
		defaultCompliance({
			customerName: args.customerName,
			lineItems,
		});
	const normalizedCompliance = normalizeComplianceSnapshot(compliance);
	const documentType = args.documentType ?? "standard";
	const current = args.id ? await getById(client, userId, args.id) : null;
	await assertWorkspaceCustomer(client, workspaceId, args.customerId);
	// WP8/C1: plan read-only, validate, commit the allocator's number right
	// before the write (see createDraft).
	const keepExistingNumber = Boolean(current) && !args.invoiceNumber.trim();
	const numberPlan = keepExistingNumber
		? null
		: await planInvoiceNumber(client, {
				workspaceId,
				documentType,
				requestedInvoiceNumber: args.invoiceNumber,
				exceptId: args.id,
			});
	const numberCandidate = numberPlan
		? candidateInvoiceNumber(numberPlan)
		: null;
	const invoiceNumber =
		numberCandidate?.invoiceNumber ?? current?.invoiceNumber ?? "";
	const shipmentDetails = normalizeShipmentDetails(
		args.shipmentDetails,
		documentType,
	);
	const depositRequest = normalizeDepositRequest(
		args.depositRequest,
		documentType,
	);

	assertInvoiceInput({
		invoiceNumber,
		currency: args.currency,
		lineItems,
		templateSettings: args.templateSettings,
		compliance: normalizedCompliance,
	});

	const doc: DraftDoc = {
		token: args.token,
		documentType,
		shipmentDetails,
		depositRequest,
		invoiceNumber,
		customerId: args.customerId,
		customerName: args.customerName,
		logoUrl: args.logoUrl,
		customerPoNumber: normalizeCustomerPoNumber(args.customerPoNumber),
		currency: args.currency,
		type: args.type ?? "one-time",
		invoiceSize: args.invoiceSize ?? "A4",
		dateFormat: args.dateFormat ?? "ng",
		paymentTermsDays: args.paymentTermsDays ?? 14,
		template: args.template ?? "Default",
		templateSettings: args.templateSettings,
		topBlock: args.topBlock,
		bottomBlock: args.bottomBlock,
		issueDate: args.issueDate,
		dueDate: args.dueDate,
		status: "draft",
		paymentAmount: 0,
		deliveredAt: undefined,
		paymentDetails: args.paymentDetails,
		paymentLink: args.paymentLink,
		paymentProvider: args.paymentProvider,
		notes: args.notes,
		internalNotes: args.internalNotes,
		lineItems,
		compliance: normalizedCompliance,
		fiscalization: (args.fiscalization as Record<string, unknown>) ??
			(normalizedCompliance.fiscalization as Record<string, unknown>) ?? {
				status: "not_configured",
			},
		reminder: args.reminder ?? defaultReminder(),
		sync: args.sync ?? defaultSync(),
		lifecycle: {},
		createdAt: now,
		updatedAt: now,
	};
	if (numberPlan && numberCandidate) {
		// WP8/C1: the allocator's number wins under concurrency.
		doc.invoiceNumber = await commitInvoiceNumber(
			client,
			numberPlan,
			numberCandidate,
		);
	}
	const columns = {
		workspace_id: workspaceId,
		user_id: userId,
		status: "draft" as const,
		...docToInvoiceColumns(doc),
	} as unknown as Database["public"]["Tables"]["invoices"]["Insert"];

	let id: string;
	if (args.id) {
		if (!current) {
			throw new Error("Draft invoice not found.");
		}
		if (getDerivedInvoiceStatus(current) !== "draft") {
			if (isInvoiceIssued(current)) {
				// C3: log the blocked edit attempt on an issued invoice.
				await recordInvoiceAudit(client, userId, {
					action: "invoice.edit",
					resourceId: args.id,
					before: current,
					after: args,
					message: "Blocked: issued invoices are immutable.",
				});
			}
			throw new Error("Only draft invoices can be autosaved.");
		}
		const { error } = await client
			.from("invoices")
			.update(columns)
			.eq("id", args.id)
			.eq("workspace_id", workspaceId);
		if (error) throw error;
		id = args.id;
	} else {
		const { data, error } = await client
			.from("invoices")
			.insert({
				...columns,
				created_at: iso(now) ?? new Date(now).toISOString(),
			})
			.select("id")
			.single();
		if (error) throw error;
		id = data.id;
	}

	const invoice = mapInvoice({
		id,
		workspaceId,
		userId,
		...doc,
		createdAt: current?.createdAt ?? now,
	});
	await recordInvoiceAudit(client, userId, {
		action: args.id ? "invoice.edit" : "invoice.create",
		resourceId: id,
		before: current,
		after: invoice,
		message: args.id ? "Autosaved draft invoice." : "Created an invoice draft.",
	});
	return invoice;
}

export async function save(
	client: Supabase,
	userId: string,
	args: InvoiceInput & { id: string },
) {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");
	const current = await getById(client, userId, args.id);
	if (!current) throw new Error("Invoice not found.");
	const currentStatus = getDerivedInvoiceStatus(current);
	if (isInvoiceIssued(current)) {
		// C2/C3: issued invoices are immutable — log the blocked attempt,
		// then refuse. Only soft cancellation is allowed past issuance.
		await recordInvoiceAudit(client, userId, {
			action: "invoice.edit",
			resourceId: args.id,
			before: current,
			after: args,
			message: "Blocked: issued invoices are immutable.",
		});
		throw new Error(
			"Issued invoices are immutable; only cancellation is allowed.",
		);
	}

	// B2: keep a stored buyer when the details-sheet payload omits it, and
	// reject an explicit buyer clear on a non-draft invoice.
	const requestedCustomerId = args.customerId?.trim();
	if (
		currentStatus !== "draft" &&
		current.customerId &&
		args.customerId !== undefined &&
		!requestedCustomerId
	) {
		throw new Error(CUSTOMER_LINK_CLEARED_ON_ISSUED_MESSAGE);
	}
	const customerId =
		currentStatus === "draft" || requestedCustomerId !== undefined
			? args.customerId
			: current.customerId;
	await assertWorkspaceCustomer(client, workspaceId, customerId);

	const compliance = args.compliance ?? defaultCompliance(args);
	const normalizedCompliance = normalizeComplianceSnapshot(compliance);
	const documentType = args.documentType ?? "standard";
	const shipmentDetails = normalizeShipmentDetails(
		args.shipmentDetails,
		documentType,
	);
	const depositRequest = normalizeDepositRequest(
		args.depositRequest,
		documentType,
	);
	assertInvoiceInput({
		invoiceNumber: args.invoiceNumber,
		currency: args.currency,
		lineItems: args.lineItems,
		templateSettings: args.templateSettings,
		compliance: normalizedCompliance,
	});
	await assertInvoiceNumberAvailable(client, {
		workspaceId,
		invoiceNumber: args.invoiceNumber,
		exceptId: args.id,
	});
	// WP8/C1: keep the allocator's counter past a user-chosen number so a
	// later generated number can never collide with it. Idempotent, and a
	// no-op for numbers outside the PREFIX-YYYY-NNNN format (the unique
	// index still backstops exact duplicates).
	await reserveInvoiceNumber(client, {
		workspaceId,
		invoiceNumber: args.invoiceNumber,
	});

	const patch = patchWithDerivedStatus(current, {
		token: args.token,
		documentType,
		shipmentDetails,
		depositRequest,
		invoiceNumber: args.invoiceNumber,
		customerId,
		customerName: args.customerName,
		logoUrl: args.logoUrl,
		customerPoNumber: normalizeCustomerPoNumber(args.customerPoNumber),
		currency: args.currency,
		type: args.type ?? "one-time",
		invoiceSize: args.invoiceSize ?? "A4",
		dateFormat: args.dateFormat ?? "ng",
		paymentTermsDays: args.paymentTermsDays ?? 14,
		template: args.template ?? "Default",
		templateSettings: args.templateSettings,
		issueDate: args.issueDate,
		dueDate: args.dueDate,
		paymentDetails: args.paymentDetails,
		paymentLink: args.paymentLink,
		paymentProvider: args.paymentProvider,
		notes: args.notes,
		internalNotes: args.internalNotes,
		lineItems: args.lineItems,
		compliance: normalizedCompliance,
		fiscalization:
			(args.fiscalization as Record<string, unknown>) ??
			(normalizedCompliance.fiscalization as Record<string, unknown>) ??
			current.fiscalization,
		reminder: args.reminder ?? defaultReminder(),
		sync: args.sync ?? defaultSync(),
		updatedAt: Date.now(),
	});

	const { error } = await client
		.from("invoices")
		.update(
			toUpdate({
				...docToInvoiceColumns({
					...current,
					...patch,
					lifecycle: { ...(current.lifecycle ?? {}) },
				} as DraftDoc),
				status: patch.status,
				updated_at: iso(patch.updatedAt as number),
			}),
		)
		.eq("id", args.id)
		.eq("workspace_id", workspaceId);
	if (error) throw error;

	await recordInvoiceAudit(client, userId, {
		action: "invoice.edit",
		resourceId: args.id,
		before: current,
		after: args,
		message: "Saved invoice changes.",
	});

	return args;
}

export async function saveDraftSettings(
	client: Supabase,
	userId: string,
	args: {
		id: string;
		invoiceSize: InvoiceSize;
		dateFormat: DateFormat;
		paymentTermsDays: number;
		template: string;
		currency: string;
		type: InvoiceType;
		dueDate?: string;
	},
): Promise<{ ok: true }> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");
	const current = await getById(client, userId, args.id);
	if (!current) throw new Error("Invoice not found.");
	if (isInvoiceIssued(current)) {
		await recordInvoiceAudit(client, userId, {
			action: "invoice.edit",
			resourceId: args.id,
			before: current,
			after: args,
			message: "Blocked: issued invoices are immutable.",
		});
		throw new Error(
			"Issued invoices are immutable; only cancellation is allowed.",
		);
	}

	const patch = patchWithDerivedStatus(current, {
		invoiceSize: args.invoiceSize,
		dateFormat: args.dateFormat,
		paymentTermsDays: args.paymentTermsDays,
		template: args.template,
		currency: args.currency,
		type: args.type,
		dueDate: args.dueDate ?? current.dueDate,
		updatedAt: Date.now(),
	});

	const { error } = await client
		.from("invoices")
		.update(
			toUpdate({
				invoice_size: patch.invoiceSize,
				date_format: patch.dateFormat,
				payment_terms_days: patch.paymentTermsDays,
				template: patch.template,
				currency: patch.currency,
				invoice_type: patch.type,
				due_date: patch.dueDate,
				status: patch.status,
				updated_at: iso(patch.updatedAt as number),
			}),
		)
		.eq("id", args.id)
		.eq("workspace_id", workspaceId);
	if (error) throw error;

	await recordInvoiceAudit(client, userId, {
		action: "invoice.edit",
		resourceId: args.id,
		before: current,
		after: {
			invoiceSize: args.invoiceSize,
			dateFormat: args.dateFormat,
			paymentTermsDays: args.paymentTermsDays,
			template: args.template,
			currency: args.currency,
			type: args.type,
			dueDate: args.dueDate ?? current.dueDate,
		},
		message: "Updated draft invoice settings.",
	});

	return { ok: true };
}

export async function saveTemplateDefaults(
	client: Supabase,
	userId: string,
	settings: InvoiceTemplateSettings,
): Promise<{ ok: true }> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");

	const trimmed = Object.fromEntries(
		Object.entries(settings).map(([key, value]) => [
			key,
			typeof value === "string" ? value.trim().slice(0, 80) : value,
		]),
	) as InvoiceTemplateSettings;
	if ((trimmed.discount ?? 0) < 0)
		throw new Error("Discount must be non-negative.");

	const { error } = await client
		.from("workspaces")
		.update({ invoice_template_defaults: trimmed as unknown as Json })
		.eq("id", workspaceId);
	if (error) throw error;

	return { ok: true };
}

export async function updateStatus(
	client: Supabase,
	userId: string,
	args: {
		id: string;
		status: InvoiceStatus;
		paidAt?: number;
		paymentReference?: string;
	},
): Promise<{ ok: true }> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");
	const current = await getById(client, userId, args.id);
	if (!current) throw new Error("Invoice not found.");

	// B2: leaving Draft (paid / unpaid / overdue) requires a customer record;
	// draft→draft and draft→canceled are unaffected.
	await assertCustomerForIssueTransition(
		client,
		workspaceId,
		current,
		getDerivedInvoiceStatus(current),
		args.status,
	);

	const now = args.paidAt ?? Date.now();

	if (args.status === "canceled") {
		const derived = getDerivedInvoiceStatus(current);
		if (derived === "canceled") {
			// Transition guard: a redundant cancel must not append a second
			// invoice.cancel row for a state that already happened.
			throw new Error("Invoice is already canceled.");
		}
		if (derived === "paid") {
			// Money already settled: canceling would rewrite paid history
			// (issued-invoice immutability; corrections go through notes).
			throw new Error("A paid invoice cannot be canceled.");
		}
		const canceledAt = current.canceledAt ?? Date.now();
		const { error } = await client
			.from("invoices")
			.update(
				toUpdate({
					canceled_at: iso(canceledAt),
					status: "canceled",
					updated_at: iso(Date.now()),
				}),
			)
			.eq("id", args.id)
			.eq("workspace_id", workspaceId);
		// Was unchecked before G1; fail-closed now so the cancel audit row
		// only records a cancel that actually committed.
		if (error) throw error;
		await recordInvoiceAudit(client, userId, {
			action: "invoice.cancel",
			resourceId: args.id,
			before: current,
			after: { status: "canceled", canceledAt },
			message: "Invoice canceled.",
		});
		return { ok: true };
	}

	if (args.status === "paid") {
		const total = invoiceAmount(current);
		const existingPayment = legacyPaymentAmount(current, total);
		const { error } = await client
			.from("invoices")
			.update(
				toUpdate({
					payment_amount: Math.max(existingPayment, total),
					paid_at: iso(now),
					payment_reference:
						args.paymentReference ?? current.paymentReference ?? null,
					status: "paid",
					reminder: json({
						...(current.reminder ?? defaultReminder()),
						paidAt: now,
						nextReminderAt: undefined,
					}),
					lifecycle: json({
						...(current.lifecycle ?? {}),
						paymentReceivedAt: current.lifecycle?.paymentReceivedAt ?? now,
					}),
					updated_at: iso(Date.now()),
				}),
			)
			.eq("id", args.id)
			.eq("workspace_id", workspaceId);
		if (error) throw error;
		// C3: money crossing into a not-yet-issued invoice takes it past the
		// draft boundary — that first crossing is an issuance and is logged as
		// one; settling an already-issued invoice stays an edit. Marking an
		// invoice paid always makes it issued (status = 'paid'), so the
		// crossing reduces to "was not issued before this write".
		const crossingIntoIssued = !isInvoiceIssued(current);
		await recordInvoiceAudit(client, userId, {
			action: crossingIntoIssued ? "invoice.send" : "invoice.edit",
			resourceId: args.id,
			before: current,
			after: {
				status: "paid",
				paidAt: now,
				paymentAmount: Math.max(existingPayment, total),
				paymentReference:
					args.paymentReference ?? current.paymentReference ?? null,
			},
			message: crossingIntoIssued
				? "Invoice issued when payment was recorded."
				: "Invoice marked as paid.",
		});
		return { ok: true };
	}

	if (args.status === "unpaid" || args.status === "overdue") {
		if (current.status === "paid") {
			// C2/C3: the database trigger (20261020000001) refuses to move a
			// paid invoice to any status but paid/canceled; mirror it here so
			// the caller gets a friendly refusal and the blocked attempt is
			// logged instead of a raw insufficient_privilege from Postgres.
			await recordInvoiceAudit(client, userId, {
				action: "invoice.edit",
				resourceId: args.id,
				before: current,
				after: { status: args.status },
				message: "Blocked: paid invoices cannot be marked unpaid.",
			});
			throw new Error(
				"Paid invoices cannot be marked unpaid; corrections go through credit or debit notes.",
			);
		}
		const deliveredAt = deliveredAtForInvoice(current) ?? Date.now();
		const patch = patchWithDerivedStatus(current, {
			deliveredAt,
			lifecycle: {
				...(current.lifecycle ?? {}),
				sentAt: current.lifecycle?.sentAt ?? deliveredAt,
			},
			updatedAt: Date.now(),
		});
		const { error } = await client
			.from("invoices")
			.update(
				toUpdate({
					delivered_at: iso(deliveredAt),
					lifecycle: json(patch.lifecycle),
					status: patch.status,
					updated_at: iso(patch.updatedAt as number),
				}),
			)
			.eq("id", args.id)
			.eq("workspace_id", workspaceId);
		if (error) throw error;
		// C3: crossing into "issued" for the first time is an issuance and is
		// logged as one; re-marking an already-issued invoice stays an edit.
		const crossingIntoIssued =
			!isInvoiceIssued(current) && isInvoiceIssued(patch);
		await recordInvoiceAudit(client, userId, {
			action: crossingIntoIssued ? "invoice.send" : "invoice.edit",
			resourceId: args.id,
			before: current,
			after: { status: patch.status, deliveredAt },
			message: crossingIntoIssued
				? `Invoice issued as ${args.status}.`
				: `Invoice marked as ${args.status}.`,
		});
		return { ok: true };
	}

	if (args.status === "draft") {
		if (isInvoiceIssued(current)) {
			// C2/C3: un-issuing is refused and the blocked attempt logged;
			// issued invoices are corrected through cancellation/notes.
			await recordInvoiceAudit(client, userId, {
				action: "invoice.edit",
				resourceId: args.id,
				before: current,
				after: { status: "draft" },
				message: "Blocked: issued invoices cannot be reverted to draft.",
			});
			throw new Error(
				"Issued invoices cannot be reverted to draft; cancel instead.",
			);
		}
		const { error } = await client
			.from("invoices")
			.update(
				toUpdate({
					delivered_at: null,
					status: "draft",
					updated_at: iso(Date.now()),
				}),
			)
			.eq("id", args.id)
			.eq("workspace_id", workspaceId);
		if (error) throw error;
		await recordInvoiceAudit(client, userId, {
			action: "invoice.edit",
			resourceId: args.id,
			before: current,
			after: { status: "draft", deliveredAt: null },
			message: "Invoice reverted to draft.",
		});
	}

	return { ok: true };
}

export async function cancelSchedule(
	client: Supabase,
	userId: string,
	invoiceId: string,
): Promise<{ ok: true }> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");
	const invoice = await getById(client, userId, invoiceId);
	if (!invoice) throw new Error("Scheduled invoice not found.");
	if (!invoice.scheduledAt || !invoice.scheduleVersion)
		throw new Error("Invoice is not scheduled.");
	if (isInvoiceIssued(invoice)) {
		// C2: schedule columns are frozen once the invoice has been issued.
		await recordInvoiceAudit(client, userId, {
			action: "invoice.edit",
			resourceId: invoiceId,
			before: invoice,
			after: { scheduledAt: null },
			message: "Blocked: issued invoices cannot be unscheduled.",
		});
		throw new Error("Issued invoices cannot be unscheduled; cancel instead.");
	}

	const { error } = await client
		.from("invoices")
		.update(
			toUpdate({
				finalized_at: null,
				scheduled_at: null,
				schedule_version: null,
				status: "draft",
				updated_at: iso(Date.now()),
			}),
		)
		.eq("id", invoiceId)
		.eq("workspace_id", workspaceId);
	if (error) throw error;

	await recordInvoiceAudit(client, userId, {
		action: "invoice.edit",
		resourceId: invoiceId,
		before: invoice,
		after: { scheduledAt: null, status: "draft" },
		message: "Canceled the scheduled send; invoice returned to draft.",
	});
	return { ok: true };
}

export async function reschedule(
	client: Supabase,
	userId: string,
	args: { invoiceId: string; scheduledAt: string },
): Promise<{ ok: true; scheduledAt: number }> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");
	const invoice = await getById(client, userId, args.invoiceId);
	if (!invoice) throw new Error("Scheduled invoice not found.");
	if (!invoice.scheduledAt || !invoice.scheduleVersion)
		throw new Error("Invoice is not scheduled.");
	if (isInvoiceIssued(invoice)) {
		// C2: schedule columns are frozen once the invoice has been issued.
		await recordInvoiceAudit(client, userId, {
			action: "invoice.edit",
			resourceId: args.invoiceId,
			before: invoice,
			after: { scheduledAt: args.scheduledAt },
			message: "Blocked: issued invoices cannot be rescheduled.",
		});
		throw new Error("Issued invoices cannot be rescheduled; cancel instead.");
	}

	const now = Date.now();
	const scheduledAt = parseFutureSchedule(args.scheduledAt, now);
	const scheduleVersion = crypto.randomUUID();

	const { error } = await client
		.from("invoices")
		.update(
			toUpdate({
				scheduled_at: iso(scheduledAt),
				schedule_version: scheduleVersion,
				status: "scheduled",
				updated_at: iso(now),
			}),
		)
		.eq("id", args.invoiceId)
		.eq("workspace_id", workspaceId);
	if (error) throw error;

	await recordInvoiceAudit(client, userId, {
		action: "invoice.edit",
		resourceId: args.invoiceId,
		before: invoice,
		after: { scheduledAt, status: "scheduled" },
		message: "Rescheduled the invoice send.",
	});
	return { ok: true, scheduledAt };
}

async function invoiceHasRelatedRecords(client: Supabase, invoiceId: string) {
	for (const table of [
		"payment_transactions",
		"payment_charges",
		"invoice_delivery_events",
	] as const) {
		const { data, error } = await client
			.from(table)
			.select("id")
			.eq("invoice_id", invoiceId)
			.limit(1);
		if (error) throw error;
		if (data && data.length > 0) return true;
	}
	return false;
}

function invoiceHasExternalHistory(invoice: any) {
	const lifecycle = invoice.lifecycle ?? {};
	return Boolean(
		invoice.deliveredAt ||
			invoice.paidAt ||
			invoice.paymentReference ||
			legacyPaymentAmount(invoice, invoiceAmount(invoice)) > 0 ||
			lifecycle.sentAt ||
			lifecycle.emailDeliveredAt ||
			lifecycle.firstViewedAt ||
			lifecycle.paymentReceivedAt,
	);
}

function cleanupSummary(invoice: any, action: "hard-delete" | "archive") {
	return {
		id: invoice.id,
		invoiceNumber: invoice.invoiceNumber,
		customerName: invoice.customerName,
		status: getDerivedInvoiceStatus(invoice),
		action,
	};
}

async function cleanupPlanForInvoice(client: Supabase, invoice: any) {
	const hasRelatedRecords = await invoiceHasRelatedRecords(client, invoice.id);
	// Belt and braces: `isInvoiceIssued` (the C2/C3 lock predicate, mirrored
	// from public.invoice_is_issued) joins the broader external-history scan
	// so no issued row can ever be routed to hard-delete.
	const hasExternalHistory =
		hasRelatedRecords ||
		invoiceHasExternalHistory(invoice) ||
		isInvoiceIssued(invoice);

	if (
		["draft", "canceled"].includes(getDerivedInvoiceStatus(invoice)) &&
		!hasExternalHistory
	) {
		return cleanupSummary(invoice, "hard-delete");
	}

	return cleanupSummary(invoice, "archive");
}

async function cleanupPreviewForIds(
	client: Supabase,
	workspaceId: string,
	ids: string[],
) {
	const uniqueIds = Array.from(new Set(ids)).slice(0, 100);
	const hardDelete = [];
	const archive = [];
	const blocked = [];

	for (const id of uniqueIds) {
		const { data, error } = await client
			.from("invoices")
			.select("*")
			.eq("id", id)
			.eq("workspace_id", workspaceId)
			.maybeSingle();
		if (error) throw error;
		if (!data || (data as unknown as InvoiceRow).deleted_at) {
			blocked.push({
				id,
				invoiceNumber: "Unknown",
				reason: "Invoice was not found in this workspace.",
			});
			continue;
		}

		const invoice = rowToInvoiceDoc(data as unknown as InvoiceRow);
		const plan = await cleanupPlanForInvoice(client, invoice);
		if (plan.action === "hard-delete") {
			hardDelete.push(plan);
		} else {
			archive.push(plan);
		}
	}

	return { hardDelete, archive, blocked };
}

export async function remove(
	client: Supabase,
	userId: string,
	id: string,
): Promise<{ ok: true }> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");
	const invoice = await getById(client, userId, id);
	if (!invoice) throw new Error("Invoice not found.");

	const plan = await cleanupPlanForInvoice(client, invoice);
	if (plan.action !== "hard-delete") {
		if (isInvoiceIssued(invoice)) {
			// C3: the blocked delete attempt is logged before it is refused.
			await recordInvoiceAudit(client, userId, {
				action: "invoice.delete",
				resourceId: id,
				before: invoice,
				after: null,
				message: "Blocked: issued invoices cannot be deleted; cancel instead.",
			});
		}
		throw new Error("Only untouched draft invoices can be hard deleted.");
	}

	const { error } = await client
		.from("invoices")
		.delete()
		.eq("id", id)
		.eq("workspace_id", workspaceId);
	if (error) throw error;
	await recordInvoiceAudit(client, userId, {
		action: "invoice.delete",
		// The row is gone: the audit route resolves an `invoice` entry's
		// resourceId in the caller's workspace and would answer 404 for a
		// deleted id (tenancy check), so the identity travels in the payload.
		resourceId: null,
		before: { id, invoiceNumber: invoice.invoiceNumber },
		after: null,
		message: "Hard deleted an untouched draft invoice.",
	});
	return { ok: true };
}

export async function previewBulkCleanup(
	client: Supabase,
	userId: string,
	ids: string[],
) {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) {
		return { hardDelete: [], archive: [], blocked: [] };
	}
	return cleanupPreviewForIds(client, workspaceId, ids);
}

export async function bulkDeleteOrArchive(
	client: Supabase,
	userId: string,
	ids: string[],
) {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) {
		return { hardDeleted: 0, archived: 0, blocked: 0 };
	}
	const preview = await cleanupPreviewForIds(client, workspaceId, ids);
	const now = Date.now();

	for (const item of preview.hardDelete) {
		const { error } = await client
			.from("invoices")
			.delete()
			.eq("id", item.id)
			.eq("workspace_id", workspaceId);
		if (error) throw error;
		// C3: every hard delete leaves an audit row. `resourceId` stays null —
		// the row is gone, and the audit route refuses to reference invoices
		// it can no longer resolve in the caller's workspace (404).
		await recordInvoiceAudit(client, userId, {
			action: "invoice.delete",
			resourceId: null,
			before: { id: item.id, invoiceNumber: item.invoiceNumber },
			after: null,
			message: "Hard deleted an untouched draft invoice (bulk cleanup).",
		});
	}

	for (const item of preview.archive) {
		const { error } = await client
			.from("invoices")
			.update(
				toUpdate({
					deleted_at: iso(now),
					canceled_at: iso(now),
					status: "canceled",
					updated_at: iso(now),
				}),
			)
			.eq("id", item.id)
			.eq("workspace_id", workspaceId);
		if (error) throw error;
		// Archiving is the soft-cancel path for issued invoices (C3): the row
		// and its number stay, so it is logged as a cancellation. `resourceId`
		// stays null — archiving sets `deleted_at`, and the audit route
		// resolves an `invoice` entry's id through a lookup that filters
		// `deleted_at IS NULL`, so a soft-deleted id would answer 404, throw,
		// and abort the bulk loop with the remaining items unprocessed (same
		// reason as the hard-delete branch above).
		await recordInvoiceAudit(client, userId, {
			action: "invoice.cancel",
			resourceId: null,
			before: {
				id: item.id,
				invoiceNumber: item.invoiceNumber,
				status: item.status,
			},
			after: { status: "canceled" },
			message: "Archived invoice (bulk cleanup).",
		});
	}

	return {
		hardDeleted: preview.hardDelete.length,
		archived: preview.archive.length,
		blocked: preview.blocked.length,
	};
}

export async function renumberInvoices(
	client: Supabase,
	userId: string,
	ids: string[],
) {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");
	const uniqueIds = Array.from(new Set(ids)).slice(0, 100);
	const renumbered = [];
	const skipped = [];

	for (const id of uniqueIds) {
		const invoice = await getById(client, userId, id);
		if (!invoice || invoice.deletedAt) {
			skipped.push({
				id,
				reason: "Invoice was not found in this workspace.",
			});
			continue;
		}

		if (isInvoiceIssued(invoice)) {
			// C2/C3: an issued invoice's number is immutable — log the blocked
			// attempt, keep the row's number, and report it as skipped.
			await recordInvoiceAudit(client, userId, {
				action: "invoice.edit",
				resourceId: id,
				before: { invoiceNumber: invoice.invoiceNumber },
				after: null,
				message: "Blocked: issued invoices cannot be renumbered.",
			});
			skipped.push({
				id,
				reason: "Issued invoices cannot be renumbered.",
			});
			continue;
		}

		// WP8/C1: the replacement number comes from the database allocator,
		// which also advances the workspace's preview floor.
		const plan = await planInvoiceNumber(client, {
			workspaceId,
			documentType: invoice.documentType ?? "standard",
		});
		const newInvoiceNumber = await commitInvoiceNumber(
			client,
			plan,
			candidateInvoiceNumber(plan),
		);
		const now = Date.now();
		const { error } = await client
			.from("invoices")
			.update(
				toUpdate({
					invoice_number: newInvoiceNumber,
					updated_at: iso(now),
				}),
			)
			.eq("id", id)
			.eq("workspace_id", workspaceId);
		if (error) throw error;
		await recordInvoiceAudit(client, userId, {
			action: "invoice.edit",
			resourceId: id,
			before: { invoiceNumber: invoice.invoiceNumber },
			after: { invoiceNumber: newInvoiceNumber },
			message: "Renumbered invoice.",
		});
		renumbered.push({
			id,
			oldInvoiceNumber: invoice.invoiceNumber,
			newInvoiceNumber,
		});
	}

	return { renumbered, skipped };
}

export async function deleteEmptyDrafts(
	client: Supabase,
	userId: string,
): Promise<{ deleted: number }> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");
	const rows = await fetchWorkspaceInvoiceRows(client, workspaceId);
	const candidates = [];

	for (const invoice of rows) {
		if (invoice.deletedAt || invoiceAmount(invoice) > 0) continue;
		const plan = await cleanupPlanForInvoice(client, invoice);
		if (plan.action === "hard-delete") candidates.push(invoice);
		if (candidates.length >= 200) break;
	}

	for (const invoice of candidates) {
		const { error } = await client
			.from("invoices")
			.delete()
			.eq("id", invoice.id)
			.eq("workspace_id", workspaceId);
		if (error) throw error;
	}

	if (candidates.length > 0) {
		// C3: batch cleanup leaves one audit row for the deletion run.
		await recordInvoiceAudit(client, userId, {
			action: "invoice.delete",
			after: { deleted: candidates.length },
			message: `Hard deleted ${candidates.length} empty draft(s).`,
		});
	}

	return { deleted: candidates.length };
}

export async function duplicate(
	client: Supabase,
	userId: string,
	id: string,
): Promise<{ id: string }> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");
	const source = await getById(client, userId, id);
	if (!source) throw new Error("Invoice not found.");

	// WP8/C1: the duplicate's number is allocated by the database.
	const plan = await planInvoiceNumber(client, {
		workspaceId,
		documentType: source.documentType ?? "standard",
	});
	const invoiceNumber = await commitInvoiceNumber(
		client,
		plan,
		candidateInvoiceNumber(plan),
	);
	const now = Date.now();

	const doc: DraftDoc = {
		token: `pub-${crypto.randomUUID()}`,
		documentType: source.documentType ?? "standard",
		shipmentDetails: source.shipmentDetails,
		depositRequest: source.depositRequest,
		invoiceNumber,
		customerId: source.customerId,
		customerName: source.customerName,
		logoUrl: source.logoUrl,
		customerPoNumber: source.customerPoNumber,
		currency: source.currency,
		type: source.type ?? "one-time",
		invoiceSize: source.invoiceSize ?? "A4",
		dateFormat: source.dateFormat ?? "iso",
		paymentTermsDays: source.paymentTermsDays ?? 14,
		template: source.template ?? "Default",
		issueDate: source.issueDate,
		dueDate: source.dueDate,
		paymentAmount: 0,
		paymentDetails: source.paymentDetails,
		paymentLink: source.paymentLink,
		paymentProvider: source.paymentProvider,
		notes: source.notes,
		internalNotes: source.internalNotes,
		lineItems: source.lineItems,
		compliance:
			(source.compliance as Record<string, unknown>) ??
			defaultCompliance(source),
		fiscalization: (source.fiscalization as Record<string, unknown>) ??
			(source.compliance?.fiscalization as Record<string, unknown>) ?? {
				status: "not_configured",
			},
		reminder: defaultReminder(),
		sync: defaultSync(),
		lifecycle: {},
		createdAt: now,
		updatedAt: now,
	};
	const status = getDerivedInvoiceStatus(doc);

	const { data, error } = await client
		.from("invoices")
		.insert({
			workspace_id: workspaceId,
			user_id: userId,
			status,
			...docToInvoiceColumns(doc),
		})
		.select("id")
		.single();
	if (error) throw error;

	await recordInvoiceAudit(client, userId, {
		action: "invoice.create",
		resourceId: data.id,
		// Create event for the NEW invoice: there is no prior state of this
		// resource, so `before` is null (the source invoice is referenced
		// in the message instead of being misreported as prior state).
		before: null,
		after: {
			invoiceNumber,
			duplicatedFrom: id,
		},
		message: `Duplicated invoice ${source.invoiceNumber}.`,
	});

	return { id: data.id };
}

export async function convertProformaToInvoice(
	client: Supabase,
	userId: string,
	id: string,
): Promise<{ id: string }> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");
	const source = await getById(client, userId, id);
	if (!source) throw new Error("Invoice not found.");

	if ((source.documentType ?? "standard") !== "proforma") {
		throw new Error("Only pro-forma invoices can be converted.");
	}
	if (source.convertedToInvoiceId) {
		return { id: source.convertedToInvoiceId };
	}

	// WP8/C1: the converted invoice's number is allocated by the database.
	const plan = await planInvoiceNumber(client, { workspaceId });
	const invoiceNumber = await commitInvoiceNumber(
		client,
		plan,
		candidateInvoiceNumber(plan),
	);
	const now = Date.now();
	const total = invoiceAmount(source);
	const carriedPaymentAmount = Math.min(
		legacyPaymentAmount(source, total),
		total,
	);

	const doc: DraftDoc = {
		token: `pub-${crypto.randomUUID()}`,
		documentType: "standard",
		invoiceNumber,
		customerId: source.customerId,
		customerName: source.customerName,
		logoUrl: source.logoUrl,
		customerPoNumber: source.customerPoNumber,
		currency: source.currency,
		type: source.type ?? "one-time",
		invoiceSize: source.invoiceSize ?? "A4",
		dateFormat: source.dateFormat ?? "ng",
		paymentTermsDays: source.paymentTermsDays ?? 14,
		template: source.template ?? "Default",
		issueDate: new Date(now).toISOString().slice(0, 10),
		dueDate: source.dueDate,
		paymentAmount: carriedPaymentAmount,
		deliveredAt: undefined,
		paymentDetails: source.paymentDetails,
		paymentLink: source.paymentLink,
		paymentProvider: source.paymentProvider,
		paidAt: carriedPaymentAmount >= total && total > 0 ? now : undefined,
		paymentReference: source.paymentReference,
		notes: source.notes,
		internalNotes: source.internalNotes,
		lineItems: source.lineItems,
		compliance:
			(source.compliance as Record<string, unknown>) ??
			defaultCompliance(source),
		fiscalization: (source.fiscalization as Record<string, unknown>) ??
			(source.compliance?.fiscalization as Record<string, unknown>) ?? {
				status: "not_configured",
			},
		reminder:
			carriedPaymentAmount >= total && total > 0
				? {
						...(source.reminder ?? defaultReminder()),
						paidAt: now,
						nextReminderAt: undefined,
					}
				: defaultReminder(),
		sync: defaultSync(),
		lifecycle: carriedPaymentAmount > 0 ? { paymentReceivedAt: now } : {},
		createdAt: now,
		updatedAt: now,
	};
	const status = getDerivedInvoiceStatus(doc);
	// B2: a conversion that lands the new standard invoice outside Draft
	// requires a customer record. With the current derivation this only
	// fires defensively — a deposit-carrying source already derives issued,
	// and a customer-less Draft source lands as Draft — but the guard keeps
	// the rule true if the landing status ever changes.
	await assertCustomerForIssueTransition(
		client,
		workspaceId,
		source,
		getDerivedInvoiceStatus(source),
		status,
	);

	const { data, error } = await client
		.from("invoices")
		.insert({
			workspace_id: workspaceId,
			user_id: userId,
			status,
			...docToInvoiceColumns(doc),
		})
		.select("id")
		.single();
	if (error) throw error;
	const convertedId = data.id;

	if (carriedPaymentAmount > 0) {
		const { error: txError } = await client
			.from("payment_transactions")
			.insert({
				workspace_id: workspaceId,
				owner_id: userId,
				invoice_id: convertedId,
				source: "manual",
				reference: `deposit-from-${id}`,
				amount: carriedPaymentAmount,
				currency: source.currency,
				recorded_by: userId,
			});
		if (txError) throw txError;
	}

	await client
		.from("invoices")
		.update(
			toUpdate({
				lifecycle: json({
					...(source.lifecycle ?? {}),
					convertedToInvoiceId: convertedId,
				}),
				updated_at: iso(now),
			}),
		)
		.eq("id", id)
		.eq("workspace_id", workspaceId);

	await recordInvoiceAudit(client, userId, {
		action: "invoice.create",
		resourceId: convertedId,
		// Create event for the converted invoice: no prior state of THIS
		// resource exists, so `before` is null; the pro-forma source id
		// travels in `after` / the message.
		before: null,
		after: {
			invoiceNumber,
			documentType: "standard",
			convertedFromProformaId: id,
		},
		message: "Converted a pro-forma invoice to a standard invoice.",
	});

	return { id: convertedId };
}

export type InvoiceImportRow = {
	invoiceNumber?: string;
	customerName: string;
	currency?: string;
	status?: InvoiceStatus;
	issueDate?: string;
	dueDate?: string;
	description: string;
	quantity?: number;
	price?: number;
	notes?: string;
	paymentDetails?: string;
};

/**
 * CSV cells are free text, and row exports from payment/email tools often put
 * the buyer's email in the customer column ("billing@acme.com"). Returns the
 * first email-shaped token, normalized with the same `trim()` +
 * `toLowerCase()` the clients module applies to stored emails
 * (src/server/data/clients.ts), or null when the cell carries no email.
 */
function importRowCustomerEmail(customerName: string): string | null {
	const match = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(
		customerName,
	);
	return match ? match[0].trim().toLowerCase() : null;
}

export async function importCsv(
	client: Supabase,
	userId: string,
	rows: InvoiceImportRow[],
): Promise<{
	created: number;
	skipped: number;
	errors: Array<{ row: number; message: string }>;
	/**
	 * B2 import flag (audit round-1 finding 3, hardened in round 2): rows
	 * whose CSV status was issued-family (unpaid / overdue / paid) but whose
	 * customer cell resolved to no workspace client. Import no longer exempts
	 * itself from the leave-Draft gate: those rows land as DRAFTS awaiting a
	 * buyer link (see the comment at the status derivation) and are counted
	 * here so the caller reports them instead of dropping them silently.
	 */
	needsBuyerMatch: number;
}> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");
	if (rows.length > MAX_INVOICE_IMPORT_ROWS) {
		throw new Error(
			`Import supports up to ${MAX_INVOICE_IMPORT_ROWS} invoice rows per CSV.`,
		);
	}

	const now = Date.now();
	const created: string[] = [];
	let skipped = 0;
	let needsBuyerMatch = 0;
	const errors: Array<{ row: number; message: string }> = [];
	const addImportError = (row: number, message: string) => {
		if (errors.length < 100) {
			errors.push({ row, message });
		}
	};

	const { data: existing, error: existingError } = await client
		.from("invoices")
		.select("invoice_number")
		.eq("workspace_id", workspaceId);
	if (existingError) throw existingError;
	const usedNumbers = new Set(
		(existing ?? []).map((invoice) => String(invoice.invoice_number)),
	);
	// WP8/C1: one read-only plan; every generated number is consumed from the
	// database allocator inside the loop, so an import can never hand out a
	// number another concurrent writer already took. Custom imported numbers
	// are reserved so the counter stays clear of them.
	const numberPlan = await planInvoiceNumber(client, { workspaceId });
	const groups = new Map<
		string,
		{
			invoiceNumber?: string;
			customerName: string;
			currency: string;
			status: InvoiceStatus;
			issueDate: string;
			dueDate: string;
			notes?: string;
			paymentDetails?: string;
			rowNumbers: number[];
			lineItems: LineItem[];
		}
	>();
	const docs: Array<Record<string, unknown>> = [];

	for (const [index, row] of rows.entries()) {
		const customerName = row.customerName.trim();
		const description = row.description.trim();
		const quantity = Math.max(1, Number(row.quantity ?? 1));
		const price = Math.max(0, Number(row.price ?? 0));

		if (!customerName || !description || price <= 0) {
			skipped += 1;
			addImportError(index + 2, "Missing customer, description, or price.");
			continue;
		}

		const today = new Date().toISOString().slice(0, 10);
		const dueDate =
			row.dueDate?.trim() ||
			new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
				.toISOString()
				.slice(0, 10);
		const invoiceNumber = row.invoiceNumber?.trim().toUpperCase();
		const key = invoiceNumber || `row-${index}`;
		const group = groups.get(key);

		if (group) {
			group.lineItems.push({
				id: `li-${crypto.randomUUID()}`,
				name: description,
				quantity,
				price,
			});
			group.rowNumbers.push(index + 2);
			continue;
		}

		groups.set(key, {
			invoiceNumber,
			customerName,
			currency: (row.currency ?? "NGN").trim().toUpperCase() || "NGN",
			status: row.status ?? "draft",
			issueDate: row.issueDate?.trim() || today,
			dueDate,
			notes: row.notes?.trim() || undefined,
			paymentDetails: row.paymentDetails?.trim() || undefined,
			rowNumbers: [index + 2],
			lineItems: [
				{
					id: `li-${crypto.randomUUID()}`,
					name: description,
					quantity,
					price,
				},
			],
		});
	}

	// Best-effort B2 linkage for CSV import: when the customer cell carries an
	// email address, link the row to the existing client with that email in
	// THIS workspace. The lookup is workspace-scoped exactly like every other
	// client query and normalizes both sides with the clients module's
	// `trim().toLowerCase()` (src/server/data/clients.ts importClientsCsv).
	// Rows whose cell carries no email (or no match) are handled at the status
	// derivation below: issued-family rows land as drafts awaiting a buyer
	// link instead of being exempted from the leave-Draft gate.
	const emailToClientId = new Map<string, string>();
	const hasImportEmails = [...groups.values()].some(
		(group) => importRowCustomerEmail(group.customerName) !== null,
	);
	if (hasImportEmails) {
		// PostgREST caps an unbounded SELECT (1000 rows by default), so a
		// single all-clients read would silently truncate the email → id map
		// for a workspace with more clients than one page. Read in ID-ordered
		// pages instead and fold every page in until a short page ends the
		// loop; normalization stays exactly as before (trim().toLowerCase()
		// applied to both sides below), only the read is paged.
		const CLIENT_PAGE_SIZE = 1000;
		let offset = 0;
		for (;;) {
			const { data: pageClients, error: clientsError } = await client
				.from("clients")
				.select("id, email")
				.eq("workspace_id", workspaceId)
				.order("id", { ascending: true })
				.range(offset, offset + CLIENT_PAGE_SIZE - 1);
			if (clientsError) throw clientsError;
			for (const row of pageClients ?? []) {
				const normalized = String(row.email ?? "")
					.trim()
					.toLowerCase();
				if (normalized && !emailToClientId.has(normalized)) {
					emailToClientId.set(normalized, String(row.id));
				}
			}
			if (!pageClients || pageClients.length < CLIENT_PAGE_SIZE) break;
			offset += CLIENT_PAGE_SIZE;
		}
	}

	for (const group of groups.values()) {
		let invoiceNumber = group.invoiceNumber;
		if (
			!invoiceNumber ||
			!/^[A-Z0-9]{2,12}-\d{4}-\d{4,6}$/.test(invoiceNumber) ||
			usedNumbers.has(invoiceNumber)
		) {
			// WP8/C1: consume a number from the database allocator — under
			// concurrency the committed value is authoritative, so an import
			// can never hand out a number another writer already took.
			invoiceNumber = await commitInvoiceNumber(
				client,
				numberPlan,
				candidateInvoiceNumber(numberPlan),
			);
		} else {
			// WP8/C1: a custom imported number is reserved so the allocator's
			// counter stays past it and later generated numbers never collide.
			await reserveInvoiceNumber(client, {
				workspaceId,
				invoiceNumber,
			});
		}
		usedNumbers.add(invoiceNumber);
		const compliance = defaultCompliance({
			customerName: group.customerName,
			lineItems: group.lineItems,
		});
		const normalizedCompliance = {
			...compliance,
			regulatoryNotice:
				group.currency !== "NGN"
					? NIGERIA_FOREIGN_CURRENCY_WARNING
					: (compliance.regulatoryNotice as string | undefined),
		};

		try {
			assertInvoiceInput({
				invoiceNumber,
				currency: group.currency,
				lineItems: group.lineItems,
				compliance: normalizedCompliance,
			});
		} catch (error) {
			skipped += group.rowNumbers.length;
			addImportError(
				group.rowNumbers[0] ?? 0,
				error instanceof Error ? error.message : "Invalid invoice row.",
			);
			continue;
		}

		const matchEmail = importRowCustomerEmail(group.customerName);
		const matchedCustomerId = matchEmail
			? (emailToClientId.get(matchEmail) ?? null)
			: null;
		// Issued family = anything that leaves Draft on import (the same
		// condition that stamps `delivered_at` below); draft/canceled rows are
		// never flagged because a buyer-less draft is a legal document state.
		const issuedFamily =
			group.status !== "draft" && group.status !== "canceled";
		// B2 (audit round-2, HIGH): import must NOT exempt itself from
		// `assertCustomerForIssueTransition`, the single choke point for
		// leaving Draft. An issued-family row whose customer cell resolves to
		// no workspace client therefore lands as a DRAFT — never `unpaid`,
		// `overdue` or `paid`, and with no `delivered_at` / `paid_at` /
		// `payment_amount` stamp — with the original CSV status preserved in
		// `internal_notes` so the buyer can be linked later and the row then
		// issues through the ordinary gated transition. Rows WITH a workspace
		// customer keep today's behavior. Nothing is dropped silently: every
		// demoted row is still counted in `needsBuyerMatch` (reported by the
		// import toast) and the reason travels in `internal_notes`. Recorded in
		// prompts/wp6-audit-round2-fixes.md.
		const landAsDraft = issuedFamily && !matchedCustomerId;
		if (landAsDraft) needsBuyerMatch += 1;
		const csvStatus = group.status;

		const invoiceDoc = {
			workspace_id: workspaceId,
			user_id: userId,
			token: `pub-${crypto.randomUUID()}`,
			document_type: "standard",
			invoice_number: invoiceNumber,
			customer_id: matchedCustomerId,
			customer_name: group.customerName,
			currency: group.currency,
			invoice_type: "one-time",
			invoice_size: "A4",
			date_format: "ng",
			payment_terms_days: 14,
			template: "Default",
			issue_date: group.issueDate,
			due_date: group.dueDate,
			payment_amount:
				!landAsDraft && group.status === "paid"
					? invoiceAmount({
							lineItems: group.lineItems,
							compliance: normalizedCompliance as {
								netPayable?: number;
								grandTotal?: number;
								withholdingTaxAmount?: number;
							},
						})
					: 0,
			delivered_at: issuedFamily && !landAsDraft ? iso(now) : null,
			canceled_at: group.status === "canceled" ? iso(now) : null,
			payment_details: group.paymentDetails ?? null,
			paid_at: !landAsDraft && group.status === "paid" ? iso(now) : null,
			notes: group.notes ?? null,
			// Buyer-less issued-family rows keep their original CSV status here
			// so the demoted draft can be linked and issued later without
			// losing the imported intent (internal: never on the public copy).
			internal_notes: landAsDraft
				? `Imported from CSV as a draft: row status "${csvStatus}" needs a linked client before this invoice can leave Draft.`
				: null,
			line_items: group.lineItems,
			compliance: normalizedCompliance,
			fiscalization: { status: "not_configured" },
			reminder: defaultReminder(),
			sync: defaultSync(),
			lifecycle: {},
			created_at: iso(now),
			updated_at: iso(now),
			// B2 import semantics (WP6, audit round-2): CSV rows are PAST
			// records being backfilled, so import still derives and writes the
			// row's status here instead of replaying each historical
			// transition — but it no longer exempts itself from the
			// leave-Draft customer gate. A row marked draft, canceled, or
			// issued-family WITH a matched workspace client lands with its CSV
			// status; an issued-family row (unpaid / overdue / paid) WITHOUT a
			// match is demoted to `draft` (`landAsDraft` above) with its
			// intent recorded in `internal_notes` and counted in
			// `needsBuyerMatch`, so no customer-less invoice can reach an
			// issued or settled state through this path. Any later transition
			// of the imported row is gated as usual. Recorded in
			// prompts/wp6-audit-round2-fixes.md.
			status: getDerivedInvoiceStatus({
				...group,
				// Demote before deriving: overriding `status` also stops
				// `deliveredAtForInvoice` from treating the CSV status itself
				// as evidence the invoice was issued.
				...(landAsDraft ? { status: "draft" as const } : {}),
				lineItems: group.lineItems,
				compliance: normalizedCompliance,
				paymentAmount: landAsDraft
					? 0
					: group.status === "paid"
						? invoiceAmount({
								lineItems: group.lineItems,
								compliance: normalizedCompliance as {
									netPayable?: number;
									grandTotal?: number;
									withholdingTaxAmount?: number;
								},
							})
						: 0,
				deliveredAt: issuedFamily && !landAsDraft ? now : undefined,
				canceledAt: group.status === "canceled" ? now : undefined,
				paidAt: !landAsDraft && group.status === "paid" ? now : undefined,
			}),
		};

		docs.push(invoiceDoc);
	}

	for (
		let index = 0;
		index < docs.length;
		index += INVOICE_IMPORT_INSERT_CHUNK_SIZE
	) {
		const chunk = docs.slice(index, index + INVOICE_IMPORT_INSERT_CHUNK_SIZE);
		const { data, error } = await client
			.from("invoices")
			.insert(
				chunk as unknown as Database["public"]["Tables"]["invoices"]["Insert"][],
			)
			.select("id");
		if (error) throw error;
		created.push(...(data ?? []).map((row) => row.id));
	}

	// WP8/C1: the allocator already advanced `workspaces.next_invoice_sequence`
	// (monotonically, inside the same statement that consumed each number),
	// so there is no second write here.

	if (created.length > 0) {
		await recordInvoiceAudit(client, userId, {
			action: "invoice.create",
			resourceType: "invoice_import",
			after: {
				created: created.length,
				skipped,
				failed: errors.length,
				needsBuyerMatch,
			},
			message: `Imported ${created.length} invoice(s) from CSV.`,
		});
	}

	return { created: created.length, skipped, errors, needsBuyerMatch };
}

export async function markInvoiceSent(
	client: Supabase,
	userId: string,
	id: string,
): Promise<{ ok: true }> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");
	const invoice = await getById(client, userId, id);
	if (!invoice) throw new Error("Invoice not found.");

	const currentStatus = getDerivedInvoiceStatus(invoice);
	if (currentStatus === "paid" || currentStatus === "canceled") {
		throw new Error("Cannot send a paid or canceled invoice.");
	}
	// B2: sending a draft (mark as sent) leaves Draft — customer required.
	await assertCustomerForIssueTransition(
		client,
		workspaceId,
		invoice,
		currentStatus,
		"unpaid",
	);

	const now = Date.now();
	const currentLifecycle = invoice.lifecycle ?? {};
	const patch = patchWithDerivedStatus(invoice, {
		deliveredAt: invoice.deliveredAt ?? now,
		lifecycle: {
			...currentLifecycle,
			sentAt: currentLifecycle.sentAt ?? now,
		},
		updatedAt: now,
	});

	const { error } = await client
		.from("invoices")
		.update(
			toUpdate({
				delivered_at: iso(patch.deliveredAt as number),
				lifecycle: json(patch.lifecycle),
				status: patch.status,
				updated_at: iso(patch.updatedAt as number),
			}),
		)
		.eq("id", id)
		.eq("workspace_id", workspaceId);
	if (error) throw error;

	await recordInvoiceAudit(client, userId, {
		action: "invoice.send",
		resourceId: id,
		before: invoice,
		after: patch,
		message: "Invoice marked as sent.",
	});

	return { ok: true };
}

export async function recordDeliveryEvent(
	client: Supabase,
	userId: string,
	args: {
		invoiceId: string;
		channel: "email";
		recipient: string;
		provider: "resend";
		status: "sent" | "failed";
		providerMessageId?: string;
		error?: string;
		publicUrl?: string;
	},
	// Server callers (src/server/invoice-repository.ts) inject the
	// server-only audit service; browser callers rely on the default
	// endpoint transport from ./audit-client.
	options?: { write?: InvoiceAuditWriter },
): Promise<{ ok: true; deliveryEventId: string }> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");
	const invoice = await getById(client, userId, args.invoiceId);
	if (!invoice) throw new Error("Invoice not found.");

	// B2: a `sent` delivery event sets delivered_at, deriving a Draft invoice
	// out of Draft (unpaid/overdue) — the same customer requirement as every
	// other leave-Draft path, enforced BEFORE the event row and the invoice
	// update are written. `failed` events do not leave Draft, so they stay
	// recordable for customer-less drafts. Non-derived-Draft invoices are
	// unaffected (transitionLeavesDraft returns early, no extra query).
	if (args.status === "sent") {
		await assertCustomerForIssueTransition(
			client,
			workspaceId,
			invoice,
			getDerivedInvoiceStatus(invoice),
			"unpaid",
		);
	}

	const now = Date.now();
	const { data, error } = await client
		.from("invoice_delivery_events")
		.insert({
			workspace_id: workspaceId,
			owner_id: userId,
			invoice_id: args.invoiceId,
			channel: args.channel,
			recipient: args.recipient,
			provider: args.provider,
			status: args.status,
			provider_message_id: args.providerMessageId ?? null,
			public_url: args.publicUrl ?? null,
			error: args.error ?? null,
		})
		.select("id")
		.single();
	if (error) throw error;
	const deliveryEventId = data.id;

	if (args.status === "sent") {
		const currentLifecycle = invoice.lifecycle ?? {};
		const patch = patchWithDerivedStatus(invoice, {
			deliveredAt: invoice.deliveredAt ?? now,
			lifecycle: {
				...currentLifecycle,
				sentAt: currentLifecycle.sentAt ?? now,
				emailDeliveredAt: currentLifecycle.emailDeliveredAt ?? now,
			},
			updatedAt: now,
		});
		const { error: updateError } = await client
			.from("invoices")
			.update(
				toUpdate({
					delivered_at: iso(patch.deliveredAt as number),
					lifecycle: json(patch.lifecycle),
					status: patch.status,
					updated_at: iso(patch.updatedAt as number),
				}),
			)
			.eq("id", args.invoiceId)
			.eq("workspace_id", workspaceId);
		if (updateError) throw updateError;

		await recordInvoiceAudit(
			client,
			userId,
			{
				action: "invoice.send",
				resourceId: args.invoiceId,
				before: invoice,
				after: patch,
				message: `Invoice emailed to ${args.recipient}.`,
			},
			options?.write,
		);
	}

	return { ok: true, deliveryEventId };
}
