import { resolveActiveWorkspaceId, type Supabase } from "./workspaces";

export type { Supabase } from "./workspaces";

/**
 * A10 — products domain, ported to Supabase.
 *
 * RLS-pure: every function takes a USER-scoped Supabase client (the one
 * holding the OIDC-minted JWT). Reads are scoped to the user's ACTIVE
 * workspace (matching the Convex session scope); RLS additionally guarantees
 * a cross-workspace read returns zero rows — never a leak.
 *
 * Port of: convex/products.ts (list, getById, search, create, update,
 * archive, duplicate). Return shapes match the Convex surface so call sites
 * compile unchanged until each domain is cut over. The analytics /
 * intelligence / suggestions functions depend on the invoices domain and
 * are ported with it.
 */

export type ProductType = "product" | "service";

export type ProductRecord = {
	id: string;
	workspaceId: string;
	type: ProductType;
	name: string;
	description: string | null;
	sku: string | null;
	unitName: string | null;
	defaultUnitPrice: number;
	defaultTaxId: string | null;
	isActive: boolean;
	createdAt: string;
	updatedAt: string;
};

export type ProductInput = {
	type: ProductType;
	name: string;
	description?: string;
	sku?: string;
	unitName?: string;
	defaultUnitPrice: number;
	defaultTaxId?: string;
	isActive: boolean;
};

const normalize = (value?: string) => {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : null;
};

function assertValidProductPayload(args: {
	name: string;
	defaultUnitPrice: number;
}) {
	if (args.name.trim().length < 1) {
		throw new Error("Product name is required.");
	}
	if (args.defaultUnitPrice < 0) {
		throw new Error("Unit price must be non-negative.");
	}
}

/** Port of convex/products.ts `list`. */
export async function listProducts(
	client: Supabase,
	userId: string,
	args: {
		q?: string;
		type?: "all" | ProductType;
		status?: "all" | "active" | "archived";
	} = {},
): Promise<ProductRecord[]> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) return [];

	const { data, error } = await client
		.from("products")
		.select(
			"id, workspace_id, type, name, description, sku, unit_name, default_unit_price, default_tax_id, is_active, created_at, updated_at, deleted_at",
		)
		.eq("workspace_id", workspaceId)
		.order("created_at", { ascending: false });
	if (error) throw error;

	let products = (data ?? []).filter((p) => p.deleted_at === null);

	if (args.type && args.type !== "all") {
		products = products.filter((p) => p.type === args.type);
	}
	if (args.status && args.status !== "all") {
		const isActive = args.status === "active";
		products = products.filter((p) => p.is_active === isActive);
	}

	const queryText = (args.q ?? "").toLowerCase().trim();
	if (queryText.length > 0) {
		products = products.filter((p) => p.name.toLowerCase().includes(queryText));
	}

	return products.map((p) => ({
		id: p.id,
		workspaceId: p.workspace_id,
		type: p.type as ProductType,
		name: p.name,
		description: p.description,
		sku: p.sku,
		unitName: p.unit_name,
		defaultUnitPrice: Number(p.default_unit_price),
		defaultTaxId: p.default_tax_id,
		isActive: p.is_active,
		createdAt: p.created_at,
		updatedAt: p.updated_at,
	}));
}

/** Port of convex/products.ts `getById`. */
export async function getProductById(
	client: Supabase,
	userId: string,
	id: string,
): Promise<ProductRecord | null> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) return null;

	const { data, error } = await client
		.from("products")
		.select(
			"id, workspace_id, type, name, description, sku, unit_name, default_unit_price, default_tax_id, is_active, created_at, updated_at, deleted_at",
		)
		.eq("id", id)
		.eq("workspace_id", workspaceId)
		.maybeSingle();
	if (error) throw error;
	if (!data || data.deleted_at !== null) return null;

	return {
		id: data.id,
		workspaceId: data.workspace_id,
		type: data.type as ProductType,
		name: data.name,
		description: data.description,
		sku: data.sku,
		unitName: data.unit_name,
		defaultUnitPrice: Number(data.default_unit_price),
		defaultTaxId: data.default_tax_id,
		isActive: data.is_active,
		createdAt: data.created_at,
		updatedAt: data.updated_at,
	};
}

