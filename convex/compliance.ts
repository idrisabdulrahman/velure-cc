import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { recordAuditLog } from "./audit";
import { requireAuthUser } from "./auth";
import { buildComplianceDashboardReport } from "./complianceDashboard";
import {
	assertValidRcNumber,
	assertValidTin,
	NIGERIA_AUTHORITY_LABEL,
	NIGERIA_TAX_RULE_SET_VERSION,
	NIGERIA_VAT_RATE,
	normalizeNigeriaPhone,
	normalizeRuleSetVersionForWrite,
} from "./nigeria";
import { requireWorkspaceForRead, requireWritableWorkspace } from "./rls";

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

const exportKindValidator = v.union(
	v.literal("invoices_csv"),
	v.literal("tax_summary_csv"),
	v.literal("customer_ledger_csv"),
	v.literal("normalized_accounting"),
);

const providerValidator = v.union(
	v.literal("quickbooks"),
	v.literal("xero"),
	v.literal("slack"),
);

const invoiceNumberModeValidator = v.union(
	v.literal("prefix"),
	v.literal("business_name"),
);

const DEFAULT_JURISDICTIONS = [
	{
		code: "NG",
		name: "Nigeria",
		defaultTaxLabel: "VAT",
		supportsReverseCharge: true,
		supportsVat: true,
		notes: "Nigeria-first default setup.",
	},
	{
		code: "GH",
		name: "Ghana",
		defaultTaxLabel: "VAT",
		supportsReverseCharge: false,
		supportsVat: true,
		notes: "Regional expansion target.",
	},
	{
		code: "KE",
		name: "Kenya",
		defaultTaxLabel: "VAT",
		supportsReverseCharge: true,
		supportsVat: true,
		notes: "Regional expansion target.",
	},
	{
		code: "ZA",
		name: "South Africa",
		defaultTaxLabel: "VAT",
		supportsReverseCharge: true,
		supportsVat: true,
		notes: "Regional expansion target.",
	},
	{
		code: "US",
		name: "United States",
		defaultTaxLabel: "Sales Tax",
		supportsReverseCharge: false,
		supportsVat: false,
		notes: "Accounting export support only in v1.",
	},
	{
		code: "GB",
		name: "United Kingdom",
		defaultTaxLabel: "VAT",
		supportsReverseCharge: true,
		supportsVat: true,
		notes: "VAT-ready template skeleton.",
	},
	{
		code: "EU",
		name: "European Union",
		defaultTaxLabel: "VAT",
		supportsReverseCharge: true,
		supportsVat: true,
		notes: "VAT-ready template skeleton.",
	},
	{
		code: "OTHER",
		name: "Other",
		defaultTaxLabel: "Tax",
		supportsReverseCharge: false,
		supportsVat: false,
		notes: "Review with an accountant before issuing invoices.",
	},
] as const;

function csvEscape(value: string | number | boolean | null | undefined) {
	const safe = String(value ?? "");
	if (safe.includes(",") || safe.includes('"') || safe.includes("\n")) {
		return `"${safe.replace(/"/g, '""')}"`;
	}
	return safe;
}

function businessInitialsForFileName(workspace: {
	legalName?: string;
	name?: string;
}) {
	const source = (workspace.legalName || workspace.name || "").trim();
	const tokens = source.match(/[A-Za-z0-9]+/g) ?? [];
	const initials =
		tokens.length > 1
			? tokens.map((token) => token[0]).join("")
			: (tokens[0] ?? "").slice(0, 3);
	const normalized = initials.toUpperCase().replace(/[^A-Z0-9]/g, "");

	return normalized.slice(0, 12) || "VELURE";
}

function assertValidInvoiceDefaults(args: {
	invoiceNumberMode?: "prefix" | "business_name";
	invoiceNumberPrefix?: string;
	nextInvoiceSequence?: number;
	defaultPaymentTermsDays?: number;
}) {
	if (
		(args.invoiceNumberMode ?? "prefix") === "prefix" &&
		args.invoiceNumberPrefix &&
		!/^[A-Z0-9-]{2,12}$/.test(args.invoiceNumberPrefix.trim())
	) {
		throw new Error(
			"Invoice prefix must be 2-12 uppercase letters, numbers, or hyphens.",
		);
	}
	if (
		args.nextInvoiceSequence !== undefined &&
		(!Number.isInteger(args.nextInvoiceSequence) ||
			args.nextInvoiceSequence < 1)
	) {
		throw new Error("Next invoice sequence must be 1 or higher.");
	}
	if (
		args.defaultPaymentTermsDays !== undefined &&
		(!Number.isInteger(args.defaultPaymentTermsDays) ||
			args.defaultPaymentTermsDays < 0 ||
			args.defaultPaymentTermsDays > 365)
	) {
		throw new Error("Default payment terms must be between 0 and 365 days.");
	}
}

