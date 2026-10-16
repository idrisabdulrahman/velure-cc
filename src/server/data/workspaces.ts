import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "#/types/database.types";

/**
 * A10 — workspaces domain, ported to Supabase.
 *
 * RLS-pure: every function takes a USER-scoped Supabase client (the one holding
 * the OIDC-minted JWT) and never sends a workspace_id for authorization. RLS
 * decides. A missing membership returns zero rows, not an error.
 *
 * Port of: convex/account.ts (listWorkspaces, getWorkspaceContext,
 * setActiveWorkspace) + convex/workspaces.ts (resolveWorkspaceForUser,
 * ensureWorkspaceForUser). Return shapes match the Convex surface so call
 * sites compile unchanged until each domain is cut over.
 */

export type Supabase = SupabaseClient<Database>;

export type WorkspaceRole = "owner" | "member" | "viewer";

const DEFAULT_WORKSPACE_NAME = "Velure Workspace";
export const NIGERIA_TAX_RULE_SET_VERSION = "ng-2026-q1";

export function normalizeWorkspaceName(value?: string) {
	const normalized = value?.trim().replace(/\s+/g, " ");
	if (!normalized) return DEFAULT_WORKSPACE_NAME;
	return normalized.slice(0, 120);
}

export type WorkspaceListItem = {
	id: string;
	name: string;
	legalName: string | null;
	email: string | null;
	role: WorkspaceRole;
	isActive: boolean;
	updatedAt: string;
};

export type WorkspaceContext = {
	userId: string;
	workspaceId: string;
	role: WorkspaceRole;
	name: string;
	legalName: string | null;
	email: string | null;
	invoiceNumberMode: "prefix" | "business_name";
	invoiceNumberPrefix: string | null;
	nextInvoiceSequence: number;
};

export type InvoiceWorkspaceSettings = WorkspaceContext & {
	phone: string | null;
	address: string | null;
	addressStreet: string | null;
	addressLga: string | null;
	addressState: string | null;
	website: string | null;
	baseCurrency: string;
	countryCode: string;
	defaultPaymentTermsDays: number;
	defaultPaymentLink: string | null;
	logoUrl: string | null;
	paymentDetails: string | null;
	taxId: string | null;
	rcNumber: string | null;
	sellerTaxStatus: string | null;
	taxRuleSetVersion: string | null;
	invoiceTemplateDefaults: Record<string, unknown> | null;
	reminderSignature: string | null;
	remindersEnabled: boolean;
	supplierProfileStatus: string;
	supplierProfileIssues: string[];
};

export async function getInvoiceWorkspaceSettings(
	client: Supabase,
	userId: string,
): Promise<InvoiceWorkspaceSettings | null> {
	const context = await getWorkspaceContext(client, userId);
	if (!context) return null;
	const { data, error } = await client
		.from("workspaces")
		.select(
			"phone, address, address_street, address_lga, address_state, website, base_currency, country_code, default_payment_terms_days, default_payment_link, logo_url, payment_details, tax_id, rc_number, seller_tax_status, tax_rule_set_version, invoice_template_defaults, reminder_signature, reminders_enabled, supplier_profile_status, supplier_profile_issues",
		)
		.eq("id", context.workspaceId)
		.maybeSingle();
	if (error) throw error;
	if (!data) return null;
	return {
		...context,
		phone: data.phone,
		address: data.address,
		addressStreet: data.address_street,
		addressLga: data.address_lga,
		addressState: data.address_state,
		website: data.website,
		baseCurrency: data.base_currency,
		countryCode: data.country_code,
		defaultPaymentTermsDays: data.default_payment_terms_days ?? 14,
		defaultPaymentLink: data.default_payment_link,
		logoUrl: data.logo_url,
		paymentDetails: data.payment_details,
		taxId: data.tax_id,
		rcNumber: data.rc_number,
		sellerTaxStatus: data.seller_tax_status,
		taxRuleSetVersion: data.tax_rule_set_version,
		invoiceTemplateDefaults: data.invoice_template_defaults as Record<
			string,
			unknown
		> | null,
		reminderSignature: data.reminder_signature,
		remindersEnabled: data.reminders_enabled,
		supplierProfileStatus: data.supplier_profile_status,
		supplierProfileIssues: Array.isArray(data.supplier_profile_issues)
			? (data.supplier_profile_issues as string[])
			: [],
	};
}

/**
 * Resolve the user's active workspace id (RLS-scoped read of
 * active_workspaces). Shared by the other A10 domain modules to scope their
 * queries to the active workspace, matching the Convex session scope.
 */
