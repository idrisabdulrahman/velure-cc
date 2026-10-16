import type { Database, Json } from "#/types/database.types";
import { getById as getInvoiceById } from "./invoices";
import {
	decryptSensitiveFields,
	encryptSensitiveFields,
} from "./token-encryption";
import type { Supabase } from "./workspaces";

/**
 * A10 — integrations domain, ported to Supabase.
 *
 * RLS-pure: every function takes a USER-scoped Supabase client (the one
 * holding the OIDC-minted JWT) and never sends a user id for authorization.
 * Integration tables are owner-scoped (owner_id = current user); invoices
 * resolve through workspace membership.
 *
 * Port of convex/integrations.ts (the UI-facing surface): listConnections,
 * getConnectionSecret, updateConnectionTokens, upsertConnection, disconnect,
 * listSyncJobs, listLogs, recordSyncJobResult, retrySyncJob,
 * updateInvoiceSyncState. Return shapes match the Convex surface.
 *
 * Convex-internal machinery stays on Convex: the OAuth callback action
 * (completeOAuthConnectionAction), provider token refresh + API calls
 * (quickbooksRequest / xeroRequest / syncInvoiceLive / syncClientLive), and
 * audit-log writes (audit_logs is SELECT-only for members under RLS).
 *
 * Token encryption: reuses convex/tokenEncryption.ts (Web Crypto AES-GCM,
 * AAD-bound to the owner id) so ciphertext written by the app decrypts
 * here and vice versa. Requires INTEGRATION_ENCRYPTION_KEY in the runtime
 * env, exactly as the Convex side does.
 *
 * Server-only tables (by design, phase_a5 + phase_a9):
 * integration_connections and integration_webhooks have NO client grants
 * or RLS policies — the A9 migration deliberately kept token-bearing rows
 * server-only. listConnections / getConnectionSecret / updateConnectionTokens /
 * upsertConnection / disconnect therefore require a SERVICE-ROLE (or bridge)
 * client and must never run in the browser; owner scoping is enforced
 * explicitly with owner_id in the WHERE clauses rather than by RLS.
 * integration_sync_jobs and integration_logs DO have owner-access RLS
 * policies and are RLS-pure through the user-scoped client.
 */

export type Provider = "quickbooks" | "xero" | "slack";
export type ConnectionStatus = "disconnected" | "connected" | "error";
export type AuthType = "oauth" | "webhook" | "api_key" | "manual";
export type SyncJobStatus =
	| "pending"
	| "success"
	| "failed"
	| "needs_configuration";
export type SyncEntityType = "invoice" | "client" | "export";

export type IntegrationConnection = {
	_id: string;
	ownerId: string;
	provider: Provider;
	status: ConnectionStatus;
	authType: AuthType;
	externalAccountId?: string;
	accessToken?: string;
	refreshToken?: string;
	expiresAt?: number;
	webhookUrl?: string;
	defaultRevenueAccount?: string;
	defaultTaxCode?: string;
	configJson?: string;
	createdAt: number;
	updatedAt: number;
};

export type IntegrationSyncJob = {
	_id: string;
	ownerId: string;
	provider: Provider;
	entityType: SyncEntityType;
	entityId: string;
	direction: "push";
	status: SyncJobStatus;
	requestPayload?: string;
	responsePayload?: string;
	error?: string;
	retryCount: number;
	lastAttemptAt?: number;
	createdAt: number;
	updatedAt: number;
};

export type IntegrationLog = {
	_id: string;
	ownerId: string;
	provider: Provider;
	level: "info" | "error";
	message: string;
	entityType?: string;
	entityId?: string;
	createdAt: number;
};

const PROVIDERS: Provider[] = ["quickbooks", "xero", "slack"];
const TOKEN_FIELDS = ["accessToken", "refreshToken"] as const;

type ConnectionUpdate =
	Database["public"]["Tables"]["integration_connections"]["Update"];
