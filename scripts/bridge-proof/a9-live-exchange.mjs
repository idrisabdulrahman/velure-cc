/**
 * Live A9 bridge run: real OIDC code exchange through Supabase Auth.
 *
 * Drives the actual browser flow against `velure-cc`:
 *   1. Create a scratch user at the standalone issuer (through the public
 *      tunnel URL) and capture its session cookie.
 *   2. Start Supabase sign-in: GET /auth/v1/authorize?provider=custom:velure
 *      (GoTrue generates PKCE verifier/challenge + nonce, 302s to the issuer).
 *   3. Complete the authorize step at the issuer with the session cookie.
 *   4. Follow the redirect back to GoTrue's callback (GoTrue exchanges the
 *      code server-side, verifies the RS256 id_token against the JWKS, and
 *      mints its own Supabase JWT).
 *   5. Answer the load-bearing question: does the Supabase JWT `sub` equal
 *      the better-auth user id (the value the app stores in owner_id)?
 *   6. Prove the minted token is accepted through the REAL A4 helpers on a
 *      scratch RLS table (mirrors the A9 policy swap's foundation).
 *
 * Everything is scratch and removed in `finally`: the OIDC provider, the
 * GoTrue auth user, and the scratch workspace + table. The real A3 deny-all
 * policies are untouched.
 *
 * Env: SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, SUPABASE_MANAGEMENT_TOKEN.
 */
import process from "node:process";

const REF = "kbexydkmmfabfutgkbxn";
const API = `https://${REF}.supabase.co`;
const MGMT = "https://api.supabase.com";
const ISSUER_URL = process.env.ISSUER_URL;
if (!ISSUER_URL) throw new Error("ISSUER_URL is required (the public tunnel URL)");
const PROVIDER_IDENTIFIER = "custom:velure";

const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
const mgmtToken = process.env.SUPABASE_MANAGEMENT_TOKEN;
if (!anonKey || !serviceKey || !mgmtToken) {
	throw new Error("Missing SUPABASE_ANON_KEY / SUPABASE_SERVICE_KEY / SUPABASE_MANAGEMENT_TOKEN");
}

const suffix = `${Date.now()}`;
const ISSUER_EMAIL = `a9-live-${suffix}@gmail.com`;
const ISSUER_PASSWORD = "A9BridgePass-2026!";

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
	if (ok) {
		passed += 1;
		console.log(`  ✓ ${name}`);
	} else {
		failed += 1;
		console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
	}
}

