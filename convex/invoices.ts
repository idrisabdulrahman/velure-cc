import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
	internalAction,
	internalMutation,
	mutation,
	query,
} from "./_generated/server";
import { recordAuditLog } from "./audit";
import { recordEmailEvent } from "./emailEvents";
import { env } from "./env";
import {
	assertValidRcNumber,
	assertValidTin,
	defaultTaxTreatmentForSellerTaxStatus,
	defaultWithholdingSelection,
	formatInvoiceNumber,
	NIGERIA_FOREIGN_CURRENCY_WARNING,
	NIGERIA_TAX_RULE_SET_VERSION,
	NIGERIA_VAT_RATE,
	normalizeNigeriaPhone,
} from "./nigeria";
import {
	requireWorkspaceForRead,
	requireWritableInvoice,
	requireWritableWorkspace,
} from "./rls";

const statusValidator = v.union(
	v.literal("draft"),
	v.literal("unpaid"),
	v.literal("partially-paid"),
	v.literal("paid"),
	v.literal("overdue"),
	v.literal("canceled"),
);

const typeValidator = v.union(v.literal("one-time"), v.literal("recurring"));
const documentTypeValidator = v.union(
	v.literal("standard"),
	v.literal("proforma"),
);
const invoiceSizeValidator = v.union(v.literal("A4"), v.literal("LETTER"));
const dateFormatValidator = v.union(
	v.literal("iso"),
	v.literal("us"),
	v.literal("ng"),
);
const jurisdictionValidator = v.union(
	v.literal("NG"),
	v.literal("NGN"),
	v.literal("GH"),
	v.literal("KE"),
	v.literal("ZA"),
	v.literal("US"),
	v.literal("GB"),
	v.literal("EU"),
	v.literal("OTHER"),
);
const taxTreatmentValidator = v.union(
	v.literal("none"),
	v.literal("exclusive_rate"),
	v.literal("inclusive_rate"),
	v.literal("reverse_charge"),
	v.literal("exempt"),
	v.literal("zero_rated"),
);
const sellerTaxStatusValidator = v.union(
	v.literal("vat_registered"),
	v.literal("below_threshold_not_charging_vat"),
	v.literal("statutorily_exempt"),
);
const withholdingTaxPresetValidator = v.union(
	v.literal("none"),
	v.literal("contracts_supplies"),
	v.literal("consultancy_company"),
	v.literal("consultancy_individual"),
	v.literal("rent_interest"),
);
const withholdingCategoryValidator = v.union(
	v.literal("none"),
	v.literal("goods_materials"),
	v.literal("general_services"),
	v.literal("professional_fees"),
	v.literal("major_construction"),
	v.literal("other_construction"),
	v.literal("telecom_colocation"),
	v.literal("brokerage"),
	v.literal("rent_hire_lease"),
);
const withholdingRecipientEntityTypeValidator = v.union(
	v.literal("corporate"),
	v.literal("non_corporate"),
);
const withholdingRecipientResidencyValidator = v.union(
	v.literal("resident"),
	v.literal("non_resident"),
);
const complianceWarningValidator = v.union(
	v.literal("missing_seller_tax_id"),
	v.literal("missing_buyer_tax_id"),
	v.literal("cross_border_review"),
	v.literal("reverse_charge_review"),
	v.literal("unknown_jurisdiction"),
	v.literal("domestic_vat_not_applied"),
	v.literal("missing_workspace_tax_status"),
	v.literal("manual_tax_override"),
	v.literal("manual_wht_override"),
	v.literal("legacy_wht_mapping"),
);
const syncStatusValidator = v.union(
	v.literal("idle"),
	v.literal("pending"),
	v.literal("success"),
	v.literal("failed"),
	v.literal("needs_configuration"),
);
const MAX_INVOICE_IMPORT_ROWS = 2_000;
const INVOICE_IMPORT_INSERT_CHUNK_SIZE = 50;
const reminderStageValidator = v.union(
	v.literal("none"),
	v.literal("before_due"),
	v.literal("due_date"),
	v.literal("overdue_1"),
	v.literal("overdue_2"),
	v.literal("overdue_3"),
	v.literal("escalated"),
);
const escalationStatusValidator = v.union(
	v.literal("idle"),
	v.literal("queued"),
	v.literal("sent"),
	v.literal("manual_review"),
);

const lineItemValidator = v.object({
	id: v.string(),
	name: v.string(),
	quantity: v.number(),
	price: v.number(),
	productId: v.optional(v.id("products")),
});

const shipmentDetailsValidator = v.object({
	weight: v.optional(v.string()),
	packageCount: v.optional(v.number()),
	hsCode: v.optional(v.string()),
	incoterms: v.optional(v.string()),
	portOfLoading: v.optional(v.string()),
	portOfDischarge: v.optional(v.string()),
});

const depositRequestValidator = v.object({
	kind: v.union(v.literal("amount"), v.literal("percentage")),
	value: v.number(),
	dueDate: v.optional(v.string()),
});

const importInvoiceRowValidator = v.object({
	invoiceNumber: v.optional(v.string()),
	customerName: v.string(),
	currency: v.optional(v.string()),
	status: v.optional(statusValidator),
	issueDate: v.optional(v.string()),
	dueDate: v.optional(v.string()),
	description: v.string(),
	quantity: v.optional(v.number()),
	price: v.optional(v.number()),
	notes: v.optional(v.string()),
	paymentDetails: v.optional(v.string()),
	paymentLink: v.optional(v.string()),
});

const businessIdentityValidator = v.object({
	legalName: v.optional(v.string()),
	tradingName: v.optional(v.string()),
	email: v.optional(v.string()),
	phone: v.optional(v.string()),
	address: v.optional(v.string()),
	website: v.optional(v.string()),
	countryCode: v.optional(jurisdictionValidator),
	taxId: v.optional(v.string()),
	rcNumber: v.optional(v.string()),
});

const withholdingValidator = v.object({
	mode: v.union(v.literal("rule_based"), v.literal("legacy_manual")),
	category: withholdingCategoryValidator,
	recipientEntityType: withholdingRecipientEntityTypeValidator,
	recipientResidency: withholdingRecipientResidencyValidator,
	rate: v.number(),
	amount: v.number(),
	ruleVersion: v.string(),
	manualOverride: v.boolean(),
	overrideNote: v.optional(v.string()),
	legacyPreset: v.optional(withholdingTaxPresetValidator),
});

const fiscalizationValidator = v.object({
	status: v.union(
		v.literal("not_configured"),
		v.literal("ready"),
		v.literal("pending"),
		v.literal("fiscalized"),
		v.literal("failed"),
	),
	uid: v.optional(v.string()),
	sid: v.optional(v.string()),
	qrCodePayload: v.optional(v.string()),
	lastError: v.optional(v.string()),
	lastAttemptAt: v.optional(v.number()),
});

const complianceValidator = v.object({
	seller: businessIdentityValidator,
	buyer: businessIdentityValidator,
	sellerTaxStatus: v.optional(sellerTaxStatusValidator),
	placeOfSupply: jurisdictionValidator,
	taxRuleSetVersion: v.string(),
	taxTreatment: taxTreatmentValidator,
	taxRate: v.number(),
	taxLabel: v.string(),
	taxLines: v.array(
		v.object({
			label: v.string(),
			rate: v.number(),
			amount: v.number(),
			treatment: taxTreatmentValidator,
			jurisdictionCode: jurisdictionValidator,
		}),
	),
	warnings: v.array(complianceWarningValidator),
	templateVariant: v.union(
		v.literal("default_ng"),
		v.literal("cross_border"),
		v.literal("vat_ready"),
	),
	subtotal: v.number(),
	totalTax: v.number(),
	withholding: withholdingValidator,
	withholdingTaxPreset: withholdingTaxPresetValidator,
	withholdingTaxLabel: v.string(),
	withholdingTaxRate: v.number(),
	withholdingTaxAmount: v.number(),
	regulatoryNotice: v.optional(v.string()),
	grandTotal: v.number(),
	fiscalization: v.optional(fiscalizationValidator),
});

const reminderValidator = v.object({
	enabled: v.boolean(),
	paused: v.boolean(),
	stage: reminderStageValidator,
	lastReminderAt: v.optional(v.number()),
	nextReminderAt: v.optional(v.number()),
	escalationStatus: escalationStatusValidator,
	paidAt: v.optional(v.number()),
});

const providerSyncStateValidator = v.object({
	externalId: v.optional(v.string()),
	status: syncStatusValidator,
	lastSyncedAt: v.optional(v.number()),
	lastError: v.optional(v.string()),
});

function normalizeJurisdictionCode(value: unknown) {
	return value === "NGN" ? "NG" : value;
}

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

const syncValidator = v.object({
	quickbooks: providerSyncStateValidator,
	xero: providerSyncStateValidator,
	slack: providerSyncStateValidator,
});