async function requireViewer(ctx: any) {
	return await requireAuthUser(ctx);
}

function defaultWorkspace(ownerId: string) {
	const now = Date.now();
	return {
		ownerId,
		name: "Velure Workspace",
		legalName: "Velure Workspace",
		email: "",
		phone: "",
		address: "",
		website: "",
		taxId: "",
		rcNumber: "",
		countryCode: "NG" as const,
		baseCurrency: "NGN",
		sellerTaxStatus: "vat_registered" as const,
		taxRuleSetVersion: NIGERIA_TAX_RULE_SET_VERSION,
		atrs: {
			environment: "sandbox" as const,
			credentialsConfigured: false,
		},
		reminderSignature: "Velure Finance Team",
		remindersEnabled: true,
		logoUrl: "",
		paymentDetails: "",
		defaultPaymentLink: "",
		defaultPaymentTermsDays: 14,
		invoiceNumberMode: "prefix" as const,
		invoiceNumberPrefix: "INV",
		nextInvoiceSequence: 1,
		createdAt: now,
		updatedAt: now,
	};
}

export const getWorkspaceSettings = query({
	args: {},
	handler: async (ctx) => {
		const viewer = await requireViewer(ctx);
		const scope = await requireWorkspaceForRead(ctx);
		const workspace = scope ? await ctx.db.get(scope.workspaceId) : null;

		return workspace ?? defaultWorkspace(viewer._id);
	},
});

export const upsertWorkspaceSettings = mutation({
	args: {
		name: v.string(),
		legalName: v.optional(v.string()),
		email: v.optional(v.string()),
		phone: v.optional(v.string()),
		address: v.optional(v.string()),
		website: v.optional(v.string()),
		taxId: v.optional(v.string()),
		rcNumber: v.optional(v.string()),
		countryCode: jurisdictionValidator,
		baseCurrency: v.string(),
		sellerTaxStatus: sellerTaxStatusValidator,
		taxRuleSetVersion: v.string(),
		atrs: v.optional(
			v.object({
				environment: v.optional(
					v.union(v.literal("sandbox"), v.literal("production")),
				),
				credentialsConfigured: v.boolean(),
			}),
		),
		reminderSignature: v.optional(v.string()),
		remindersEnabled: v.boolean(),
		logoUrl: v.optional(v.string()),
		paymentDetails: v.optional(v.string()),
		defaultPaymentLink: v.optional(v.string()),
		defaultPaymentTermsDays: v.optional(v.number()),
		invoiceNumberMode: v.optional(invoiceNumberModeValidator),
		invoiceNumberPrefix: v.optional(v.string()),
		nextInvoiceSequence: v.optional(v.number()),
		defaultTaxProfileId: v.optional(v.id("tax_profiles")),
	},
	handler: async (ctx, args) => {
		const viewer = await requireViewer(ctx);
		const scope = await requireWritableWorkspace(ctx);
		assertValidTin(args.taxId);
		assertValidRcNumber(args.rcNumber);
		assertValidInvoiceDefaults(args);
		// Staleness guard at the write boundary: only known rule sets (including
		// legacy ids normalized to the canonical id) may be stored. Unknown
		// versions are rejected instead of silently persisting stale rules.
		const taxRuleSetVersion = normalizeRuleSetVersionForWrite(
			args.taxRuleSetVersion,
		);
		const existing = await ctx.db.get(scope.workspaceId);
		const now = Date.now();
		const {
			defaultPaymentLink: _defaultPaymentLink,
			taxRuleSetVersion: _taxRuleSetVersion,
			...workspaceArgs
		} = args;

		if (existing) {
			await ctx.db.patch(existing._id, {
				...workspaceArgs,
				taxRuleSetVersion,
				phone: normalizeNigeriaPhone(args.phone),
				updatedAt: now,
			});
			await recordAuditLog(ctx, {
				workspaceId: existing._id,
				actorId: viewer._id,
				action: "workspace.changed",
				resourceType: "workspace",
				resourceId: String(existing._id),
			});
			return existing._id;
		}

		const workspaceId = await ctx.db.insert("workspaces", {
			ownerId: viewer._id,
			...workspaceArgs,
			taxRuleSetVersion,
			phone: normalizeNigeriaPhone(args.phone),
			createdAt: now,
			updatedAt: now,
		});
		await recordAuditLog(ctx, {
			workspaceId,
			actorId: viewer._id,
			action: "workspace.changed",
			resourceType: "workspace",
			resourceId: String(workspaceId),
		});
		return workspaceId;
	},
});

