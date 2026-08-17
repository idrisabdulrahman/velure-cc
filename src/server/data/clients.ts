import { assertValidTin, normalizeNigeriaPhone } from "../../../convex/nigeria";
import { resolveActiveWorkspaceId, type Supabase } from "./workspaces";

export type { Supabase } from "./workspaces";

/**
 * A10 — clients domain, ported to Supabase.
 *
 * RLS-pure: every function takes a USER-scoped Supabase client (the one
 * holding the OIDC-minted JWT). Reads are scoped to the user's ACTIVE
 * workspace (matching the Convex session scope); RLS additionally guarantees
 * a cross-workspace read returns zero rows — never a leak.
 *
 * Port of: convex/clients.ts (list, getById, create, update, archive,
 * remove, toggleFavorite, importCsv). Return shapes match the Convex surface
 * so call sites compile unchanged until each domain is cut over.
 */

export type ClientStatus = "active" | "pending" | "inactive" | "archived";

export type ClientContact = {
	fullName?: string;
	role?: string;
	email?: string;
	phone?: string;
};

export type ClientRecord = {
	id: string;
	workspaceId: string;
	name: string;
	company: string | null;
	email: string;
	phone: string | null;
	website: string | null;
	billingAddress: string | null;
	taxId: string | null;
	currency: string;
	paymentTerms: string;
	internalNotes: string | null;
	contact: ClientContact;
	favorite: boolean;
	status: ClientStatus;
	createdAt: string | null;
	updatedAt: string | null;
};

export type ClientInput = {
	name: string;
	company?: string;
	email: string;
	phone?: string;
	website?: string;
	billingAddress?: string;
	taxId?: string;
	currency: string;
	paymentTerms: string;
	internalNotes?: string;
	contact: ClientContact;
	favorite: boolean;
	status: ClientStatus;
};

const normalize = (value?: string) => {
	const trimmed = value?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_CLIENT_IMPORT_ROWS = 2_000;
const CLIENT_IMPORT_INSERT_CHUNK_SIZE = 50;

const assertValidClientPayload = (input: {
	name: string;
	email: string;
	paymentTerms: string;
	currency: string;
	website?: string;
	contactEmail?: string;
}) => {
	const name = input.name.trim();
	const email = input.email.trim().toLowerCase();
	const paymentTerms = input.paymentTerms.trim();
	const currency = input.currency.trim();
	const contactEmail = input.contactEmail?.trim().toLowerCase();
	const website = input.website?.trim();

	if (name.length < 2) {
		throw new Error("Client name must be at least 2 characters long.");
	}

	if (!EMAIL_REGEX.test(email)) {
		throw new Error("Client email format is invalid.");
	}

	if (contactEmail && !EMAIL_REGEX.test(contactEmail)) {
		throw new Error("Contact email format is invalid.");
	}

	if (paymentTerms.length === 0) {
		throw new Error("Payment terms are required.");
	}

	if (currency.length === 0) {
		throw new Error("Currency is required.");
	}

	if (website) {
		try {
			// URL validation guard for server trust boundary.
			new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
		} catch {
			throw new Error("Website must be a valid URL.");
		}
	}
};

type ClientRow = {
	id: string;
	workspace_id: string | null;
	owner_id: string | null;
	name: string;
	company: string | null;
	email: string;
	phone: string | null;
	website: string | null;
	billing_address: string | null;
	tax_id: string | null;
	currency: string;
	payment_terms: string;
	internal_notes: string | null;
	contact: unknown;
	favorite: boolean;
	status: string;
	created_at: string | null;
	updated_at: string | null;
};

function toClientRecord(row: ClientRow): ClientRecord {
	return {
		id: row.id,
		workspaceId: row.workspace_id ?? "",
		name: row.name,
		company: row.company,
		email: row.email,
		phone: row.phone,
		website: row.website,
		billingAddress: row.billing_address,
		taxId: row.tax_id,
		currency: row.currency,
		paymentTerms: row.payment_terms,
		internalNotes: row.internal_notes,
		contact: (row.contact ?? {}) as ClientContact,
		favorite: row.favorite,
		status: row.status as ClientStatus,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

async function assertEmailUnique(
	client: Supabase,
	workspaceId: string,
	email: string,
	idToIgnore?: string,
) {
	const normalizedEmail = email.trim().toLowerCase();
	const { data, error } = await client
		.from("clients")
		.select("id")
		.eq("workspace_id", workspaceId)
		.eq("email", normalizedEmail);
	if (error) throw error;

	const conflict = (data ?? []).find((row) => row.id !== idToIgnore);
	if (conflict) {
		throw new Error("A client with this email already exists.");
	}
}

/** Port of convex/clients.ts `list`. */
export async function listClients(
	client: Supabase,
	userId: string,
	args: { q?: string; status?: "all" | ClientStatus } = {},
): Promise<ClientRecord[]> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) return [];

	const status = args.status && args.status !== "all" ? args.status : null;
	let query = client
		.from("clients")
		.select(
			"id, workspace_id, owner_id, name, company, email, phone, website, billing_address, tax_id, currency, payment_terms, internal_notes, contact, favorite, status, created_at, updated_at",
		)
		.eq("workspace_id", workspaceId)
		.order("updated_at", { ascending: false });
	if (status) query = query.eq("status", status);

	const { data, error } = await query;
	if (error) throw error;

	const queryText = (args.q ?? "").toLowerCase().trim();
	let filtered = (data ?? []) as ClientRow[];
	if (queryText.length > 0) {
		filtered = filtered.filter((clientRow) => {
			const contact = (clientRow.contact ?? {}) as ClientContact;
			const haystack = [
				clientRow.name,
				clientRow.company ?? "",
				clientRow.email,
				contact.fullName ?? "",
			]
				.join(" ")
				.toLowerCase();
			return haystack.includes(queryText);
		});
	}

	return filtered.map(toClientRecord);
}

/** Port of convex/clients.ts `getById`. */
export async function getClientById(
	client: Supabase,
	userId: string,
	id: string,
): Promise<ClientRecord | null> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) return null;

	const { data, error } = await client
		.from("clients")
		.select(
			"id, workspace_id, owner_id, name, company, email, phone, website, billing_address, tax_id, currency, payment_terms, internal_notes, contact, favorite, status, created_at, updated_at",
		)
		.eq("id", id)
		.eq("workspace_id", workspaceId)
		.maybeSingle();
	if (error) throw error;
	return data ? toClientRecord(data as ClientRow) : null;
}

