import {
	composeSupplierAddress,
	validateSupplierProfile,
} from "#/features/compliance/supplier-profile";
import { buildComplianceDashboardReport } from "./compliance-dashboard";
import type { ComplianceExportKind } from "./compliance-export";
import { buildInvoiceExportContent } from "./compliance-export";
import { list as listInvoices } from "./invoices";
import type { Supabase } from "./workspaces";
import {
	getInvoiceWorkspaceSettings,
	resolveActiveWorkspaceId,
} from "./workspaces";

export async function getWorkspaceSettings(client: Supabase, userId: string) {
	return getInvoiceWorkspaceSettings(client, userId);
}

type SupplierProfileRowSnapshot = {
	tax_id: string | null;
	rc_number: string | null;
	address: string | null;
	address_street: string | null;
	address_lga: string | null;
	address_state: string | null;
	country_code: string;
};

export type SupplierProfileColumns = {
	tax_id: string | null;
	rc_number: string | null;
	address: string;
	address_street: string;
	address_lga: string | null;
	address_state: string;
	country_code: string;
	supplier_profile_status: "complete" | "needs_review";
	supplier_profile_issues: string[];
};

/**
 * Prefix of the error thrown when a supplier profile fails validation. The
 * settings page matches it to surface the per-field messages (e.g. the
 * 300/200/200 address caps) instead of a generic save-failure toast.
 */
export const SUPPLIER_PROFILE_REJECTION_PREFIX =
	"Supplier profile is incomplete or invalid:";

/**
 * B1 server boundary for the supplier profile. A provided (non-undefined)
 * value replaces the stored one; omitted values fall back to what is already
 * stored so unrelated settings edits never wipe registration details. Throws
 * on malformed or placeholder TIN/CAC RC values, on an over-long structured
 * address (the DB CHECK caps) and on an incomplete profile (SPEC §5.B row B1:
 * validated TIN, required CAC RC, structured address).
 *
 * Pure so the write path can be unit-tested without a Supabase client; the
 * returned columns include the non-destructive flag columns, never deletes.
 */
export function buildSupplierProfileUpdate(
	current: SupplierProfileRowSnapshot,
	input: {
		taxId?: string;
		rcNumber?: string;
		addressStreet?: string;
		addressLga?: string;
		addressState?: string;
		countryCode?: string;
	},
): SupplierProfileColumns {
	const provided = (value: string | undefined, fallback: string | null) =>
		value === undefined ? (fallback ?? "") : value.trim();

	const result = validateSupplierProfile({
		tin: provided(input.taxId, current.tax_id),
		rcNumber: provided(input.rcNumber, current.rc_number),
		address: {
			street: provided(input.addressStreet, current.address_street),
			lga: provided(input.addressLga, current.address_lga),
			state: provided(input.addressState, current.address_state),
			countryCode: provided(input.countryCode, current.country_code),
		},
	});
	if (!result.valid) {
		throw new Error(
			`${SUPPLIER_PROFILE_REJECTION_PREFIX} ${result.issues
				.map((issue) => issue.message)
				.join(" ")}`,
		);
	}

	return {
		tax_id: result.normalized.tin || null,
		rc_number: result.normalized.rcNumber || null,
		address: composeSupplierAddress(result.normalized.address),
		address_street: result.normalized.address.street,
		address_lga: result.normalized.address.lga || null,
		address_state: result.normalized.address.state,
		country_code: result.normalized.address.countryCode,
		supplier_profile_status: result.status,
		supplier_profile_issues: result.issues.map((issue) => issue.code),
	};
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
	const { data: currentProfile, error: currentProfileError } = await client
		.from("workspaces")
		.select(
			"tax_id, rc_number, address, address_street, address_lga, address_state, country_code",
		)
		.eq("id", workspaceId)
		.maybeSingle();
	if (currentProfileError) throw currentProfileError;
	if (!currentProfile) throw new Error("Workspace not found.");
	const profile = buildSupplierProfileUpdate(currentProfile, {
		taxId: text(input.taxId),
		rcNumber: text(input.rcNumber),
		addressStreet: text(input.addressStreet),
		addressLga: text(input.addressLga),
		addressState: text(input.addressState),
		countryCode: text(input.countryCode),
	});
	const allowed = {
		name: text(input.name),
		legal_name: text(input.legalName),
		email: text(input.email),
		phone: text(input.phone),
		website: text(input.website),
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
		...profile,
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
	kind: ComplianceExportKind,
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
	const now = Date.now();
	const content = buildInvoiceExportContent(kind, rows, now);
	const fileName = `${prefix}-${kind}-${now}.${kind === "normalized_accounting" ? "json" : "csv"}`;
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
