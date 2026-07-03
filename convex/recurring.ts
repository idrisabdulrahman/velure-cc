import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
	action,
	internalAction,
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";
import { recordAuditLog } from "./audit";
import {
	defaultTaxTreatmentForSellerTaxStatus,
	defaultWithholdingSelection,
	formatInvoiceNumber,
	NIGERIA_FOREIGN_CURRENCY_WARNING,
	NIGERIA_TAX_RULE_SET_VERSION,
	NIGERIA_VAT_RATE,
} from "./nigeria";
import { requireWorkspaceForRead, requireWritableWorkspace } from "./rls";

const frequencyValidator = v.union(
	v.literal("monthly"),
	v.literal("quarterly"),
);
const scheduleStatusValidator = v.union(
	v.literal("active"),
	v.literal("paused"),
	v.literal("ended"),
);
const invoiceSizeValidator = v.union(v.literal("A4"), v.literal("LETTER"));
const dateFormatValidator = v.union(
	v.literal("iso"),
	v.literal("us"),
	v.literal("ng"),
);
const paymentProviderValidator = v.union(
	v.literal("manual"),
	v.literal("paystack"),
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

const lineItemValidator = v.object({
	id: v.string(),
	name: v.string(),
	quantity: v.number(),
	price: v.number(),
	productId: v.optional(v.id("products")),
});

type Frequency = "monthly" | "quarterly";
type ScheduleInput = {
	name: string;
	frequency: Frequency;
	interval: number;
	startDate: string;
	endDate?: string;
	autoSend: boolean;
	customerName: string;
	logoUrl?: string;
	currency: string;
	invoiceSize?: "A4" | "LETTER";
	dateFormat?: "iso" | "us" | "ng";
	paymentTermsDays: number;
	template?: string;
	paymentDetails?: string;
	paymentLink?: string;
	paymentProvider?: "manual" | "paystack";
	notes?: string;
	lineItems: Array<{
		id: string;
		name: string;
		quantity: number;
		price: number;
		productId?: Id<"products">;
	}>;
	compliance?: Doc<"recurring_invoice_schedules">["compliance"];
};

type RecurringGenerationResult = {
	date: string;
	scannedCount: number;
	createdCount: number;
	skippedCount: number;
	failedCount: number;
};

function startOfUtcDate(value: string) {
	const date = new Date(`${value}T00:00:00.000Z`);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime())) {
		throw new Error("Date must use YYYY-MM-DD.");
	}
	return date;
}

function formatUtcDate(date: Date) {
	return date.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number) {
	return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function addMonths(dateString: string, months: number) {
	const date = startOfUtcDate(dateString);
	const day = date.getUTCDate();
	const targetMonth = date.getUTCMonth() + months;
	const target = new Date(Date.UTC(date.getUTCFullYear(), targetMonth, 1));
	const clampedDay = Math.min(
		day,
		daysInMonth(target.getUTCFullYear(), target.getUTCMonth()),
	);
	target.setUTCDate(clampedDay);
	return formatUtcDate(target);
}

function addDays(dateString: string, days: number) {
	const date = startOfUtcDate(dateString);
	date.setUTCDate(date.getUTCDate() + days);
	return formatUtcDate(date);
}

export function nextRunDateAfter(
	dateString: string,
	frequency: Frequency,
	interval: number,
) {
	return addMonths(
		dateString,
		frequency === "quarterly" ? interval * 3 : interval,
	);
}

export function periodKeyFor(dateString: string, frequency: Frequency) {
	const date = startOfUtcDate(dateString);
	const year = date.getUTCFullYear();
	const month = date.getUTCMonth() + 1;
	if (frequency === "quarterly") {
		return `${year}-Q${Math.ceil(month / 3)}`;
	}
	return `${year}-${String(month).padStart(2, "0")}`;
}

function defaultReminder() {
	return {
		enabled: true,
		paused: false,
		stage: "none" as const,
		escalationStatus: "idle" as const,
	};
}

function defaultSync() {
	return {
		quickbooks: { status: "idle" as const },
		xero: { status: "idle" as const },
		slack: { status: "idle" as const },
	};
}

function defaultCompliance(args: {
	customerName: string;
	lineItems: Array<{ quantity: number; price: number }>;
}) {
	const subtotal = args.lineItems.reduce(
		(sum, item) => sum + item.quantity * item.price,
		0,
	);
	const taxTreatment = defaultTaxTreatmentForSellerTaxStatus("vat_registered");
	const totalTax =
		taxTreatment === "exclusive_rate"
			? Math.round(((subtotal * NIGERIA_VAT_RATE) / 100) * 100) / 100
			: 0;
	const withholding = defaultWithholdingSelection();

	return {
		seller: { legalName: "Velure", countryCode: "NG" as const },
		buyer: {
			legalName: args.customerName || undefined,
			countryCode: "NG" as const,
		},
		sellerTaxStatus: "vat_registered" as const,
		placeOfSupply: "NG" as const,
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
							amount: totalTax,
							treatment: "exclusive_rate" as const,
							jurisdictionCode: "NG" as const,
						},
					]
				: [],
		warnings: [],
		templateVariant: "vat_ready" as const,
		subtotal,
		totalTax,
		withholding: { ...withholding, amount: 0 },
		withholdingTaxPreset: "none" as const,
		withholdingTaxLabel: "WHT",
		withholdingTaxRate: withholding.rate,
		withholdingTaxAmount: 0,
		grandTotal: subtotal + totalTax,
		fiscalization: { status: "not_configured" as const },
	};
}