function decodeJwt(token) {
	return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

/** Cookie jar across both hosts (issuer sets the session, GoTrue sets state). */
function makeCookieJar() {
	const cookies = new Map(); // key -> value
	return {
		store(res) {
			for (const c of res.headers.getSetCookie?.() ?? []) {
				const [pair, ...rest] = c.split(";");
				const [k, ...v] = pair.split("=");
				const key = k.trim();
				const value = v.join("=").trim();
				const isExpired = rest.some((p) => p.trim().toLowerCase().startsWith("max-age=0"));
				if (isExpired || value === "") cookies.delete(key);
				else cookies.set(key, value);
			}
		},
		header() {
			return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
		},
	};
}

async function mgmtSql(query, attempts = 3) {
	let lastErr;
	for (let i = 0; i < attempts; i += 1) {
		try {
			const res = await fetch(`${MGMT}/v1/projects/${REF}/database/query`, {
				method: "POST",
				headers: { authorization: `Bearer ${mgmtToken}`, "content-type": "application/json" },
				body: JSON.stringify({ query }),
			});
			const text = await res.text();
			if (!res.ok) throw new Error(`mgmt SQL failed: ${res.status} ${text.slice(0, 300)}`);
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

/**
 * Follow a redirect chain manually with a shared cookie jar.
 *
 * Stops at the handoff boundary: once a redirect leaves both the Supabase and
 * the issuer hosts (GoTrue redirecting the browser to the app URL with tokens
 * in the fragment), it returns that redirect's Location instead of fetching
 * the (nonexistent) app.
 */
async function followRedirects(url, jar, { method = "GET", headers = {}, body } = {}, hops = 0) {
	const res = await fetch(url, {
		method,
		headers: { ...headers, cookie: jar.header() },
		body: body === undefined ? undefined : body,
		redirect: "manual",
	});
	jar.store(res);
	const location = res.headers.get("location");
	// better-auth's authorize responds to non-browser clients with a 200 JSON
	// body {"redirect":true,"url":...} instead of a 302 — follow that too.
	let jsonRedirect = null;
	if (res.status === 200 && res.headers.get("content-type")?.includes("application/json")) {
		try {
			const parsed = await res.clone().json();
			if (parsed?.redirect === true && parsed.url) jsonRedirect = parsed.url;
		} catch {
			/* not a JSON redirect */
		}
	}
	const nextUrl = (res.status >= 300 && res.status < 400 && location) ? location : jsonRedirect;
	if (nextUrl) {
		const next = new URL(nextUrl, url);
		const host = next.hostname;
		const inFlow = host.endsWith("supabase.co") || host === new URL(ISSUER_URL).hostname;
		if (!inFlow) {
			// Handoff to the app: tokens live in this redirect's fragment.
			return { res, finalUrl: url, handoff: next.toString() };
		}
		if (hops > 8) throw new Error("too many redirects");
		return followRedirects(next.toString(), jar, { method: "GET", headers }, hops + 1);
	}
	return { res, finalUrl: url };
}

let issuerUserId = null;
let supabaseToken = null;
let supabaseJwtSub = null;
let supabaseUserId = null;
let oidcUser = null;
let workspaceId = null;
let scratchTable = null;

async function cleanup() {
	try {
		// The delete endpoint takes the raw identifier (URL-encoding the colon
		// breaks validation), so interpolate it directly into the path.
		const res = await fetch(`${API}/auth/v1/admin/custom-providers/${PROVIDER_IDENTIFIER}`, {
			method: "DELETE",
			headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
		});
		console.log(`cleanup: delete provider -> ${res.status}`);
	} catch (error) {
		console.error("cleanup: delete provider failed:", error.message);
	}
	if (oidcUser?.id) {
		try {
			const res = await fetch(`${API}/auth/v1/admin/users/${oidcUser.id}`, {
				method: "DELETE",
				headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
			});
			console.log(`cleanup: delete auth user -> ${res.status}`);
		} catch (error) {
			console.error("cleanup: delete auth user failed:", error.message);
		}
	}
	if (workspaceId) {
		try {
			await mgmtSql(`
				delete from public.workspace_members where workspace_id = '${workspaceId}';
				delete from public.workspaces where id = '${workspaceId}';
			`);
		} catch (error) {
			console.error("cleanup: workspace rows failed:", error.message);
		}
	}
	if (scratchTable) {
		try {
			await mgmtSql(`drop table if exists public.${scratchTable};`);
		} catch (error) {
			console.error("cleanup: drop table failed:", error.message);
		}
	}
}

/** Register (or re-use) the OIDC provider so the script is self-contained. */
async function ensureProvider() {
	const list = await fetch(`${API}/auth/v1/admin/custom-providers`, {
		headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
	});
	const listBody = await list.json();
	const existing = (listBody.providers ?? []).find((p) => p.identifier === PROVIDER_IDENTIFIER);
	if (existing) return;
	const res = await fetch(`${API}/auth/v1/admin/custom-providers`, {
		method: "POST",
		headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
		body: JSON.stringify({
			provider_type: "oidc",
			identifier: PROVIDER_IDENTIFIER,
			name: "Velure (A9 bridge proof)",
			client_id: "velure-supabase-client",
			client_secret: "velure-supabase-client-secret-live-run",
			issuer: ISSUER_URL,
			scopes: ["openid", "profile", "email"],
		}),
	});
	if (!res.ok) throw new Error(`register provider: ${res.status} ${await res.text()}`);
	console.log(`  registered ${PROVIDER_IDENTIFIER} -> ${ISSUER_URL}`);
}

async function main() {
	await ensureProvider();
	console.log("1) Create a scratch user at the standalone issuer (through the tunnel)");
	const jar = makeCookieJar();
	const signup = await fetch(`${ISSUER_URL}/sign-up/email`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email: ISSUER_EMAIL, password: ISSUER_PASSWORD, name: "A9 Live User" }),
		redirect: "manual",
	});
	jar.store(signup);
	if (signup.status !== 200) throw new Error(`issuer sign-up: ${signup.status} ${await signup.text()}`);
	// The sign-up response carries the created user (with id) plus the session cookie.
	const signupBody = await signup.json();
	issuerUserId = signupBody.user?.id;
	check("better-auth user created; id captured", Boolean(issuerUserId), `status=${signup.status}`);
	console.log(`  better-auth user id: ${issuerUserId}`);

	// GoTrue rejects OIDC sign-ins with an unverified email
	// (provider_email_needs_verification). This harness's dev-only route flips
	// emailVerified on the scratch user so the flow can complete.
	const verify = await fetch(`${ISSUER_URL}/__dev/verify-email`, {
		method: "POST",
		headers: { "content-type": "application/json", "x-dev-token": "dev-secret-2026" },
		body: JSON.stringify({ email: ISSUER_EMAIL }),
	});
	check("scratch user email marked verified (dev-only route)", verify.status === 200, `status=${verify.status}`);

	console.log("2) Real Supabase sign-in: authorize -> issuer -> GoTrue callback -> JWT");
	// Start the flow with Supabase. GoTrue 302s to the issuer's authorize
	// endpoint with PKCE + nonce; we follow with the issuer session cookie.
	const { res: final, handoff } = await followRedirects(
		`${API}/auth/v1/authorize?provider=${PROVIDER_IDENTIFIER}`,
		jar,
		{ headers: { apikey: anonKey } },
	);
	const finalText = await final.text();
	// GoTrue's final step redirects to the app with tokens in the fragment.
	const fragment = handoff ? new URL(handoff).hash : "";
	const params = new URLSearchParams(fragment.replace(/^#/, ""));
	supabaseToken = params.get("access_token") ?? null;
	check("Supabase issued an access_token after the real code exchange", Boolean(supabaseToken), `status=${final.status}`);
	if (!supabaseToken) {
		console.log(`  final url: ${handoff?.slice(0, 300) ?? final.url}`);
		console.log(`  body: ${finalText.slice(0, 300)}`);
		return;
	}
	supabaseJwtSub = decodeJwt(supabaseToken).sub;
	supabaseUserId = supabaseJwtSub;
	console.log(`  Supabase JWT sub: ${supabaseJwtSub}`);

	// Where did GoTrue put the provider identity? The admin users API does NOT
	// return provider_id, so probe auth.identities directly (the authoritative
	// check the earlier live run established).
	const adminList = await fetch(`${API}/auth/v1/admin/users?page=1&per_page=50`, {
		headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
	});
	const adminBody = await adminList.json();
	// The list endpoint returns {"users":[...]} (not a bare array).
	oidcUser = (adminBody.users ?? []).find((u) => u.email === ISSUER_EMAIL) ?? { id: supabaseJwtSub };
	const identRows = await mgmtSql(
		`select provider, provider_id from auth.identities where user_id = '${supabaseJwtSub}'::uuid;`,
	);
	const identities = identRows ?? [];
	const providerSub = identities.find((i) => i.provider === PROVIDER_IDENTIFIER)?.provider_id ?? null;

	console.log("3) The load-bearing question: does the Supabase JWT carry the better-auth user id?");
	// With the custom access token hook (phase_a9_identity_sub_claim_hook), the
	// minted JWT should carry `velure_user_id` = the better-auth user id even
	// though `sub` is the GoTrue-minted UUID.
	const decoded = decodeJwt(supabaseToken);
	const claimUserId = decoded.velure_user_id ?? null;
	check(
		"Supabase JWT carries velure_user_id == better-auth user id",
		claimUserId === issuerUserId,
		`velure_user_id=${claimUserId} issuerUserId=${issuerUserId}`,
	);
	check(
		"sub is the GoTrue-minted UUID (expected to differ)",
		supabaseJwtSub !== issuerUserId,
		`sub=${supabaseJwtSub}`,
	);
	check(
		"GoTrue stored the issuer sub in auth.identities.provider_id",
		providerSub === issuerUserId,
		`provider_id=${providerSub} issuerUserId=${issuerUserId}`,
	);
	console.log(`  identities: ${JSON.stringify(identities.map((i) => ({ provider: i.provider, provider_id: i.provider_id })))}`);

	console.log("4) The minted token through the REAL A4 helpers (scratch RLS table)");
	// Mirror the acceptance run: a scratch workspace + membership + RLS table
	// using the actual app.current_user_id() / app.is_workspace_member().
	scratchTable = "_a9_bridge_live";
	await mgmtSql(`
		insert into public.workspaces (owner_id, name, country_code, base_currency, reminders_enabled, tax_rule_set_version)
		values ('${issuerUserId}', 'A9 Bridge Live ${suffix}', 'NG', 'NGN', false, 'ng-2026-q1')
		returning id;
	`);
	const wsRows = await mgmtSql(`select id from public.workspaces where name = 'A9 Bridge Live ${suffix}' limit 1;`);
	workspaceId = wsRows[0].id;
	// Membership anchored on the better-auth user id: with the custom access
	// token hook, app.current_user_id() resolves velure_user_id (the
	// better-auth id), which is what the app stores in user_id/owner_id.
	await mgmtSql(`
		insert into public.workspace_members (workspace_id, user_id, role) values ('${workspaceId}', '${issuerUserId}', 'owner');
		create table public.${scratchTable} (
			id uuid primary key default gen_random_uuid(),
			workspace_id uuid,
			owner_id text,
			note text
		);
		alter table public.${scratchTable} enable row level security;
		revoke all on table public.${scratchTable} from anon, authenticated;
		grant select, insert, update, delete on public.${scratchTable} to authenticated;
		create policy a9_select on public.${scratchTable}
			for select to authenticated
			using (owner_id = app.current_user_id() or (workspace_id is not null and app.is_workspace_member(workspace_id)));
		create policy a9_insert on public.${scratchTable}
			for insert to authenticated
			with check (owner_id = app.current_user_id() or (workspace_id is not null and app.is_workspace_member(workspace_id)));
		notify pgrst, 'reload schema';
	`);
	for (let i = 0; i < 16; i += 1) {
		const res = await fetch(`${API}/rest/v1/${scratchTable}?select=id&limit=1`, {
			headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
		});
		if (res.status !== 404) break;
		await new Promise((r) => setTimeout(r, 500));
	}

	const insert = await fetch(`${API}/rest/v1/${scratchTable}`, {
		method: "POST",
		headers: {
			apikey: anonKey,
			authorization: `Bearer ${supabaseToken}`,
			"content-type": "application/json",
			prefer: "return=representation",
		},
		body: JSON.stringify({ workspace_id: workspaceId, owner_id: null, note: "a9 live row" }),
	});
	check("OIDC-minted JWT inserts into its workspace (201)", insert.status === 201, `status=${insert.status}`);

	const read = await fetch(`${API}/rest/v1/${scratchTable}?select=id,note`, {
		headers: { apikey: anonKey, authorization: `Bearer ${supabaseToken}` },
	});
	const rows = await read.json();
	check(
		"OIDC-minted JWT reads its workspace rows through app.is_workspace_member",
		Array.isArray(rows) && rows.length === 1 && rows[0].note === "a9 live row",
		`rows=${JSON.stringify(rows)}`,
	);

	// The owner-anchored path (owner_id = better-auth id) works only if the
	// JWT sub equals the better-auth id. This is the crux of the policy swap.
	const ownerInsert = await fetch(`${API}/rest/v1/${scratchTable}`, {
		method: "POST",
		headers: {
			apikey: anonKey,
			authorization: `Bearer ${supabaseToken}`,
			"content-type": "application/json",
			prefer: "return=representation",
		},
		body: JSON.stringify({ workspace_id: null, owner_id: issuerUserId, note: "owner row" }),
	});
	check(
		"owner-anchored insert (owner_id = better-auth id) accepted",
		ownerInsert.status === 201,
		`status=${ownerInsert.status} (claim==owner_id => ${claimUserId === issuerUserId})`,
	);

	const ownerRead = await fetch(`${API}/rest/v1/${scratchTable}?select=note`, {
		headers: { apikey: anonKey, authorization: `Bearer ${supabaseToken}` },
	});
	const ownerRows = await ownerRead.json();
	check(
		"reads both rows (workspace + owner anchored)",
		Array.isArray(ownerRows) && ownerRows.length === 2,
		`rows=${ownerRows.length}`,
	);

	console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
	console.log(`FINDING: Supabase JWT velure_user_id ${claimUserId === issuerUserId ? "EQUALS" : "DOES NOT EQUAL"} better-auth user id`);
	if (failed > 0) process.exitCode = 1;
}

try {
	await main();
} finally {
	await cleanup();
	console.log("cleanup: provider, auth user, workspace, and table removed");
}
