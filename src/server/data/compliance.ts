import { recordInvoiceAudit } from "./audit-client";
import { buildComplianceDashboardReport } from "./compliance-dashboard";
import { list as listInvoices } from "./invoices";
import type { Supabase } from "./workspaces";
import {
	getInvoiceWorkspaceSettings,
	resolveActiveWorkspaceId,
} from "./workspaces";

export async function getWorkspaceSettings(client: Supabase, userId: string) {
	return getInvoiceWorkspaceSettings(client, userId);
}

export async function upsertWorkspaceSettings(
	client: Supabase,
	userId: string,
	input: Record<string, unknown>,
) {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("Workspace not found.");
	const text = (value: unknown) =>
		typeof value === "string" ? value : undefined;
	const bool = (value: unknown) =>
		typeof value === "boolean" ? value : undefined;
	const number = (value: unknown) =>
		typeof value === "number" && Number.isFinite(value) ? value : undefined;
	const invoiceMode: "prefix" | "business_name" | undefined =
		input.invoiceNumberMode === "prefix" ||
		input.invoiceNumberMode === "business_name"
			? (input.invoiceNumberMode as "prefix" | "business_name")
			: undefined;
	const sellerTaxStatus =
		input.sellerTaxStatus === "vat_registered" ||
		input.sellerTaxStatus === "below_threshold_not_charging_vat" ||
		input.sellerTaxStatus === "statutorily_exempt"
			? (input.sellerTaxStatus as
					| "vat_registered"
					| "below_threshold_not_charging_vat"
					| "statutorily_exempt")
			: undefined;
	const allowed = {
		name: text(input.name),
		legal_name: text(input.legalName),
		email: text(input.email),
		phone: text(input.phone),
		address: text(input.address),
		website: text(input.website),
		tax_id: text(input.taxId),
		rc_number: text(input.rcNumber),
		country_code: text(input.countryCode),
		base_currency: text(input.baseCurrency),
		seller_tax_status: sellerTaxStatus,
		tax_rule_set_version: text(input.taxRuleSetVersion),
		reminders_enabled: bool(input.remindersEnabled),
		logo_url: text(input.logoUrl),
		payment_details: text(input.paymentDetails),
		default_payment_terms_days: number(input.defaultPaymentTermsDays),
		invoice_number_mode: invoiceMode,
		invoice_number_prefix: text(input.invoiceNumberPrefix),
		next_invoice_sequence: number(input.nextInvoiceSequence),
	};
	const { error } = await client
		.from("workspaces")
		.update(allowed)
		.eq("id", workspaceId);
	if (error) throw error;
	return workspaceId;
}

export async function listTaxProfiles(client: Supabase, userId: string) {
	const { data, error } = await client
		.from("tax_profiles")
		.select(
			"id, name, jurisdiction_code, tax_treatment, rate, label, is_default, active, notes, created_at, updated_at",
		)
		.eq("owner_id", userId)
		.order("is_default", { ascending: false })
		.order("name");
	if (error) throw error;
	return (data ?? []).map((row) => ({
		_id: row.id,
		name: row.name,
		jurisdictionCode: row.jurisdiction_code,
		taxTreatment: row.tax_treatment,
		rate: Number(row.rate),
		label: row.label,
		isDefault: row.is_default,
		active: row.active,
		notes: row.notes ?? undefined,
		createdAt: Date.parse(row.created_at),
		updatedAt: Date.parse(row.updated_at),
	}));
}

export type TaxProfileInput = {
	id?: string;
	name: string;
	jurisdictionCode: string;
	taxTreatment:
		| "none"
		| "exclusive_rate"
		| "inclusive_rate"
		| "reverse_charge"
		| "exempt"
		| "zero_rated";
	rate: number;
	label: string;
	isDefault: boolean;
	active: boolean;
	notes?: string;
};

export async function saveTaxProfile(
	client: Supabase,
	userId: string,
	input: TaxProfileInput,
) {
	if (
		!input.name.trim() ||
		!input.label.trim() ||
		!Number.isFinite(input.rate) ||
		input.rate < 0 ||
		input.rate > 100
	) {
		throw new Error("Invalid tax profile.");
	}
	if (input.isDefault) {
		const { error } = await client
			.from("tax_profiles")
			.update({ is_default: false })
			.eq("owner_id", userId)
			.neq("id", input.id ?? "");
		if (error) throw error;
	}
	const values = {
		name: input.name.trim(),
		jurisdiction_code: input.jurisdictionCode,
		tax_treatment: input.taxTreatment,
		rate: input.rate,
		label: input.label.trim(),
		is_default: input.isDefault,
		active: input.active,
		notes: input.notes?.trim() || null,
		owner_id: userId,
	};
	if (input.id) {
		const { data, error } = await client
			.from("tax_profiles")
			.update(values)
			.eq("id", input.id)
			.eq("owner_id", userId)
			.select("id")
			.single();
		if (error) throw error;
		return data.id;
	}
	const { data, error } = await client
		.from("tax_profiles")
		.insert(values)
		.select("id")
		.single();
	if (error) throw error;
	return data.id;
}

