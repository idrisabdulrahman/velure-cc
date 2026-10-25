import type { ProviderAdapter } from "#/features/einvoicing/provider-adapter";
import { decryptToken, encryptToken } from "#/server/data/token-encryption";
import type { Supabase } from "#/server/data/workspaces";
import { getWorkspaceContext } from "#/server/data/workspaces";
import { getSupabaseAdminClient } from "#/server/supabase";

const MAX_BUNDLE_BYTES = 256 * 1024;
const PROVIDER_KEY = /^[a-z][a-z0-9_-]{0,63}$/;

export type EInvoiceCredentialBundle = Readonly<{
	apiKey?: string;
	certificate?: string;
	privateKey?: string;
}>;

function assertServerOnly() {
	if (typeof window !== "undefined") {
		throw new Error("E-invoice credentials are available only on the server.");
	}
}

function validateBundle(bundle: EInvoiceCredentialBundle) {
	const entries = Object.entries(bundle);
	if (
		entries.length === 0 ||
		entries.some(
			([key, value]) =>
				!["apiKey", "certificate", "privateKey"].includes(key) ||
				typeof value !== "string" ||
				value.length === 0,
		)
	) {
		throw new Error("A non-empty supported credential bundle is required.");
	}
	const serialized = JSON.stringify(bundle);
	if (new TextEncoder().encode(serialized).byteLength > MAX_BUNDLE_BYTES) {
		throw new Error("Provider credential bundle is too large.");
	}
	return serialized;
}

async function activeWritableWorkspace(client: Supabase, userId: string) {
	const context = await getWorkspaceContext(client, userId);
	if (!context || !["owner", "member"].includes(context.role)) {
		throw new Error("A writable active workspace is required.");
	}
	return context.workspaceId;
}

/** Store encrypted data only; plaintext is never returned to the caller. */
export async function saveEInvoiceProviderCredentials(
	client: Supabase,
	userId: string,
	providerKey: string,
	bundle: EInvoiceCredentialBundle,
): Promise<void> {
	assertServerOnly();
	if (!PROVIDER_KEY.test(providerKey)) throw new Error("Invalid provider key.");
	const workspaceId = await activeWritableWorkspace(client, userId);
	const encryptedBundle = await encryptToken(
		validateBundle(bundle),
		workspaceId,
	);
	const admin = getSupabaseAdminClient();
	const { error } = await admin.from("einvoice_provider_credentials").upsert(
		{
			workspace_id: workspaceId,
			provider_key: providerKey,
			encrypted_bundle: encryptedBundle,
			updated_at: new Date().toISOString(),
		},
		{ onConflict: "workspace_id,provider_key" },
	);
	if (error) throw new Error("Unable to save provider credentials.");
}

async function loadBundle(
	client: Supabase,
	userId: string,
	workspaceId: string,
	providerKey: string,
): Promise<EInvoiceCredentialBundle> {
	const context = await getWorkspaceContext(client, userId);
	if (!context || context.workspaceId !== workspaceId) {
		throw new Error("Provider credentials are unavailable.");
	}
	const admin = getSupabaseAdminClient();
	const { data, error } = await admin
		.from("einvoice_provider_credentials")
		.select("encrypted_bundle")
		.eq("workspace_id", workspaceId)
		.eq("provider_key", providerKey)
		.maybeSingle();
	if (error || !data) throw new Error("Provider credentials are unavailable.");
	try {
		const parsed: unknown = JSON.parse(
			await decryptToken(data.encrypted_bundle, workspaceId),
		);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("Invalid credential bundle.");
		}
		validateBundle(parsed as EInvoiceCredentialBundle);
		return parsed as EInvoiceCredentialBundle;
	} catch {
		throw new Error("Provider credentials are unavailable.");
	}
}

/**
 * Adapter-only secret boundary: decrypted material is passed directly to the
 * server-side adapter constructor and is never returned by this module.
 */
export async function createWorkspaceProviderAdapter(
	client: Supabase,
	userId: string,
	providerKey: string,
	buildAdapter: (credentials: EInvoiceCredentialBundle) => ProviderAdapter,
): Promise<ProviderAdapter> {
	assertServerOnly();
	if (!PROVIDER_KEY.test(providerKey)) throw new Error("Invalid provider key.");
	const workspaceId = await activeWritableWorkspace(client, userId);
	const credentials = await loadBundle(
		client,
		userId,
		workspaceId,
		providerKey,
	);
	return buildAdapter(credentials);
}