type ConnectionInsert =
	Database["public"]["Tables"]["integration_connections"]["Insert"];
type SyncJobUpdate =
	Database["public"]["Tables"]["integration_sync_jobs"]["Update"];
type SyncJobInsert =
	Database["public"]["Tables"]["integration_sync_jobs"]["Insert"];
type LogInsert = Database["public"]["Tables"]["integration_logs"]["Insert"];

const toConnUpdate = (patch: Record<string, unknown>): ConnectionUpdate =>
	patch as unknown as ConnectionUpdate;
const toConnInsert = (patch: Record<string, unknown>): ConnectionInsert =>
	patch as unknown as ConnectionInsert;
const toJobUpdate = (patch: Record<string, unknown>): SyncJobUpdate =>
	patch as unknown as SyncJobUpdate;
const toJobInsert = (patch: Record<string, unknown>): SyncJobInsert =>
	patch as unknown as SyncJobInsert;
const toLogInsert = (patch: Record<string, unknown>): LogInsert =>
	patch as unknown as LogInsert;
const json = (value: unknown): Json => value as Json;

function defaultConnection(
	ownerId: string,
	provider: Provider,
): IntegrationConnection {
	const timestamp = Date.now();
	return {
		_id: "",
		ownerId,
		provider,
		status: "disconnected",
		authType: provider === "slack" ? "webhook" : "oauth",
		createdAt: timestamp,
		updatedAt: timestamp,
	};
}

function epoch(value?: string | null): number | undefined {
	if (!value) return undefined;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? undefined : ms;
}

function iso(value?: number | null): string | null {
	if (value === undefined || value === null) return null;
	return new Date(value).toISOString();
}

type ConnectionRow = {
	id: string;
	owner_id: string;
	provider: Provider;
	status: ConnectionStatus;
	auth_type: AuthType;
	external_account_id: string | null;
	access_token: string | null;
	refresh_token: string | null;
	expires_at: string | null;
	webhook_url: string | null;
	default_revenue_account: string | null;
	default_tax_code: string | null;
	config_json: unknown;
	created_at: string;
	updated_at: string;
};

function toConnection(row: ConnectionRow): IntegrationConnection {
	return {
		_id: row.id,
		ownerId: row.owner_id,
		provider: row.provider,
		status: row.status,
		authType: row.auth_type,
		externalAccountId: row.external_account_id ?? undefined,
		accessToken: row.access_token ?? undefined,
		refreshToken: row.refresh_token ?? undefined,
		expiresAt: epoch(row.expires_at),
		webhookUrl: row.webhook_url ?? undefined,
		defaultRevenueAccount: row.default_revenue_account ?? undefined,
		defaultTaxCode: row.default_tax_code ?? undefined,
		configJson: row.config_json
			? typeof row.config_json === "string"
				? (row.config_json as string)
				: JSON.stringify(row.config_json)
			: undefined,
		createdAt: epoch(row.created_at) ?? 0,
		updatedAt: epoch(row.updated_at) ?? 0,
	};
}

type SyncJobRow = {
	id: string;
	owner_id: string;
	provider: Provider;
	entity_type: SyncEntityType;
	entity_id: string;
	direction: "push";
	status: SyncJobStatus;
	request_payload: unknown;
	response_payload: unknown;
	error: string | null;
	retry_count: number;
	last_attempt_at: string | null;
	created_at: string;
	updated_at: string;
};

function toSyncJob(row: SyncJobRow): IntegrationSyncJob {
	return {
		_id: row.id,
		ownerId: row.owner_id,
		provider: row.provider,
		entityType: row.entity_type,
		entityId: row.entity_id,
		direction: "push",
		status: row.status,
		requestPayload: row.request_payload
			? typeof row.request_payload === "string"
				? (row.request_payload as string)
				: JSON.stringify(row.request_payload)
			: undefined,
		responsePayload: row.response_payload
			? typeof row.response_payload === "string"
				? (row.response_payload as string)
				: JSON.stringify(row.response_payload)
			: undefined,
		error: row.error ?? undefined,
		retryCount: row.retry_count,
		lastAttemptAt: epoch(row.last_attempt_at),
		createdAt: epoch(row.created_at) ?? 0,
		updatedAt: epoch(row.updated_at) ?? 0,
	};
}

