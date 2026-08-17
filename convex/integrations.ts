import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	action,
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";
import { recordAuditLog } from "./audit";
import { requireAuthUser } from "./auth";
import { env } from "./env";
import { requireWorkspaceForRead, requireWritableInvoice } from "./rls";
import {
	decryptSensitiveFields,
	encryptSensitiveFields,
} from "./tokenEncryption";

const TOKEN_FIELDS = ["accessToken", "refreshToken"] as const;

const providerValidator = v.union(
	v.literal("quickbooks"),
	v.literal("xero"),
	v.literal("slack"),
);

type Provider = "quickbooks" | "xero" | "slack";

async function requireViewer(ctx: any) {
	return await requireAuthUser(ctx);
}

function now() {
	return Date.now();
}

async function activeWorkspaceIdForUser(ctx: any, userId: string) {
	const active = await ctx.db
		.query("active_workspaces")
		.withIndex("by_userId", (q: any) => q.eq("userId", userId))
		.first();
	return active?.workspaceId;
}

function defaultConnection(ownerId: string, provider: Provider) {
	const timestamp = now();
	return {
		ownerId,
		provider,
		status: "disconnected" as const,
		authType: provider === "slack" ? ("webhook" as const) : ("oauth" as const),
		createdAt: timestamp,
		updatedAt: timestamp,
	};
}

function quickBooksApiBase() {
	return env.QUICKBOOKS_ENV === "production"
		? "https://quickbooks.api.intuit.com"
		: "https://sandbox-quickbooks.api.intuit.com";
}

async function quickbooksTokenRefresh(refreshToken: string) {
	if (!env.QUICKBOOKS_CLIENT_ID || !env.QUICKBOOKS_CLIENT_SECRET) {
		throw new Error("QuickBooks credentials are missing.");
	}

	const response = await fetch(
		"https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
		{
			method: "POST",
			headers: {
				Authorization: `Basic ${Buffer.from(
					`${env.QUICKBOOKS_CLIENT_ID}:${env.QUICKBOOKS_CLIENT_SECRET}`,
				).toString("base64")}`,
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: refreshToken,
			}),
		},
	);

	if (!response.ok) {
		throw new Error(await response.text());
	}

	return (await response.json()) as {
		access_token: string;
		refresh_token?: string;
		expires_in?: number;
	};
}

async function xeroTokenRefresh(refreshToken: string) {
	if (!env.XERO_CLIENT_ID || !env.XERO_CLIENT_SECRET) {
		throw new Error("Xero credentials are missing.");
	}

	const response = await fetch("https://identity.xero.com/connect/token", {
		method: "POST",
		headers: {
			Authorization: `Basic ${Buffer.from(
				`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`,
			).toString("base64")}`,
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
		}),
	});

	if (!response.ok) {
		throw new Error(await response.text());
	}

	return (await response.json()) as {
		access_token: string;
		refresh_token?: string;
		expires_in?: number;
	};
}