const paymentProviderValidator = v.union(
	v.literal("manual"),
	v.literal("paystack"),
);

const invoiceValidator = v.object({
	id: v.id("invoices"),
	token: v.string(),
	documentType: v.optional(documentTypeValidator),
	convertedToInvoiceId: v.optional(v.id("invoices")),
	shipmentDetails: v.optional(shipmentDetailsValidator),
	depositRequest: v.optional(depositRequestValidator),
	invoiceNumber: v.string(),
	customerName: v.string(),
	logoUrl: v.optional(v.string()),
	customerPoNumber: v.optional(v.string()),
	currency: v.string(),
	type: typeValidator,
	invoiceSize: invoiceSizeValidator,
	dateFormat: dateFormatValidator,
	paymentTermsDays: v.number(),
	template: v.string(),
	issueDate: v.string(),
	dueDate: v.string(),
	status: statusValidator,
	total: v.number(),
	balance: v.number(),
	paymentAmount: v.number(),
	paymentDetails: v.optional(v.string()),
	paymentLink: v.optional(v.string()),
	paymentProvider: v.optional(paymentProviderValidator),
	paidAt: v.optional(v.number()),
	paymentReference: v.optional(v.string()),
	deliveredAt: v.optional(v.number()),
	canceledAt: v.optional(v.number()),
	deletedAt: v.optional(v.number()),
	notes: v.optional(v.string()),
	lineItems: v.array(lineItemValidator),
	compliance: v.optional(complianceValidator),
	fiscalization: v.optional(fiscalizationValidator),
	reminder: v.optional(reminderValidator),
	sync: v.optional(syncValidator),
});

function defaultCompliance(args: {
	customerName: string;
	lineItems: Array<{ quantity: number; price: number }>;
}): any {
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

function defaultReminder(): any {
	return {
		enabled: true,
		paused: false,
		stage: "none",
		escalationStatus: "idle",
	};
}

function defaultSync(): any {
	return {
		quickbooks: { status: "idle" },
		xero: { status: "idle" },
		slack: { status: "idle" },
	};
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

	return invoice.lineItems.reduce(
		(sum, item) => sum + item.quantity * item.price,
		0,
	);
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

function getDerivedInvoiceStatus(invoice: any) {
	const total = invoiceAmount(invoice);
	const paymentAmount = legacyPaymentAmount(invoice, total);

	if (invoice.canceledAt || invoice.status === "canceled")
		return "canceled" as const;
	if (total > 0 && paymentAmount >= total) return "paid" as const;
	if (paymentAmount > 0 && paymentAmount < total)
		return "partially-paid" as const;

	const deliveredAt = deliveredAtForInvoice(invoice);
	if (!deliveredAt) return "draft" as const;

	const dueDate = new Date(`${invoice.dueDate}T00:00:00`);
	if (!Number.isNaN(dueDate.getTime())) {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		if (dueDate.getTime() < today.getTime()) return "overdue" as const;
	}

	return "unpaid" as const;
}

function patchWithDerivedStatus(current: any, patch: Record<string, unknown>) {
	const next = { ...current, ...patch };
	return {
		...patch,
		status: getDerivedInvoiceStatus(next),
	};
}

const mapInvoice = (invoice: any) => {
	const total = invoiceAmount(invoice);
	const paymentAmount = legacyPaymentAmount(invoice, total);
	const deliveredAt = deliveredAtForInvoice(invoice);
	const status = getDerivedInvoiceStatus(invoice);

	return {
		id: invoice._id,
		token: invoice.token,
		documentType: invoice.documentType ?? "standard",
		convertedToInvoiceId: invoice.convertedToInvoiceId,
		shipmentDetails: invoice.shipmentDetails,
		depositRequest: invoice.depositRequest,
		invoiceNumber: invoice.invoiceNumber,
		customerName: invoice.customerName,
		logoUrl: invoice.logoUrl,
		customerPoNumber: invoice.customerPoNumber,
		currency: invoice.currency,
		type: invoice.type ?? "one-time",
		invoiceSize: invoice.invoiceSize ?? "A4",
		dateFormat: invoice.dateFormat ?? "ng",
		paymentTermsDays: invoice.paymentTermsDays ?? 14,
		template: invoice.template ?? "Default",
		issueDate: invoice.issueDate,
		dueDate: invoice.dueDate,
		status,
		total,
		balance: Math.max(0, total - paymentAmount),
		paymentAmount,
		paymentDetails: invoice.paymentDetails,
		paymentLink: invoice.paymentLink,
		paymentProvider: invoice.paymentProvider,
		paidAt: invoice.paidAt,
		paymentReference: invoice.paymentReference,
		deliveredAt,
		canceledAt:
			invoice.canceledAt ??
			(invoice.status === "canceled" ? invoice.updatedAt : undefined),
		deletedAt: invoice.deletedAt,
		notes: invoice.notes,
		lineItems: invoice.lineItems,
		compliance: invoice.compliance ?? defaultCompliance(invoice),
		fiscalization: invoice.fiscalization ??
			invoice.compliance?.fiscalization ?? { status: "not_configured" },
		reminder: invoice.reminder ?? defaultReminder(),
		sync: invoice.sync ?? defaultSync(),
		lifecycle: invoice.lifecycle ?? {},
		createdAt: invoice.createdAt ?? Date.now(),
		updatedAt: invoice.updatedAt ?? Date.now(),
	};
};

function assertInvoiceInput(args: {
	invoiceNumber: string;
	currency: string;
	lineItems: Array<{
		id: string;
		name: string;
		quantity: number;
		price: number;
	}>;
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
	details:
		| {
				weight?: string;
				packageCount?: number;
				hsCode?: string;
				incoterms?: string;
				portOfLoading?: string;
				portOfDischarge?: string;
		  }
		| undefined,
	documentType: "standard" | "proforma",
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
	request:
		| {
				kind: "amount" | "percentage";
				value: number;
				dueDate?: string;
		  }
		| undefined,
	documentType: "standard" | "proforma",
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

async function assertUniqueInvoiceNumber(
	ctx: any,
	args: {
		workspaceId: string;
		invoiceNumber: string;
		exceptId?: string;
	},
) {
	const existing = await ctx.db
		.query("invoices")
		.withIndex("by_workspaceId_and_invoice_number", (q: any) =>
			q
				.eq("workspaceId", args.workspaceId)
				.eq("invoiceNumber", args.invoiceNumber),
		)
		.first();

	if (existing && String(existing._id) !== String(args.exceptId ?? "")) {
		throw new Error("Invoice number already exists in this workspace.");
	}
}

function sequenceFromInvoiceNumber(
	invoiceNumber: string,
	prefix: string,
	year: number,
) {
	const match = invoiceNumber.match(
		new RegExp(`^${prefix}-(\\d{4})-(\\d{4,6})$`),
	);
	if (!match || Number(match[1]) !== year) return null;
	const sequence = Number(match[2]);
	return Number.isFinite(sequence) ? sequence : null;
}

async function nextInvoiceNumberForWorkspace(
	ctx: any,
	workspaceId: string,
	documentType: "standard" | "proforma" = "standard",
) {
	const workspace = await ctx.db.get(workspaceId);
	const prefixSource =
		documentType === "proforma"
			? "PF"
			: workspace?.invoiceNumberMode === "business_name"
				? workspace?.name
				: workspace?.invoiceNumberPrefix;
	const prefix =
		String(prefixSource ?? "INV")
			.trim()
			.toUpperCase()
			.replace(/[^A-Z0-9]/g, "")
			.slice(0, 12) || "INV";
	const invoices = await ctx.db
		.query("invoices")
		.withIndex("by_workspaceId", (q: any) => q.eq("workspaceId", workspaceId))
		.collect();
	const year = new Date().getFullYear();
	const pattern = new RegExp(`^${prefix}-(\\d{4})-(\\d{4,6})$`);
	const maxSequence = invoices.reduce((max: number, invoice: any) => {
		const match = String(invoice.invoiceNumber).match(pattern);
		if (!match || Number(match[1]) !== year) return max;
		return Math.max(max, Number(match[2]));
	}, 0);
	const sequence = Math.max(
		Number(workspace?.nextInvoiceSequence ?? 1),
		maxSequence + 1,
	);
	return {
		prefix,
		year,
		sequence,
		invoiceNumber:
			prefix === "INV"
				? formatInvoiceNumber(year, sequence)
				: `${prefix}-${year}-${String(sequence).padStart(4, "0")}`,
		nextSequence: sequence + 1,
	};
}

async function prepareInvoiceNumberForInsert(
	ctx: any,
	args: {
		workspaceId: string;
		requestedInvoiceNumber: string;
		documentType: "standard" | "proforma";
		exceptId?: string;
	},
) {
	const requestedInvoiceNumber = args.requestedInvoiceNumber.trim();
	const generated = await nextInvoiceNumberForWorkspace(
		ctx,
		args.workspaceId,
		args.documentType,
	);
	const hasValidRequestedNumber = /^[A-Z0-9]{2,12}-\d{4}-\d{4,6}$/.test(
		requestedInvoiceNumber,
	);
	const existing = hasValidRequestedNumber
		? await ctx.db
				.query("invoices")
				.withIndex("by_workspaceId_and_invoice_number", (q: any) =>
					q
						.eq("workspaceId", args.workspaceId)
						.eq("invoiceNumber", requestedInvoiceNumber),
				)
				.first()
		: null;
	const requestedCollides =
		existing && String(existing._id) !== String(args.exceptId ?? "");

	if (
		!hasValidRequestedNumber ||
		requestedCollides ||
		requestedInvoiceNumber === generated.invoiceNumber
	) {
		return generated;
	}

	const requestedSequence = sequenceFromInvoiceNumber(
		requestedInvoiceNumber,
		generated.prefix,
		generated.year,
	);

	return {
		...generated,
		invoiceNumber: requestedInvoiceNumber,
		nextSequence:
			requestedSequence !== null && requestedSequence >= generated.sequence
				? requestedSequence + 1
				: undefined,
	};
}

function invoiceNumberForSequence(
	prefix: string,
	year: number,
	sequence: number,
) {
	return prefix === "INV"
		? formatInvoiceNumber(year, sequence)
		: `${prefix}-${year}-${String(sequence).padStart(4, "0")}`;
}

const invoiceListArgs = {
	q: v.optional(v.string()),
	status: v.optional(v.union(v.literal("all"), statusValidator)),
	type: v.optional(v.union(v.literal("all"), typeValidator)),
	documentType: v.optional(v.union(v.literal("all"), documentTypeValidator)),
	customer: v.optional(v.string()),
	dueDateFrom: v.optional(v.string()),
	dueDateTo: v.optional(v.string()),
};

const invoicePageArgs = {
	...invoiceListArgs,
	cursor: v.optional(v.union(v.string(), v.null())),
	pageSize: v.optional(v.number()),
};

type InvoiceListArgs = {
	q?: string;
	status?:
		| "all"
		| "draft"
		| "unpaid"
		| "partially-paid"
		| "paid"
		| "overdue"
		| "canceled";
	type?: "all" | "one-time" | "recurring";
	documentType?: "all" | "standard" | "proforma";
	customer?: string;
	dueDateFrom?: string;
	dueDateTo?: string;
	cursor?: string | null;
	pageSize?: number;
};

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

function paginateInvoiceRows(
	rows: Array<Doc<"invoices">>,
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

function invoiceListQueryForWorkspace(
	ctx: any,
	workspaceId: string,
	args: InvoiceListArgs,
) {
	const status = args.status && args.status !== "all" ? args.status : null;
	if (status !== null) {
		return ctx.db
			.query("invoices")
			.withIndex("by_workspaceId_and_status", (q: any) =>
				q.eq("workspaceId", workspaceId).eq("status", status),
			)
			.order("desc");
	}

	if (args.dueDateFrom && args.dueDateTo) {
		return ctx.db
			.query("invoices")
			.withIndex("by_workspaceId_and_dueDate", (q: any) =>
				q
					.eq("workspaceId", workspaceId)
					.gte("dueDate", args.dueDateFrom)
					.lte("dueDate", args.dueDateTo),
			)
			.order("desc");
	}

	if (args.dueDateFrom) {
		return ctx.db
			.query("invoices")
			.withIndex("by_workspaceId_and_dueDate", (q: any) =>
				q.eq("workspaceId", workspaceId).gte("dueDate", args.dueDateFrom),
			)
			.order("desc");
	}

	if (args.dueDateTo) {
		return ctx.db
			.query("invoices")
			.withIndex("by_workspaceId_and_dueDate", (q: any) =>
				q.eq("workspaceId", workspaceId).lte("dueDate", args.dueDateTo),
			)
			.order("desc");
	}

	return ctx.db
		.query("invoices")
		.withIndex("by_workspaceId", (q: any) => q.eq("workspaceId", workspaceId))
		.order("desc");
}

function filterInvoiceListRows(
	invoices: Array<Doc<"invoices">>,
	args: InvoiceListArgs,
) {
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

async function listInvoicesForWorkspace(
	ctx: any,
	workspaceId: string,
	args: InvoiceListArgs,
) {
	const invoices = await invoiceListQueryForWorkspace(
		ctx,
		workspaceId,
		args,
	).collect();

	return filterInvoiceListRows(invoices, args).map(mapInvoice);
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

function buildInvoiceListSummary(rows: any[]) {
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
	};
}

export const list = query({
	args: invoiceListArgs,
	handler: async (ctx, args) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) return [];

		return listInvoicesForWorkspace(ctx, scope.workspaceId, args);
	},
});

export const listSummary = query({
	args: invoiceListArgs,
	handler: async (ctx, args) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) {
			return {
				currencySummaries: [],
				chartDataByCurrency: {},
			};
		}

		const rows = await listInvoicesForWorkspace(ctx, scope.workspaceId, args);

		return buildInvoiceListSummary(rows);
	},
});

export const listPage = query({
	args: invoicePageArgs,
	handler: async (ctx, args) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) {
			return {
				page: [],
				isDone: true,
				continueCursor: args.cursor ?? null,
			};
		}

		const pageSize = Math.min(
			Math.max(Math.floor(args.pageSize ?? 50), 10),
			100,
		);

		if (hasInvoiceListPostFilters(args)) {
			const invoices = await invoiceListQueryForWorkspace(
				ctx,
				scope.workspaceId,
				args,
			).collect();

			return paginateInvoiceRows(
				filterInvoiceListRows(invoices, args),
				args,
				pageSize,
			);
		}

		const result = await invoiceListQueryForWorkspace(
			ctx,
			scope.workspaceId,
			args,
		).paginate({
			cursor: args.cursor ?? null,
			numItems: pageSize,
		});

		return {
			...result,
			page: filterInvoiceListRows(result.page, args).map(mapInvoice),
		};
	},
});