type LogRow = {
	id: string;
	owner_id: string;
	provider: Provider;
	level: "info" | "error";
	message: string;
	entity_type: string | null;
	entity_id: string | null;
	created_at: string;
};

function toLog(row: LogRow): IntegrationLog {
	return {
		_id: row.id,
		ownerId: row.owner_id,
		provider: row.provider,
		level: row.level,
		message: row.message,
		entityType: row.entity_type ?? undefined,
		entityId: row.entity_id ?? undefined,
		createdAt: epoch(row.created_at) ?? 0,
	};
}

async function connectionForProvider(
	client: Supabase,
	userId: string,
	provider: Provider,
) {
	// Explicit owner scoping: the caller holds either the user-scoped client
	// (RLS would also enforce this, were grants present) or a service-role
	// client, where RLS is bypassed — so the owner_id filter is load-bearing.
	const { data, error } = await client
		.from("integration_connections")
		.select("*")
		.eq("owner_id", userId)
		.eq("provider", provider)
		.limit(1)
		.maybeSingle();
	if (error) throw error;
	if (!data) return null;
	return toConnection(data as unknown as ConnectionRow);
}

export async function listConnections(
	client: Supabase,
	userId: string,
): Promise<
	Array<{
		_id: string;
		provider: Provider;
		status: ConnectionStatus;
		authType: AuthType;
		externalAccountId?: string;
		accountName?: string;
		defaultRevenueAccount?: string;
		defaultTaxCode?: string;
		webhookUrlConfigured: boolean;
		updatedAt: number;
	}>
> {
	const { data, error } = await client
		.from("integration_connections")
		.select("*")
		.eq("owner_id", userId);
	if (error) throw error;
	const rows = (data ?? []).map((r) =>
		toConnection(r as unknown as ConnectionRow),
	);

	return PROVIDERS.map((provider) => {
		const connection =
			rows.find((entry) => entry.provider === provider) ??
			defaultConnection(userId, provider);

		let accountName: string | undefined;
		if (connection.configJson) {
			try {
				const parsed = JSON.parse(connection.configJson) as Record<
					string,
					string
				>;
				accountName = parsed.realmId ?? parsed.tenantName ?? parsed.tenantId;
			} catch {
				accountName = undefined;
			}
		}

		return {
			_id: connection._id,
			provider: connection.provider,
			status: connection.status,
			authType: connection.authType,
			externalAccountId: connection.externalAccountId,
			accountName,
			defaultRevenueAccount: connection.defaultRevenueAccount,
			defaultTaxCode: connection.defaultTaxCode,
			webhookUrlConfigured: Boolean(connection.webhookUrl),
			updatedAt: connection.updatedAt,
		};
	});
}

export async function getConnectionSecret(
	client: Supabase,
	userId: string,
	provider: Provider,
): Promise<IntegrationConnection | null> {
	const connection = await connectionForProvider(client, userId, provider);
	if (!connection) return null;
	return (await decryptSensitiveFields(
		connection,
		TOKEN_FIELDS,
		userId,
	)) as unknown as IntegrationConnection;
}

export async function updateConnectionTokens(
	client: Supabase,
	userId: string,
	args: {
		provider: Provider;
		accessToken: string;
		refreshToken?: string;
		expiresAt?: number;
	},
): Promise<{ ok: true }> {
	const connection = await connectionForProvider(client, userId, args.provider);
	if (!connection) throw new Error("Integration connection not found.");

	const encrypted = await encryptSensitiveFields(
		{ accessToken: args.accessToken, refreshToken: args.refreshToken },
		TOKEN_FIELDS,
		userId,
	);

	const { error } = await client
		.from("integration_connections")
		.update(
			toConnUpdate({
				access_token: encrypted.accessToken ?? null,
				refresh_token: encrypted.refreshToken ?? null,
				expires_at: iso(args.expiresAt),
				status: "connected",
				updated_at: iso(Date.now()),
			}),
		)
		.eq("id", connection._id);
	if (error) throw error;
	return { ok: true };
}