function cleanString(value: string, label: string, maxLength: number) {
	const clean = value.trim().replace(/\s+/g, " ");
	if (!clean) throw new Error(`${label} is required.`);
	return clean.slice(0, maxLength);
}

export function normalizeScheduleInput(args: ScheduleInput) {
	const startDate = formatUtcDate(startOfUtcDate(args.startDate));
	const endDate = args.endDate
		? formatUtcDate(startOfUtcDate(args.endDate))
		: undefined;
	if (endDate && endDate < startDate) {
		throw new Error("End date cannot be before start date.");
	}
	if (
		!Number.isInteger(args.interval) ||
		args.interval < 1 ||
		args.interval > 12
	) {
		throw new Error("Billing interval must be between 1 and 12.");
	}
	if (
		!Number.isInteger(args.paymentTermsDays) ||
		args.paymentTermsDays < 0 ||
		args.paymentTermsDays > 365
	) {
		throw new Error("Payment terms must be between 0 and 365 days.");
	}
	if (args.lineItems.length === 0) {
		throw new Error("At least one invoice line item is required.");
	}
	if (args.lineItems.length > 50) {
		throw new Error("Invoices support a maximum of 50 line items.");
	}

	const lineItems = args.lineItems.map((item) => {
		const name = cleanString(item.name, "Line item name", 120);
		if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
			throw new Error("Line item quantity must be greater than 0.");
		}
		if (!Number.isFinite(item.price) || item.price < 0) {
			throw new Error("Line item price cannot be negative.");
		}
		return {
			id: item.id.trim() || crypto.randomUUID(),
			name,
			quantity: item.quantity,
			price: item.price,
			productId: item.productId,
		};
	});

	const currency = cleanString(args.currency, "Currency", 8).toUpperCase();
	const compliance =
		args.compliance ??
		(defaultCompliance({
			customerName: args.customerName,
			lineItems,
		}) as Doc<"recurring_invoice_schedules">["compliance"]);

	if (
		currency !== "NGN" &&
		(compliance as { regulatoryNotice?: string }).regulatoryNotice !==
			NIGERIA_FOREIGN_CURRENCY_WARNING
	) {
		throw new Error(
			"Foreign currency recurring invoices must include the CBN settlement warning.",
		);
	}

	return {
		name: cleanString(args.name, "Schedule name", 120),
		frequency: args.frequency,
		interval: args.interval,
		startDate,
		endDate,
		autoSend: args.autoSend,
		customerName: cleanString(args.customerName, "Customer name", 160),
		logoUrl: args.logoUrl?.trim() || undefined,
		currency,
		invoiceSize: args.invoiceSize ?? "A4",
		dateFormat: args.dateFormat ?? "ng",
		paymentTermsDays: args.paymentTermsDays,
		template: args.template?.trim() || "Default",
		paymentDetails: args.paymentDetails?.trim() || undefined,
		notes: args.notes?.trim() || undefined,
		lineItems,
		compliance,
	};
}

