import {
	type BuyerType,
	validateBuyerProfile,
} from "#/features/clients/buyer-profile";
import { buildClientIntelligence } from "./client-intelligence";
import { normalizeNigeriaPhone } from "./nigeria";
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
	buyerType: BuyerType;
	buyerProfileStatus: string;
	buyerProfileIssues: string[];
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
	/** B2B/B2C buyer type; defaults to B2B when omitted. */
	buyerType?: BuyerType;
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
/** PostgREST caps an unbounded read; page the existing-email scan instead. */
const CLIENT_IMPORT_EXISTING_PAGE_SIZE = 1000;

const CLIENT_COLUMNS =
	"id, workspace_id, owner_id, name, company, email, phone, website, billing_address, tax_id, buyer_type, buyer_profile_status, buyer_profile_issues, currency, payment_terms, internal_notes, contact, favorite, status, created_at, updated_at";

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

export const CLIENT_BUYER_REJECTION_PREFIX = "Buyer profile is invalid:";

type ClientBuyerRowSnapshot = {
	buyer_type?: string | null;
	tax_id?: string | null;
	billing_address?: string | null;
};

export type ClientBuyerColumns = {
	buyer_type: BuyerType;
	buyer_profile_status: "complete" | "needs_review";
	buyer_profile_issues: string[];
	/** Normalized stored values (null = cleared) so flags and data stay in lockstep. */
	billing_address: string | null;
	tax_id: string | null;
};

/**
 * B2 server boundary for the buyer profile on a client row. A provided
 * (non-undefined) value replaces the stored one; omitted values fall back to
 * what is already stored and "" clears — same contract as B1's
 * `buildSupplierProfileUpdate`. Throws on format-invalid values (bad email,
 * malformed/placeholder TIN, invalid buyer type, over-long address); missing
 * required parts (address, B2B TIN) are FLAGGED through the non-destructive
 * flag columns instead of rejected so bulk pre-existing clients and CSV
 * imports keep working.
 *
 * Exception (WP6 finding 4): an over-long address the write merely ECHOES
 * back from the stored row is legacy data — it is flagged, not rejected, so
 * such a row stays editable / archivable; a differently typed over-long
 * address still throws.
 *
 * DELIBERATE ASYMMETRY (accepted as designed, WP6 audit round-1 finding 5):
 * a LEGACY stored placeholder TIN that an edit leaves in place HARD-FAILS the
 * save rather than being re-flagged — the save path is the moment the user is
 * editing that buyer anyway, and silently keeping a placeholder would defeat
 * B1's reject-on-placeholder rule. Only genuinely MISSING parts are flagged.
 * Pinned by `refuses to persist a stored placeholder that the edit leaves in
 * place` and `updateClient hard-fails on a legacy placeholder TIN` in
 * src/server/data/clients-buyer-profile.test.ts.
 *
 * Pure so the write path can be unit-tested without a Supabase client; the
 * returned columns never delete or rewrite name/email history.
 */
export function buildClientBuyerColumns(
	current: ClientBuyerRowSnapshot,
	input: {
		name: string;
		email: string;
		billingAddress?: string;
		taxId?: string;
		buyerType?: BuyerType;
	},
): ClientBuyerColumns {
	const provided = (
		value: string | undefined,
		fallback: string | null | undefined,
	) => (value === undefined ? (fallback ?? "") : value);

	const result = validateBuyerProfile({
		name: input.name,
		email: input.email,
		billingAddress: provided(input.billingAddress, current.billing_address),
		taxId: provided(input.taxId, current.tax_id),
		buyerType: provided(input.buyerType, current.buyer_type),
	});

	// AUDIT WP6 (finding 4): a LEGACY stored address longer than the 300-char
	// cap made the row un-editable and un-restorable — the clients edit dialog
	// has no address field, so it resubmits the STORED value and the
	// over-long FORMAT check hard-failed every save forever. An address the
	// edit merely ECHOES back (equal to what is stored, after trim) is
	// therefore treated as legacy data: `address_too_long` stays a NON-BLOCKING
	// flag (`buyer_profile_status = "needs_review"` + the issue code) and the
	// write proceeds, so the row can be edited, archived and restored. A
	// newly TYPED over-long address (any value that differs from the stored
	// one) still HARD-FAILS, and so does any other blocking issue riding
	// along (placeholder TIN, bad email, invalid buyer type) — the documented
	// asymmetry above is untouched. No UI surface reads this flag yet; the
	// address field in the edit dialog is a logged follow-up.
	const echoesStoredAddress =
		result.normalized.billingAddress === (current.billing_address ?? "").trim();
	const legacyStoredOverlongAddress =
		echoesStoredAddress &&
		result.blockingIssues.length > 0 &&
		result.blockingIssues.every((issue) => issue.code === "address_too_long");
	if (!result.valid && !legacyStoredOverlongAddress) {
		throw new Error(
			`${CLIENT_BUYER_REJECTION_PREFIX} ${result.blockingIssues
				.map((issue) => issue.message)
				.join(" ")}`,
		);
	}

	return {
		buyer_type: result.normalized.buyerType,
		buyer_profile_status: result.status,
		buyer_profile_issues: result.issues.map((issue) => issue.code),
		billing_address: result.normalized.billingAddress || null,
		tax_id: result.normalized.taxId || null,
	};
}

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
	buyer_type: string | null;
	buyer_profile_status: string | null;
	buyer_profile_issues: unknown;
	currency: string;
	payment_terms: string;
	internal_notes: string | null;
	contact: unknown;
	favorite: boolean;
	status: string;
	created_at: string | null;
	updated_at: string | null;
};