export async function upsertConnection(
	client: Supabase,
	userId: string,
	args: {
		provider: Provider;
		authType: AuthType;
		externalAccountId?: string;
		accessToken?: string;
		refreshToken?: string;
		expiresAt?: number;
		webhookUrl?: string;
		defaultRevenueAccount?: string;
		defaultTaxCode?: string;
		configJson?: string;
	},
): Promise<string> {
	const existing = await connectionForProvider(client, userId, args.provider);
	const timestamp = Date.now();

	const encryptedArgs = (await encryptSensitiveFields(
		args,
		TOKEN_FIELDS,
		userId,
	)) as Record<string, unknown>;

	const status: ConnectionStatus =
		args.provider === "slack"
			? args.webhookUrl
				? "connected"
				: "disconnected"
			: encryptedArgs.accessToken
				? "connected"
				: "disconnected";

	if (existing) {
		const { error } = await client
			.from("integration_connections")
			.update(
				toConnUpdate({
					auth_type: encryptedArgs.authType as AuthType,
					external_account_id:
						(encryptedArgs.externalAccountId as string | undefined) ?? null,
					access_token:
						(encryptedArgs.accessToken as string | undefined) ?? null,
					refresh_token:
						(encryptedArgs.refreshToken as string | undefined) ?? null,
					expires_at: iso(encryptedArgs.expiresAt as number | undefined),
					webhook_url: (encryptedArgs.webhookUrl as string | undefined) ?? null,
					default_revenue_account:
						(encryptedArgs.defaultRevenueAccount as string | undefined) ?? null,
					default_tax_code:
						(encryptedArgs.defaultTaxCode as string | undefined) ?? null,
					config_json: json(
						(encryptedArgs.configJson as string | undefined) ?? null,
					),
					status,
					updated_at: iso(timestamp),
				}),
			)
			.eq("id", existing._id);
		if (error) throw error;
		return existing._id;
	}

	const { data, error } = await client
		.from("integration_connections")
		.insert(
			toConnInsert({
				owner_id: userId,
				provider: args.provider,
				auth_type: args.authType,
				external_account_id: args.externalAccountId ?? null,
				access_token: (encryptedArgs.accessToken as string | undefined) ?? null,
				refresh_token:
					(encryptedArgs.refreshToken as string | undefined) ?? null,
				expires_at: iso(args.expiresAt),
				webhook_url: args.webhookUrl ?? null,
				default_revenue_account: args.defaultRevenueAccount ?? null,
				default_tax_code: args.defaultTaxCode ?? null,
				config_json: json(args.configJson ?? null),
				status,
				created_at: iso(timestamp),
				updated_at: iso(timestamp),
			}),
		)
		.select("id")
		.single();
	if (error) throw error;
	return data.id;
}
export async function disconnect(
	client: Supabase,
	userId: string,
	provider: Provider,
): Promise<{ ok: true }> {
	const existing = await connectionForProvider(client, userId, provider);
	if (!existing) return { ok: true };

	const { error } = await client
		.from("integration_connections")
		.update(
			toConnUpdate({
				status: "disconnected",
				access_token: null,
				refresh_token: null,
				webhook_url: null,
				expires_at: null,
				updated_at: iso(Date.now()),
			}),
		)
		.eq("id", existing._id);
	if (error) throw error;
	return { ok: true };
}

