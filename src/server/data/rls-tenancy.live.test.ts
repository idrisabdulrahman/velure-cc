import { importJWK, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * A10 tenancy gate — the RLS policies against REAL minted JWTs on velure-cc.
 *
 * Run with: A10_LIVE=1 pnpm exec vitest run src/server/data/rls-tenancy.live.test.ts
 * Skipped (green, no-op) under plain `pnpm test`.
 *
 * A10 removed the A9 OIDC provider: the app now mints its own ES256 JWT at
 * POST /api/auth/supabase-session and the BROWSER calls PostgREST directly,
 * passing workspace_id/owner_id as filters. Per ADR-0001 those identifiers are
 * "filters only" — RLS is the sole tenancy enforcement. So this suite mints the
 * same shape of token the bridge does and drives PostgREST at that boundary.
 *
 * The other *.live.test.ts files in this directory still drive the retired A9
 * issuer flow (they need ISSUER_URL + a management token), which is why they
 * cannot cover the A10 path.
 *
 * Covers the four-way INSERT anchor matrix that a9-live-tenancy.mjs established
 * for clients (own workspace / no workspace + own owner_id / no anchor), plus
 * the cases it never tested:
 *
 *   * a FOREIGN workspace_id paired with your own owner_id, on INSERT;
 *   * the same reached in two hops via UPDATE (insert unanchored, then PATCH
 *     workspace_id onto a stranger's workspace) — fixing INSERT alone leaves
 *     this open;
 *   * the same on email_events and invoice_exports, which carry the identical
 *     owner-branch shape (invoice_exports' was weaker still: no is-not-null
 *     guard);
 *   * the legitimate claim path — an owner moving their own unanchored row into
 *     their OWN workspace must keep working, so the fix can't overshoot.
 *
 * owner_id/user_id are plain `text` with no FK into better_auth, so scratch
 * users are synthetic ids and no auth rows are created.
 */
const LIVE = process.env.A10_LIVE === "1";
const gate = LIVE ? describe : describe.skip;

const SUPABASE_URL =
	process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const ANON_KEY =
	process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
	process.env.SUPABASE_PUBLISHABLE_KEY ??
	"";
const PRIVATE_JWK = process.env.SUPABASE_JWT_PRIVATE_JWK ?? "";

const suffix = `${Date.now()}`;
const USER_A = `a10-rls-a-${suffix}`;
const USER_B = `a10-rls-b-${suffix}`;

let tokenA = "";
let tokenB = "";
let workspaceA = "";

/** Mint the same token shape as server/supabase-session.ts mintSupabaseAccessToken. */
async function mintFor(userId: string) {
	const jwk = JSON.parse(PRIVATE_JWK) as Record<string, unknown>;
	if (typeof jwk.kid !== "string") {
		throw new Error(
			"SUPABASE_JWT_PRIVATE_JWK must include its Supabase key kid",
		);
	}
	return new SignJWT({
		sub: userId,
		velure_user_id: userId,
		role: "authenticated",
		aud: "authenticated",
	})
		.setIssuedAt()
		.setExpirationTime(Math.floor(Date.now() / 1000) + 60 * 30)
		.setProtectedHeader({ alg: "ES256", kid: jwk.kid, typ: "JWT" })
		.sign(await importJWK({ ...jwk, key_ops: ["sign"] }, "ES256"));
}

/** PostgREST exactly as the browser's supabase-js client calls it. */
async function rest(
	method: string,
	path: string,
	options: { token?: string | null; body?: unknown } = {},
) {
	const headers: Record<string, string> = {
		apikey: ANON_KEY,
		prefer: "return=representation",
	};
	if (options.token) headers.authorization = `Bearer ${options.token}`;
	if (options.body !== undefined) headers["content-type"] = "application/json";
	const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
		method,
		headers,
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
	const text = await res.text();
	let body: unknown = null;
	try {
		body = text ? JSON.parse(text) : null;
	} catch {
		/* non-JSON error body */
	}
	return { status: res.status, body, text: text.slice(0, 240) };
}

const rows = (value: unknown) => (Array.isArray(value) ? value : []);

/**
 * Assert a write was refused. Deletes anything that slipped through first, so a
 * regression can't leave a cross-tenant row behind in the live project.
 */
async function expectRefused(
	result: Awaited<ReturnType<typeof rest>>,
	table: string,
	token: string,
) {
	const planted = rows(result.body)[0] as { id?: string } | undefined;
	if (planted?.id) {
		await rest("DELETE", `${table}?id=eq.${planted.id}`, { token });
	}
	expect(result.status, result.text).toBe(403);
}

function scratchClient(overrides: Record<string, unknown>) {
	return {
		name: `A10 RLS Scratch ${Math.random().toString(36).slice(2, 8)}`,
		email: `a10-rls-${Math.random().toString(36).slice(2, 8)}@example.test`,
		currency: "NGN",
		payment_terms: "Net 7",
		contact: {},
		favorite: false,
		status: "active",
		...overrides,
	};
}

gate("A10 RLS tenancy: clients INSERT anchors", () => {
	beforeAll(async () => {
		if (!SUPABASE_URL || !ANON_KEY || !PRIVATE_JWK) {
			throw new Error(
				"A10_LIVE=1 requires VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and SUPABASE_JWT_PRIVATE_JWK",
			);
		}
		tokenA = await mintFor(USER_A);
		tokenB = await mintFor(USER_B);

		const created = await rest("POST", "workspaces?select=id", {
			token: tokenA,
			body: {
				owner_id: USER_A,
				name: `A10 RLS W1 ${suffix}`,
				country_code: "NG",
				base_currency: "NGN",
				reminders_enabled: false,
			},
		});
		expect(created.status, created.text).toBe(201);
		workspaceA = (rows(created.body)[0] as { id: string }).id;
		await rest("POST", "workspace_members", {
			token: tokenA,
			body: { workspace_id: workspaceA, user_id: USER_A, role: "owner" },
		});
	});

	afterAll(async () => {
		if (!workspaceA) return;
		// Sweep any row a regression left behind, then the scratch workspace.
		for (const table of ["clients", "email_events", "invoice_exports"]) {
			await rest("DELETE", `${table}?workspace_id=eq.${workspaceA}`, {
				token: tokenA,
			});
			await rest("DELETE", `${table}?owner_id=eq.${USER_A}`, { token: tokenA });
			await rest("DELETE", `${table}?owner_id=eq.${USER_B}`, { token: tokenB });
		}
		await rest("DELETE", `workspace_members?workspace_id=eq.${workspaceA}`, {
			token: tokenA,
		});
		const removed = await rest("DELETE", `workspaces?id=eq.${workspaceA}`, {
			token: tokenA,
		});
		if (rows(removed.body).length !== 1) {
			console.warn(
				`A10 RLS: scratch workspace ${workspaceA} may remain (status ${removed.status})`,
			);
		}
	});

	it("rejects an insert into a workspace the user is not a member of", async () => {
		const intrusion = await rest("POST", "clients?select=id", {
			token: tokenB,
			body: scratchClient({
				workspace_id: workspaceA,
				owner_id: USER_B,
				name: "A10 RLS Scratch INTRUSION",
			}),
		});
		await expectRefused(intrusion, "clients", tokenB);
	});

	it("accepts a member's insert into their own workspace", async () => {
		const own = await rest("POST", "clients?select=id", {
			token: tokenA,
			body: scratchClient({ workspace_id: workspaceA, owner_id: USER_A }),
		});
		expect(own.status, own.text).toBe(201);
		const created = rows(own.body)[0] as { id: string };
		await rest("DELETE", `clients?id=eq.${created.id}`, { token: tokenA });
	});

	it("accepts an owner-anchored insert with no workspace", async () => {
		const unanchored = await rest("POST", "clients?select=id", {
			token: tokenA,
			body: scratchClient({ owner_id: USER_A }),
		});
		expect(unanchored.status, unanchored.text).toBe(201);
		const created = rows(unanchored.body)[0] as { id: string };
		await rest("DELETE", `clients?id=eq.${created.id}`, { token: tokenA });
	});

	it("rejects an insert with no anchor at all", async () => {
		const orphan = await rest("POST", "clients?select=id", {
			token: tokenB,
			body: scratchClient({}),
		});
		await expectRefused(orphan, "clients", tokenB);
	});

	it("rejects moving an owned row into a foreign workspace via UPDATE", async () => {
		// Hop 1 is legitimate and must succeed: owner-anchored, no workspace.
		const seeded = await rest("POST", "clients?select=id", {
			token: tokenB,
			body: scratchClient({ owner_id: USER_B }),
		});
		expect(seeded.status, seeded.text).toBe(201);
		const seededId = (rows(seeded.body)[0] as { id: string }).id;

		// Hop 2 is the bypass: PATCH the row into a workspace B is not in.
		const moved = await rest(
			`PATCH`,
			`clients?id=eq.${seededId}&select=id,workspace_id`,
			{ token: tokenB, body: { workspace_id: workspaceA } },
		);
		const landed = rows(moved.body)[0] as
			| { workspace_id: string | null }
			| undefined;
		await rest("DELETE", `clients?id=eq.${seededId}`, { token: tokenB });

		// RLS may refuse outright (403) or match zero rows — never relocate it.
		expect(landed?.workspace_id ?? null, moved.text).not.toBe(workspaceA);
	});

	it("still allows an owner to claim their unanchored row into their own workspace", async () => {
		const seeded = await rest("POST", "clients?select=id", {
			token: tokenA,
			body: scratchClient({ owner_id: USER_A }),
		});
		expect(seeded.status, seeded.text).toBe(201);
		const seededId = (rows(seeded.body)[0] as { id: string }).id;

		const claimed = await rest(
			"PATCH",
			`clients?id=eq.${seededId}&select=id,workspace_id`,
			{ token: tokenA, body: { workspace_id: workspaceA } },
		);
		const landed = rows(claimed.body)[0] as
			| { workspace_id: string | null }
			| undefined;
		await rest("DELETE", `clients?id=eq.${seededId}`, { token: tokenA });

		expect(landed?.workspace_id, claimed.text).toBe(workspaceA);
	});

	it.each(["email_events", "invoice_exports"])(
		"rejects a cross-tenant insert into %s",
		async (table) => {
			const body =
				table === "email_events"
					? {
							workspace_id: workspaceA,
							owner_id: USER_B,
							provider: "resend",
							provider_event_id: `a10-rls-${table}-${Date.now()}`,
							event_type: "delivered",
						}
					: {
							workspace_id: workspaceA,
							owner_id: USER_B,
							kind: "invoices_csv",
							status: "ready",
							file_name: "a10-rls.csv",
							content: "scratch",
						};
			const intrusion = await rest("POST", `${table}?select=id`, {
				token: tokenB,
				body,
			});
			await expectRefused(intrusion, table, tokenB);
		},
	);
});
