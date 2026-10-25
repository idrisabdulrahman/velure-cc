import dns from "node:dns";

// The ngrok tunnel advertises IPv6 AAAA records, but this machine has no IPv6
// route — undici's Happy Eyeballs hangs on the IPv6 attempt. Force IPv4 first.
dns.setDefaultResultOrder("ipv4first");

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	disconnect,
	getConnectionSecret,
	listConnections,
	listLogs,
	listSyncJobs,
	recordSyncJobResult,
	retrySyncJob,
	updateConnectionTokens,
	updateInvoiceSyncState,
	upsertConnection,
} from "./integrations";
import {
	autosaveDraft,
	getById as getInvoiceById,
	save,
	updateStatus,
} from "./invoices";
import { ensureWorkspaceForUser, type Supabase } from "./workspaces";

// The browser writes audit rows through POST /api/invoice/audit; this gate
// runs in Node with no web origin, so route that transport to the real
// server-only audit service — the same write the gate exercised before the
// G1 browser/server split. The HTTP boundary itself is covered by
// audit.test.ts and src/routes/api/invoice/-audit.test.ts.
vi.mock("#/server/data/audit-client", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("#/server/data/audit-client")>();
	const { recordInvoiceAudit } = await import("#/server/data/audit");
	return { ...original, recordInvoiceAudit };
});

/**
 * A10 live gate for the integrations domain — REAL velure-cc.
 *
 * Run with: A10_LIVE=1 SUPABASE_MANAGEMENT_TOKEN=… ISSUER_URL=… pnpm exec
 * vitest run src/server/data/integrations.live.test.ts
 * Skipped (green, no-op) under plain `pnpm test`.
 *
 * Two surfaces, both proven end to end:
 *  1. integration_sync_jobs / integration_logs / invoices are client-granted
 *     with owner-access RLS — exercised through the real OIDC JWT user client
 *     (record result, list jobs/logs, retry, invoice sync state, zero
 *     cross-workspace rows).
 *  2. integration_connections has NO client grants by design (server-only,
 *     phase_a9). The connection functions are proven with a SERVICE-ROLE
 *     client: upsert Slack + Xero (tokens AES-GCM encrypted at rest),
 *     listConnections / getConnectionSecret (decrypt round-trip),
 *     updateConnectionTokens, disconnect. Owner scoping is enforced by the
 *     module's explicit owner_id filters, since RLS is bypassed.
 *
 * Scratch artifacts are removed in afterAll; real data is never touched.
 */
const LIVE = process.env.A10_LIVE === "1";

const REF = "kbexydkmmfabfutgkbxn";
const API = `https://${REF}.supabase.co`;
const MGMT = "https://api.supabase.com";
const ISSUER_URL = process.env.ISSUER_URL ?? "";
const PROVIDER_IDENTIFIER = "custom:velure";
const CLIENT_SECRET =
	process.env.CLIENT_SECRET ?? "velure-supabase-client-secret-prod";

const suffix = `${Date.now()}`;
const EMAIL_A = `a10-int-a-${suffix}@gmail.com`;
const EMAIL_B = `a10-int-b-${suffix}@gmail.com`;
const PASSWORD = "A10BridgePass-2026!";

let mgmtToken = "";
let anonKey = "";
let serviceKey = "";
let providerPreExisted = false;
let userA: { issuerUserId: string; jwt: string } | null = null;
let userB: { issuerUserId: string; jwt: string } | null = null;
let invoiceAId: string | null = null;

function decodeJwt(token: string) {
	return JSON.parse(
		Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
	) as Record<string, unknown>;
}

function makeCookieJar() {
	const cookies = new Map<string, string>();
	return {
		store(res: Response) {
			for (const c of res.headers.getSetCookie?.() ?? []) {
				const [pair, ...rest] = c.split(";");
				const [k, ...v] = pair.split("=");
				const key = k.trim();
				const value = v.join("=").trim();
				const isExpired = rest.some((p) =>
					p.trim().toLowerCase().startsWith("max-age=0"),
				);
				if (isExpired || value === "") cookies.delete(key);
				else cookies.set(key, value);
			}
		},
		header() {
			return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
		},
	};
}

async function withRetry<T>(
	fn: () => Promise<T>,
	label: string,
	attempts = 6,
): Promise<T> {
	let lastErr: unknown;
	for (let i = 0; i < attempts; i += 1) {
		try {
			return await fn();
		} catch (error) {
			lastErr = error;
			console.error(
				`retry ${label} ${i + 1}/${attempts}: ${(error as Error).message}`,
			);
			await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
		}
	}
	throw lastErr;
}