export const listJurisdictions = query({
	args: {},
	handler: async (ctx) => {
		const rows = await ctx.db.query("jurisdictions").collect();
		if (rows.length > 0) return rows;

		return DEFAULT_JURISDICTIONS.map((entry) => ({
			...entry,
			updatedAt: Date.now(),
		}));
	},
});

export const listTaxProfiles = query({
	args: {},
	handler: async (ctx) => {
		const viewer = await requireViewer(ctx);
		return await ctx.db
			.query("tax_profiles")
			.withIndex("by_ownerId", (q) => q.eq("ownerId", viewer._id))
			.collect();
	},
});

export const saveTaxProfile = mutation({
	args: {
		id: v.optional(v.id("tax_profiles")),
		name: v.string(),
		jurisdictionCode: jurisdictionValidator,
		taxTreatment: taxTreatmentValidator,
		rate: v.number(),
		label: v.string(),
		isDefault: v.boolean(),
		active: v.boolean(),
		notes: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const viewer = await requireViewer(ctx);
		const now = Date.now();

		if (args.isDefault) {
			const profiles = await ctx.db
				.query("tax_profiles")
				.withIndex("by_ownerId", (q) => q.eq("ownerId", viewer._id))
				.collect();

			for (const profile of profiles) {
				if (profile.isDefault && profile._id !== args.id) {
					await ctx.db.patch(profile._id, { isDefault: false, updatedAt: now });
				}
			}
		}

		if (args.id) {
			const existing = await ctx.db.get(args.id);
			if (!existing || existing.ownerId !== viewer._id) {
				throw new Error("Tax profile not found.");
			}
			await ctx.db.patch(args.id, {
				name: args.name,
				jurisdictionCode: args.jurisdictionCode,
				taxTreatment: args.taxTreatment,
				rate: args.rate,
				label: args.label,
				isDefault: args.isDefault,
				active: args.active,
				notes: args.notes,
				updatedAt: now,
			});
			return args.id;
		}

		return await ctx.db.insert("tax_profiles", {
			ownerId: viewer._id,
			name: args.name,
			jurisdictionCode: args.jurisdictionCode,
			taxTreatment: args.taxTreatment,
			rate: args.rate,
			label: args.label,
			isDefault: args.isDefault,
			active: args.active,
			notes: args.notes,
			createdAt: now,
			updatedAt: now,
		});
	},
});

function buildInvoiceExportRows(invoices: any[]) {
	const netPayableForInvoice = (invoice: any) =>
		invoice.compliance?.netPayable ??
		(invoice.compliance?.grandTotal ?? 0) -
			(invoice.compliance?.withholdingTaxAmount ?? 0);

	return [
		[
			"invoiceNumber",
			"customerName",
			"currency",
			"subtotal",
			"vat",
			"wht",
			"sellerTaxStatus",
			"whtCategory",
			"whtRecipientEntityType",
			"whtRecipientResidency",
			"whtManualOverride",
			"netPayable",
			"grandTotal",
			"status",
			"issueDate",
			"dueDate",
		].join(","),
		...invoices.map((invoice) =>
			[
				csvEscape(invoice.invoiceNumber),
				csvEscape(invoice.customerName),
				csvEscape(invoice.currency),
				csvEscape(invoice.compliance?.subtotal ?? 0),
				csvEscape(invoice.compliance?.totalTax ?? 0),
				csvEscape(invoice.compliance?.withholdingTaxAmount ?? 0),
				csvEscape(invoice.compliance?.sellerTaxStatus ?? ""),
				csvEscape(invoice.compliance?.withholding?.category ?? ""),
				csvEscape(invoice.compliance?.withholding?.recipientEntityType ?? ""),
				csvEscape(invoice.compliance?.withholding?.recipientResidency ?? ""),
				csvEscape(invoice.compliance?.withholding?.manualOverride ?? false),
				csvEscape(netPayableForInvoice(invoice)),
				csvEscape(invoice.compliance?.grandTotal ?? 0),
				csvEscape(invoice.status),
				csvEscape(invoice.issueDate),
				csvEscape(invoice.dueDate),
			].join(","),
		),
	].join("\n");
}