export async function listExportHistory(client: Supabase, userId: string) {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) return [];
	const { data, error } = await client
		.from("invoice_exports")
		.select(
			"id, kind, status, file_name, content, error, created_at, updated_at",
		)
		.eq("workspace_id", workspaceId)
		.order("created_at", { ascending: false })
		.limit(50);
	if (error) throw error;
	return (data ?? []).map((row) => ({
		_id: row.id,
		kind: row.kind,
		status: row.status,
		fileName: row.file_name,
		content: row.content,
		error: row.error ?? undefined,
		createdAt: Date.parse(row.created_at),
		updatedAt: Date.parse(row.updated_at),
	}));
}

export async function getComplianceDashboard(
	client: Supabase,
	userId: string,
	args: { from?: string; to?: string; currency?: string; limit?: number } = {},
) {
	const [workspace, invoices, exports] = await Promise.all([
		getWorkspaceSettings(client, userId),
		listInvoices(client, userId),
		listExportHistory(client, userId),
	]);
	if (!workspace) return null;
	const report = buildComplianceDashboardReport({
		invoices,
		baseCurrency: workspace.baseCurrency,
		currency: args.currency,
		window: { from: args.from, to: args.to },
		limit: Math.min(Math.max(args.limit ?? 8, 1), 20),
	});
	return {
		...report,
		exports: {
			readyCount: exports.filter((record) => record.status === "ready").length,
			lastGeneratedAt: exports[0]?.createdAt ?? null,
			recent: exports
				.slice(0, 5)
				.map((record) => ({ id: record._id, ...record })),
		},
	};
}

export async function createInvoiceExport(
	client: Supabase,
	userId: string,
	kind:
		| "invoices_csv"
		| "tax_summary_csv"
		| "customer_ledger_csv"
		| "normalized_accounting",
) {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("Workspace not found.");
	const [{ data: workspace }, { data: invoices, error: invoiceError }] =
		await Promise.all([
			client
				.from("workspaces")
				.select("id, name, legal_name")
				.eq("id", workspaceId)
				.single(),
			client
				.from("invoices")
				.select(
					"invoice_number, customer_name, currency, payment_amount, status, issue_date, due_date, compliance",
				)
				.eq("workspace_id", workspaceId),
		]);
	if (invoiceError) throw invoiceError;
	const source = workspace?.legal_name || workspace?.name || "VELURE";
	const prefix =
		(source.match(/[A-Za-z0-9]+/g) ?? [])
			.map((x) => x[0])
			.join("")
			.slice(0, 12)
			.toUpperCase() || "VELURE";
	const rows = invoices ?? [];
	const csv = [
		[
			"invoiceNumber",
			"customerName",
			"currency",
			"total",
			"status",
			"issueDate",
			"dueDate",
		].join(","),
		...rows.map((row) =>
			[
				row.invoice_number,
				row.customer_name,
				row.currency,
				row.payment_amount,
				row.status,
				row.issue_date,
				row.due_date,
			]
				.map((value) => JSON.stringify(value ?? ""))
				.join(","),
		),
	].join("\n");
	const now = Date.now();
	const fileName = `${prefix}-${kind}-${now}.${kind === "normalized_accounting" ? "json" : "csv"}`;
	const content =
		kind === "normalized_accounting"
			? JSON.stringify({ generatedAt: now, invoices: rows }, null, 2)
			: csv;
	const { data, error } = await client
		.from("invoice_exports")
		.insert({
			owner_id: userId,
			workspace_id: workspaceId,
			kind,
			status: "ready",
			file_name: fileName,
			content,
		})
		.select("id, file_name, content")
		.single();
	if (error) throw error;
	await recordInvoiceAudit(client, userId, {
		action: "invoice.export",
		resourceType: "invoice_export",
		resourceId: data.id,
		after: { kind, fileName, rowCount: rows.length },
		message: `Generated a ${kind} export.`,
	});
	return { id: data.id, fileName: data.file_name, content: data.content };
}

export async function retryInvoiceExport(
	client: Supabase,
	userId: string,
	id: string,
) {
	const { data, error } = await client
		.from("invoice_exports")
		.update({ status: "ready", error: null })
		.eq("id", id)
		.eq("owner_id", userId)
		.select("id")
		.single();
	if (error) throw error;
	return { ok: Boolean(data) };
}