async function mgmtSql(query: string, attempts = 3) {
	let lastErr: unknown;
	for (let i = 0; i < attempts; i += 1) {
		try {
			const res = await fetch(`${MGMT}/v1/projects/${REF}/database/query`, {
				method: "POST",
				headers: {
					authorization: `Bearer ${mgmtToken}`,
					"content-type": "application/json",
				},
				body: JSON.stringify({ query }),
			});
			const text = await res.text();
			if (!res.ok)
				throw new Error(`mgmt SQL failed: ${res.status} ${text.slice(0, 300)}`);
			try {
				return JSON.parse(text);
			} catch {
				return text;
			}
		} catch (error) {
			lastErr = error;
			await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
		}
	}
	throw lastErr;
}

async function followRedirects(
	url: string,
	jar: ReturnType<typeof makeCookieJar>,
	{ headers = {} }: { headers?: Record<string, string> } = {},
	hops = 0,
): Promise<{ handoff?: string; url: string }> {
	const res = await fetch(url, {
		headers: { ...headers, cookie: jar.header() },
		redirect: "manual",
	});
	jar.store(res);
	const location = res.headers.get("location");
	let jsonRedirect: string | null = null;
	if (
		res.status === 200 &&
		res.headers.get("content-type")?.includes("application/json")
	) {
		try {
			const parsed = (await res.clone().json()) as {
				redirect?: boolean;
				url?: string;
			};
			if (parsed?.redirect === true && parsed.url) jsonRedirect = parsed.url;
		} catch {
			/* not a JSON redirect */
		}
	}
	const nextUrl =
		res.status >= 300 && res.status < 400 && location ? location : jsonRedirect;
	if (nextUrl) {
		const next = new URL(nextUrl, url);
		const host = next.hostname;
		const inFlow =
			host.endsWith("supabase.co") || host === new URL(ISSUER_URL).hostname;
		if (!inFlow) return { handoff: next.toString(), url };
		if (hops > 8) throw new Error("too many redirects");
		return followRedirects(next.toString(), jar, { headers }, hops + 1);
	}
	return { url };
}

