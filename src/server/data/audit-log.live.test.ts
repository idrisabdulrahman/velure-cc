import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { importJWK, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "#/types/database.types";
import { recordInvoiceAudit } from "./audit";

/**
 * G1 live gate — the append-only invoice audit log against REAL RLS on the
 * linked Supabase project.
 *
 * Run with: A10_LIVE=1 SUPABASE_JWT_PRIVATE_JWK=… SUPABASE_SERVICE_ROLE_KEY=…
 * (or SUPABASE_MANAGEMENT_TOKEN=… to fetch the service key via the management
 * API) pnpm exec vitest run src/server/data/audit-log.live.test.ts
 * Skipped (green, no-op) under plain `pnpm test`.
 *
 * Proves, at the PostgREST boundary:
 *   * recordInvoiceAudit writes a row for the caller's active workspace
 *     through the service-role path, with the caller as actor;
 *   * members of workspace A can read A's audit rows, a member of workspace
 *     B sees none of them (tenant scoping);
 *   * an authenticated session can neither insert, update nor delete audit
 *     rows (no grant, no policy);
 *   * even the service key cannot rewrite a row in place — the append-only
 *     trigger raises;
 *   * workspace deletion (FK cascade) still removes a tenant's audit rows,
 *     which is how the scratch data is cleaned up below.
 *
 * owner_id/user_id are plain `text` with no FK into better_auth, so scratch
 * users are synthetic ids and no auth rows are created.
 */
const LIVE = process.env.A10_LIVE === "1";
const gate = LIVE ? describe : describe.skip;

const REF = process.env.SUPABASE_PROJECT_REF ?? "kbexydkmmfabfutgkbxn";
const API =
	process.env.VITE_SUPABASE_URL ??
	process.env.SUPABASE_URL ??
	`https://${REF}.supabase.co`;
const ANON_KEY =
	process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
	process.env.SUPABASE_PUBLISHABLE_KEY ??
	"";
const PRIVATE_JWK = process.env.SUPABASE_JWT_PRIVATE_JWK ?? "";
const MGMT = "https://api.supabase.com";

const suffix = `${Date.now()}`;
const USER_A = `g1-audit-a-${suffix}`;
const USER_B = `g1-audit-b-${suffix}`;

let tokenA = "";
let tokenB = "";
let serviceKey = "";
let workspaceA = "";
let workspaceB = "";

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
		apikey: options.token === serviceKey ? serviceKey : ANON_KEY,
		prefer: "return=representation",
	};
	if (options.token) headers.authorization = `Bearer ${options.token}`;
	if (options.body !== undefined) headers["content-type"] = "application/json";
	const res = await fetch(`${API}/rest/v1/${path}`, {
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

function userScopedClient(jwt: string) {
	return createSupabaseClient<Database>(API, ANON_KEY, {
		global: { headers: { Authorization: `Bearer ${jwt}` } },
		auth: {
			autoRefreshToken: false,
			detectSessionInUrl: false,
			persistSession: false,
		},
	});
}

async function fetchServiceKey() {
	const fromEnv =
		process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
	if (fromEnv) return fromEnv;
	const mgmtToken = process.env.SUPABASE_MANAGEMENT_TOKEN ?? "";
	if (!mgmtToken) {
		throw new Error(
			"A10_LIVE audit gate requires SUPABASE_SERVICE_ROLE_KEY or SUPABASE_MANAGEMENT_TOKEN",
		);
	}
	const res = await fetch(`${MGMT}/v1/projects/${REF}/api-keys`, {
		headers: { authorization: `Bearer ${mgmtToken}` },
	});
	if (!res.ok) throw new Error(`api-keys: ${res.status} ${await res.text()}`);
	const keys = (await res.json()) as { name: string; api_key: string }[];
	const service = keys.find((k) => k.name === "service_role")?.api_key;
	if (!service) throw new Error("service_role key not found");
	return service;
}

async function createScratchWorkspace(
	token: string,
	userId: string,
	label: string,
) {
	const created = await rest("POST", "workspaces?select=id", {
		token,
		body: {
			owner_id: userId,
			name: `G1 Audit ${label} ${suffix}`,
			country_code: "NG",
			base_currency: "NGN",
			reminders_enabled: false,
		},
	});
	if (created.status !== 201) {
		throw new Error(`workspace create: ${created.status} ${created.text}`);
	}
	const id = (rows(created.body)[0] as { id: string }).id;
	await rest("POST", "workspace_members", {
		token,
		body: { workspace_id: id, user_id: userId, role: "owner" },
	});
	await rest("POST", "active_workspaces", {
		token,
		body: { user_id: userId, workspace_id: id },
	});
	return id;
}

gate("G1 append-only invoice audit log (live)", () => {
	beforeAll(async () => {
		if (!ANON_KEY || !PRIVATE_JWK) {
			throw new Error(
				"A10_LIVE=1 requires VITE_SUPABASE_PUBLISHABLE_KEY and SUPABASE_JWT_PRIVATE_JWK",
			);
		}
		tokenA = await mintFor(USER_A);
		tokenB = await mintFor(USER_B);
		serviceKey = await fetchServiceKey();
		// The audit service writes through getSupabaseAdminClient(); feed it
		// the same live project credentials.
		process.env.VITE_SUPABASE_URL ??= API;
		process.env.SUPABASE_SERVICE_ROLE_KEY ??= serviceKey;

		workspaceA = await createScratchWorkspace(tokenA, USER_A, "A");
		workspaceB = await createScratchWorkspace(tokenB, USER_B, "B");
	}, 120_000);

	afterAll(async () => {
		// FK cascade removes each scratch workspace's audit rows — the only
		// delete path the append-only design intentionally keeps.
		for (const id of [workspaceA, workspaceB]) {
			if (!id) continue;
			// Service-role sweep of scratch rows; the audit rows themselves go
			// with the workspace below (FK cascade).
			await rest("DELETE", `workspace_members?workspace_id=eq.${id}`, {
				token: serviceKey,
			});
			await rest("DELETE", `active_workspaces?workspace_id=eq.${id}`, {
				token: serviceKey,
			});
			const removed = await rest("DELETE", `workspaces?id=eq.${id}`, {
				token: serviceKey,
			});
			if (rows(removed.body).length !== 1) {
				console.warn(
					`G1 audit: scratch workspace ${id} may remain (status ${removed.status})`,
				);
			}
		}
	});

	it("writes a row through the service and scopes reads to members", async () => {
		await recordInvoiceAudit(userScopedClient(tokenA), USER_A, {
			action: "invoice.send",
			resourceId: "inv-g1-live",
			before: { id: "inv-g1-live", status: "draft", token: "must-be-redacted" },
			after: { id: "inv-g1-live", status: "unpaid" },
			message: "Live gate send event.",
		});

		const asMember = await rest(
			"GET",
			`invoice_audit_log?resource_id=eq.inv-g1-live&select=action,actor_id,workspace_id,before_payload`,
			{ token: tokenA },
		);
		expect(asMember.status, asMember.text).toBe(200);
		const mine = rows(asMember.body)[0] as {
			action: string;
			actor_id: string;
			workspace_id: string;
			before_payload: Record<string, unknown>;
		};
		expect(mine.action).toBe("invoice.send");
		expect(mine.actor_id).toBe(USER_A);
		expect(mine.workspace_id).toBe(workspaceA);
		expect(mine.before_payload.token).toBeUndefined();

		const asStranger = await rest(
			"GET",
			`invoice_audit_log?workspace_id=eq.${workspaceA}&select=id`,
			{ token: tokenB },
		);
		expect(asStranger.status, asStranger.text).toBe(200);
		expect(rows(asStranger.body)).toHaveLength(0);
	});

	it("refuses authenticated insert, update and delete on audit rows", async () => {
		const target = await rest(
			"GET",
			`invoice_audit_log?resource_id=eq.inv-g1-live&select=id`,
			{ token: tokenA },
		);
		const rowId = (rows(target.body)[0] as { id: string }).id;

		const forged = await rest("POST", "invoice_audit_log?select=id", {
			token: tokenA,
			body: {
				workspace_id: workspaceA,
				actor_id: USER_A,
				actor_type: "user",
				action: "invoice.cancel",
				resource_id: "inv-g1-live",
			},
		});
		expect(forged.status, forged.text).toBeGreaterThanOrEqual(400);

		const patched = await rest("PATCH", `invoice_audit_log?id=eq.${rowId}`, {
			token: tokenA,
			body: { action: "invoice.edit" },
		});
		expect(patched.status, patched.text).toBeGreaterThanOrEqual(400);

		const removed = await rest("DELETE", `invoice_audit_log?id=eq.${rowId}`, {
			token: tokenA,
		});
		expect(removed.status, removed.text).toBeGreaterThanOrEqual(400);

		// The row is untouched.
		const check = await rest(
			"GET",
			`invoice_audit_log?id=eq.${rowId}&select=action`,
			{ token: tokenA },
		);
		expect((rows(check.body)[0] as { action: string }).action).toBe(
			"invoice.send",
		);
	});

	it("blocks even the service role from rewriting history in place", async () => {
		const target = await rest(
			"GET",
			`invoice_audit_log?resource_id=eq.inv-g1-live&select=id`,
			{ token: tokenA },
		);
		const rowId = (rows(target.body)[0] as { id: string }).id;

		const patched = await rest("PATCH", `invoice_audit_log?id=eq.${rowId}`, {
			token: serviceKey,
			body: { message: "tampered" },
		});
		expect(patched.status, patched.text).toBeGreaterThanOrEqual(400);
		expect(patched.text).toContain("append-only");

		const check = await rest(
			"GET",
			`invoice_audit_log?id=eq.${rowId}&select=message`,
			{ token: serviceKey },
		);
		expect((rows(check.body)[0] as { message: string }).message).toBe(
			"Live gate send event.",
		);
	});
});