function nextInvoiceNumberForWorkspace(
	workspace: Doc<"workspaces"> | null,
	invoices: Array<Doc<"invoices">>,
	issueDate: string,
) {
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
	const year = startOfUtcDate(issueDate).getUTCFullYear();
	const pattern = new RegExp(`^${prefix}-(\\d{4})-(\\d{4,6})$`);
	const maxSequence = invoices.reduce(
		(max: number, invoice: Doc<"invoices">) => {
			const match = String(invoice.invoiceNumber).match(pattern);
			if (!match || Number(match[1]) !== year) return max;
			return Math.max(max, Number(match[2]));
		},
		0,
	);
	const sequence = Math.max(
		Number(workspace?.nextInvoiceSequence ?? 1),
		maxSequence + 1,
	);

	return {
		invoiceNumber:
			prefix === "INV"
				? formatInvoiceNumber(year, sequence)
				: `${prefix}-${year}-${String(sequence).padStart(4, "0")}`,
		nextSequence: sequence + 1,
	};
}

export const listSchedules = query({
	args: {
		status: v.optional(v.union(v.literal("all"), scheduleStatusValidator)),
	},
	handler: async (ctx, args) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) return [];

		const rows = await ctx.db
			.query("recurring_invoice_schedules")
			.withIndex("by_workspaceId", (q) =>
				q.eq("workspaceId", scope.workspaceId),
			)
			.collect();

		return rows
			.filter(
				(row) =>
					!args.status || args.status === "all" || row.status === args.status,
			)
			.sort((a, b) => a.nextRunDate.localeCompare(b.nextRunDate));
	},
});

export const createSchedule = mutation({
	args: {
		name: v.string(),
		frequency: frequencyValidator,
		interval: v.number(),
		startDate: v.string(),
		endDate: v.optional(v.string()),
		autoSend: v.boolean(),
		customerName: v.string(),
		logoUrl: v.optional(v.string()),
		currency: v.string(),
		invoiceSize: v.optional(invoiceSizeValidator),
		dateFormat: v.optional(dateFormatValidator),
		paymentTermsDays: v.number(),
		template: v.optional(v.string()),
		paymentDetails: v.optional(v.string()),
		paymentLink: v.optional(v.string()),
		paymentProvider: v.optional(paymentProviderValidator),
		notes: v.optional(v.string()),
		lineItems: v.array(lineItemValidator),
		compliance: v.optional(complianceValidator),
	},
	handler: async (ctx, args) => {
		const scope = await requireWritableWorkspace(ctx);
		const input = normalizeScheduleInput(args);
		const now = Date.now();
		const id = await ctx.db.insert("recurring_invoice_schedules", {
			workspaceId: scope.workspaceId,
			ownerId: scope.userId,
			...input,
			status: "active",
			nextRunDate: input.startDate,
			generatedCount: 0,
			createdAt: now,
			updatedAt: now,
		});

		await recordAuditLog(ctx, {
			workspaceId: scope.workspaceId,
			actorId: scope.userId,
			action: "workspace.changed",
			resourceType: "recurring_invoice_schedule",
			resourceId: String(id),
			metadata: { name: input.name, frequency: input.frequency },
		});

		return id;
	},
});