async function oidcSignIn(email: string) {
	const jar = makeCookieJar();
	const signup = await fetch(`${ISSUER_URL}/sign-up/email`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			email,
			password: PASSWORD,
			name: email.split("@")[0],
		}),
		redirect: "manual",
	});
	if (signup.status !== 200)
		throw new Error(`issuer sign-up: ${signup.status} ${await signup.text()}`);
	jar.store(signup);
	const signupBody = (await signup.json()) as { user?: { id: string } };
	const issuerUserId = signupBody.user?.id;
	if (!issuerUserId)
		throw new Error(`no user id in sign-up response for ${email}`);

	const verify = await fetch(`${ISSUER_URL}/__dev/verify-email`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-dev-token": "dev-secret-2026",
		},
		body: JSON.stringify({ email }),
	});
	if (verify.status === 404) {
		await mgmtSql(
			`update better_auth."user" set "emailVerified" = true where "email" = '${email}' and "emailVerified" = false;`,
		);
	} else if (verify.status !== 200) {
		throw new Error(`verify-email: ${verify.status}`);
	}

	const signin = await fetch(`${ISSUER_URL}/sign-in/email`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email, password: PASSWORD }),
		redirect: "manual",
	});
	if (signin.status !== 200)
		throw new Error(`issuer sign-in: ${signin.status} ${await signin.text()}`);
	jar.store(signin);

	const { handoff } = await followRedirects(
		`${API}/auth/v1/authorize?provider=${PROVIDER_IDENTIFIER}`,
		jar,
		{ headers: { apikey: anonKey } },
	);
	const fragment = handoff ? new URL(handoff).hash : "";
	const params = new URLSearchParams(fragment.replace(/^#/, ""));
	const token = params.get("access_token");
	if (!token)
		throw new Error(`no access_token in handoff: ${handoff?.slice(0, 200)}`);
	const decoded = decodeJwt(token);
	if (decoded.velure_user_id !== issuerUserId) {
		throw new Error(
			`velure_user_id claim missing (got ${String(decoded.velure_user_id ?? "null")})`,
		);
	}
	return { issuerUserId, jwt: token };
}

async function ensureProvider() {
	const list = await fetch(`${API}/auth/v1/admin/custom-providers`, {
		headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
	});
	const listBody = (await list.json()) as {
		providers?: { identifier: string }[];
	};
	const existing = (listBody.providers ?? []).find(
		(p) => p.identifier === PROVIDER_IDENTIFIER,
	);
	if (existing) {
		providerPreExisted = true;
		return;
	}
	const res = await fetch(`${API}/auth/v1/admin/custom-providers`, {
		method: "POST",
		headers: {
			apikey: serviceKey,
			authorization: `Bearer ${serviceKey}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			provider_type: "oidc",
			identifier: PROVIDER_IDENTIFIER,
			name: "Velure (A10 integrations gate)",
			client_id: "velure-supabase-client",
			client_secret: CLIENT_SECRET,
			issuer: ISSUER_URL,
			scopes: ["openid", "profile", "email"],
		}),
	});
	if (!res.ok)
		throw new Error(`register provider: ${res.status} ${await res.text()}`);
}

function userScopedClient(jwt: string): Supabase {
	return createSupabaseClient(API, anonKey, {
		global: {
			headers: { Authorization: `Bearer ${jwt}` },
		},
		auth: {
			autoRefreshToken: false,
			detectSessionInUrl: false,
			persistSession: false,
		},
	});
}

function serviceRoleClient(): Supabase {
	return createSupabaseClient(API, serviceKey, {
		auth: {
			autoRefreshToken: false,
			detectSessionInUrl: false,
			persistSession: false,
		},
	});
}

async function fetchKeys() {
	const res = await fetch(`${MGMT}/v1/projects/${REF}/api-keys`, {
		headers: { authorization: `Bearer ${mgmtToken}` },
	});
	if (!res.ok) throw new Error(`api-keys: ${res.status} ${await res.text()}`);
	const keys = (await res.json()) as { name: string; api_key: string }[];
	const anon = keys.find((k) => k.name === "anon")?.api_key;
	const service = keys.find((k) => k.name === "service_role")?.api_key;
	if (!anon || !service)
		throw new Error("anon/service_role keys not found via management API");
	return { anon, service };
}

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (days: number) =>
	new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

describe.skipIf(!LIVE)("A10 integrations domain (live velure-cc)", () => {
	beforeAll(async () => {
		mgmtToken = process.env.SUPABASE_MANAGEMENT_TOKEN ?? "";
		if (!mgmtToken) throw new Error("SUPABASE_MANAGEMENT_TOKEN is required");
		if (!ISSUER_URL) throw new Error("ISSUER_URL is required");
		const keys = await withRetry(fetchKeys, "fetchKeys");
		anonKey = keys.anon;
		serviceKey = keys.service;
		await withRetry(ensureProvider, "ensureProvider");
		userA = await withRetry(
			() => oidcSignIn(EMAIL_A),
			`oidcSignIn(${EMAIL_A})`,
		);
		userB = await withRetry(
			() => oidcSignIn(EMAIL_B),
			`oidcSignIn(${EMAIL_B})`,
		);
	}, 120_000);

	afterAll(async () => {
		const ids = [userA?.issuerUserId, userB?.issuerUserId]
			.filter((id): id is string => Boolean(id))
			.map((id) => `'${id}'`)
			.join(", ");
		const emails = [EMAIL_A, EMAIL_B].map((e) => `'${e}'`).join(", ");
		if (ids) {
			try {
				await mgmtSql(`
					delete from public.integration_webhooks where owner_id in (${ids});
					delete from public.integration_logs where owner_id in (${ids});
					delete from public.integration_sync_jobs where owner_id in (${ids});
					delete from public.integration_connections where owner_id in (${ids});
					delete from public.reminder_events where owner_id in (${ids});
					delete from public.collections_cases where owner_id in (${ids});
					delete from public.reminder_rules where owner_id in (${ids});
					delete from public.payment_transactions where workspace_id in (
						select w.id from public.workspaces w where w.owner_id in (${ids})
					);
					delete from public.invoice_delivery_events where workspace_id in (
						select w.id from public.workspaces w where w.owner_id in (${ids})
					);
					delete from public.invoices where workspace_id in (
						select w.id from public.workspaces w where w.owner_id in (${ids})
					);
					delete from public.clients where workspace_id in (
						select w.id from public.workspaces w where w.owner_id in (${ids})
					);
					delete from public.active_workspaces where user_id in (${ids});
					delete from public.workspace_members where user_id in (${ids});
					delete from public.workspaces where owner_id in (${ids});
					delete from better_auth."user" where "email" in (${emails});
				`);
			} catch (error) {
				console.error(
					"cleanup: scratch rows failed:",
					(error as Error).message,
				);
			}
		}
		if (!providerPreExisted) {
			try {
				const res = await fetch(
					`${API}/auth/v1/admin/custom-providers/${PROVIDER_IDENTIFIER}`,
					{
						method: "DELETE",
						headers: {
							apikey: serviceKey,
							authorization: `Bearer ${serviceKey}`,
						},
					},
				);
				console.log(`cleanup: delete provider -> ${res.status}`);
			} catch (error) {
				console.error("cleanup: provider failed:", (error as Error).message);
			}
		}
		try {
			const adminList = await fetch(
				`${API}/auth/v1/admin/users?page=1&per_page=200`,
				{
					headers: {
						apikey: serviceKey,
						authorization: `Bearer ${serviceKey}`,
					},
				},
			);
			const adminBody = (await adminList.json()) as {
				users?: { id: string; email: string }[];
			};
			for (const u of adminBody.users ?? []) {
				if (u.email === EMAIL_A || u.email === EMAIL_B) {
					const res = await fetch(`${API}/auth/v1/admin/users/${u.id}`, {
						method: "DELETE",
						headers: {
							apikey: serviceKey,
							authorization: `Bearer ${serviceKey}`,
						},
					});
					console.log(`cleanup: delete auth user ${u.email} -> ${res.status}`);
				}
			}
		} catch (error) {
			console.error("cleanup: auth users failed:", (error as Error).message);
		}
	}, 120_000);

	it("bootstraps workspaces for both users through the authenticated RLS path", async () => {
		const clientA = userScopedClient(userA!.jwt);
		const ctxA = await ensureWorkspaceForUser(clientA, userA!.issuerUserId, {
			businessName: `A10 INT W1 ${suffix}`,
		});
		expect(ctxA).not.toBeNull();

		const clientB = userScopedClient(userB!.jwt);
		const ctxB = await ensureWorkspaceForUser(clientB, userB!.issuerUserId, {
			businessName: `A10 INT W2 ${suffix}`,
		});
		expect(ctxB).not.toBeNull();
	}, 60_000);

	it("(server-only) connects Slack + Xero via service role with encrypted tokens", async () => {
		const client = serviceRoleClient();
		const slackId = await upsertConnection(client, userA!.issuerUserId, {
			provider: "slack",
			authType: "webhook",
			webhookUrl: `https://hooks.slack.com/services/T00/B00-${suffix}`,
		});
		expect(slackId).toBeTruthy();

		const xeroId = await upsertConnection(client, userA!.issuerUserId, {
			provider: "xero",
			authType: "oauth",
			externalAccountId: `xero-${suffix}`,
			accessToken: "xero-access-token-a",
			refreshToken: "xero-refresh-token-a",
			expiresAt: Date.now() + 30 * 60 * 1000,
			configJson: JSON.stringify({ tenantId: "Xero Tenant A" }),
		});
		expect(xeroId).toBeTruthy();

		const connections = await listConnections(client, userA!.issuerUserId);
		const slack = connections.find((c) => c.provider === "slack");
		const xero = connections.find((c) => c.provider === "xero");
		expect(slack?.status).toBe("connected");
		expect(slack?.webhookUrlConfigured).toBe(true);
		expect(xero?.status).toBe("connected");
		expect(xero?.externalAccountId).toBe(`xero-${suffix}`);
		expect(xero?.accountName).toBe("Xero Tenant A");
	}, 60_000);

	it("(server-only) decrypts tokens, updates them, and disconnects", async () => {
		const client = serviceRoleClient();
		const secret = await getConnectionSecret(
			client,
			userA!.issuerUserId,
			"xero",
		);
		expect(secret).not.toBeNull();
		expect(secret!.accessToken).toBe("xero-access-token-a");
		expect(secret!.refreshToken).toBe("xero-refresh-token-a");

		await updateConnectionTokens(client, userA!.issuerUserId, {
			provider: "xero",
			accessToken: "xero-access-token-b",
			refreshToken: "xero-refresh-token-b",
			expiresAt: Date.now() + 60 * 60 * 1000,
		});
		const secretB = await getConnectionSecret(
			client,
			userA!.issuerUserId,
			"xero",
		);
		expect(secretB!.accessToken).toBe("xero-access-token-b");

		await disconnect(client, userA!.issuerUserId, "xero");
		const after = await listConnections(client, userA!.issuerUserId);
		expect(after.find((c) => c.provider === "xero")?.status).toBe(
			"disconnected",
		);
	}, 60_000);

	it("records a sync job + log and retries it (RLS-pure)", async () => {
		const clientA = userScopedClient(userA!.jwt);
		const { jobId } = await recordSyncJobResult(clientA, userA!.issuerUserId, {
			provider: "quickbooks",
			entityType: "invoice",
			entityId: `inv-${suffix}`,
			status: "failed",
			error: "QB API 401",
		});
		expect(jobId).toBeTruthy();

		const jobs = await listSyncJobs(clientA);
		expect(jobs.some((j) => j._id === jobId && j.status === "failed")).toBe(
			true,
		);
		const logs = await listLogs(clientA);
		expect(logs.some((l) => l.message === "QB API 401")).toBe(true);

		await retrySyncJob(clientA, jobId);
		const jobsAfter = await listSyncJobs(clientA);
		const job = jobsAfter.find((j) => j._id === jobId);
		expect(job?.status).toBe("pending");
		expect(job?.retryCount).toBe(1);
	}, 60_000);

	it("updates invoice sync state on A's invoice (RLS-pure)", async () => {
		const clientA = userScopedClient(userA!.jwt);
		const draft = await autosaveDraft(clientA, userA!.issuerUserId, {
			token: `pub-${crypto.randomUUID()}`,
			invoiceNumber: "",
			customerName: "Sync Co",
			currency: "NGN",
			issueDate: today(),
			dueDate: inDays(30),
			lineItems: [{ id: "li-1", name: "Retainer", quantity: 1, price: 50000 }],
			compliance: { buyer: { email: `sync-${suffix}@example.com` } },
		});
		const full = await getInvoiceById(clientA, userA!.issuerUserId, draft.id);
		if (!full) throw new Error("draft not found");
		await save(clientA, userA!.issuerUserId, {
			id: full.id,
			token: full.token,
			documentType: "standard",
			invoiceNumber: full.invoiceNumber,
			customerName: "Sync Co",
			currency: "NGN",
			type: "one-time",
			invoiceSize: "A4",
			dateFormat: "ng",
			paymentTermsDays: 14,
			template: "Default",
			issueDate: today(),
			dueDate: inDays(30),
			lineItems: full.lineItems,
			compliance: { buyer: { email: `sync-${suffix}@example.com` } },
		});
		await updateStatus(clientA, userA!.issuerUserId, {
			id: full.id,
			status: "unpaid",
		});
		invoiceAId = full.id;

		await updateInvoiceSyncState(clientA, userA!.issuerUserId, {
			invoiceId: invoiceAId!,
			provider: "quickbooks",
			status: "success",
			externalId: "qb-12345",
		});
		const invoice = await getInvoiceById(
			clientA,
			userA!.issuerUserId,
			invoiceAId!,
		);
		const sync = (invoice!.sync as Record<string, unknown>)
			.quickbooks as Record<string, unknown>;
		expect(sync.status).toBe("success");
		expect(sync.externalId).toBe("qb-12345");
	}, 60_000);

	it("zero cross-workspace reads — A never sees B's rows", async () => {
		const clientB = userScopedClient(userB!.jwt);
		await recordSyncJobResult(clientB, userB!.issuerUserId, {
			provider: "xero",
			entityType: "client",
			entityId: `cli-${suffix}`,
			status: "success",
		});

		const clientA = userScopedClient(userA!.jwt);
		const jobs = await listSyncJobs(clientA);
		expect(jobs.some((j) => j.entityId === `cli-${suffix}`)).toBe(false);
		const logs = await listLogs(clientA);
		expect(logs.some((l) => l.entityId === `cli-${suffix}`)).toBe(false);

		// Service-role reads must stay owner-scoped via the explicit owner_id
		// filter (RLS is bypassed for service role). B connects their own Slack;
		// A's read must return A's webhook, never B's.
		const service = serviceRoleClient();
		await upsertConnection(service, userB!.issuerUserId, {
			provider: "slack",
			authType: "webhook",
			webhookUrl: `https://hooks.slack.com/services/T99/B99-${suffix}`,
		});
		const secretA = await getConnectionSecret(
			service,
			userA!.issuerUserId,
			"slack",
		);
		expect(secretA?.webhookUrl).toBe(
			`https://hooks.slack.com/services/T00/B00-${suffix}`,
		);
		const secretB = await getConnectionSecret(
			service,
			userB!.issuerUserId,
			"slack",
		);
		expect(secretB?.webhookUrl).toBe(
			`https://hooks.slack.com/services/T99/B99-${suffix}`,
		);
	}, 60_000);
});