/** Port of convex/clients.ts `create`. Returns the new client's id. */
export async function createClient(
	client: Supabase,
	userId: string,
	args: ClientInput,
): Promise<string> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");

	assertValidClientPayload({
		name: args.name,
		email: args.email,
		paymentTerms: args.paymentTerms,
		currency: args.currency,
		website: args.website,
		contactEmail: args.contact.email,
	});
	assertValidTin(args.taxId);
	await assertEmailUnique(client, workspaceId, args.email);

	const { data, error } = await client
		.from("clients")
		.insert({
			workspace_id: workspaceId,
			owner_id: userId,
			name: args.name.trim(),
			company: normalize(args.company),
			email: args.email.trim().toLowerCase(),
			phone: normalizeNigeriaPhone(args.phone),
			website: normalize(args.website),
			billing_address: normalize(args.billingAddress),
			tax_id: normalize(args.taxId),
			currency: args.currency.trim(),
			payment_terms: args.paymentTerms.trim(),
			internal_notes: normalize(args.internalNotes),
			contact: {
				fullName: normalize(args.contact.fullName),
				role: normalize(args.contact.role),
				email: normalize(args.contact.email),
				phone: normalizeNigeriaPhone(args.contact.phone),
			},
			favorite: args.favorite,
			status: args.status,
		})
		.select("id")
		.single();
	if (error) throw error;
	return data.id;
}

/** Port of convex/clients.ts `update`. Returns the client id. */
export async function updateClient(
	client: Supabase,
	userId: string,
	id: string,
	args: ClientInput,
): Promise<string> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");

	assertValidClientPayload({
		name: args.name,
		email: args.email,
		paymentTerms: args.paymentTerms,
		currency: args.currency,
		website: args.website,
		contactEmail: args.contact.email,
	});
	assertValidTin(args.taxId);
	await assertEmailUnique(client, workspaceId, args.email, id);

	const { error } = await client
		.from("clients")
		.update({
			name: args.name.trim(),
			company: normalize(args.company),
			email: args.email.trim().toLowerCase(),
			phone: normalizeNigeriaPhone(args.phone),
			website: normalize(args.website),
			billing_address: normalize(args.billingAddress),
			tax_id: normalize(args.taxId),
			currency: args.currency.trim(),
			payment_terms: args.paymentTerms.trim(),
			internal_notes: normalize(args.internalNotes),
			contact: {
				fullName: normalize(args.contact.fullName),
				role: normalize(args.contact.role),
				email: normalize(args.contact.email),
				phone: normalizeNigeriaPhone(args.contact.phone),
			},
			favorite: args.favorite,
			status: args.status,
			updated_at: new Date().toISOString(),
		})
		.eq("id", id)
		.eq("workspace_id", workspaceId);
	if (error) throw error;
	return id;
}