export const listWithSummary = query({
	args: invoiceListArgs,
	handler: async (ctx, args) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) {
			return {
				rows: [],
				currencySummaries: [],
				chartDataByCurrency: {},
			};
		}

		const rows = await listInvoicesForWorkspace(ctx, scope.workspaceId, args);

		return {
			rows,
			...buildInvoiceListSummary(rows),
		};
	},
});

export const getById = query({
	args: { id: v.id("invoices") },
	handler: async (ctx, args) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) return null;

		const invoice = await ctx.db.get(args.id);
		if (!invoice || invoice.workspaceId !== scope.workspaceId) return null;

		return mapInvoice(invoice);
	},
});

export const getByToken = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) return null;

		const invoice = await ctx.db
			.query("invoices")
			.withIndex("by_token", (q) => q.eq("token", args.token))
			.first();

		if (!invoice || invoice.workspaceId !== scope.workspaceId) return null;

		return mapInvoice(invoice);
	},
});

export const getPublicByToken = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const invoice = await ctx.db
			.query("invoices")
			.withIndex("by_token", (q) => q.eq("token", args.token))
			.first();

		if (
			!invoice ||
			invoice.deletedAt ||
			getDerivedInvoiceStatus(invoice) === "canceled"
		)
			return null;

		return {
			...mapInvoice(invoice),
			paymentLink: undefined,
			paymentProvider: undefined,
		};
	},
});