export async function resolveActiveWorkspaceId(
	client: Supabase,
	userId: string,
): Promise<string | null> {
	const { data, error } = await client
		.from("active_workspaces")
		.select("workspace_id")
		.eq("user_id", userId)
		.maybeSingle();
	if (error) throw error;
	return data?.workspace_id ?? null;
}

async function getMembership(
	client: Supabase,
	userId: string,
	workspaceId: string,
): Promise<{ role: WorkspaceRole } | null> {
	const { data, error } = await client
		.from("workspace_members")
		.select("role")
		.eq("user_id", userId)
		.eq("workspace_id", workspaceId)
		.maybeSingle();
	if (error) throw error;
	return data ? { role: data.role as WorkspaceRole } : null;
}

async function getWorkspace(
	client: Supabase,
	workspaceId: string,
): Promise<{
	id: string;
	name: string;
	legal_name: string | null;
	email: string | null;
	invoice_number_mode: "prefix" | "business_name" | null;
	invoice_number_prefix: string | null;
	next_invoice_sequence: number | null;
} | null> {
	const { data, error } = await client
		.from("workspaces")
		.select(
			"id, name, legal_name, email, invoice_number_mode, invoice_number_prefix, next_invoice_sequence",
		)
		.eq("id", workspaceId)
		.maybeSingle();
	if (error) throw error;
	return data;
}

async function setActiveWorkspaceId(
	client: Supabase,
	userId: string,
	workspaceId: string,
) {
	const existing = await resolveActiveWorkspaceId(client, userId);
	if (existing) {
		const { error } = await client
			.from("active_workspaces")
			.update({ workspace_id: workspaceId })
			.eq("user_id", userId);
		if (error) throw error;
		return;
	}
	const { error } = await client
		.from("active_workspaces")
		.insert({ user_id: userId, workspace_id: workspaceId });
	if (error) throw error;
}

/** Port of convex/account.ts `listWorkspaces`. */
export async function listWorkspaces(
	client: Supabase,
	userId: string,
): Promise<WorkspaceListItem[]> {
	const { data: memberships, error } = await client
		.from("workspace_members")
		.select(
			"role, workspace_id, workspaces(id, name, legal_name, email, updated_at)",
		)
		.eq("user_id", userId);
	if (error) throw error;

	const activeId = await resolveActiveWorkspaceId(client, userId);

	const rows: WorkspaceListItem[] = (memberships ?? []).flatMap((m) => {
		if (!m.workspaces) return [];
		return [
			{
				id: m.workspaces.id,
				name: m.workspaces.name,
				legalName: m.workspaces.legal_name,
				email: m.workspaces.email,
				role: m.role as WorkspaceRole,
				isActive: m.workspace_id === activeId,
				updatedAt: m.workspaces.updated_at,
			},
		];
	});

	return rows.sort((a, b) => Number(b.isActive) - Number(a.isActive));
}

/** Port of convex/account.ts `getWorkspaceContext`. */ export async function getWorkspaceContext(
	client: Supabase,
	userId: string,
): Promise<WorkspaceContext | null> {
	const activeWorkspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!activeWorkspaceId) return null;

	const [membership, workspace] = await Promise.all([
		getMembership(client, userId, activeWorkspaceId),
		getWorkspace(client, activeWorkspaceId),
	]);

	if (!membership || !workspace) return null;

	return {
		userId,
		workspaceId: workspace.id,
		role: membership.role,
		name: workspace.name,
		legalName: workspace.legal_name,
		email: workspace.email,
		invoiceNumberMode: workspace.invoice_number_mode ?? "prefix",
		invoiceNumberPrefix: workspace.invoice_number_prefix ?? "INV",
		nextInvoiceSequence: workspace.next_invoice_sequence ?? 1,
	};
}

/** Port of convex/account.ts `setActiveWorkspace`. RLS with-check blocks non-members. */
export async function setActiveWorkspace(
	client: Supabase,
	userId: string,
	workspaceId: string,
): Promise<void> {
	await setActiveWorkspaceId(client, userId, workspaceId);
}

type EnsureWorkspaceOptions = {
	businessName?: string;
	createIfMissing?: boolean;
};