async function ensureConnectionAccess(
	ctx: any,
	connection: any,
): Promise<{ accessToken: string; connection: any }> {
	// Tokens are bound to the connection owner at encryption time, so decrypt
	// (and later re-encrypt) with the same identifier.
	const bindingId = connection?.ownerId;

	// Decrypt any encrypted tokens from the connection
	const decryptedConnection = await decryptSensitiveFields(
		connection,
		TOKEN_FIELDS,
		bindingId,
	);

	if (
		decryptedConnection.expiresAt &&
		decryptedConnection.expiresAt > now() + 60_000 &&
		decryptedConnection.accessToken
	) {
		return {
			accessToken: decryptedConnection.accessToken,
			connection: decryptedConnection,
		};
	}

	if (!decryptedConnection.refreshToken) {
		if (!decryptedConnection.accessToken) {
			throw new Error(
				`No access token stored for ${decryptedConnection.provider}.`,
			);
		}
		return {
			accessToken: decryptedConnection.accessToken,
			connection: decryptedConnection,
		};
	}

	const refreshed =
		decryptedConnection.provider === "quickbooks"
			? await quickbooksTokenRefresh(decryptedConnection.refreshToken)
			: await xeroTokenRefresh(decryptedConnection.refreshToken);

	const updated = {
		accessToken: refreshed.access_token,
		refreshToken: refreshed.refresh_token ?? decryptedConnection.refreshToken,
		expiresAt: refreshed.expires_in
			? now() + refreshed.expires_in * 1000
			: decryptedConnection.expiresAt,
	};

	// Encrypt the new tokens before storing
	const encryptedUpdated = await encryptSensitiveFields(
		{ ...updated, provider: decryptedConnection.provider },
		TOKEN_FIELDS,
		bindingId,
	);

	await ctx.runMutation(api.integrations.updateConnectionTokens, {
		provider: decryptedConnection.provider,
		accessToken: encryptedUpdated.accessToken,
		refreshToken: encryptedUpdated.refreshToken,
		expiresAt: updated.expiresAt,
	});

	return {
		accessToken: updated.accessToken,
		connection: { ...decryptedConnection, ...updated },
	};
}

async function quickbooksRequest(
	accessToken: string,
	path: string,
	init?: RequestInit,
) {
	const response = await fetch(`${quickBooksApiBase()}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: "application/json",
			"Content-Type": "application/json",
			...(init?.headers as Record<string, string> | undefined),
		},
	});

	if (!response.ok) {
		throw new Error(await response.text());
	}

	return await response.json();
}

async function xeroRequest(
	accessToken: string,
	tenantId: string,
	path: string,
	init?: RequestInit,
) {
	const response = await fetch(`https://api.xero.com/api.xro/2.0${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"xero-tenant-id": tenantId,
			Accept: "application/json",
			"Content-Type": "application/json",
			...(init?.headers as Record<string, string> | undefined),
		},
	});

	if (!response.ok) {
		throw new Error(await response.text());
	}

	return await response.json();
}

async function logSync(
	ctx: any,
	args: {
		provider: "quickbooks" | "xero";
		entityType: "invoice" | "client";
		entityId: string;
		status: "pending" | "success" | "failed" | "needs_configuration";
		requestPayload?: string;
		responsePayload?: string;
		error?: string;
	},
) {
	return await ctx.runMutation(api.integrations.recordSyncJobResult, args);
}

function resolveConnectionConfig(connection: any) {
	if (!connection?.configJson) return {};
	try {
		return JSON.parse(connection.configJson) as Record<string, string>;
	} catch {
		return {};
	}
}

function validateProviderConnection(
	provider: "quickbooks" | "xero",
	connection: any,
) {
	const errors: string[] = [];
	const config = resolveConnectionConfig(connection);

	if (!connection || connection.status !== "connected") {
		errors.push(`Connect ${provider} before syncing.`);
		return errors;
	}

	if (provider === "quickbooks" && !connection.externalAccountId) {
		errors.push("QuickBooks realm/account is missing.");
	}

	if (provider === "xero" && !config.tenantId) {
		errors.push("Xero tenant is missing.");
	}

	return errors;
}