/** Port of convex/clients.ts `archive`. Returns the client id. */
export async function archiveClient(
	client: Supabase,
	userId: string,
	id: string,
): Promise<string> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");

	const { error } = await client
		.from("clients")
		.update({ status: "archived", updated_at: new Date().toISOString() })
		.eq("id", id)
		.eq("workspace_id", workspaceId);
	if (error) throw error;
	return id;
}

/** Port of convex/clients.ts `remove`. Returns the client id. */
export async function removeClient(
	client: Supabase,
	userId: string,
	id: string,
): Promise<string> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");

	const { error } = await client
		.from("clients")
		.delete()
		.eq("id", id)
		.eq("workspace_id", workspaceId);
	if (error) throw error;
	return id;
}

/** Port of convex/clients.ts `toggleFavorite`. Returns the new favorite value. */
export async function toggleClientFavorite(
	client: Supabase,
	userId: string,
	id: string,
): Promise<boolean> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");

	const { data: current, error: readError } = await client
		.from("clients")
		.select("favorite")
		.eq("id", id)
		.eq("workspace_id", workspaceId)
		.maybeSingle();
	if (readError) throw readError;
	if (!current) throw new Error("Client not found.");

	const favorite = !current.favorite;
	const { error } = await client
		.from("clients")
		.update({ favorite, updated_at: new Date().toISOString() })
		.eq("id", id)
		.eq("workspace_id", workspaceId);
	if (error) throw error;
	return favorite;
}

export type ImportCsvRow = {
	name: string;
	company?: string;
	email: string;
	phone?: string;
	billingAddress?: string;
	taxId?: string;
	currency?: string;
	paymentTerms?: string;
};

export type ImportCsvResult = {
	created: number;
	skipped: number;
	errors: Array<{ row: number; message: string }>;
};

/** Port of convex/clients.ts `importCsv`. */
export async function importClientsCsv(
	client: Supabase,
	userId: string,
	rows: ImportCsvRow[],
): Promise<ImportCsvResult> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");

	if (rows.length > MAX_CLIENT_IMPORT_ROWS) {
		throw new Error(
			`Import supports up to ${MAX_CLIENT_IMPORT_ROWS} clients per CSV.`,
		);
	}

	let created = 0;
	let skipped = 0;
	const errors: Array<{ row: number; message: string }> = [];
	const addImportError = (row: number, message: string) => {
		if (errors.length < 100) errors.push({ row, message });
	};

	const { data: existing, error: existingError } = await client
		.from("clients")
		.select("email")
		.eq("workspace_id", workspaceId);
	if (existingError) throw existingError;
	const usedEmails = new Set(
		(existing ?? []).map((c) => c.email.trim().toLowerCase()),
	);

	const docs: ClientInput[] = [];
	for (const [index, row] of rows.entries()) {
		const email = row.email.trim().toLowerCase();
		const clientRow = {
			name: row.name.trim(),
			email,
			paymentTerms: row.paymentTerms?.trim() || "Net 14",
			currency: row.currency?.trim().toUpperCase() || "NGN",
		};

		try {
			assertValidClientPayload(clientRow);
			assertValidTin(row.taxId);
		} catch (error) {
			skipped += 1;
			addImportError(
				index + 2,
				error instanceof Error ? error.message : "Invalid client row.",
			);
			continue;
		}

		if (usedEmails.has(email)) {
			skipped += 1;
			addImportError(index + 2, "A client with this email already exists.");
			continue;
		}
		usedEmails.add(email);

		docs.push({
			name: clientRow.name,
			company: normalize(row.company),
			email,
			phone: normalizeNigeriaPhone(row.phone),
			website: undefined,
			billingAddress: normalize(row.billingAddress),
			taxId: normalize(row.taxId),
			currency: clientRow.currency,
			paymentTerms: clientRow.paymentTerms,
			internalNotes: undefined,
			contact: {},
			favorite: false,
			status: "active",
		});
	}

	for (
		let index = 0;
		index < docs.length;
		index += CLIENT_IMPORT_INSERT_CHUNK_SIZE
	) {
		const chunk = docs.slice(index, index + CLIENT_IMPORT_INSERT_CHUNK_SIZE);
		await Promise.all(
			chunk.map(async (doc) => {
				const { error } = await client.from("clients").insert({
					workspace_id: workspaceId,
					owner_id: userId,
					name: doc.name,
					company: doc.company,
					email: doc.email,
					phone: doc.phone,
					website: doc.website,
					billing_address: doc.billingAddress,
					tax_id: doc.taxId,
					currency: doc.currency,
					payment_terms: doc.paymentTerms,
					internal_notes: doc.internalNotes,
					contact: doc.contact,
					favorite: doc.favorite,
					status: doc.status,
				});
				if (error) throw error;
			}),
		);
		created += chunk.length;
	}

	return { created, skipped, errors };
}