type IntelligenceInvoice = {
	sentAt?: number;
	emailDeliveredAt?: number;
	paymentReceivedAt?: number;
};

type IntelligenceCompliance = {
	buyer?: { email?: string };
	netPayable?: number;
	grandTotal?: number;
	withholdingTaxAmount?: number;
};

type IntelligenceLineItem = {
	name: string;
	quantity: number;
	price: number;
	productId?: string;
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
		buyerType: row.buyer_type === "b2c" ? "b2c" : "b2b",
		buyerProfileStatus: row.buyer_profile_status ?? "needs_review",
		buyerProfileIssues: Array.isArray(row.buyer_profile_issues)
			? (row.buyer_profile_issues as string[])
			: [],
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
		.select(CLIENT_COLUMNS)
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
		.select(CLIENT_COLUMNS)
		.eq("id", id)
		.eq("workspace_id", workspaceId)
		.maybeSingle();
	if (error) throw error;
	return data ? toClientRecord(data as ClientRow) : null;
}

/** RLS-scoped port of convex/clients.ts `getIntelligence`. */
export async function getClientIntelligence(
	client: Supabase,
	userId: string,
	id: string,
) {
	const selected = await getClientById(client, userId, id);
	if (!selected) return null;

	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) return null;
	const { data, error } = await client
		.from("invoices")
		.select(
			"id, invoice_number, customer_name, currency, issue_date, due_date, status, payment_amount, paid_at, delivered_at, canceled_at, updated_at, lifecycle, compliance, line_items",
		)
		.eq("workspace_id", workspaceId);
	if (error) throw error;

	return buildClientIntelligence({
		client: {
			name: selected.name,
			email: selected.email,
			currency: selected.currency,
		},
		invoices: (data ?? []).map((row) => ({
			id: row.id,
			invoiceNumber: row.invoice_number,
			customerName: row.customer_name,
			currency: row.currency,
			issueDate: row.issue_date,
			dueDate: row.due_date,
			status: row.status,
			paymentAmount: row.payment_amount ?? 0,
			paidAt: row.paid_at ? new Date(row.paid_at).getTime() : undefined,
			deliveredAt: row.delivered_at
				? new Date(row.delivered_at).getTime()
				: undefined,
			canceledAt: row.canceled_at
				? new Date(row.canceled_at).getTime()
				: undefined,
			updatedAt: row.updated_at
				? new Date(row.updated_at).getTime()
				: undefined,
			lifecycle: (row.lifecycle ?? undefined) as
				| IntelligenceInvoice
				| undefined,
			compliance: (row.compliance ?? undefined) as
				| IntelligenceCompliance
				| undefined,
			lineItems: (row.line_items ?? []) as IntelligenceLineItem[],
		})),
	});
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
	const buyer = buildClientBuyerColumns(
		{},
		{
			name: args.name,
			email: args.email,
			billingAddress: args.billingAddress,
			taxId: args.taxId,
			buyerType: args.buyerType,
		},
	);
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
			billing_address: buyer.billing_address,
			tax_id: buyer.tax_id,
			buyer_type: buyer.buyer_type,
			buyer_profile_status: buyer.buyer_profile_status,
			buyer_profile_issues: buyer.buyer_profile_issues,
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
	const { data: currentBuyerRow, error: currentBuyerError } = await client
		.from("clients")
		.select("buyer_type, tax_id, billing_address")
		.eq("id", id)
		.eq("workspace_id", workspaceId)
		.maybeSingle();
	if (currentBuyerError) throw currentBuyerError;
	const buyer = buildClientBuyerColumns(
		{
			buyer_type: currentBuyerRow?.buyer_type,
			tax_id: currentBuyerRow?.tax_id,
			billing_address: currentBuyerRow?.billing_address,
		},
		{
			name: args.name,
			email: args.email,
			billingAddress: args.billingAddress,
			taxId: args.taxId,
			buyerType: args.buyerType,
		},
	);
	await assertEmailUnique(client, workspaceId, args.email, id);

	const { error } = await client
		.from("clients")
		.update({
			name: args.name.trim(),
			company: normalize(args.company),
			email: args.email.trim().toLowerCase(),
			phone: normalizeNigeriaPhone(args.phone),
			website: normalize(args.website),
			billing_address: buyer.billing_address,
			tax_id: buyer.tax_id,
			buyer_type: buyer.buyer_type,
			buyer_profile_status: buyer.buyer_profile_status,
			buyer_profile_issues: buyer.buyer_profile_issues,
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
		.select("id, email")
		.eq("workspace_id", workspaceId)
		.order("id", { ascending: true })
		.range(0, CLIENT_IMPORT_EXISTING_PAGE_SIZE - 1);
	if (existingError) throw existingError;
	const usedEmails = new Set<string>();
	const foldEmails = (page: Array<{ email?: unknown }> | null) => {
		for (const row of page ?? []) {
			const email = String(row.email ?? "")
				.trim()
				.toLowerCase();
			if (email) usedEmails.add(email);
		}
	};
	foldEmails(existing);
	// An unbounded read would be capped by PostgREST (1000 rows by default), so
	// for a workspace with more clients than one page the set missed every later
	// email and the same address was imported again as a new client.
	// `clients_workspace_email_idx` is NOT unique, so the database does not
	// backstop that either. Page until a short page ends the loop.
	for (
		let offset = CLIENT_IMPORT_EXISTING_PAGE_SIZE;
		existing && existing.length === CLIENT_IMPORT_EXISTING_PAGE_SIZE;
		offset += CLIENT_IMPORT_EXISTING_PAGE_SIZE
	) {
		const { data: page, error } = await client
			.from("clients")
			.select("id, email")
			.eq("workspace_id", workspaceId)
			.order("id", { ascending: true })
			.range(offset, offset + CLIENT_IMPORT_EXISTING_PAGE_SIZE - 1);
		if (error) throw error;
		foldEmails(page);
		if (!page || page.length < CLIENT_IMPORT_EXISTING_PAGE_SIZE) break;
	}

	const docs: Array<ClientInput & { buyer: ClientBuyerColumns }> = [];
	const docRowNumbers: number[] = [];
	for (const [index, row] of rows.entries()) {
		const email = String(row.email ?? "")
			.trim()
			.toLowerCase();
		const clientRow = {
			name: String(row.name ?? "").trim(),
			email,
			paymentTerms: row.paymentTerms?.trim() || "Net 14",
			currency: row.currency?.trim().toUpperCase() || "NGN",
		};

		let buyer: ClientBuyerColumns;
		try {
			assertValidClientPayload(clientRow);
			// B2: format-invalid buyer data (bad TIN, bad email) skips the row;
			// incomplete data (missing address/B2B TIN) imports and is flagged.
			buyer = buildClientBuyerColumns(
				{},
				{
					name: clientRow.name,
					email,
					billingAddress: row.billingAddress,
					taxId: row.taxId,
				},
			);
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

		docRowNumbers.push(index + 2);
		docs.push({
			name: clientRow.name,
			company: normalize(row.company),
			email,
			phone: normalizeNigeriaPhone(row.phone),
			website: undefined,
			billingAddress: buyer.billing_address ?? undefined,
			taxId: buyer.tax_id ?? undefined,
			currency: clientRow.currency,
			paymentTerms: clientRow.paymentTerms,
			internalNotes: undefined,
			contact: {},
			favorite: false,
			status: "active",
			buyer,
		});
	}

	for (
		let index = 0;
		index < docs.length;
		index += CLIENT_IMPORT_INSERT_CHUNK_SIZE
	) {
		const chunk = docs.slice(index, index + CLIENT_IMPORT_INSERT_CHUNK_SIZE);
		// Sequential, individually counted inserts. The previous `Promise.all`
		// fanned 50 inserts out at once and threw on the first rejection: any
		// sibling that had already committed stayed in the database, `created`
		// was not incremented for the chunk, and the thrown error made the UI
		// report a total failure — so the user's retry duplicated every row that
		// did commit. A failed row is now reported by its CSV row number and the
		// count stays truthful.
		for (const [chunkIndex, doc] of chunk.entries()) {
			const { error } = await client.from("clients").insert({
				workspace_id: workspaceId,
				owner_id: userId,
				name: doc.name,
				company: doc.company,
				email: doc.email,
				phone: doc.phone,
				website: doc.website,
				billing_address: doc.buyer.billing_address,
				tax_id: doc.buyer.tax_id,
				buyer_type: doc.buyer.buyer_type,
				buyer_profile_status: doc.buyer.buyer_profile_status,
				buyer_profile_issues: doc.buyer.buyer_profile_issues,
				currency: doc.currency,
				payment_terms: doc.paymentTerms,
				internal_notes: doc.internalNotes,
				contact: doc.contact,
				favorite: doc.favorite,
				status: doc.status,
			});
			if (error) {
				skipped += 1;
				addImportError(
					docRowNumbers[index + chunkIndex] ?? index + chunkIndex + 2,
					`Could not save this client: ${error.message}`,
				);
				continue;
			}
			created += 1;
		}
	}

	return { created, skipped, errors };
}