export const updateSchedule = mutation({
	args: {
		scheduleId: v.id("recurring_invoice_schedules"),
		name: v.string(),
		frequency: frequencyValidator,
		interval: v.number(),
		startDate: v.string(),
		endDate: v.optional(v.string()),
		autoSend: v.boolean(),
		customerName: v.string(),
		logoUrl: v.optional(v.string()),
		currency: v.string(),
		invoiceSize: v.optional(invoiceSizeValidator),
		dateFormat: v.optional(dateFormatValidator),
		paymentTermsDays: v.number(),
		template: v.optional(v.string()),
		paymentDetails: v.optional(v.string()),
		paymentLink: v.optional(v.string()),
		paymentProvider: v.optional(paymentProviderValidator),
		notes: v.optional(v.string()),
		lineItems: v.array(lineItemValidator),
		compliance: v.optional(complianceValidator),
	},
	handler: async (ctx, args) => {
		const scope = await requireWritableWorkspace(ctx);
		const schedule = await ctx.db.get(args.scheduleId);
		if (!schedule || schedule.workspaceId !== scope.workspaceId) {
			throw new Error("Recurring schedule not found.");
		}

		const input = normalizeScheduleInput(args);
		const nextRunDate =
			schedule.generatedCount > 0 ? schedule.nextRunDate : input.startDate;
		const status =
			input.endDate && nextRunDate > input.endDate ? "ended" : schedule.status;
		const now = Date.now();

		await ctx.db.patch(args.scheduleId, {
			...input,
			nextRunDate,
			status,
			updatedAt: now,
		});

		await recordAuditLog(ctx, {
			workspaceId: scope.workspaceId,
			actorId: scope.userId,
			action: "workspace.changed",
			resourceType: "recurring_invoice_schedule",
			resourceId: String(args.scheduleId),
			metadata: {
				name: input.name,
				frequency: input.frequency,
				updated: true,
			},
		});

		return { ok: true };
	},
});

export const deleteSchedule = mutation({
	args: {
		scheduleId: v.id("recurring_invoice_schedules"),
	},
	handler: async (ctx, args) => {
		const scope = await requireWritableWorkspace(ctx);
		const schedule = await ctx.db.get(args.scheduleId);
		if (!schedule || schedule.workspaceId !== scope.workspaceId) {
			throw new Error("Recurring schedule not found.");
		}

		const runs = await ctx.db
			.query("recurring_invoice_runs")
			.withIndex("by_scheduleId", (q) => q.eq("scheduleId", args.scheduleId))
			.collect();
		const hasGeneratedInvoice =
			schedule.generatedCount > 0 || runs.some((run) => Boolean(run.invoiceId));
		const now = Date.now();

		if (hasGeneratedInvoice) {
			await ctx.db.patch(args.scheduleId, {
				status: "ended",
				updatedAt: now,
			});
		} else {
			for (const run of runs) {
				await ctx.db.delete(run._id);
			}
			await ctx.db.delete(args.scheduleId);
		}

		await recordAuditLog(ctx, {
			workspaceId: scope.workspaceId,
			actorId: scope.userId,
			action: "workspace.changed",
			resourceType: "recurring_invoice_schedule",
			resourceId: String(args.scheduleId),
			metadata: {
				deleted: !hasGeneratedInvoice,
				ended: hasGeneratedInvoice,
			},
		});

		return {
			ok: true,
			deleted: !hasGeneratedInvoice,
			ended: hasGeneratedInvoice,
		};
	},
});

export const setScheduleStatus = mutation({
	args: {
		scheduleId: v.id("recurring_invoice_schedules"),
		status: scheduleStatusValidator,
	},
	handler: async (ctx, args) => {
		const scope = await requireWritableWorkspace(ctx);
		const schedule = await ctx.db.get(args.scheduleId);
		if (!schedule || schedule.workspaceId !== scope.workspaceId) {
			throw new Error("Recurring schedule not found.");
		}

		await ctx.db.patch(args.scheduleId, {
			status: args.status,
			updatedAt: Date.now(),
		});

		await recordAuditLog(ctx, {
			workspaceId: scope.workspaceId,
			actorId: scope.userId,
			action: "workspace.changed",
			resourceType: "recurring_invoice_schedule",
			resourceId: String(args.scheduleId),
			metadata: { status: args.status },
		});

		return { ok: true };
	},
});