function buildTaxSummaryRows(invoices: any[]) {
	return [
		[
			"invoiceNumber",
			"authority",
			"jurisdiction",
			"sellerTaxStatus",
			"taxLabel",
			"taxTreatment",
			"taxRate",
			"taxAmount",
			"whtCategory",
			"whtRecipientEntityType",
			"whtRecipientResidency",
			"whtRate",
			"whtAmount",
			"whtManualOverride",
			"warnings",
		].join(","),
		...invoices.map((invoice) =>
			[
				csvEscape(invoice.invoiceNumber),
				csvEscape(NIGERIA_AUTHORITY_LABEL),
				csvEscape(invoice.compliance?.placeOfSupply ?? "NG"),
				csvEscape(invoice.compliance?.sellerTaxStatus ?? ""),
				csvEscape(invoice.compliance?.taxLabel ?? "VAT"),
				csvEscape(invoice.compliance?.taxTreatment ?? "none"),
				csvEscape(invoice.compliance?.taxRate ?? 0),
				csvEscape(invoice.compliance?.totalTax ?? 0),
				csvEscape(invoice.compliance?.withholding?.category ?? ""),
				csvEscape(invoice.compliance?.withholding?.recipientEntityType ?? ""),
				csvEscape(invoice.compliance?.withholding?.recipientResidency ?? ""),
				csvEscape(invoice.compliance?.withholdingTaxRate ?? 0),
				csvEscape(invoice.compliance?.withholdingTaxAmount ?? 0),
				csvEscape(invoice.compliance?.withholding?.manualOverride ?? false),
				csvEscape((invoice.compliance?.warnings ?? []).join("|")),
			].join(","),
		),
	].join("\n");
}

function buildCustomerLedgerRows(invoices: any[]) {
	const netPayableForInvoice = (invoice: any) =>
		invoice.compliance?.netPayable ??
		(invoice.compliance?.grandTotal ?? 0) -
			(invoice.compliance?.withholdingTaxAmount ?? 0);

	return [
		[
			"customerName",
			"invoiceNumber",
			"issueDate",
			"dueDate",
			"grossAmount",
			"netPayable",
			"status",
		].join(","),
		...invoices.map((invoice) =>
			[
				csvEscape(invoice.customerName),
				csvEscape(invoice.invoiceNumber),
				csvEscape(invoice.issueDate),
				csvEscape(invoice.dueDate),
				csvEscape(invoice.compliance?.grandTotal ?? 0),
				csvEscape(netPayableForInvoice(invoice)),
				csvEscape(invoice.status),
			].join(","),
		),
	].join("\n");
}

export const listExportHistory = query({
	args: {},
	handler: async (ctx) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) return [];

		return await ctx.db
			.query("invoice_exports")
			.withIndex("by_workspaceId", (q) =>
				q.eq("workspaceId", scope.workspaceId),
			)
			.order("desc")
			.collect();
	},
});

export const getComplianceDashboard = query({
	args: {
		from: v.optional(v.string()),
		to: v.optional(v.string()),
		currency: v.optional(v.string()),
		limit: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) return null;

		const workspace = await ctx.db.get(scope.workspaceId);
		const invoices = await ctx.db
			.query("invoices")
			.withIndex("by_workspaceId", (q) =>
				q.eq("workspaceId", scope.workspaceId),
			)
			.collect();
		const exportsHistory = await ctx.db
			.query("invoice_exports")
			.withIndex("by_workspaceId", (q) =>
				q.eq("workspaceId", scope.workspaceId),
			)
			.order("desc")
			.collect();
		const report = buildComplianceDashboardReport({
			invoices,
			baseCurrency: workspace?.baseCurrency ?? "NGN",
			currency: args.currency,
			window: {
				from: args.from,
				to: args.to,
			},
			limit: Math.min(Math.max(args.limit ?? 8, 1), 20),
		});

		return {
			...report,
			exports: {
				readyCount: exportsHistory.filter((record) => record.status === "ready")
					.length,
				lastGeneratedAt: exportsHistory[0]?.createdAt ?? null,
				recent: exportsHistory.slice(0, 5).map((record) => ({
					id: record._id,
					kind: record.kind,
					status: record.status,
					fileName: record.fileName,
					createdAt: record.createdAt,
				})),
			},
		};
	},
});