/**
 * Port of convex/workspaces.ts `ensureWorkspaceForUser`. Resolution order:
 * active -> single membership -> owned workspace (ensure membership) -> create.
 * The create path is RLS-pure: workspaces_insert with-check admits
 * `owner_id = current_user`, workspace_members_self_insert admits the owner,
 * and active_workspaces with-check admits a member.
 */ export async function ensureWorkspaceForUser(
	client: Supabase,
	userId: string,
	options: EnsureWorkspaceOptions = {},
): Promise<WorkspaceContext | null> {
	const activeWorkspaceId = await resolveActiveWorkspaceId(client, userId);
	if (activeWorkspaceId) {
		const [membership, workspace] = await Promise.all([
			getMembership(client, userId, activeWorkspaceId),
			getWorkspace(client, activeWorkspaceId),
		]);
		if (membership && workspace) {
			return {
				userId,
				workspaceId: workspace.id,
				role: membership.role,
				name: workspace.name,
				legalName: workspace.legal_name,
				email: workspace.email,
				invoiceNumberMode: workspace.invoice_number_mode ?? "prefix",
				invoiceNumberPrefix: workspace.invoice_number_prefix ?? "INV",
				nextInvoiceSequence: workspace.next_invoice_sequence ?? 1,
			};
		}
	}

	// Single membership: promote it to active.
	const { data: memberships, error: membershipsError } = await client
		.from("workspace_members")
		.select("workspace_id, role")
		.eq("user_id", userId);
	if (membershipsError) throw membershipsError;
	const only = memberships?.length === 1 ? memberships[0] : null;
	if (only) {
		const workspace = await getWorkspace(client, only.workspace_id);
		if (workspace) {
			await setActiveWorkspaceId(client, userId, only.workspace_id);
			return {
				userId,
				workspaceId: workspace.id,
				role: only.role as WorkspaceRole,
				name: workspace.name,
				legalName: workspace.legal_name,
				email: workspace.email,
				invoiceNumberMode: workspace.invoice_number_mode ?? "prefix",
				invoiceNumberPrefix: workspace.invoice_number_prefix ?? "INV",
				nextInvoiceSequence: workspace.next_invoice_sequence ?? 1,
			};
		}
	}

	// Owned workspace without a membership row: ensure the owner membership.
	const { data: owned, error: ownedError } = await client
		.from("workspaces")
		.select(
			"id, name, legal_name, email, invoice_number_mode, invoice_number_prefix, next_invoice_sequence",
		)
		.eq("owner_id", userId)
		.limit(1)
		.maybeSingle();
	if (ownedError) throw ownedError;
	if (owned) {
		const membership = await getMembership(client, userId, owned.id);
		if (!membership) {
			const { error: insertError } = await client
				.from("workspace_members")
				.insert({ workspace_id: owned.id, user_id: userId, role: "owner" });
			if (insertError) throw insertError;
		}
		await setActiveWorkspaceId(client, userId, owned.id);
		return {
			userId,
			workspaceId: owned.id,
			role: "owner",
			name: owned.name,
			legalName: owned.legal_name,
			email: owned.email,
			invoiceNumberMode: owned.invoice_number_mode ?? "prefix",
			invoiceNumberPrefix: owned.invoice_number_prefix ?? "INV",
			nextInvoiceSequence: owned.next_invoice_sequence ?? 1,
		};
	}

	if (options.createIfMissing === false) return null;

	// Create the default workspace + owner membership + active row.
	const name = normalizeWorkspaceName(options.businessName);
	const { data: created, error: createError } = await client
		.from("workspaces")
		.insert({
			owner_id: userId,
			name,
			legal_name: name,
			email: "",
			phone: "",
			address: "",
			website: "",
			tax_id: "",
			rc_number: "",
			country_code: "NG",
			base_currency: "NGN",
			seller_tax_status: "vat_registered",
			tax_rule_set_version: NIGERIA_TAX_RULE_SET_VERSION,
			reminders_enabled: true,
			reminder_signature: "Velure Finance Team",
			invoice_number_mode: "prefix",
			invoice_number_prefix: "INV",
			next_invoice_sequence: 1,
			default_payment_terms_days: 14,
		})
		.select("id")
		.single();
	if (createError) throw createError;

	const { error: membershipError } = await client
		.from("workspace_members")
		.insert({ workspace_id: created.id, user_id: userId, role: "owner" });
	if (membershipError) throw membershipError;

	await setActiveWorkspaceId(client, userId, created.id);

	return {
		userId,
		workspaceId: created.id,
		role: "owner",
		name,
		legalName: name,
		email: "",
		invoiceNumberMode: "prefix",
		invoiceNumberPrefix: "INV",
		nextInvoiceSequence: 1,
	};
}