/** Port of convex/products.ts `search` (top 10 active matches by name/sku). */
export async function searchProducts(
	client: Supabase,
	userId: string,
	q: string,
): Promise<
	Array<{
		id: string;
		name: string;
		sku: string | null;
		defaultUnitPrice: number;
		unitName: string | null;
		type: ProductType;
	}>
> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) return [];

	const queryText = q.toLowerCase().trim();
	if (queryText.length === 0) return [];

	const { data, error } = await client
		.from("products")
		.select(
			"id, name, sku, default_unit_price, unit_name, type, is_active, deleted_at",
		)
		.eq("workspace_id", workspaceId);
	if (error) throw error;

	const matches = (data ?? [])
		.filter(
			(p) =>
				p.deleted_at === null &&
				p.is_active &&
				(p.name.toLowerCase().includes(queryText) ||
					p.sku?.toLowerCase().includes(queryText)),
		)
		.sort((a, b) => a.name.localeCompare(b.name))
		.slice(0, 10);

	return matches.map((p) => ({
		id: p.id,
		name: p.name,
		sku: p.sku,
		defaultUnitPrice: Number(p.default_unit_price),
		unitName: p.unit_name,
		type: p.type as ProductType,
	}));
}

/** Port of convex/products.ts `create`. Returns the new product's id. */
export async function createProduct(
	client: Supabase,
	userId: string,
	args: ProductInput,
): Promise<string> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");

	assertValidProductPayload(args);

	const { data, error } = await client
		.from("products")
		.insert({
			workspace_id: workspaceId,
			type: args.type,
			name: args.name.trim(),
			description: normalize(args.description),
			sku: normalize(args.sku),
			unit_name: normalize(args.unitName),
			default_unit_price: args.defaultUnitPrice,
			default_tax_id: normalize(args.defaultTaxId),
			is_active: args.isActive,
		})
		.select("id")
		.single();
	if (error) throw error;
	return data.id;
}

/** Port of convex/products.ts `update`. Returns the product id. */
export async function updateProduct(
	client: Supabase,
	userId: string,
	id: string,
	args: ProductInput,
): Promise<string> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");

	assertValidProductPayload(args);

	const { error } = await client
		.from("products")
		.update({
			type: args.type,
			name: args.name.trim(),
			description: normalize(args.description),
			sku: normalize(args.sku),
			unit_name: normalize(args.unitName),
			default_unit_price: args.defaultUnitPrice,
			default_tax_id: normalize(args.defaultTaxId),
			is_active: args.isActive,
			updated_at: new Date().toISOString(),
		})
		.eq("id", id)
		.eq("workspace_id", workspaceId)
		.is("deleted_at", null);
	if (error) throw error;
	return id;
}

/** Port of convex/products.ts `archive` (soft delete). Returns the product id. */
export async function archiveProduct(
	client: Supabase,
	userId: string,
	id: string,
): Promise<string> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");

	const { error } = await client
		.from("products")
		.update({
			is_active: false,
			deleted_at: new Date().toISOString(),
			updated_at: new Date().toISOString(),
		})
		.eq("id", id)
		.eq("workspace_id", workspaceId)
		.is("deleted_at", null);
	if (error) throw error;
	return id;
}

/** Port of convex/products.ts `duplicate`. Returns the new copy's id. */
export async function duplicateProduct(
	client: Supabase,
	userId: string,
	id: string,
): Promise<string> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");

	const { data: source, error: readError } = await client
		.from("products")
		.select(
			"type, name, description, sku, unit_name, default_unit_price, default_tax_id, is_active",
		)
		.eq("id", id)
		.eq("workspace_id", workspaceId)
		.is("deleted_at", null)
		.maybeSingle();
	if (readError) throw readError;
	if (!source) throw new Error("Product not found.");

	const { data, error } = await client
		.from("products")
		.insert({
			workspace_id: workspaceId,
			type: source.type,
			name: `${source.name} (Copy)`,
			description: source.description,
			sku: source.sku,
			unit_name: source.unit_name,
			default_unit_price: Number(source.default_unit_price),
			default_tax_id: source.default_tax_id,
			is_active: source.is_active,
		})
		.select("id")
		.single();
	if (error) throw error;
	return data.id;
}