export const createExport = mutation({
	args: {
		kind: exportKindValidator,
		provider: v.optional(providerValidator),
	},
	handler: async (ctx, args) => {
		const viewer = await requireViewer(ctx);
		const scope = await requireWritableWorkspace(ctx);
		const invoices = await ctx.db
			.query("invoices")
			.withIndex("by_workspaceId", (q) =>
				q.eq("workspaceId", scope.workspaceId),
			)
			.collect();
		const workspace = await ctx.db.get(scope.workspaceId);
		const filePrefix = businessInitialsForFileName({
			legalName: workspace?.legalName,
			name: workspace?.name,
		});
		const now = Date.now();

		let fileName = "";
		let content = "";

		if (args.kind === "invoices_csv") {
			fileName = `${filePrefix}-invoices-${now}.csv`;
			content = buildInvoiceExportRows(invoices);
		} else if (args.kind === "tax_summary_csv") {
			fileName = `${filePrefix}-tax-summary-${now}.csv`;
			content = buildTaxSummaryRows(invoices);
		} else if (args.kind === "customer_ledger_csv") {
			fileName = `${filePrefix}-customer-ledger-${now}.csv`;
			content = buildCustomerLedgerRows(invoices);
		} else {
			fileName = `${filePrefix}-accounting-${now}.json`;
			content = JSON.stringify(
				{
					provider: args.provider ?? null,
					generatedAt: now,
					invoices: invoices.map((invoice) => ({
						invoiceNumber: invoice.invoiceNumber,
						customerName: invoice.customerName,
						issueDate: invoice.issueDate,
						dueDate: invoice.dueDate,
						currency: invoice.currency,
						subtotal: invoice.compliance?.subtotal ?? 0,
						tax: invoice.compliance?.totalTax ?? 0,
						withholdingTax: invoice.compliance?.withholdingTaxAmount ?? 0,
						netPayable:
							(invoice.compliance as { netPayable?: number } | undefined)
								?.netPayable ??
							(invoice.compliance?.grandTotal ?? 0) -
								(invoice.compliance?.withholdingTaxAmount ?? 0),
						total: invoice.compliance?.grandTotal ?? 0,
						sellerTaxStatus: invoice.compliance?.sellerTaxStatus ?? null,
						taxRuleSetVersion:
							invoice.compliance?.taxRuleSetVersion ??
							NIGERIA_TAX_RULE_SET_VERSION,
						taxTreatment: invoice.compliance?.taxTreatment ?? "none",
						taxLabel: invoice.compliance?.taxLabel ?? "VAT",
						vatRate: invoice.compliance?.taxRate ?? NIGERIA_VAT_RATE,
						whtCategory: invoice.compliance?.withholding?.category ?? null,
						whtRecipientEntityType:
							invoice.compliance?.withholding?.recipientEntityType ?? null,
						whtRecipientResidency:
							invoice.compliance?.withholding?.recipientResidency ?? null,
						whtManualOverride:
							invoice.compliance?.withholding?.manualOverride ?? false,
					})),
				},
				null,
				2,
			);
		}

		const id = await ctx.db.insert("invoice_exports", {
			ownerId: viewer._id,
			workspaceId: scope.workspaceId,
			kind: args.kind,
			provider: args.provider,
			status: "ready",
			fileName,
			content,
			createdAt: now,
			updatedAt: now,
		});
		await recordAuditLog(ctx, {
			workspaceId: scope.workspaceId,
			actorId: viewer._id,
			action: "export.created",
			resourceType: "invoice_export",
			resourceId: String(id),
			metadata: { kind: args.kind, fileName },
		});

		return { id, fileName, content };
	},
});

export const retryExport = mutation({
	args: { id: v.id("invoice_exports") },
	handler: async (ctx, args) => {
		const viewer = await requireViewer(ctx);
		const scope = await requireWritableWorkspace(ctx);
		const record = await ctx.db.get(args.id);
		if (
			!record ||
			record.ownerId !== viewer._id ||
			record.workspaceId !== scope.workspaceId
		) {
			throw new Error("Export not found.");
		}

		await ctx.db.patch(args.id, {
			status: "ready",
			updatedAt: Date.now(),
			error: undefined,
		});
		await recordAuditLog(ctx, {
			workspaceId: scope.workspaceId,
			actorId: viewer._id,
			action: "export.retried",
			resourceType: "invoice_export",
			resourceId: String(args.id),
			metadata: { kind: record.kind, fileName: record.fileName },
		});

		return { ok: true };
	},
});