function validateInvoiceForSync(invoice: any, provider: "quickbooks" | "xero") {
	const errors: string[] = [];

	if (!invoice.customerName?.trim()) {
		errors.push("Customer name is required before syncing an invoice.");
	}

	if (!invoice.lineItems?.length) {
		errors.push(
			"At least one line item is required before syncing an invoice.",
		);
	}

	if (!invoice.compliance?.buyer?.email) {
		errors.push("Buyer email is required before syncing an invoice.");
	}

	if (invoice.sync?.[provider]?.externalId) {
		errors.push(`This invoice is already linked to ${provider}.`);
	}

	if (invoice.compliance?.withholdingTaxAmount > 0) {
		errors.push(
			`${provider} sync currently supports gross invoice sync only. Remove WHT from the synced invoice or post the deduction separately.`,
		);
	}

	if (invoice.compliance?.warnings?.includes("manual_tax_override")) {
		errors.push(
			"Manual tax overrides must be reviewed before accounting sync.",
		);
	}

	if (invoice.compliance?.warnings?.includes("manual_wht_override")) {
		errors.push(
			"Manual WHT overrides must be reviewed before accounting sync.",
		);
	}

	if (
		invoice.compliance?.taxTreatment &&
		!["none", "exclusive_rate", "inclusive_rate", "exempt"].includes(
			invoice.compliance.taxTreatment,
		)
	) {
		errors.push(
			`${provider} sync does not support this tax treatment yet. Use standard VAT/no-tax flows for sync.`,
		);
	}

	return errors;
}

function validateClientForSync(client: any) {
	const errors: string[] = [];
	if (!client.name?.trim()) {
		errors.push("Client name is required before syncing.");
	}
	if (!client.email?.trim()) {
		errors.push("Client email is required before syncing.");
	}
	return errors;
}

export const resolveAuthenticatedIntegrationOwner = internalQuery({
	args: {},
	handler: async (ctx) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) {
			throw new Error("Workspace access required.");
		}

		return scope.userId;
	},
});

