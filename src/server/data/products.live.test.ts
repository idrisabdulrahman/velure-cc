import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	archiveProduct,
	createProduct,
	duplicateProduct,
	getProductById,
	listProducts,
	type Supabase,
	searchProducts,
	updateProduct,
} from "./products";
import { ensureWorkspaceForUser, resolveActiveWorkspaceId } from "./workspaces";

/**
 * A10 live gate for the products domain — REAL OIDC JWT + REAL velure-cc.
 *
 * Run with: A10_LIVE=1 SUPABASE_MANAGEMENT_TOKEN=… ISSUER_URL=… pnpm exec
 * vitest run src/server/data/products.live.test.ts
 * Skipped (green, no-op) under plain `pnpm test`.
 *
 * Proves the ported module is RLS-pure end to end: user A bootstraps a
 * workspace and creates/reads/updates/searches/archives/duplicates products
 * through the authenticated path; user B creates their own workspace +
 * product; A's reads return zero of B's rows. Scratch artifacts are removed
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
const EMAIL_A = `a10-pr-a-${suffix}@gmail.com`;
const EMAIL_B = `a10-pr-b-${suffix}@gmail.com`;
const PASSWORD = "A10BridgePass-2026!";

let mgmtToken = "";
let anonKey = "";
let serviceKey = "";
let userA: { issuerUserId: string; jwt: string } | null = null;
let userB: { issuerUserId: string; jwt: string } | null = null;
let productAId: string | null = null;
let duplicateId: string | null = null;

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
	if (existing) return;
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
			name: "Velure (A10 products gate)",
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

describe.skipIf(!LIVE)("A10 products domain (live velure-cc)", () => {
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
				delete from public.products where workspace_id in (
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
			businessName: `A10 PR W1 ${suffix}`,
		});
		expect(ctxA).not.toBeNull();

		const clientB = userScopedClient(userB!.jwt);
		const ctxB = await ensureWorkspaceForUser(clientB, userB!.issuerUserId, {
			businessName: `A10 PR W2 ${suffix}`,
		});
		expect(ctxB).not.toBeNull();
	}, 60_000);

	it("creates a product for user A through the authenticated path", async () => {
		const clientA = userScopedClient(userA!.jwt);
		const id = await createProduct(clientA, userA!.issuerUserId, {
			type: "product",
			name: "Consulting Retainer",
			description: "Monthly retainer",
			sku: "RET-001",
			unitName: "month",
			defaultUnitPrice: 250000,
			defaultTaxId: "vat-ng",
			isActive: true,
		});
		expect(id).toBeTruthy();
		productAId = id;

		const fetched = await getProductById(clientA, userA!.issuerUserId, id);
		expect(fetched).not.toBeNull();
		expect(fetched!.name).toBe("Consulting Retainer");
		expect(fetched!.defaultUnitPrice).toBe(250000);
		expect(fetched!.sku).toBe("RET-001");
		expect(fetched!.type).toBe("product");
	}, 60_000);

	it("lists exactly user A's products — zero cross-workspace rows", async () => {
		// User B creates their own product first so A's read has a real B row
		// to leak.
		const clientB = userScopedClient(userB!.jwt);
		await createProduct(clientB, userB!.issuerUserId, {
			type: "service",
			name: "Beta Service",
			defaultUnitPrice: 5000,
			isActive: true,
		});

		const clientA = userScopedClient(userA!.jwt);
		const rows = await listProducts(clientA, userA!.issuerUserId);
		expect(rows.some((p) => p.name === "Consulting Retainer")).toBe(true);
		expect(rows.some((p) => p.name === "Beta Service")).toBe(false);

		// A cannot fetch B's product by id either.
		const bWs = await resolveActiveWorkspaceId(clientB, userB!.issuerUserId);
		const bProducts = await clientB
			.from("products")
			.select("id, name")
			.eq("workspace_id", bWs!);
		expect(bProducts.error).toBeNull();
		const bProductId = bProducts.data?.[0]?.id;
		expect(bProductId).toBeTruthy();
		const viaA = await getProductById(
			clientA,
			userA!.issuerUserId,
			bProductId!,
		);
		expect(viaA).toBeNull();
	}, 60_000);

	it("searches products by name and sku within the workspace", async () => {
		const clientA = userScopedClient(userA!.jwt);
		const byName = await searchProducts(
			clientA,
			userA!.issuerUserId,
			"retainer",
		);
		expect(byName.some((p) => p.name === "Consulting Retainer")).toBe(true);
		const bySku = await searchProducts(clientA, userA!.issuerUserId, "RET-001");
		expect(bySku.some((p) => p.sku === "RET-001")).toBe(true);
		const noMatch = await searchProducts(clientA, userA!.issuerUserId, "zzzz");
		expect(noMatch).toHaveLength(0);
	}, 60_000);

	it("updates a product through the authenticated path", async () => {
		const clientA = userScopedClient(userA!.jwt);
		await updateProduct(clientA, userA!.issuerUserId, productAId!, {
			type: "service",
			name: "Consulting Retainer Pro",
			description: "Premium monthly retainer",
			sku: "RET-002",
			defaultUnitPrice: 350000,
			isActive: true,
		});
		const updated = await getProductById(
			clientA,
			userA!.issuerUserId,
			productAId!,
		);
		expect(updated!.name).toBe("Consulting Retainer Pro");
		expect(updated!.defaultUnitPrice).toBe(350000);
		expect(updated!.type).toBe("service");
	}, 60_000);

	it("duplicates a product with a (Copy) suffix", async () => {
		const clientA = userScopedClient(userA!.jwt);
		const copyId = await duplicateProduct(
			clientA,
			userA!.issuerUserId,
			productAId!,
		);
		expect(copyId).not.toBe(productAId);
		duplicateId = copyId;

		const copy = await getProductById(clientA, userA!.issuerUserId, copyId);
		expect(copy!.name).toBe("Consulting Retainer Pro (Copy)");
		expect(copy!.defaultUnitPrice).toBe(350000);
	}, 60_000);

	it("archives a product (soft delete) and hides it from list/getById", async () => {
		const clientA = userScopedClient(userA!.jwt);
		await archiveProduct(clientA, userA!.issuerUserId, duplicateId!);

		const archived = await getProductById(
			clientA,
			userA!.issuerUserId,
			duplicateId!,
		);
		expect(archived).toBeNull();

		const rows = await listProducts(clientA, userA!.issuerUserId);
		expect(rows.some((p) => p.id === duplicateId)).toBe(false);
		// The original is still listed.
		expect(rows.some((p) => p.id === productAId)).toBe(true);
	}, 60_000);
});