export async function listSyncJobs(
	client: Supabase,
): Promise<IntegrationSyncJob[]> {
	const { data, error } = await client
		.from("integration_sync_jobs")
		.select("*")
		.order("created_at", { ascending: false });
	if (error) throw error;
	return (data ?? []).map((row) => toSyncJob(row as unknown as SyncJobRow));
}

export async function listLogs(client: Supabase): Promise<IntegrationLog[]> {
	const { data, error } = await client
		.from("integration_logs")
		.select("*")
		.order("created_at", { ascending: false });
	if (error) throw error;
	return (data ?? []).map((row) => toLog(row as unknown as LogRow));
}

export async function recordSyncJobResult(
	client: Supabase,
	userId: string,
	args: {
		provider: Provider;
		entityType: SyncEntityType;
		entityId: string;
		status: SyncJobStatus;
		requestPayload?: string;
		responsePayload?: string;
		error?: string;
	},
): Promise<{ jobId: string }> {
	const timestamp = Date.now();

	const { data, error } = await client
		.from("integration_sync_jobs")
		.insert(
			toJobInsert({
				owner_id: userId,
				provider: args.provider,
				entity_type: args.entityType,
				entity_id: args.entityId,
				direction: "push",
				status: args.status,
				request_payload: json(args.requestPayload ?? null),
				response_payload: json(args.responsePayload ?? null),
				error: args.error ?? null,
				retry_count: 0,
				last_attempt_at: iso(timestamp),
				created_at: iso(timestamp),
				updated_at: iso(timestamp),
			}),
		)
		.select("id")
		.single();
	if (error) throw error;

	const { error: logError } = await client
		.from("integration_logs")
		.insert(
			toLogInsert({
				owner_id: userId,
				provider: args.provider,
				level: args.status === "success" ? "info" : "error",
				message:
					args.status === "success"
						? `${args.entityType} sync completed.`
						: (args.error ?? `${args.entityType} sync failed.`),
				entity_type: args.entityType,
				entity_id: args.entityId,
				created_at: iso(timestamp),
			}),
		)
		.select("id")
		.maybeSingle();
	if (logError) throw logError;

	return { jobId: data.id };
}

export async function retrySyncJob(
	client: Supabase,
	jobId: string,
): Promise<{ ok: true }> {
	const { data: job, error: fetchError } = await client
		.from("integration_sync_jobs")
		.select("*")
		.eq("id", jobId)
		.maybeSingle();
	if (fetchError) throw fetchError;
	if (!job) throw new Error("Sync job not found.");

	const { error } = await client
		.from("integration_sync_jobs")
		.update(
			toJobUpdate({
				status: "pending",
				retry_count: (job as unknown as SyncJobRow).retry_count + 1,
				updated_at: iso(Date.now()),
			}),
		)
		.eq("id", jobId);
	if (error) throw error;
	return { ok: true };
}

export async function updateInvoiceSyncState(
	client: Supabase,
	userId: string,
	args: {
		invoiceId: string;
		provider: Provider;
		status: SyncJobStatus | "idle";
		externalId?: string;
		lastError?: string;
	},
): Promise<{ ok: true }> {
	const invoice = await getInvoiceById(client, userId, args.invoiceId);
	if (!invoice) throw new Error("Invoice not found.");

	const now = Date.now();
	const currentSync = (invoice.sync as Record<string, unknown> | null) ?? {
		quickbooks: { status: "idle" },
		xero: { status: "idle" },
		slack: { status: "idle" },
	};
	const providerState = (currentSync[args.provider] as Record<
		string,
		unknown
	>) ?? {
		status: "idle",
	};
	const nextSync = {
		...currentSync,
		[args.provider]: {
			...providerState,
			status: args.status,
			externalId: args.externalId,
			lastError: args.lastError,
			lastSyncedAt: now,
		},
	};

	const { error } = await client
		.from("invoices")
		.update({
			sync: json(nextSync),
			updated_at: iso(now) as string,
		})
		.eq("id", args.invoiceId);
	if (error) throw error;
	return { ok: true };
}