export const getRecurringScopeForViewer = internalQuery({
	args: {},
	handler: async (ctx) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) {
			throw new Error("Workspace not found.");
		}
		return scope;
	},
});

export const listDueSchedulesInternal = internalQuery({
	args: {
		date: v.string(),
		workspaceId: v.optional(v.id("workspaces")),
	},
	handler: async (ctx, args) => {
		const date = formatUtcDate(startOfUtcDate(args.date));
		const rows = await ctx.db
			.query("recurring_invoice_schedules")
			.withIndex("by_nextRunDate_and_status", (q) => q.lte("nextRunDate", date))
			.collect();

		return rows.filter((row) => {
			if (row.status !== "active") return false;
			if (args.workspaceId && row.workspaceId !== args.workspaceId)
				return false;
			if (row.endDate && row.nextRunDate > row.endDate) return false;
			return true;
		});
	},
});

export const generateInvoiceForScheduleInternal = internalMutation({
	args: {
		scheduleId: v.id("recurring_invoice_schedules"),
		runDate: v.string(),
	},
	handler: async (ctx, args) => {
		const runDate = formatUtcDate(startOfUtcDate(args.runDate));
		const schedule = await ctx.db.get(args.scheduleId);
		if (!schedule) throw new Error("Recurring schedule not found.");

		const now = Date.now();
		const periodKey = periodKeyFor(schedule.nextRunDate, schedule.frequency);
		const existingRuns = await ctx.db
			.query("recurring_invoice_runs")
			.withIndex("by_scheduleId_and_periodKey", (q) =>
				q.eq("scheduleId", args.scheduleId).eq("periodKey", periodKey),
			)
			.collect();

		if (existingRuns.some((run) => run.status === "created")) {
			return { status: "skipped" as const, reason: "duplicate", periodKey };
		}
		if (schedule.status !== "active" || schedule.nextRunDate > runDate) {
			return { status: "skipped" as const, reason: "not_due", periodKey };
		}
		if (schedule.endDate && schedule.nextRunDate > schedule.endDate) {
			await ctx.db.patch(args.scheduleId, { status: "ended", updatedAt: now });
			return { status: "skipped" as const, reason: "ended", periodKey };
		}

		try {
			const workspace = await ctx.db.get(schedule.workspaceId);
			const existingInvoices = await ctx.db
				.query("invoices")
				.withIndex("by_workspaceId", (q) =>
					q.eq("workspaceId", schedule.workspaceId),
				)
				.collect();
			const generated = nextInvoiceNumberForWorkspace(
				workspace,
				existingInvoices,
				schedule.nextRunDate,
			);
			const dueDate = addDays(schedule.nextRunDate, schedule.paymentTermsDays);
			const token = `pub-${crypto.randomUUID()}`;
			const invoiceId = await ctx.db.insert("invoices", {
				workspaceId: schedule.workspaceId,
				userId: schedule.ownerId,
				token,
				invoiceNumber: generated.invoiceNumber,
				customerName: schedule.customerName,
				logoUrl: schedule.logoUrl,
				currency: schedule.currency,
				type: "recurring",
				invoiceSize: schedule.invoiceSize ?? "A4",
				dateFormat: schedule.dateFormat ?? "ng",
				paymentTermsDays: schedule.paymentTermsDays,
				template: schedule.template,
				issueDate: schedule.nextRunDate,
				dueDate,
				status: "draft",
				paymentAmount: 0,
				paymentDetails: schedule.paymentDetails,
				notes: schedule.notes,
				lineItems: schedule.lineItems,
				compliance: schedule.compliance,
				fiscalization: schedule.compliance?.fiscalization ?? {
					status: "not_configured",
				},
				reminder: defaultReminder(),
				sync: defaultSync(),
				lifecycle: {},
				createdAt: now,
				updatedAt: now,
			});
			const nextRunDate = nextRunDateAfter(
				schedule.nextRunDate,
				schedule.frequency,
				schedule.interval,
			);
			const shouldEnd = schedule.endDate
				? nextRunDate > schedule.endDate
				: false;

			await ctx.db.patch(schedule.workspaceId, {
				nextInvoiceSequence: generated.nextSequence,
				updatedAt: now,
			});
			await ctx.db.insert("recurring_invoice_runs", {
				workspaceId: schedule.workspaceId,
				scheduleId: args.scheduleId,
				periodKey,
				invoiceId,
				status: "created",
				createdAt: now,
				updatedAt: now,
			});
			await ctx.db.patch(args.scheduleId, {
				status: shouldEnd ? "ended" : schedule.status,
				nextRunDate,
				lastGeneratedAt: now,
				lastGeneratedInvoiceId: invoiceId,
				lastGeneratedPeriod: periodKey,
				generatedCount: schedule.generatedCount + 1,
				updatedAt: now,
			});
			await recordAuditLog(ctx, {
				workspaceId: schedule.workspaceId,
				actorId: schedule.ownerId,
				actorType: "system",
				action: "invoice.created",
				resourceType: "invoice",
				resourceId: String(invoiceId),
				metadata: {
					source: "recurring_billing",
					scheduleId: String(args.scheduleId),
					periodKey,
					invoiceNumber: generated.invoiceNumber,
					autoSendRequested: schedule.autoSend,
				},
			});

			return {
				status: "created" as const,
				invoiceId,
				periodKey,
				nextRunDate,
			};
		} catch (error) {
			await ctx.db.insert("recurring_invoice_runs", {
				workspaceId: schedule.workspaceId,
				scheduleId: args.scheduleId,
				periodKey,
				status: "failed",
				error: error instanceof Error ? error.message : "Unknown error",
				createdAt: now,
				updatedAt: now,
			});
			return {
				status: "failed" as const,
				periodKey,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	},
});

export const runRecurringGenerationInternal = internalAction({
	args: {
		date: v.optional(v.string()),
		workspaceId: v.optional(v.id("workspaces")),
	},
	handler: async (ctx, args): Promise<RecurringGenerationResult> => {
		const startedAt = Date.now();
		const runDate = args.date ?? new Date().toISOString().slice(0, 10);
		try {
			const schedules: Array<Doc<"recurring_invoice_schedules">> =
				await ctx.runQuery(internal.recurring.listDueSchedulesInternal, {
					date: runDate,
					workspaceId: args.workspaceId,
				});
			let createdCount = 0;
			let skippedCount = 0;
			let failedCount = 0;

			for (const schedule of schedules) {
				try {
					const result = await ctx.runMutation(
						internal.recurring.generateInvoiceForScheduleInternal,
						{ scheduleId: schedule._id, runDate },
					);
					if (result.status === "created") createdCount += 1;
					if (result.status === "skipped") skippedCount += 1;
					if (result.status === "failed") failedCount += 1;
				} catch {
					failedCount += 1;
				}
			}

			const completedAt = Date.now();
			const result: RecurringGenerationResult = {
				date: runDate,
				scannedCount: schedules.length,
				createdCount,
				skippedCount,
				failedCount,
			};
			await ctx.runMutation(internal.jobRuns.recordInternal, {
				workspaceId: args.workspaceId,
				jobName: "generate recurring invoices",
				status: failedCount > 0 ? "failure" : "success",
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
				workspaceId: args.workspaceId,
				jobName: "generate recurring invoices",
				status: "failure",
				durationMs: completedAt - startedAt,
				retries: 0,
				error: error instanceof Error ? error.message : "Unknown error",
				startedAt,
				completedAt,
			});
			throw error;
		}
	},
});

export const runRecurringGeneration = action({
	args: { date: v.optional(v.string()) },
	handler: async (ctx, args): Promise<RecurringGenerationResult> => {
		const scope: { workspaceId: Id<"workspaces"> } = await ctx.runQuery(
			internal.recurring.getRecurringScopeForViewer,
			{},
		);
		return await ctx.runAction(
			internal.recurring.runRecurringGenerationInternal,
			{
				date: args.date,
				workspaceId: scope.workspaceId,
			},
		);
	},
});
