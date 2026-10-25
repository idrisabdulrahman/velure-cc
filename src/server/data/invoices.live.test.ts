import dns from "node:dns";

// The ngrok tunnel advertises IPv6 AAAA records, but this machine has no IPv6
// route — undici's Happy Eyeballs hangs on the IPv6 attempt. Force IPv4 first.
dns.setDefaultResultOrder("ipv4first");

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient as createClientRecord } from "./clients";
import {
	autosaveDraft,
	bulkDeleteOrArchive,
	convertProformaToInvoice,
	createDraft,
	duplicate,
	getById,
	getByToken,
	importCsv,
	list,
	listPage,
	remove,
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
 * A10 live gate for the invoices domain — REAL OIDC JWT + REAL velure-cc.
 *
 * Run with: A10_LIVE=1 SUPABASE_MANAGEMENT_TOKEN=… ISSUER_URL=… pnpm exec
 * vitest run src/server/data/invoices.live.test.ts
 * Skipped (green, no-op) under plain `pnpm test`.
 *
 * Proves the ported module is RLS-pure end to end: user A bootstraps a
 * workspace and runs the full invoice workflow (draft -> save -> status
 * transitions -> duplicate -> proforma conversion -> CSV import -> cleanup)
 * through the authenticated path; user B creates their own workspace +
 * invoice; A's reads return zero of B's rows. Scratch artifacts are removed
 * in afterAll; real data is never touched.
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
const EMAIL_A = `a10-inv-a-${suffix}@gmail.com`;
const EMAIL_B = `a10-inv-b-${suffix}@gmail.com`;
const PASSWORD = "A10BridgePass-2026!";

let mgmtToken = "";
let anonKey = "";
let serviceKey = "";
let providerPreExisted = false;
let userA: { issuerUserId: string; jwt: string } | null = null;
let userB: { issuerUserId: string; jwt: string } | null = null;
let draftAId: string | null = null;
let customerAId: string | null = null;

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
			name: "Velure (A10 invoices gate)",
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

function draftInput(customerName: string, price = 250000) {
	return {
		token: `pub-${crypto.randomUUID()}`,
		invoiceNumber: "",
		customerName,
		currency: "NGN",
		issueDate: today(),
		dueDate: inDays(30),
		lineItems: [{ id: "li-1", name: "Consulting", quantity: 1, price }],
		compliance: {
			buyer: { email: `${customerName.toLowerCase()}@example.com` },
		},
	};
}

describe.skipIf(!LIVE)("A10 invoices domain (live velure-cc)", () => {
	beforeAll(async () => {
		mgmtToken = process.env.SUPABASE_MANAGEMENT_TOKEN ?? "";
		if (!mgmtToken) throw new Error("SUPABASE_MANAGEMENT_TOKEN is required");
		if (!ISSUER_URL) throw new Error("ISSUER_URL is required");
		const keys = await fetchKeys();
		anonKey = keys.anon;
		serviceKey = keys.service;
		await ensureProvider();
		userA = await oidcSignIn(EMAIL_A);
		userB = await oidcSignIn(EMAIL_B);
	}, 120_000);

	afterAll(async () => {
		const ids = [userA?.issuerUserId, userB?.issuerUserId]
			.filter((id): id is string => Boolean(id))
			.map((id) => `'${id}'`)
			.join(", ");
		const emails = [EMAIL_A, EMAIL_B].map((e) => `'${e}'`).join(", ");
		try {
			await mgmtSql(`
				delete from public.invoice_delivery_events where workspace_id in (
					select w.id from public.workspaces w where w.owner_id in (${ids})
				);
				delete from public.payment_transactions where workspace_id in (
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
			console.error("cleanup: scratch rows failed:", (error as Error).message);
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
			businessName: `A10 INV W1 ${suffix}`,
		});
		expect(ctxA).not.toBeNull();

		const clientB = userScopedClient(userB!.jwt);
		const ctxB = await ensureWorkspaceForUser(clientB, userB!.issuerUserId, {
			businessName: `A10 INV W2 ${suffix}`,
		});
		expect(ctxB).not.toBeNull();
	}, 60_000);

	it("creates a customer for user A (customer-scoping path)", async () => {
		const clientA = userScopedClient(userA!.jwt);
		const id = await createClientRecord(clientA, userA!.issuerUserId, {
			name: "Acme Corp",
			email: `acme-${suffix}@example.com`,
			currency: "NGN",
			paymentTerms: "net-14",
			contact: { fullName: "Acme Corp", email: `acme-${suffix}@example.com` },
			favorite: false,
			status: "active",
		});
		expect(id).toBeTruthy();
		customerAId = id;
	}, 60_000);

	it("creates a draft for user A (autosaveDraft) with a generated invoice number", async () => {
		const clientA = userScopedClient(userA!.jwt);
		const invoice = await autosaveDraft(clientA, userA!.issuerUserId, {
			...draftInput("Acme Corp"),
			customerId: customerAId ?? undefined,
		});
		expect(invoice.id).toBeTruthy();
		expect(invoice.status).toBe("draft");
		expect(invoice.invoiceNumber).toMatch(/^INV-\d{4}-\d{4,6}$/);
		expect(invoice.total).toBe(250000);
		expect(invoice.lineItems).toHaveLength(1);
		draftAId = invoice.id;

		const byId = await getById(clientA, userA!.issuerUserId, invoice.id);
		expect(byId?.id).toBe(invoice.id);
		const byToken = await getByToken(
			clientA,
			userA!.issuerUserId,
			invoice.token,
		);
		expect(byToken?.id).toBe(invoice.id);
	}, 60_000);

	it("lists exactly user A's invoices — zero cross-workspace rows", async () => {
		const clientB = userScopedClient(userB!.jwt);
		const bInvoice = await autosaveDraft(clientB, userB!.issuerUserId, {
			...draftInput("Beta Ltd"),
		});

		const clientA = userScopedClient(userA!.jwt);
		const rows = await list(clientA, userA!.issuerUserId);
		expect(rows.some((i) => i.customerName === "Acme Corp")).toBe(true);
		expect(rows.some((i) => i.customerName === "Beta Ltd")).toBe(false);

		// A cannot fetch B's invoice by id.
		const viaA = await getById(clientA, userA!.issuerUserId, bInvoice.id);
		expect(viaA).toBeNull();

		// A cannot fetch B's invoice by token.
		const viaTokenA = await getByToken(
			clientA,
			userA!.issuerUserId,
			bInvoice.token,
		);
		expect(viaTokenA).toBeNull();

		// listPage paginates A's own rows.
		const page = await listPage(clientA, userA!.issuerUserId, {
			pageSize: 10,
			status: "all",
		});
		expect(page.page.length).toBeGreaterThan(0);
		expect(page.page.every((i) => i.customerName !== "Beta Ltd")).toBe(true);
	}, 60_000);

	it("finalizes the draft (save) and transitions status to paid", async () => {
		const clientA = userScopedClient(userA!.jwt);
		const draft = await getById(clientA, userA!.issuerUserId, draftAId!);
		expect(draft).not.toBeNull();

		const saved = await save(clientA, userA!.issuerUserId, {
			id: draftAId!,
			token: draft!.token,
			documentType: "standard",
			invoiceNumber: draft!.invoiceNumber,
			customerId: customerAId ?? undefined,
			customerName: "Acme Corp",
			currency: "NGN",
			type: "one-time",
			invoiceSize: "A4",
			dateFormat: "ng",
			paymentTermsDays: 14,
			template: "Default",
			issueDate: today(),
			dueDate: inDays(30),
			lineItems: draft!.lineItems,
			compliance: {
				buyer: { email: `acme-${suffix}@example.com` },
			},
		});
		expect(saved.id).toBe(draftAId);

		await updateStatus(clientA, userA!.issuerUserId, {
			id: draftAId!,
			status: "unpaid",
		});
		const unpaid = await getById(clientA, userA!.issuerUserId, draftAId!);
		expect(unpaid!.status).toBe("unpaid");

		await updateStatus(clientA, userA!.issuerUserId, {
			id: draftAId!,
			status: "paid",
			paymentReference: `gate-${suffix}`,
		});
		const paid = await getById(clientA, userA!.issuerUserId, draftAId!);
		expect(paid!.status).toBe("paid");
		expect(paid!.paymentAmount).toBe(250000);
		expect(paid!.balance).toBe(0);
		expect(paid!.paymentReference).toBe(`gate-${suffix}`);
	}, 60_000);

	it("duplicates the invoice with a fresh number and id", async () => {
		const clientA = userScopedClient(userA!.jwt);
		const { id } = await duplicate(clientA, userA!.issuerUserId, draftAId!);
		expect(id).not.toBe(draftAId);
		const copy = await getById(clientA, userA!.issuerUserId, id);
		expect(copy).not.toBeNull();
		expect(copy!.invoiceNumber).not.toBe(
			(await getById(clientA, userA!.issuerUserId, draftAId!))!.invoiceNumber,
		);
		expect(copy!.customerName).toBe("Acme Corp");
	}, 60_000);

	it("converts a proforma into a standard invoice", async () => {
		const clientA = userScopedClient(userA!.jwt);
		const proforma = await createDraft(clientA, userA!.issuerUserId, {
			...draftInput("Proforma Co", 100000),
			documentType: "proforma",
			deliveryType: "create",
		});
		expect(proforma.documentType).toBe("proforma");

		const { id } = await convertProformaToInvoice(
			clientA,
			userA!.issuerUserId,
			proforma.id,
		);
		expect(id).not.toBe(proforma.id);
		const converted = await getById(clientA, userA!.issuerUserId, id);
		expect(converted!.documentType).toBe("standard");

		// Idempotent: converting again returns the same invoice.
		const again = await convertProformaToInvoice(
			clientA,
			userA!.issuerUserId,
			proforma.id,
		);
		expect(again.id).toBe(id);
	}, 60_000);

	it("imports CSV rows and hard-deletes untouched drafts", async () => {
		const clientA = userScopedClient(userA!.jwt);
		const result = await importCsv(clientA, userA!.issuerUserId, [
			{
				customerName: "CSV Buyer One",
				description: "Widget A",
				quantity: 2,
				price: 5000,
				dueDate: inDays(14),
			},
			{
				customerName: "CSV Buyer Two",
				description: "Widget B",
				quantity: 1,
				price: 7500,
				dueDate: inDays(14),
			},
		]);
		expect(result.created).toBe(2);
		expect(result.errors).toHaveLength(0);

		// A paid invoice cannot be hard-deleted.
		await expect(
			remove(clientA, userA!.issuerUserId, draftAId!),
		).rejects.toThrow("Only untouched draft invoices can be hard deleted");

		// Bulk cleanup archives it.
		const bulk = await bulkDeleteOrArchive(clientA, userA!.issuerUserId, [
			draftAId!,
		]);
		expect(bulk.archived).toBe(1);
		// Convex parity: getById does NOT filter deletedAt — an archived
		// invoice stays readable by id (only list views filter it out).
		const archived = await getById(clientA, userA!.issuerUserId, draftAId!);
		expect(archived).not.toBeNull();
		expect(archived!.deletedAt).toBeDefined();
		expect(archived!.status).toBe("canceled");

		// A brand-new empty draft IS hard-deletable.
		const emptyDraft = await autosaveDraft(clientA, userA!.issuerUserId, {
			...draftInput("Empty Co", 0),
			lineItems: [{ id: "li-0", name: "", quantity: 1, price: 0 }],
		});
		await remove(clientA, userA!.issuerUserId, emptyDraft.id);
		const gone = await getById(clientA, userA!.issuerUserId, emptyDraft.id);
		expect(gone).toBeNull();
	}, 60_000);
});