export const createDraft = mutation({
	args: {
		id: v.optional(v.id("invoices")),
		token: v.string(),
		documentType: v.optional(documentTypeValidator),
		shipmentDetails: v.optional(shipmentDetailsValidator),
		depositRequest: v.optional(depositRequestValidator),
		invoiceNumber: v.string(),
		customerName: v.string(),
		logoUrl: v.optional(v.string()),
		customerPoNumber: v.optional(v.string()),
		currency: v.string(),
		type: v.optional(typeValidator),
		invoiceSize: v.optional(invoiceSizeValidator),
		dateFormat: v.optional(dateFormatValidator),
		paymentTermsDays: v.optional(v.number()),
		template: v.optional(v.string()),
		issueDate: v.string(),
		dueDate: v.string(),
		paymentDetails: v.optional(v.string()),
		paymentLink: v.optional(v.string()),
		paymentProvider: v.optional(paymentProviderValidator),
		notes: v.optional(v.string()),
		lineItems: v.array(lineItemValidator),
		compliance: v.optional(complianceValidator),
		fiscalization: v.optional(fiscalizationValidator),
		reminder: v.optional(reminderValidator),
		sync: v.optional(syncValidator),
		autoSendEmail: v.optional(v.boolean()),
	},
	handler: async (ctx, args) => {
		const scope = await requireWritableWorkspace(ctx);
		const now = Date.now();
		const compliance = args.compliance ?? defaultCompliance(args);
		const documentType = args.documentType ?? "standard";
		const existingDraft = args.id ? await ctx.db.get(args.id) : null;
		if (args.id) {
			if (!existingDraft || existingDraft.workspaceId !== scope.workspaceId) {
				throw new Error("Draft invoice not found.");
			}
			if (getDerivedInvoiceStatus(existingDraft) !== "draft") {
				throw new Error("Only draft invoices can be finalized.");
			}
		}
		const preparedNumber =
			existingDraft && !args.invoiceNumber.trim()
				? {
						invoiceNumber: existingDraft.invoiceNumber,
						nextSequence: undefined,
					}
				: await prepareInvoiceNumberForInsert(ctx, {
						workspaceId: scope.workspaceId,
						requestedInvoiceNumber: args.invoiceNumber,
						documentType,
						exceptId: args.id,
					});
		const invoiceNumber = preparedNumber.invoiceNumber;
		const normalizedCompliance = normalizeComplianceSnapshot(compliance);
		assertInvoiceInput({
			invoiceNumber,
			currency: args.currency,
			lineItems: args.lineItems,
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

		const invoiceDoc = {
			workspaceId: scope.workspaceId,
			userId: existingDraft?.userId ?? scope.userId,
			token: args.token,
			documentType,
			shipmentDetails,
			depositRequest,
			invoiceNumber,
			customerName: args.customerName,
			logoUrl: args.logoUrl,
			customerPoNumber,
			currency: args.currency,
			type: args.type ?? "one-time",
			invoiceSize: args.invoiceSize ?? "A4",
			dateFormat: args.dateFormat ?? "ng",
			paymentTermsDays: args.paymentTermsDays ?? 14,
			template: args.template ?? "Default",
			issueDate: args.issueDate,
			dueDate: args.dueDate,
			paymentAmount: 0,
			paymentDetails: args.paymentDetails,
			notes: args.notes,
			lineItems: args.lineItems,
			compliance: normalizedCompliance,
			fiscalization: args.fiscalization ??
				normalizedCompliance.fiscalization ?? { status: "not_configured" },
			reminder,
			sync,
			lifecycle: {},
			createdAt: existingDraft?.createdAt ?? now,
			updatedAt: now,
		};
		const status = getDerivedInvoiceStatus(invoiceDoc);
		const id =
			args.id ??
			(await ctx.db.insert("invoices", {
				...invoiceDoc,
				status,
			}));

		if (args.id) {
			await ctx.db.patch(args.id, {
				...invoiceDoc,
				status,
			});
		}

		if (preparedNumber.nextSequence) {
			await ctx.db.patch(scope.workspaceId, {
				nextInvoiceSequence: preparedNumber.nextSequence,
				updatedAt: now,
			});
		}

		await recordAuditLog(ctx, {
			workspaceId: scope.workspaceId,
			actorId: scope.userId,
			action: args.id ? "invoice.edited" : "invoice.created",
			resourceType: "invoice",
			resourceId: String(id),
			metadata: {
				invoiceNumber,
				source: args.id ? "autosave_finalize" : "create",
			},
		});

		const shouldAutoSend =
			args.autoSendEmail !== false &&
			normalizedCompliance?.buyer?.email?.trim();

		let emailSent = false;

		if (shouldAutoSend) {
			const recipient = normalizedCompliance.buyer.email.trim().toLowerCase();

			try {
				if (env.RESEND_API_KEY) {
					const publicLink = `${env.SITE_URL ?? ""}/i/${args.token}`;
					const safeInvoiceNumber = escapeHtml(invoiceNumber);
					const safeCustomerName = escapeHtml(args.customerName);
					const safePublicLink = escapeHtml(publicLink);

					const response = await fetch("https://api.resend.com/emails", {
						method: "POST",
						headers: {
							Authorization: `Bearer ${env.RESEND_API_KEY}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify({
							from: env.RESEND_FROM ?? "Velure <onboarding@resend.dev>",
							to: [recipient],
							subject: buildInvoiceEmailSubject(invoiceNumber, documentType),
							text: `${documentLabel(documentType)} ${invoiceNumber} for ${args.customerName}. View it here: ${publicLink}`,
							html: `<p>${documentLabel(documentType)} <strong>${safeInvoiceNumber}</strong> for ${safeCustomerName}.</p><p>View it here: <a href="${safePublicLink}">${safePublicLink}</a></p>`,
						}),
					});

					const payload = response.ok
						? ((await response.json().catch(() => null)) as {
								id?: string;
								data?: { id?: string };
							} | null)
						: null;
					const providerMessageId = payload?.id ?? payload?.data?.id;

					if (response.ok) {
						emailSent = true;
						const emailTimestamp = Date.now();

						await ctx.db.patch(
							id,
							patchWithDerivedStatus(invoiceDoc, {
								deliveredAt: emailTimestamp,
								lifecycle: {
									sentAt: emailTimestamp,
									emailDeliveredAt: emailTimestamp,
								},
								updatedAt: emailTimestamp,
							}),
						);

						const deliveryEventId = await ctx.db.insert(
							"invoice_delivery_events",
							{
								workspaceId: scope.workspaceId,
								ownerId: scope.userId,
								invoiceId: id,
								channel: "email",
								recipient,
								provider: "resend",
								status: "sent",
								providerMessageId,
								publicUrl: publicLink,
								createdAt: emailTimestamp,
								updatedAt: emailTimestamp,
							},
						);

						await recordEmailEvent(ctx, {
							workspaceId: scope.workspaceId,
							ownerId: scope.userId,
							invoiceId: id,
							deliveryEventId,
							providerMessageId,
							eventType: "sent",
							recipient,
						});

						await recordAuditLog(ctx, {
							workspaceId: scope.workspaceId,
							actorId: scope.userId,
							action: "invoice.sent",
							resourceType: "invoice",
							resourceId: String(id),
							metadata: {
								invoiceNumber,
								recipient,
								providerMessageId,
							},
						});
					}
				}
			} catch (_error) {
				// Email sending failed, but invoice was created successfully
			}
		}

		return mapInvoice({
			_id: id,
			workspaceId: scope.workspaceId,
			userId: existingDraft?.userId ?? scope.userId,
			token: args.token,
			documentType,
			shipmentDetails,
			depositRequest,
			invoiceNumber,
			customerName: args.customerName,
			logoUrl: args.logoUrl,
			customerPoNumber,
			currency: args.currency,
			type: args.type,
			invoiceSize: args.invoiceSize,
			dateFormat: args.dateFormat,
			paymentTermsDays: args.paymentTermsDays,
			template: args.template,
			issueDate: args.issueDate,
			dueDate: args.dueDate,
			paymentAmount: 0,
			deliveredAt: emailSent ? Date.now() : undefined,
			paymentDetails: args.paymentDetails,
			notes: args.notes,
			lineItems: args.lineItems,
			compliance: normalizedCompliance,
			fiscalization: args.fiscalization ??
				normalizedCompliance.fiscalization ?? { status: "not_configured" },
			reminder,
			sync,
			lifecycle: emailSent
				? { sentAt: Date.now(), emailDeliveredAt: Date.now() }
				: {},
			createdAt: existingDraft?.createdAt ?? now,
			updatedAt: now,
		});
	},
});

export const autosaveDraft = mutation({
	args: {
		id: v.optional(v.id("invoices")),
		token: v.string(),
		documentType: v.optional(documentTypeValidator),
		shipmentDetails: v.optional(shipmentDetailsValidator),
		depositRequest: v.optional(depositRequestValidator),
		invoiceNumber: v.string(),
		customerName: v.string(),
		logoUrl: v.optional(v.string()),
		customerPoNumber: v.optional(v.string()),
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
		compliance: v.optional(complianceValidator),
		fiscalization: v.optional(fiscalizationValidator),
		reminder: v.optional(reminderValidator),
		sync: v.optional(syncValidator),
	},
	handler: async (ctx, args) => {
		const scope = await requireWritableWorkspace(ctx);
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
		const current = args.id ? await ctx.db.get(args.id) : null;
		const preparedNumber =
			current && !args.invoiceNumber.trim()
				? {
						invoiceNumber: current.invoiceNumber,
						nextSequence: undefined,
					}
				: await prepareInvoiceNumberForInsert(ctx, {
						workspaceId: scope.workspaceId,
						requestedInvoiceNumber: args.invoiceNumber,
						documentType,
						exceptId: args.id,
					});
		const invoiceNumber = preparedNumber.invoiceNumber;
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
			compliance: normalizedCompliance,
		});

		const patch = {
			token: args.token,
			documentType,
			shipmentDetails,
			depositRequest,
			invoiceNumber,
			customerName: args.customerName,
			logoUrl: args.logoUrl,
			customerPoNumber: normalizeCustomerPoNumber(args.customerPoNumber),
			currency: args.currency,
			type: args.type ?? "one-time",
			invoiceSize: args.invoiceSize ?? "A4",
			dateFormat: args.dateFormat ?? "ng",
			paymentTermsDays: args.paymentTermsDays ?? 14,
			template: args.template ?? "Default",
			issueDate: args.issueDate,
			dueDate: args.dueDate,
			status: "draft" as const,
			paymentAmount: 0,
			deliveredAt: undefined,
			paymentDetails: args.paymentDetails,
			notes: args.notes,
			lineItems,
			compliance: normalizedCompliance,
			fiscalization: args.fiscalization ??
				normalizedCompliance.fiscalization ?? {
					status: "not_configured" as const,
				},
			reminder: args.reminder ?? defaultReminder(),
			sync: args.sync ?? defaultSync(),
			lifecycle: {},
			updatedAt: now,
		};

		if (args.id) {
			if (!current || current.workspaceId !== scope.workspaceId) {
				throw new Error("Draft invoice not found.");
			}
			if (getDerivedInvoiceStatus(current) !== "draft") {
				throw new Error("Only draft invoices can be autosaved.");
			}

			await ctx.db.patch(args.id, patch);
			return mapInvoice({
				...current,
				...patch,
				_id: args.id,
				workspaceId: scope.workspaceId,
				userId: current.userId ?? scope.userId,
				createdAt: current.createdAt ?? now,
			});
		}

		const id = await ctx.db.insert("invoices", {
			workspaceId: scope.workspaceId,
			userId: scope.userId,
			...patch,
			createdAt: now,
		});

		if (preparedNumber.nextSequence) {
			await ctx.db.patch(scope.workspaceId, {
				nextInvoiceSequence: preparedNumber.nextSequence,
				updatedAt: now,
			});
		}

		await recordAuditLog(ctx, {
			workspaceId: scope.workspaceId,
			actorId: scope.userId,
			action: "invoice.created",
			resourceType: "invoice",
			resourceId: String(id),
			metadata: { invoiceNumber, source: "autosave" },
		});

		return mapInvoice({
			_id: id,
			workspaceId: scope.workspaceId,
			userId: scope.userId,
			...patch,
			createdAt: now,
		});
	},
});

export const save = mutation({
	args: invoiceValidator,
	handler: async (ctx, args) => {
		const { invoice: current } = await requireWritableInvoice(ctx, args.id);

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
			compliance: normalizedCompliance,
		});
		await assertUniqueInvoiceNumber(ctx, {
			workspaceId: current.workspaceId,
			invoiceNumber: args.invoiceNumber,
			exceptId: args.id,
		});

		await ctx.db.patch(
			args.id,
			patchWithDerivedStatus(current, {
				token: args.token,
				documentType,
				shipmentDetails,
				depositRequest,
				invoiceNumber: args.invoiceNumber,
				customerName: args.customerName,
				logoUrl: args.logoUrl,
				customerPoNumber: normalizeCustomerPoNumber(args.customerPoNumber),
				currency: args.currency,
				type: args.type,
				invoiceSize: args.invoiceSize,
				dateFormat: args.dateFormat,
				paymentTermsDays: args.paymentTermsDays,
				template: args.template,
				issueDate: args.issueDate,
				dueDate: args.dueDate,
				paymentDetails: args.paymentDetails,
				notes: args.notes,
				lineItems: args.lineItems,
				compliance: normalizedCompliance,
				fiscalization:
					args.fiscalization ??
					normalizedCompliance.fiscalization ??
					current.fiscalization,
				reminder: args.reminder ?? defaultReminder(),
				sync: args.sync ?? defaultSync(),
				updatedAt: Date.now(),
			}),
		);

		return args;
	},
});

export const saveDraftSettings = mutation({
	args: {
		id: v.id("invoices"),
		invoiceSize: invoiceSizeValidator,
		dateFormat: dateFormatValidator,
		paymentTermsDays: v.number(),
		template: v.string(),
		currency: v.string(),
		type: typeValidator,
		dueDate: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const { invoice: current } = await requireWritableInvoice(ctx, args.id);

		await ctx.db.patch(
			args.id,
			patchWithDerivedStatus(current, {
				invoiceSize: args.invoiceSize,
				dateFormat: args.dateFormat,
				paymentTermsDays: args.paymentTermsDays,
				template: args.template,
				currency: args.currency,
				type: args.type,
				dueDate: args.dueDate,
				updatedAt: Date.now(),
			}),
		);
		return { ok: true };
	},
});

export const updateStatus = mutation({
	args: {
		id: v.id("invoices"),
		status: statusValidator,
		paidAt: v.optional(v.number()),
		paymentReference: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const { invoice: current } = await requireWritableInvoice(ctx, args.id);
		const now = args.paidAt ?? Date.now();

		if (args.status === "canceled") {
			await ctx.db.patch(args.id, {
				canceledAt: current.canceledAt ?? Date.now(),
				status: "canceled",
				updatedAt: Date.now(),
			});
			return { ok: true };
		}

		if (args.status === "paid") {
			const total = invoiceAmount(current);
			const existingPayment = legacyPaymentAmount(current, total);
			await ctx.db.patch(args.id, {
				paymentAmount: Math.max(existingPayment, total),
				paidAt: now,
				paymentReference: args.paymentReference ?? current.paymentReference,
				status: "paid",
				reminder: {
					...(current.reminder ?? defaultReminder()),
					paidAt: now,
					nextReminderAt: undefined,
				},
				lifecycle: {
					...(current.lifecycle ?? {}),
					paymentReceivedAt: current.lifecycle?.paymentReceivedAt ?? now,
				},
				updatedAt: Date.now(),
			});
			return { ok: true };
		}

		if (args.status === "unpaid" || args.status === "overdue") {
			const deliveredAt = deliveredAtForInvoice(current) ?? Date.now();
			await ctx.db.patch(
				args.id,
				patchWithDerivedStatus(current, {
					deliveredAt,
					lifecycle: {
						...(current.lifecycle ?? {}),
						sentAt: current.lifecycle?.sentAt ?? deliveredAt,
					},
					updatedAt: Date.now(),
				}),
			);
			return { ok: true };
		}

		if (args.status === "draft") {
			await ctx.db.patch(args.id, {
				deliveredAt: undefined,
				status: "draft",
				updatedAt: Date.now(),
			});
		}

		return { ok: true };
	},
});

async function invoiceHasRelatedRecords(
	ctx: MutationCtx,
	invoiceId: Id<"invoices">,
) {
	const payment = await ctx.db
		.query("payment_transactions")
		.withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoiceId))
		.first();
	if (payment) return true;

	const charge = await ctx.db
		.query("payment_charges")
		.withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoiceId))
		.first();
	if (charge) return true;

	const deliveryEvent = await ctx.db
		.query("invoice_delivery_events")
		.withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoiceId))
		.first();
	return Boolean(deliveryEvent);
}

function invoiceHasExternalHistory(invoice: Doc<"invoices">) {
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

function cleanupSummary(
	invoice: Doc<"invoices">,
	action: "hard-delete" | "archive",
) {
	return {
		id: invoice._id,
		invoiceNumber: invoice.invoiceNumber,
		customerName: invoice.customerName,
		status: getDerivedInvoiceStatus(invoice),
		action,
	};
}

async function cleanupPlanForInvoice(
	ctx: MutationCtx,
	invoice: Doc<"invoices">,
) {
	const hasRelatedRecords = await invoiceHasRelatedRecords(ctx, invoice._id);
	const hasExternalHistory =
		hasRelatedRecords || invoiceHasExternalHistory(invoice);

	if (getDerivedInvoiceStatus(invoice) === "draft" && !hasExternalHistory) {
		return cleanupSummary(invoice, "hard-delete");
	}

	return cleanupSummary(invoice, "archive");
}

async function cleanupPreviewForIds(
	ctx: MutationCtx,
	workspaceId: Id<"workspaces">,
	ids: Id<"invoices">[],
) {
	const uniqueIds = Array.from(new Set(ids)).slice(0, 100);
	const hardDelete = [];
	const archive = [];
	const blocked = [];

	for (const id of uniqueIds) {
		const invoice = await ctx.db.get(id);
		if (!invoice || invoice.workspaceId !== workspaceId || invoice.deletedAt) {
			blocked.push({
				id,
				invoiceNumber: "Unknown",
				reason: "Invoice was not found in this workspace.",
			});
			continue;
		}

		const plan = await cleanupPlanForInvoice(ctx, invoice);
		if (plan.action === "hard-delete") {
			hardDelete.push(plan);
		} else {
			archive.push(plan);
		}
	}

	return { hardDelete, archive, blocked };
}

export const remove = mutation({
	args: { id: v.id("invoices") },
	handler: async (ctx, args) => {
		const { scope, invoice } = await requireWritableInvoice(ctx, args.id);
		const plan = await cleanupPlanForInvoice(ctx, invoice);

		if (plan.action !== "hard-delete") {
			throw new Error("Only untouched draft invoices can be hard deleted.");
		}

		await ctx.db.delete(args.id);
		await recordAuditLog(ctx, {
			workspaceId: scope.workspaceId,
			actorId: scope.userId,
			action: "invoice.deleted",
			resourceType: "invoice",
			resourceId: String(args.id),
			metadata: {
				invoiceNumber: invoice.invoiceNumber,
				mode: "hard_delete",
				source: "single",
			},
		});
		return { ok: true };
	},
});

export const previewBulkCleanup = mutation({
	args: { ids: v.array(v.id("invoices")) },
	handler: async (ctx, args) => {
		const scope = await requireWritableWorkspace(ctx);
		return cleanupPreviewForIds(ctx, scope.workspaceId, args.ids);
	},
});

export const bulkDeleteOrArchive = mutation({
	args: { ids: v.array(v.id("invoices")) },
	handler: async (ctx, args) => {
		const scope = await requireWritableWorkspace(ctx);
		const preview = await cleanupPreviewForIds(
			ctx,
			scope.workspaceId,
			args.ids,
		);
		const now = Date.now();

		for (const item of preview.hardDelete) {
			await ctx.db.delete(item.id);
			await recordAuditLog(ctx, {
				workspaceId: scope.workspaceId,
				actorId: scope.userId,
				action: "invoice.deleted",
				resourceType: "invoice",
				resourceId: String(item.id),
				metadata: {
					invoiceNumber: item.invoiceNumber,
					mode: "hard_delete",
					source: "bulk_cleanup",
				},
			});
		}

		for (const item of preview.archive) {
			await ctx.db.patch(item.id, {
				deletedAt: now,
				canceledAt: now,
				status: "canceled",
				updatedAt: now,
			});
			await recordAuditLog(ctx, {
				workspaceId: scope.workspaceId,
				actorId: scope.userId,
				action: "invoice.deleted",
				resourceType: "invoice",
				resourceId: String(item.id),
				metadata: {
					invoiceNumber: item.invoiceNumber,
					mode: "archived",
					source: "bulk_cleanup",
				},
			});
		}

		return {
			hardDeleted: preview.hardDelete.length,
			archived: preview.archive.length,
			blocked: preview.blocked.length,
		};
	},
});

export const renumberInvoices = mutation({
	args: { ids: v.array(v.id("invoices")) },
	handler: async (ctx, args) => {
		const scope = await requireWritableWorkspace(ctx);
		const uniqueIds = Array.from(new Set(args.ids)).slice(0, 100);
		const renumbered = [];
		const skipped = [];

		for (const id of uniqueIds) {
			const invoice = await ctx.db.get(id);
			if (
				!invoice ||
				invoice.workspaceId !== scope.workspaceId ||
				invoice.deletedAt
			) {
				skipped.push({
					id,
					reason: "Invoice was not found in this workspace.",
				});
				continue;
			}

			const generated = await nextInvoiceNumberForWorkspace(
				ctx,
				scope.workspaceId,
				invoice.documentType ?? "standard",
			);
			const now = Date.now();
			await ctx.db.patch(id, {
				invoiceNumber: generated.invoiceNumber,
				updatedAt: now,
			});
			await ctx.db.patch(scope.workspaceId, {
				nextInvoiceSequence: generated.nextSequence,
				updatedAt: now,
			});
			await recordAuditLog(ctx, {
				workspaceId: scope.workspaceId,
				actorId: scope.userId,
				action: "invoice.renumbered",
				resourceType: "invoice",
				resourceId: String(id),
				metadata: {
					oldInvoiceNumber: invoice.invoiceNumber,
					newInvoiceNumber: generated.invoiceNumber,
				},
			});
			renumbered.push({
				id,
				oldInvoiceNumber: invoice.invoiceNumber,
				newInvoiceNumber: generated.invoiceNumber,
			});
		}

		return { renumbered, skipped };
	},
});

export const deleteEmptyDrafts = mutation({
	args: {},
	handler: async (ctx) => {
		const scope = await requireWritableWorkspace(ctx);
		const invoices = await ctx.db
			.query("invoices")
			.withIndex("by_workspaceId_and_status", (q) =>
				q.eq("workspaceId", scope.workspaceId).eq("status", "draft"),
			)
			.collect();
		const candidates = [];

		for (const invoice of invoices) {
			if (invoice.deletedAt || invoiceAmount(invoice) > 0) continue;
			const plan = await cleanupPlanForInvoice(ctx, invoice);
			if (plan.action === "hard-delete") candidates.push(invoice);
			if (candidates.length >= 200) break;
		}

		for (const invoice of candidates) {
			await ctx.db.delete(invoice._id);
			await recordAuditLog(ctx, {
				workspaceId: scope.workspaceId,
				actorId: scope.userId,
				action: "invoice.deleted",
				resourceType: "invoice",
				resourceId: String(invoice._id),
				metadata: {
					invoiceNumber: invoice.invoiceNumber,
					mode: "hard_delete",
					source: "delete_empty_drafts",
				},
			});
		}

		return { deleted: candidates.length };
	},
});

export const duplicate = mutation({
	args: { id: v.id("invoices") },
	handler: async (ctx, args) => {
		const { scope, invoice: source } = await requireWritableInvoice(
			ctx,
			args.id,
		);

		const generated = await nextInvoiceNumberForWorkspace(
			ctx,
			scope.workspaceId,
			source.documentType ?? "standard",
		);
		const now = Date.now();

		const invoiceDoc = {
			workspaceId: scope.workspaceId,
			userId: scope.userId,
			token: `pub-${crypto.randomUUID()}`,
			documentType: source.documentType ?? "standard",
			shipmentDetails: source.shipmentDetails,
			depositRequest: source.depositRequest,
			invoiceNumber: generated.invoiceNumber,
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
			notes: source.notes,
			lineItems: source.lineItems,
			compliance: source.compliance ?? defaultCompliance(source),
			fiscalization: source.fiscalization ??
				source.compliance?.fiscalization ?? { status: "not_configured" },
			reminder: defaultReminder(),
			sync: defaultSync(),
			lifecycle: {},
			createdAt: now,
			updatedAt: now,
		};

		const id = await ctx.db.insert("invoices", {
			...invoiceDoc,
			status: getDerivedInvoiceStatus(invoiceDoc),
		});

		await ctx.db.patch(scope.workspaceId, {
			nextInvoiceSequence: generated.nextSequence,
			updatedAt: now,
		});

		return { id };
	},
});

export const convertProformaToInvoice = mutation({
	args: { id: v.id("invoices") },
	handler: async (ctx, args) => {
		const { scope, invoice: source } = await requireWritableInvoice(
			ctx,
			args.id,
		);

		if ((source.documentType ?? "standard") !== "proforma") {
			throw new Error("Only pro-forma invoices can be converted.");
		}
		if (source.convertedToInvoiceId) {
			return { id: source.convertedToInvoiceId };
		}

		const generated = await nextInvoiceNumberForWorkspace(
			ctx,
			scope.workspaceId,
			"standard",
		);
		const now = Date.now();
		const total = invoiceAmount(source);
		const carriedPaymentAmount = Math.min(
			legacyPaymentAmount(source, total),
			total,
		);
		const invoiceDoc = {
			workspaceId: scope.workspaceId,
			userId: scope.userId,
			token: `pub-${crypto.randomUUID()}`,
			documentType: "standard" as const,
			invoiceNumber: generated.invoiceNumber,
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
			paidAt: carriedPaymentAmount >= total && total > 0 ? now : undefined,
			paymentReference: source.paymentReference,
			notes: source.notes,
			lineItems: source.lineItems,
			compliance: source.compliance ?? defaultCompliance(source),
			fiscalization: source.fiscalization ??
				source.compliance?.fiscalization ?? { status: "not_configured" },
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

		const id = await ctx.db.insert("invoices", {
			...invoiceDoc,
			status: getDerivedInvoiceStatus(invoiceDoc),
		});

		if (carriedPaymentAmount > 0) {
			await ctx.db.insert("payment_transactions", {
				workspaceId: scope.workspaceId,
				ownerId: scope.userId,
				invoiceId: id,
				source: "manual",
				reference: `deposit-from-${String(source._id)}`,
				amount: carriedPaymentAmount,
				currency: source.currency,
				recordedBy: scope.userId,
				createdAt: now,
				updatedAt: now,
			});
		}

		await ctx.db.patch(args.id, {
			convertedToInvoiceId: id,
			updatedAt: now,
		});
		await ctx.db.patch(scope.workspaceId, {
			nextInvoiceSequence: generated.nextSequence,
			updatedAt: now,
		});

		await recordAuditLog(ctx, {
			workspaceId: scope.workspaceId,
			actorId: scope.userId,
			action: "invoice.converted",
			resourceType: "invoice",
			resourceId: String(args.id),
			metadata: {
				sourceInvoiceNumber: source.invoiceNumber,
				convertedInvoiceId: String(id),
				convertedInvoiceNumber: generated.invoiceNumber,
				carriedPaymentAmount,
			},
		});

		return { id };
	},
});

export const importCsv = mutation({
	args: {
		rows: v.array(importInvoiceRowValidator),
	},
	handler: async (ctx, args) => {
		const scope = await requireWritableWorkspace(ctx);
		if (args.rows.length > MAX_INVOICE_IMPORT_ROWS) {
			throw new Error(
				`Import supports up to ${MAX_INVOICE_IMPORT_ROWS} invoice rows per CSV.`,
			);
		}

		const now = Date.now();
		const rows = args.rows;
		const created: string[] = [];
		let skipped = 0;
		const errors: Array<{ row: number; message: string }> = [];
		const addImportError = (row: number, message: string) => {
			if (errors.length < 100) {
				errors.push({ row, message });
			}
		};

		const workspace = await ctx.db.get(scope.workspaceId);
		const existing = await ctx.db
			.query("invoices")
			.withIndex("by_workspaceId", (q) =>
				q.eq("workspaceId", scope.workspaceId),
			)
			.collect();
		const usedNumbers = new Set(
			existing.map((invoice) => String(invoice.invoiceNumber)),
		);
		const prefixSource =
			workspace?.invoiceNumberMode === "business_name"
				? workspace?.name
				: workspace?.invoiceNumberPrefix;
		const prefix =
			String(prefixSource ?? "INV")
				.trim()
				.toUpperCase()
				.replace(/[^A-Z0-9]/g, "")
				.slice(0, 12) || "INV";
		const year = new Date().getFullYear();
		const pattern = new RegExp(`^${prefix}-(\\d{4})-(\\d{4,6})$`);
		const maxSequence = existing.reduce((max: number, invoice: any) => {
			const match = String(invoice.invoiceNumber).match(pattern);
			if (!match || Number(match[1]) !== year) return max;
			return Math.max(max, Number(match[2]));
		}, 0);
		let nextSequence = Math.max(
			Number(workspace?.nextInvoiceSequence ?? 1),
			maxSequence + 1,
		);
		let generatedInvoiceNumber = false;
		const groups = new Map<
			string,
			{
				invoiceNumber?: string;
				customerName: string;
				currency: string;
				status:
					| "draft"
					| "unpaid"
					| "partially-paid"
					| "paid"
					| "overdue"
					| "canceled";
				issueDate: string;
				dueDate: string;
				notes?: string;
				paymentDetails?: string;
				rowNumbers: number[];
				lineItems: Array<{
					id: string;
					name: string;
					quantity: number;
					price: number;
				}>;
			}
		>();
		const docs = [];

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

		for (const group of groups.values()) {
			let invoiceNumber = group.invoiceNumber;
			if (
				!invoiceNumber ||
				!/^[A-Z0-9]{2,12}-\d{4}-\d{4,6}$/.test(invoiceNumber) ||
				usedNumbers.has(invoiceNumber)
			) {
				invoiceNumber = invoiceNumberForSequence(prefix, year, nextSequence);
				nextSequence += 1;
				generatedInvoiceNumber = true;
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
						: compliance.regulatoryNotice,
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

			const invoiceDoc = {
				workspaceId: scope.workspaceId,
				userId: scope.userId,
				token: `pub-${crypto.randomUUID()}`,
				documentType: "standard" as const,
				invoiceNumber,
				customerName: group.customerName,
				currency: group.currency,
				type: "one-time" as const,
				invoiceSize: "A4" as const,
				dateFormat: "ng" as const,
				paymentTermsDays: 14,
				template: "Default",
				issueDate: group.issueDate,
				dueDate: group.dueDate,
				paymentAmount:
					group.status === "paid"
						? invoiceAmount({
								lineItems: group.lineItems,
								compliance: normalizedCompliance,
							})
						: 0,
				deliveredAt:
					group.status !== "draft" && group.status !== "canceled"
						? now
						: undefined,
				canceledAt: group.status === "canceled" ? now : undefined,
				paymentDetails: group.paymentDetails,
				paidAt: group.status === "paid" ? now : undefined,
				notes: group.notes,
				lineItems: group.lineItems,
				compliance: normalizedCompliance,
				fiscalization: { status: "not_configured" as const },
				reminder: defaultReminder(),
				sync: defaultSync(),
				lifecycle: {},
				createdAt: now,
				updatedAt: now,
			};

			docs.push({
				...invoiceDoc,
				status: getDerivedInvoiceStatus(invoiceDoc),
			});
		}

		for (
			let index = 0;
			index < docs.length;
			index += INVOICE_IMPORT_INSERT_CHUNK_SIZE
		) {
			const chunk = docs.slice(index, index + INVOICE_IMPORT_INSERT_CHUNK_SIZE);
			const ids = await Promise.all(
				chunk.map((doc) => ctx.db.insert("invoices", doc)),
			);
			created.push(...ids);
		}

		if (generatedInvoiceNumber) {
			await ctx.db.patch(scope.workspaceId, {
				nextInvoiceSequence: nextSequence,
				updatedAt: now,
			});
		}

		return { created: created.length, skipped, errors };
	},
});

export const summary = query({
	args: {},
	handler: async (ctx) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) {
			return { open: 0, paid: 0, overdue: 0 };
		}

		const invoices = await ctx.db
			.query("invoices")
			.withIndex("by_workspaceId", (q) =>
				q.eq("workspaceId", scope.workspaceId),
			)
			.collect();

		const totalForStatuses = (
			statuses: Array<
				"draft" | "unpaid" | "partially-paid" | "paid" | "overdue" | "canceled"
			>,
		) => {
			return invoices
				.filter((invoice) =>
					statuses.includes(getDerivedInvoiceStatus(invoice)),
				)
				.reduce((sum, invoice) => sum + invoiceAmount(invoice), 0);
		};

		return {
			open: totalForStatuses(["draft", "unpaid", "partially-paid"]),
			paid: totalForStatuses(["paid"]),
			overdue: totalForStatuses(["overdue"]),
		};
	},
});

export const recomputeInvoiceStatusesInternal = internalMutation({
	args: {},
	handler: async (ctx) => {
		const invoices = await ctx.db.query("invoices").collect();
		let updated = 0;
		const now = Date.now();

		for (const invoice of invoices) {
			const status = getDerivedInvoiceStatus(invoice);
			if (invoice.status === status) continue;

			await ctx.db.patch(invoice._id, {
				status,
				updatedAt: invoice.updatedAt ?? now,
			});
			updated += 1;
		}

		return { checked: invoices.length, updated };
	},
});

type InvoiceStatusRefreshResult = {
	checked: number;
	updated: number;
};

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : "Unknown error";
}

export const runInvoiceStatusRefreshInternal = internalAction({
	args: {},
	handler: async (ctx): Promise<InvoiceStatusRefreshResult> => {
		const startedAt = Date.now();
		try {
			const result: InvoiceStatusRefreshResult = await ctx.runMutation(
				internal.invoices.recomputeInvoiceStatusesInternal,
				{},
			);
			const completedAt = Date.now();
			await ctx.runMutation(internal.jobRuns.recordInternal, {
				jobName: "refresh invoice statuses",
				status: "success",
				durationMs: completedAt - startedAt,
				retries: 0,
				resultJson: JSON.stringify(result),
				startedAt,
				completedAt,
			});
			return result;
		} catch (error) {
			const completedAt = Date.now();
			await ctx.runMutation(internal.jobRuns.recordInternal, {
				jobName: "refresh invoice statuses",
				status: "failure",
				durationMs: completedAt - startedAt,
				retries: 0,
				error: errorMessage(error),
				startedAt,
				completedAt,
			});
			throw error;
		}
	},
});

export const products = query({
	args: {},
	handler: async (ctx) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) return [];

		const invoices = await ctx.db
			.query("invoices")
			.withIndex("by_workspaceId", (q) =>
				q.eq("workspaceId", scope.workspaceId),
			)
			.collect();
		const map = new Map<
			string,
			{ quantity: number; amount: number; currency: string; usedIn: number }
		>();

		for (const invoice of invoices) {
			for (const item of invoice.lineItems) {
				const name = item.name.trim() || "Untitled Item";
				const existing = map.get(name);

				if (existing) {
					existing.quantity += item.quantity;
					existing.amount += item.quantity * item.price;
					existing.usedIn += 1;
				} else {
					map.set(name, {
						quantity: item.quantity,
						amount: item.quantity * item.price,
						currency: invoice.currency,
						usedIn: 1,
					});
				}
			}
		}

		return [...map.entries()]
			.map(([name, value]) => ({ name, ...value }))
			.sort((a, b) => b.amount - a.amount);
	},
});

function documentLabel(documentType: "standard" | "proforma" = "standard") {
	return documentType === "proforma" ? "Pro-forma invoice" : "Invoice";
}

function buildInvoiceEmailSubject(
	invoiceNumber: string,
	documentType: "standard" | "proforma" = "standard",
) {
	return `${documentLabel(documentType)} ${invoiceNumber}`;
}

function escapeHtml(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

export const markInvoiceSent = mutation({
	args: {
		id: v.id("invoices"),
	},
	handler: async (ctx, args) => {
		const { scope, invoice } = await requireWritableInvoice(ctx, args.id);
		const currentStatus = getDerivedInvoiceStatus(invoice);

		if (currentStatus === "paid" || currentStatus === "canceled") {
			throw new Error("Cannot send a paid or canceled invoice.");
		}

		const now = Date.now();
		const currentLifecycle = invoice.lifecycle ?? {};

		await ctx.db.patch(
			args.id,
			patchWithDerivedStatus(invoice, {
				deliveredAt: invoice.deliveredAt ?? now,
				lifecycle: {
					...currentLifecycle,
					sentAt: currentLifecycle.sentAt ?? now,
				},
				updatedAt: now,
			}),
		);

		await recordAuditLog(ctx, {
			workspaceId: scope.workspaceId,
			actorId: scope.userId,
			action: "invoice.sent",
			resourceType: "invoice",
			resourceId: String(args.id),
			metadata: {
				invoiceNumber: invoice.invoiceNumber,
				previousStatus: currentStatus,
				nextStatus: getDerivedInvoiceStatus({
					...invoice,
					deliveredAt: invoice.deliveredAt ?? now,
					lifecycle: {
						...currentLifecycle,
						sentAt: currentLifecycle.sentAt ?? now,
					},
				}),
			},
		});

		return { ok: true };
	},
});

export const recordInvoiceViewed = mutation({
	args: {
		token: v.string(),
	},
	handler: async (ctx, args) => {
		const invoice = await ctx.db
			.query("invoices")
			.withIndex("by_token", (q) => q.eq("token", args.token))
			.first();

		if (!invoice || getDerivedInvoiceStatus(invoice) === "canceled") {
			return { ok: false };
		}

		const currentLifecycle = invoice.lifecycle ?? {};
		const now = Date.now();
		const alreadyTracked = Boolean(currentLifecycle.firstViewedAt);

		if (!alreadyTracked) {
			await ctx.db.patch(invoice._id, {
				lifecycle: {
					...currentLifecycle,
					firstViewedAt: now,
				},
				updatedAt: now,
			});
		}

		await recordAuditLog(ctx, {
			workspaceId: invoice.workspaceId,
			actorType: "system",
			action: "invoice.viewed",
			resourceType: "invoice",
			resourceId: String(invoice._id),
			metadata: {
				invoiceNumber: invoice.invoiceNumber,
				token: args.token,
				firstView: !alreadyTracked,
			},
		});

		return { ok: true, alreadyTracked };
	},
});

export const getInvoiceLifecycle = query({
	args: { id: v.id("invoices") },
	handler: async (ctx, args) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) return null;

		const invoice = await ctx.db.get(args.id);
		if (!invoice || invoice.workspaceId !== scope.workspaceId) return null;

		return invoice.lifecycle ?? null;
	},
});

export const recordDeliveryEvent = mutation({
	args: {
		invoiceId: v.id("invoices"),
		channel: v.literal("email"),
		recipient: v.string(),
		provider: v.literal("resend"),
		status: v.union(v.literal("sent"), v.literal("failed")),
		providerMessageId: v.optional(v.string()),
		error: v.optional(v.string()),
		publicUrl: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const { scope, invoice } = await requireWritableInvoice(
			ctx,
			args.invoiceId,
		);
		const now = Date.now();
		const deliveryEventId = await ctx.db.insert("invoice_delivery_events", {
			workspaceId: scope.workspaceId,
			ownerId: scope.userId,
			invoiceId: args.invoiceId,
			channel: args.channel,
			recipient: args.recipient,
			provider: args.provider,
			status: args.status,
			providerMessageId: args.providerMessageId,
			publicUrl: args.publicUrl,
			error: args.error,
			createdAt: now,
			updatedAt: now,
		});

		if (args.status === "sent") {
			const currentLifecycle = invoice.lifecycle ?? {};
			await ctx.db.patch(
				args.invoiceId,
				patchWithDerivedStatus(invoice, {
					deliveredAt: invoice.deliveredAt ?? now,
					lifecycle: {
						...currentLifecycle,
						sentAt: currentLifecycle.sentAt ?? now,
						emailDeliveredAt: currentLifecycle.emailDeliveredAt ?? now,
					},
					updatedAt: now,
				}),
			);

			await recordEmailEvent(ctx, {
				workspaceId: scope.workspaceId,
				ownerId: scope.userId,
				invoiceId: args.invoiceId,
				deliveryEventId,
				providerMessageId: args.providerMessageId,
				eventType: "sent",
				recipient: args.recipient,
			});

			await recordAuditLog(ctx, {
				workspaceId: scope.workspaceId,
				actorId: scope.userId,
				action: "invoice.sent",
				resourceType: "invoice",
				resourceId: String(args.invoiceId),
				metadata: {
					invoiceNumber: invoice.invoiceNumber,
					recipient: args.recipient,
					providerMessageId: args.providerMessageId,
				},
			});
		}

		return { ok: true, deliveryEventId };
	},
});

export const sendInvoiceEmailInternal = mutation({
	args: {
		invoiceId: v.id("invoices"),
	},
	handler: async (ctx, args) => {
		const { scope, invoice } = await requireWritableInvoice(
			ctx,
			args.invoiceId,
		);

		const recipient = invoice.compliance?.buyer?.email?.trim().toLowerCase();
		if (!recipient) {
			throw new Error("No recipient email found on this invoice.");
		}

		if (!env.RESEND_API_KEY) {
			throw new Error("RESEND_API_KEY is not configured.");
		}

		const publicLink = `${env.SITE_URL ?? ""}/i/${invoice.token}`;
		const safeInvoiceNumber = escapeHtml(invoice.invoiceNumber);
		const safeCustomerName = escapeHtml(invoice.customerName);
		const safePublicLink = escapeHtml(publicLink);

		const response = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.RESEND_API_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				from: env.RESEND_FROM ?? "Velure <onboarding@resend.dev>",
				to: [recipient],
				subject: buildInvoiceEmailSubject(
					invoice.invoiceNumber,
					invoice.documentType ?? "standard",
				),
				text: `${documentLabel(invoice.documentType ?? "standard")} ${invoice.invoiceNumber} for ${invoice.customerName}. View it here: ${publicLink}`,
				html: `<p>${documentLabel(invoice.documentType ?? "standard")} <strong>${safeInvoiceNumber}</strong> for ${safeCustomerName}.</p><p>View it here: <a href="${safePublicLink}">${safePublicLink}</a></p>`,
			}),
		});

		const payload = response.ok
			? ((await response.json().catch(() => null)) as {
					id?: string;
					data?: { id?: string };
				} | null)
			: null;
		const providerMessageId = payload?.id ?? payload?.data?.id;

		const now = Date.now();
		const currentLifecycle = invoice.lifecycle ?? {};

		if (response.ok) {
			await ctx.db.patch(
				invoice._id,
				patchWithDerivedStatus(invoice, {
					deliveredAt: invoice.deliveredAt ?? now,
					lifecycle: {
						...currentLifecycle,
						sentAt: currentLifecycle.sentAt ?? now,
						emailDeliveredAt: currentLifecycle.emailDeliveredAt ?? now,
					},
					updatedAt: now,
				}),
			);

			const deliveryEventId = await ctx.db.insert("invoice_delivery_events", {
				workspaceId: scope.workspaceId,
				ownerId: scope.userId,
				invoiceId: invoice._id,
				channel: "email",
				recipient,
				provider: "resend",
				status: "sent",
				providerMessageId,
				publicUrl: publicLink,
				createdAt: now,
				updatedAt: now,
			});

			await recordEmailEvent(ctx, {
				workspaceId: scope.workspaceId,
				ownerId: scope.userId,
				invoiceId: invoice._id,
				deliveryEventId,
				providerMessageId,
				eventType: "sent",
				recipient,
			});

			await recordAuditLog(ctx, {
				workspaceId: scope.workspaceId,
				actorId: scope.userId,
				action: "invoice.sent",
				resourceType: "invoice",
				resourceId: String(invoice._id),
				metadata: {
					invoiceNumber: invoice.invoiceNumber,
					recipient,
					providerMessageId,
				},
			});

			return { ok: true, providerMessageId };
		}

		const errorText = await response.text().catch(() => "Unknown error");
		throw new Error(`Failed to send email: ${errorText}`);
	},
});