export const listConnections = query({
	args: {},
	handler: async (ctx) => {
		const viewer = await requireViewer(ctx);
		const connections = await ctx.db
			.query("integration_connections")
			.withIndex("by_ownerId", (q) => q.eq("ownerId", viewer._id))
			.collect();

		return (["quickbooks", "xero", "slack"] as const).map((provider) => {
			const connection: any =
				connections.find((entry) => entry.provider === provider) ??
				defaultConnection(viewer._id, provider);

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
	},
});

export const getConnectionSecret = query({
	args: { provider: providerValidator },
	handler: async (ctx, args) => {
		const viewer = await requireViewer(ctx);
		const connection = await ctx.db
			.query("integration_connections")
			.withIndex("by_ownerId_and_provider", (q) =>
				q.eq("ownerId", viewer._id).eq("provider", args.provider),
			)
			.first();

		// Decrypt tokens if they are encrypted
		return connection
			? await decryptSensitiveFields(connection, TOKEN_FIELDS, viewer._id)
			: connection;
	},
});

export const completeOAuthConnection = internalMutation({
	args: {
		ownerId: v.string(),
		provider: v.union(v.literal("quickbooks"), v.literal("xero")),
		externalAccountId: v.optional(v.string()),
		accessToken: v.string(),
		refreshToken: v.optional(v.string()),
		expiresAt: v.optional(v.number()),
		configJson: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query("integration_connections")
			.withIndex("by_ownerId_and_provider", (q) =>
				q.eq("ownerId", args.ownerId).eq("provider", args.provider),
			)
			.first();
		const timestamp = now();

		// Encrypt tokens before storing
		const encryptedTokens = await encryptSensitiveFields(
			{
				accessToken: args.accessToken,
				refreshToken: args.refreshToken,
			},
			TOKEN_FIELDS,
			args.ownerId,
		);

		let connectionId: Id<"integration_connections">;
		if (existing) {
			await ctx.db.patch(existing._id, {
				status: "connected",
				authType: "oauth",
				externalAccountId: args.externalAccountId,
				accessToken: encryptedTokens.accessToken,
				refreshToken: encryptedTokens.refreshToken,
				expiresAt: args.expiresAt,
				configJson: args.configJson,
				updatedAt: timestamp,
			});
			connectionId = existing._id;
		} else {
			connectionId = await ctx.db.insert("integration_connections", {
				ownerId: args.ownerId,
				provider: args.provider,
				status: "connected",
				authType: "oauth",
				externalAccountId: args.externalAccountId,
				accessToken: encryptedTokens.accessToken,
				refreshToken: encryptedTokens.refreshToken,
				expiresAt: args.expiresAt,
				configJson: args.configJson,
				createdAt: timestamp,
				updatedAt: timestamp,
			});
		}

		// Add integration audit log
		await ctx.db.insert("integration_logs", {
			ownerId: args.ownerId,
			provider: args.provider,
			level: "info",
			message: `Successfully connected ${args.provider} account.`,
			createdAt: timestamp,
		});

		await recordAuditLog(ctx, {
			workspaceId: await activeWorkspaceIdForUser(ctx, args.ownerId),
			actorId: args.ownerId,
			action: "oauth.connected",
			resourceType: "integration_connection",
			resourceId: String(connectionId),
			metadata: {
				provider: args.provider,
				externalAccountId: args.externalAccountId,
			},
		});

		return connectionId;
	},
});

export const completeOAuthConnectionAction = action({
	args: {
		provider: v.union(v.literal("quickbooks"), v.literal("xero")),
		externalAccountId: v.optional(v.string()),
		accessToken: v.string(),
		refreshToken: v.optional(v.string()),
		expiresAt: v.optional(v.number()),
		configJson: v.optional(v.string()),
	},
	handler: async (ctx, args): Promise<Id<"integration_connections">> => {
		const viewer = await requireViewer(ctx);
		if (!viewer) {
			throw new Error("Authentication required.");
		}

		const ownerId: string = await ctx.runQuery(
			internal.integrations.resolveAuthenticatedIntegrationOwner,
			{},
		);

		return await ctx.runMutation(
			internal.integrations.completeOAuthConnection,
			{
				ownerId,
				provider: args.provider,
				externalAccountId: args.externalAccountId,
				accessToken: args.accessToken,
				refreshToken: args.refreshToken,
				expiresAt: args.expiresAt,
				configJson: args.configJson,
			},
		);
	},
});

export const updateConnectionTokens = mutation({
	args: {
		provider: v.union(v.literal("quickbooks"), v.literal("xero")),
		accessToken: v.string(),
		refreshToken: v.optional(v.string()),
		expiresAt: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const viewer = await requireViewer(ctx);
		const connection = await ctx.db
			.query("integration_connections")
			.withIndex("by_ownerId_and_provider", (q) =>
				q.eq("ownerId", viewer._id).eq("provider", args.provider),
			)
			.first();
		if (!connection) {
			throw new Error("Integration connection not found.");
		}

		// Encrypt tokens before storing
		const encryptedTokens = await encryptSensitiveFields(
			{ accessToken: args.accessToken, refreshToken: args.refreshToken },
			TOKEN_FIELDS,
			viewer._id,
		);

		await ctx.db.patch(connection._id, {
			accessToken: encryptedTokens.accessToken,
			refreshToken: encryptedTokens.refreshToken,
			expiresAt: args.expiresAt,
			status: "connected",
			updatedAt: now(),
		});

		return { ok: true };
	},
});

export const upsertConnection = mutation({
	args: {
		provider: providerValidator,
		authType: v.union(
			v.literal("oauth"),
			v.literal("webhook"),
			v.literal("api_key"),
			v.literal("manual"),
		),
		externalAccountId: v.optional(v.string()),
		accessToken: v.optional(v.string()),
		refreshToken: v.optional(v.string()),
		expiresAt: v.optional(v.number()),
		webhookUrl: v.optional(v.string()),
		defaultRevenueAccount: v.optional(v.string()),
		defaultTaxCode: v.optional(v.string()),
		configJson: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const viewer = await requireViewer(ctx);
		const existing = await ctx.db
			.query("integration_connections")
			.withIndex("by_ownerId_and_provider", (q) =>
				q.eq("ownerId", viewer._id).eq("provider", args.provider),
			)
			.first();
		const timestamp = now();

		// Encrypt tokens if present
		const encryptedArgs = await encryptSensitiveFields(
			args,
			TOKEN_FIELDS,
			viewer._id,
		);

		const status =
			args.provider === "slack"
				? args.webhookUrl
					? "connected"
					: "disconnected"
				: encryptedArgs.accessToken
					? "connected"
					: "disconnected";

		if (existing) {
			await ctx.db.patch(existing._id, {
				...encryptedArgs,
				status,
				updatedAt: timestamp,
			});
			return existing._id;
		}

		return await ctx.db.insert("integration_connections", {
			ownerId: viewer._id,
			...encryptedArgs,
			status,
			createdAt: timestamp,
			updatedAt: timestamp,
		});
	},
});

export const disconnect = mutation({
	args: { provider: providerValidator },
	handler: async (ctx, args) => {
		const viewer = await requireViewer(ctx);
		const existing = await ctx.db
			.query("integration_connections")
			.withIndex("by_ownerId_and_provider", (q) =>
				q.eq("ownerId", viewer._id).eq("provider", args.provider),
			)
			.first();
		if (!existing) return { ok: true };

		await ctx.db.patch(existing._id, {
			status: "disconnected",
			accessToken: undefined,
			refreshToken: undefined,
			webhookUrl: undefined,
			expiresAt: undefined,
			updatedAt: now(),
		});

		return { ok: true };
	},
});

export const listSyncJobs = query({
	args: {},
	handler: async (ctx) => {
		const viewer = await requireViewer(ctx);
		return await ctx.db
			.query("integration_sync_jobs")
			.withIndex("by_ownerId", (q) => q.eq("ownerId", viewer._id))
			.order("desc")
			.collect();
	},
});

export const listLogs = query({
	args: {},
	handler: async (ctx) => {
		const viewer = await requireViewer(ctx);
		return await ctx.db
			.query("integration_logs")
			.withIndex("by_ownerId", (q) => q.eq("ownerId", viewer._id))
			.order("desc")
			.collect();
	},
});

export const recordSyncJobResult = mutation({
	args: {
		provider: v.union(v.literal("quickbooks"), v.literal("xero")),
		entityType: v.union(v.literal("invoice"), v.literal("client")),
		entityId: v.string(),
		status: v.union(
			v.literal("pending"),
			v.literal("success"),
			v.literal("failed"),
			v.literal("needs_configuration"),
		),
		requestPayload: v.optional(v.string()),
		responsePayload: v.optional(v.string()),
		error: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const viewer = await requireViewer(ctx);
		const timestamp = now();

		const jobId = await ctx.db.insert("integration_sync_jobs", {
			ownerId: viewer._id,
			provider: args.provider,
			entityType: args.entityType,
			entityId: args.entityId,
			direction: "push",
			status: args.status,
			requestPayload: args.requestPayload,
			responsePayload: args.responsePayload,
			error: args.error,
			retryCount: 0,
			lastAttemptAt: timestamp,
			createdAt: timestamp,
			updatedAt: timestamp,
		});

		await ctx.db.insert("integration_logs", {
			ownerId: viewer._id,
			provider: args.provider,
			level: args.status === "success" ? "info" : "error",
			message:
				args.status === "success"
					? `${args.entityType} sync completed.`
					: (args.error ?? `${args.entityType} sync failed.`),
			entityType: args.entityType,
			entityId: args.entityId,
			createdAt: timestamp,
		});

		await recordAuditLog(ctx, {
			workspaceId: await activeWorkspaceIdForUser(ctx, viewer._id),
			actorId: viewer._id,
			action: "integration.synced",
			resourceType: args.entityType,
			resourceId: args.entityId,
			result: args.status === "success" ? "success" : "failure",
			message:
				args.status === "success"
					? `${args.provider} sync completed.`
					: (args.error ?? `${args.provider} sync failed.`),
			metadata: { provider: args.provider, status: args.status },
		});

		return { jobId };
	},
});

export const updateInvoiceSyncState = mutation({
	args: {
		invoiceId: v.id("invoices"),
		provider: v.union(v.literal("quickbooks"), v.literal("xero")),
		status: v.union(
			v.literal("idle"),
			v.literal("pending"),
			v.literal("success"),
			v.literal("failed"),
			v.literal("needs_configuration"),
		),
		externalId: v.optional(v.string()),
		lastError: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const { invoice } = await requireWritableInvoice(ctx, args.invoiceId);

		await ctx.db.patch(args.invoiceId, {
			sync: {
				...(invoice.sync ?? {
					quickbooks: { status: "idle" },
					xero: { status: "idle" },
					slack: { status: "idle" },
				}),
				[args.provider]: {
					...(invoice.sync?.[args.provider] ?? { status: "idle" }),
					status: args.status,
					externalId: args.externalId,
					lastError: args.lastError,
					lastSyncedAt: now(),
				},
			},
			updatedAt: now(),
		});

		return { ok: true };
	},
});

export const retrySyncJob = mutation({
	args: { jobId: v.id("integration_sync_jobs") },
	handler: async (ctx, args) => {
		const viewer = await requireViewer(ctx);
		const job = await ctx.db.get(args.jobId);
		if (!job || job.ownerId !== viewer._id) {
			throw new Error("Sync job not found.");
		}

		await ctx.db.patch(args.jobId, {
			status: "pending",
			retryCount: job.retryCount + 1,
			updatedAt: now(),
		});

		return { ok: true };
	},
});

async function ensureQuickBooksCustomer(
	accessToken: string,
	realmId: string,
	customerName: string,
	customerEmail?: string,
) {
	const query = `select * from Customer where DisplayName = '${customerName.replace(/'/g, "\\'")}'`;
	const result = await quickbooksRequest(
		accessToken,
		`/v3/company/${realmId}/query?query=${encodeURIComponent(query)}`,
		{ method: "GET" },
	);

	const existing = result?.QueryResponse?.Customer?.[0];
	if (existing?.Id) return existing.Id as string;

	const created = await quickbooksRequest(
		accessToken,
		`/v3/company/${realmId}/customer`,
		{
			method: "POST",
			body: JSON.stringify({
				DisplayName: customerName,
				PrimaryEmailAddr: customerEmail
					? { Address: customerEmail }
					: undefined,
			}),
		},
	);

	return created?.Customer?.Id as string;
}

async function createQuickBooksInvoice(
	accessToken: string,
	realmId: string,
	invoice: any,
) {
	const customerId = await ensureQuickBooksCustomer(
		accessToken,
		realmId,
		invoice.customerName,
		invoice.compliance?.buyer?.email,
	);

	const payload = {
		DocNumber: invoice.invoiceNumber,
		TxnDate: invoice.issueDate,
		DueDate: invoice.dueDate,
		CustomerRef: {
			value: customerId,
		},
		GlobalTaxCalculation:
			invoice.compliance?.taxTreatment === "inclusive_rate"
				? "TaxInclusive"
				: "TaxExcluded",
		Line: invoice.lineItems.map((line: any) => ({
			Amount: Math.round(line.quantity * line.price * 100) / 100,
			Description: line.name,
			DetailType: "SalesItemLineDetail",
			SalesItemLineDetail: {
				Qty: line.quantity,
				UnitPrice: line.price,
			},
		})),
	};

	const response = await quickbooksRequest(
		accessToken,
		`/v3/company/${realmId}/invoice`,
		{
			method: "POST",
			body: JSON.stringify(payload),
		},
	);

	return { payload, response };
}

async function createQuickBooksClient(
	accessToken: string,
	realmId: string,
	client: any,
) {
	const payload = {
		DisplayName: client.name,
		PrimaryEmailAddr: client.email ? { Address: client.email } : undefined,
		CompanyName: client.company ?? undefined,
		PrimaryPhone: client.phone ? { FreeFormNumber: client.phone } : undefined,
		WebAddr: client.website ? { URI: client.website } : undefined,
	};
	const response = await quickbooksRequest(
		accessToken,
		`/v3/company/${realmId}/customer`,
		{
			method: "POST",
			body: JSON.stringify(payload),
		},
	);
	return { payload, response };
}

async function ensureXeroContact(
	accessToken: string,
	tenantId: string,
	client: any,
) {
	const payload = {
		Contacts: [
			{
				Name: client.name,
				EmailAddress: client.email ?? undefined,
				Phones: client.phone
					? [{ PhoneType: "DEFAULT", PhoneNumber: client.phone }]
					: undefined,
			},
		],
	};
	const response = await xeroRequest(accessToken, tenantId, "/Contacts", {
		method: "POST",
		body: JSON.stringify(payload),
	});
	const contact = response?.Contacts?.[0];
	return {
		payload,
		response,
		contactId: contact?.ContactID as string | undefined,
	};
}

async function createXeroInvoice(
	accessToken: string,
	tenantId: string,
	invoice: any,
) {
	const contactResult = await ensureXeroContact(accessToken, tenantId, {
		name: invoice.customerName,
		email: invoice.compliance?.buyer?.email,
		phone: invoice.compliance?.buyer?.phone,
	});

	const payload = {
		Invoices: [
			{
				Type: "ACCREC",
				Contact: {
					ContactID: contactResult.contactId,
				},
				Date: invoice.issueDate,
				DueDate: invoice.dueDate,
				InvoiceNumber: invoice.invoiceNumber,
				LineAmountTypes:
					invoice.compliance?.taxTreatment === "inclusive_rate"
						? "Inclusive"
						: "Exclusive",
				Status: "AUTHORISED",
				LineItems: invoice.lineItems.map((line: any) => ({
					Description: line.name,
					Quantity: line.quantity,
					UnitAmount: line.price,
					TaxType: "OUTPUT",
				})),
			},
		],
	};

	const response = await xeroRequest(accessToken, tenantId, "/Invoices", {
		method: "POST",
		body: JSON.stringify(payload),
	});

	return { payload, response };
}

async function createXeroClient(
	accessToken: string,
	tenantId: string,
	client: any,
) {
	return await ensureXeroContact(accessToken, tenantId, client);
}

export const syncInvoiceLive = action({
	args: {
		invoiceId: v.id("invoices"),
		provider: v.union(v.literal("quickbooks"), v.literal("xero")),
	},
	handler: async (
		ctx,
		args,
	): Promise<{ ok: boolean; externalId?: string; error?: string }> => {
		const connection = (await ctx.runQuery(
			api.integrations.getConnectionSecret,
			{
				provider: args.provider,
			},
		)) as any;
		const invoice = (await ctx.runQuery(api.invoices.getById, {
			id: args.invoiceId,
		})) as any;

		const connectionErrors = validateProviderConnection(
			args.provider,
			connection,
		);
		if (connectionErrors.length > 0) {
			await logSync(ctx, {
				provider: args.provider,
				entityType: "invoice",
				entityId: String(args.invoiceId),
				status: "needs_configuration",
				error: connectionErrors.join(" "),
			});
			return { ok: false, error: connectionErrors.join(" ") };
		}

		if (!invoice) {
			throw new Error("Invoice not found.");
		}

		const validationErrors = validateInvoiceForSync(invoice, args.provider);
		if (validationErrors.length > 0) {
			const error = validationErrors.join(" ");
			await logSync(ctx, {
				provider: args.provider,
				entityType: "invoice",
				entityId: String(args.invoiceId),
				status: "needs_configuration",
				error,
			});
			await ctx.runMutation(api.integrations.updateInvoiceSyncState, {
				invoiceId: args.invoiceId,
				provider: args.provider,
				status: "needs_configuration",
				lastError: error,
			});
			return { ok: false, error };
		}

		try {
			const { accessToken, connection: freshConnection } =
				await ensureConnectionAccess(ctx, connection);
			const realmId = freshConnection.externalAccountId;
			const config = resolveConnectionConfig(freshConnection);

			const result: any =
				args.provider === "quickbooks"
					? await createQuickBooksInvoice(accessToken, realmId, invoice)
					: await createXeroInvoice(accessToken, config.tenantId, invoice);

			const externalId: string | undefined =
				args.provider === "quickbooks"
					? result.response?.Invoice?.Id
					: result.response?.Invoices?.[0]?.InvoiceID;

			await logSync(ctx, {
				provider: args.provider,
				entityType: "invoice",
				entityId: String(args.invoiceId),
				status: "success",
				requestPayload: JSON.stringify(
					{
						providerPayload: result.payload,
						complianceSnapshot: invoice.compliance ?? null,
					},
					null,
					2,
				),
				responsePayload: JSON.stringify(result.response, null, 2),
			});
			await ctx.runMutation(api.integrations.updateInvoiceSyncState, {
				invoiceId: args.invoiceId,
				provider: args.provider,
				status: "success",
				externalId,
			});

			return { ok: true, externalId, error: undefined };
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Unknown sync error";
			await logSync(ctx, {
				provider: args.provider,
				entityType: "invoice",
				entityId: String(args.invoiceId),
				status: "failed",
				error: message,
			});
			await ctx.runMutation(api.integrations.updateInvoiceSyncState, {
				invoiceId: args.invoiceId,
				provider: args.provider,
				status: "failed",
				lastError: message,
			});
			return { ok: false, error: message };
		}
	},
});

export const syncClientLive = action({
	args: {
		clientId: v.id("clients"),
		provider: v.union(v.literal("quickbooks"), v.literal("xero")),
	},
	handler: async (ctx, args) => {
		const [connection, client] = await Promise.all([
			ctx.runQuery(api.integrations.getConnectionSecret, {
				provider: args.provider,
			}),
			ctx.runQuery(api.clients.getById, { id: args.clientId }),
		]);

		const connectionErrors = validateProviderConnection(
			args.provider,
			connection,
		);
		if (connectionErrors.length > 0) {
			await logSync(ctx, {
				provider: args.provider,
				entityType: "client",
				entityId: String(args.clientId),
				status: "needs_configuration",
				error: connectionErrors.join(" "),
			});
			return { ok: false, error: connectionErrors.join(" ") };
		}

		if (!client) {
			throw new Error("Client not found.");
		}

		const validationErrors = validateClientForSync(client);
		if (validationErrors.length > 0) {
			const error = validationErrors.join(" ");
			await logSync(ctx, {
				provider: args.provider,
				entityType: "client",
				entityId: String(args.clientId),
				status: "needs_configuration",
				error,
			});
			return { ok: false, error };
		}

		try {
			const { accessToken, connection: freshConnection } =
				await ensureConnectionAccess(ctx, connection);
			const config = resolveConnectionConfig(freshConnection);
			const result =
				args.provider === "quickbooks"
					? await createQuickBooksClient(
							accessToken,
							freshConnection.externalAccountId,
							client,
						)
					: await createXeroClient(accessToken, config.tenantId, client);

			await logSync(ctx, {
				provider: args.provider,
				entityType: "client",
				entityId: String(args.clientId),
				status: "success",
				requestPayload: JSON.stringify(result.payload, null, 2),
				responsePayload: JSON.stringify(result.response, null, 2),
			});

			return { ok: true, error: undefined };
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Unknown sync error";
			await logSync(ctx, {
				provider: args.provider,
				entityType: "client",
				entityId: String(args.clientId),
				status: "failed",
				error: message,
			});
			return { ok: false, error: message };
		}
	},
});
