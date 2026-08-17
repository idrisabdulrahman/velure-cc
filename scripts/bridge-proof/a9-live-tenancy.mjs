/**
 * Live A9 tenancy suite: the activated RLS policies against REAL OIDC JWTs.
 *
 * Runs after `20260815190830_phase_a9_activate_rls_policies.sql` is applied to
 * `velure-cc` (and the custom access token hook is enabled, so the minted JWTs
 * carry `velure_user_id` == the better-auth user id). Four scratch users sign
 * in through the real OIDC flow (owner, member, viewer, outsider), and the
 * suite drives PostgREST against the REAL tables:
 *
 *   * bootstrap flow: a user creates a workspace + their own membership
 *     through the authenticated path (workspaces_insert with-check +
 *     workspace_members_self_insert);
 *   * W1/W2 isolation: each owner sees only their own workspace and clients;
 *   * outsider: reads zero rows of other workspaces, cross-workspace inserts
 *     are rejected, no-anchor inserts rejected;
 *   * viewer: can read the workspace but cannot insert/update/delete;
 *   * member: can write, but cannot delete a workspace they don't own;
 *   * owner-only workspace delete;
 *   * active_workspaces with-check (cannot point at a workspace you don't
 *     belong to);
 *   * job_runs stays server-only (authenticated denied);
 *   * audit_logs is member-SELECT only.
 *
 * Everything is scratch and removed in `finally`: the OIDC provider, the
 * GoTrue auth users, and the scratch workspace/membership/client/active/
 * audit rows. Real data (87 workspaces / 87 memberships / 3 clients at the
 * time of writing) is never touched.
 *
 * Env: SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, SUPABASE_MANAGEMENT_TOKEN,
 * ISSUER_URL (public tunnel URL).
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
const EMAILS = {
	owner: `a9-ten-owner-${suffix}@gmail.com`,
	member: `a9-ten-member-${suffix}@gmail.com`,
	viewer: `a9-ten-viewer-${suffix}@gmail.com`,
	outsider: `a9-ten-outsider-${suffix}@gmail.com`,
};
const PASSWORD = "A9BridgePass-2026!";

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

function makeCookieJar() {
	const cookies = new Map();
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

async function followRedirects(url, jar, { method = "GET", headers = {}, body } = {}, hops = 0) {
	const res = await fetch(url, {
		method,
		headers: { ...headers, cookie: jar.header() },
		body: body === undefined ? undefined : body,
		redirect: "manual",
	});
	jar.store(res);
	const location = res.headers.get("location");
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
		if (!inFlow) return { res, finalUrl: url, handoff: next.toString() };
		if (hops > 8) throw new Error("too many redirects");
		return followRedirects(next.toString(), jar, { method: "GET", headers }, hops + 1);
	}
	return { res, finalUrl: url };
}

/** Full real OIDC sign-in for one scratch user: signup -> verify -> authorize. */
async function oidcSignIn(email) {
	const jar = makeCookieJar();
	const signup = await fetch(`${ISSUER_URL}/sign-up/email`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email, password: PASSWORD, name: email.split("@")[0] }),
		redirect: "manual",
	});
	if (signup.status !== 200) throw new Error(`issuer sign-up ${email}: ${signup.status} ${await signup.text()}`);
	jar.store(signup);
	const signupBody = await signup.json();
	const issuerUserId = signupBody.user?.id;
	if (!issuerUserId) throw new Error(`no user id in sign-up response for ${email}`);

	// GoTrue rejects OIDC sign-ins with an unverified email. The memory-adapter
	// harness exposes a dev route to flip emailVerified; the PRODUCTION issuer
	// (production-issuer.mjs) does real verification via Resend and has no dev
	// route. For the suite, verify the scratch user the way a real verification
	// click would resolve: update better_auth."user" directly through the
	// management API (runs as postgres; the issuer's own role cannot write
	// outside its grants). Falls back to the dev route when present.
	const verify = await fetch(`${ISSUER_URL}/__dev/verify-email`, {
		method: "POST",
		headers: { "content-type": "application/json", "x-dev-token": "dev-secret-2026" },
		body: JSON.stringify({ email }),
	});
	if (verify.status === 404) {
		await mgmtSql(
			`update better_auth."user" set "emailVerified" = true where "email" = '${email}' and "emailVerified" = false;`,
		);
	} else if (verify.status !== 200) {
		throw new Error(`verify-email ${email}: ${verify.status}`);
	}

	// The PRODUCTION issuer requires email verification and does NOT auto
	// sign-in after verification — signup alone leaves no session cookie, so
	// authorize would redirect to the login page. Establish the session the
	// way a real user would: sign in with the verified password, then carry
	// the session cookie into the OIDC authorize flow.
	const signin = await fetch(`${ISSUER_URL}/sign-in/email`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email, password: PASSWORD }),
		redirect: "manual",
	});
	if (signin.status !== 200) throw new Error(`issuer sign-in ${email}: ${signin.status} ${await signin.text()}`);
	jar.store(signin);

	const { handoff } = await followRedirects(
		`${API}/auth/v1/authorize?provider=${PROVIDER_IDENTIFIER}`,
		jar,
		{ headers: { apikey: anonKey } },
	);
	const fragment = handoff ? new URL(handoff).hash : "";
	const params = new URLSearchParams(fragment.replace(/^#/, ""));
	const token = params.get("access_token");
	if (!token) throw new Error(`no access_token in handoff for ${email}: ${handoff?.slice(0, 200)}`);
	const decoded = decodeJwt(token);
	if (decoded.velure_user_id !== issuerUserId) {
		throw new Error(`velure_user_id claim missing for ${email} (got ${decoded.velure_user_id ?? "null"})`);
	}
	return { issuerUserId, jwt: token, jwtSub: decoded.sub };
}

/** PostgREST helper with an OIDC JWT (or anon when token is null). */
async function rest(method, path, { token = null, body, query = "", prefer = "return=representation" } = {}) {
	const headers = { apikey: anonKey, prefer };
	if (token) headers.authorization = `Bearer ${token}`;
	if (body !== undefined) headers["content-type"] = "application/json";
	const res = await fetch(`${API}/rest/v1/${path}${query}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await res.text();
	let json = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		/* non-JSON body */
	}
	return { status: res.status, body: json, text: text.slice(0, 300) };
}

let users = {}; // key -> {issuerUserId, jwt, jwtSub}
let wsIds = {}; // owner | outsider -> workspace id
let clientIds = []; // scratch client ids in W1
let scratchWorkspaceNames = [];
let activeIds = [];
let baseline = null; // real-data counts captured before the run

async function countReal() {
	const rows = await mgmtSql(
		"select (select count(*) from public.workspaces) as ws, (select count(*) from public.workspace_members) as wm, (select count(*) from public.clients) as cli;",
	);
	return rows[0];
}

async function cleanup() {
	try {
		const res = await fetch(`${API}/auth/v1/admin/custom-providers/${PROVIDER_IDENTIFIER}`, {
			method: "DELETE",
			headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
		});
		console.log(`cleanup: delete provider -> ${res.status}`);
	} catch (error) {
		console.error("cleanup: delete provider failed:", error.message);
	}
	try {
		const adminList = await fetch(`${API}/auth/v1/admin/users?page=1&per_page=200`, {
			headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
		});
		const adminBody = await adminList.json();
		for (const u of adminBody.users ?? []) {
			if (Object.values(EMAILS).includes(u.email)) {
				const res = await fetch(`${API}/auth/v1/admin/users/${u.id}`, {
					method: "DELETE",
					headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
				});
				console.log(`cleanup: delete auth user ${u.email} -> ${res.status}`);
			}
		}
	} catch (error) {
		console.error("cleanup: auth users failed:", error.message);
	}
	try {
		const names = scratchWorkspaceNames.map((n) => `'${n}'`).join(", ");
		const userIds = Object.values(users).map((u) => u.issuerUserId).join("', '");
		// guard empty IN lists (SQL syntax error); '' can never match a real id
		const wsClause = names ? `name in (${names})` : `name = '__none__'`;
		const userClause = userIds ? `user_id in ('${userIds}')` : `user_id = '__none__'`;
		await mgmtSql(`
			delete from public.active_workspaces where ${userClause};
			delete from public.clients where name like 'A9 Ten%';
			delete from public.workspace_members where workspace_id in (select id from public.workspaces where ${wsClause});
			delete from public.workspaces where ${wsClause};
			-- the issuer now persists users in better_auth (production shape)
			delete from better_auth."user" where "email" like 'a9-ten-%@gmail.com';
		`);
	} catch (error) {
		console.error("cleanup: scratch rows failed:", error.message);
	}
}

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
			name: "Velure (A9 tenancy suite)",
			client_id: "velure-supabase-client",
			// MUST match the issuer's trusted-client secret exactly — GoTrue sends
			// this value at the token endpoint and the issuer validates it
			// against its config.
			client_secret: process.env.CLIENT_SECRET ?? "velure-supabase-client-secret-prod",
			issuer: ISSUER_URL,
			scopes: ["openid", "profile", "email"],
		}),
	});
	if (!res.ok) throw new Error(`register provider: ${res.status} ${await res.text()}`);
	console.log(`  registered ${PROVIDER_IDENTIFIER} -> ${ISSUER_URL}`);
}

async function main() {
	baseline = await countReal();
	console.log(`  baseline real data: ${baseline.ws} workspaces, ${baseline.wm} memberships, ${baseline.cli} clients`);
	await ensureProvider();

	console.log("1) Four scratch users sign in through the real OIDC flow");
	for (const [key, email] of Object.entries(EMAILS)) {
		users[key] = await oidcSignIn(email);
		console.log(`  ${key}: better-auth id ${users[key].issuerUserId}, jwt sub ${users[key].jwtSub}`);
	}
	check("all four users carry velure_user_id == better-auth id", Object.values(users).length === 4);

	console.log("2) Bootstrap flow: owner and outsider create workspaces + own membership via the authenticated path");
	const ownerWs = await rest("POST", "workspaces", {
		token: users.owner.jwt,
		body: { owner_id: users.owner.issuerUserId, name: `A9 Ten W1 ${suffix}`, country_code: "NG", base_currency: "NGN", reminders_enabled: false, tax_rule_set_version: "ng-2026-q1" },
		query: "?select=id",
	});
	check("owner creates workspace via authenticated path (201)", ownerWs.status === 201, `status=${ownerWs.status} ${ownerWs.text}`);
	wsIds.owner = ownerWs.body?.[0]?.id;
	if (!wsIds.owner) throw new Error(`no workspace id returned: ${ownerWs.text}`);
	scratchWorkspaceNames.push(`A9 Ten W1 ${suffix}`);

	const ownerMember = await rest("POST", "workspace_members", {
		token: users.owner.jwt,
		body: { workspace_id: wsIds.owner, user_id: users.owner.issuerUserId, role: "owner" },
	});
	check("owner inserts own membership via authenticated path (201)", ownerMember.status === 201, `status=${ownerMember.status} ${ownerMember.text}`);

	const outWs = await rest("POST", "workspaces", {
		token: users.outsider.jwt,
		body: { owner_id: users.outsider.issuerUserId, name: `A9 Ten W2 ${suffix}`, country_code: "NG", base_currency: "NGN", reminders_enabled: false, tax_rule_set_version: "ng-2026-q1" },
		query: "?select=id",
	});
	check("outsider creates workspace via authenticated path (201)", outWs.status === 201, `status=${outWs.status} ${outWs.text}`);
	wsIds.outsider = outWs.body?.[0]?.id;
	if (!wsIds.outsider) throw new Error(`no workspace id returned: ${outWs.text}`);
	scratchWorkspaceNames.push(`A9 Ten W2 ${suffix}`);
	await rest("POST", "workspace_members", {
		token: users.outsider.jwt,
		body: { workspace_id: wsIds.outsider, user_id: users.outsider.issuerUserId, role: "owner" },
	});
	console.log(`  W1=${wsIds.owner} W2=${wsIds.outsider}`);

	console.log("3) Server-side invites (service role): member + viewer join W1");
	await mgmtSql(`
		insert into public.workspace_members (workspace_id, user_id, role)
		values ('${wsIds.owner}', '${users.member.issuerUserId}', 'member'),
		       ('${wsIds.owner}', '${users.viewer.issuerUserId}', 'viewer');
	`);

	console.log("4) Isolation: owners see only their own workspace");
	const ownerRead = await rest("GET", "workspaces", { token: users.owner.jwt, query: "?select=id,name" });
	const ownerNames = (ownerRead.body ?? []).map((w) => w.name);
	check("owner sees W1 (own workspace)", ownerNames.includes(`A9 Ten W1 ${suffix}`), JSON.stringify(ownerNames));
	check("owner does NOT see W2 (isolation)", !ownerNames.includes(`A9 Ten W2 ${suffix}`), JSON.stringify(ownerNames));

	const outsiderRead = await rest("GET", "workspaces", { token: users.outsider.jwt, query: "?select=id,name" });
	const outsiderNames = (outsiderRead.body ?? []).map((w) => w.name);
	check("outsider sees W2 (own workspace)", outsiderNames.includes(`A9 Ten W2 ${suffix}`), JSON.stringify(outsiderNames));
	check("outsider does NOT see W1 (isolation)", !outsiderNames.includes(`A9 Ten W1 ${suffix}`), JSON.stringify(outsiderNames));

	console.log("5) Client writes: owner and member insert into W1; outsider/viewer rejected");
	const mkClient = (workspaceId, ownerId) => ({
		name: `A9 Ten Client ${Math.random().toString(36).slice(2, 8)}`,
		email: `c-${Math.random().toString(36).slice(2, 8)}@test.com`,
		currency: "NGN",
		payment_terms: "Net 7",
		contact: {},
		favorite: false,
		status: "active",
		...(workspaceId ? { workspace_id: workspaceId } : {}),
		...(ownerId ? { owner_id: ownerId } : {}),
	});

	const o1 = await rest("POST", "clients", { token: users.owner.jwt, body: mkClient(wsIds.owner, null), query: "?select=id" });
	check("owner inserts client into W1 (201)", o1.status === 201, `status=${o1.status} ${o1.text}`);
	clientIds.push(o1.body?.[0]?.id);
	if (!clientIds[clientIds.length - 1]) throw new Error(`no client id returned: ${o1.text}`);

	const m1 = await rest("POST", "clients", { token: users.member.jwt, body: mkClient(wsIds.owner, null), query: "?select=id" });
	check("member inserts client into W1 (201)", m1.status === 201, `status=${m1.status} ${m1.text}`);
	clientIds.push(m1.body?.[0]?.id);
	if (!clientIds[clientIds.length - 1]) throw new Error(`no client id returned: ${m1.text}`);

	const v1 = await rest("POST", "clients", { token: users.viewer.jwt, body: mkClient(wsIds.owner, null) });
	check("viewer cannot insert into W1 (403)", v1.status === 403, `status=${v1.status} ${v1.text}`);

	const x1 = await rest("POST", "clients", { token: users.outsider.jwt, body: mkClient(wsIds.owner, null) });
	check("outsider cannot insert into W1 (403)", x1.status === 403, `status=${x1.status} ${x1.text}`);

	const na = await rest("POST", "clients", { token: users.outsider.jwt, body: mkClient(null, null) });
	check("no-anchor insert rejected (403)", na.status === 403, `status=${na.status} ${na.text}`);

	const own1 = await rest("POST", "clients", { token: users.owner.jwt, body: mkClient(null, users.owner.issuerUserId), query: "?select=id" });
	check("owner-anchored client insert accepted (201)", own1.status === 201, `status=${own1.status} ${own1.text}`);
	clientIds.push(own1.body?.[0]?.id);
	if (!clientIds[clientIds.length - 1]) throw new Error(`no client id returned: ${own1.text}`);

	console.log("6) Reads: member + viewer see W1 clients; outsider sees zero");
	const memberRead = await rest("GET", "clients", { token: users.member.jwt, query: `?workspace_id=eq.${wsIds.owner}&select=id` });
	check("member reads W1 clients (sees 2 workspace rows)", (memberRead.body ?? []).length === 2, `rows=${(memberRead.body ?? []).length}`);
	const viewerRead = await rest("GET", "clients", { token: users.viewer.jwt, query: `?workspace_id=eq.${wsIds.owner}&select=id` });
	check("viewer can read W1 clients", (viewerRead.body ?? []).length === 2, `rows=${(viewerRead.body ?? []).length}`);
	const outRead = await rest("GET", "clients", { token: users.outsider.jwt, query: `?workspace_id=eq.${wsIds.owner}&select=id` });
	check("outsider reads zero W1 clients", (outRead.body ?? []).length === 0, `rows=${(outRead.body ?? []).length}`);

	console.log("7) Viewer read-only: no update/delete");
	const vUpd = await rest("PATCH", "clients", {
		token: users.viewer.jwt,
		body: { name: "hacked" },
		query: `?id=eq.${clientIds[0]}`,
	});
	check("viewer cannot update W1 client (403)", vUpd.status === 403, `status=${vUpd.status} ${vUpd.text}`);
	const vDel = await rest("DELETE", "clients", { token: users.viewer.jwt, query: `?id=eq.${clientIds[0]}` });
	check("viewer cannot delete W1 client (RLS no-op, row intact)", vDel.status === 200 && (vDel.body ?? []).length === 0, `status=${vDel.status} rows=${(vDel.body ?? []).length} ${vDel.text}`);

	console.log("8) Member can delete a client; outsider cannot");
	const mDel = await rest("DELETE", "clients", { token: users.member.jwt, query: `?id=eq.${clientIds[1]}` });
	check("member deletes own workspace client (row returned)", mDel.status === 200 && (mDel.body ?? []).length === 1, `status=${mDel.status} rows=${(mDel.body ?? []).length} ${mDel.text}`);
	const xDel = await rest("DELETE", "clients", { token: users.outsider.jwt, query: `?id=eq.${clientIds[0]}` });
	check("outsider cannot delete W1 client (RLS no-op)", xDel.status === 200 && (xDel.body ?? []).length === 0, `status=${xDel.status} rows=${(xDel.body ?? []).length} ${xDel.text}`);

	console.log("9) Owner-only workspace delete");
	const ws3 = await rest("POST", "workspaces", {
		token: users.owner.jwt,
		body: { owner_id: users.owner.issuerUserId, name: `A9 Ten W3 ${suffix}`, country_code: "NG", base_currency: "NGN", reminders_enabled: false },
		query: "?select=id",
	});
	const w3id = ws3.body?.[0]?.id;
	if (!w3id) throw new Error(`no workspace id returned for W3: ${ws3.text}`);
	scratchWorkspaceNames.push(`A9 Ten W3 ${suffix}`);
	const mDelWs = await rest("DELETE", "workspaces", { token: users.member.jwt, query: `?id=eq.${w3id}` });
	check("member cannot delete a workspace they don't own (RLS no-op)", mDelWs.status === 200 && (mDelWs.body ?? []).length === 0, `status=${mDelWs.status} rows=${(mDelWs.body ?? []).length} ${mDelWs.text}`);
	const oDelWs = await rest("DELETE", "workspaces", { token: users.owner.jwt, query: `?id=eq.${w3id}` });
	check("owner deletes own workspace (row returned)", oDelWs.status === 200 && (oDelWs.body ?? []).length === 1, `status=${oDelWs.status} rows=${(oDelWs.body ?? []).length} ${oDelWs.text}`);

	console.log("10) active_workspaces with-check");
	const a1 = await rest("POST", "active_workspaces", {
		token: users.owner.jwt,
		body: { user_id: users.owner.issuerUserId, workspace_id: wsIds.owner },
	});
	check("owner sets own workspace active (201)", a1.status === 201, `status=${a1.status} ${a1.text}`);
	activeIds.push(users.owner.issuerUserId);
	const a2 = await rest("POST", "active_workspaces", {
		token: users.outsider.jwt,
		body: { user_id: users.outsider.issuerUserId, workspace_id: wsIds.owner },
	});
	check("outsider cannot point active_workspaces at W1 (403)", a2.status === 403, `status=${a2.status} ${a2.text}`);

	console.log("11) job_runs stays server-only; audit_logs member-SELECT");
	const jr = await rest("GET", "job_runs", { token: users.owner.jwt });
	check("job_runs server-only (RLS filters all rows)", jr.status === 200 && (jr.body ?? []).length === 0, `status=${jr.status} rows=${(jr.body ?? []).length}`);
	await mgmtSql(`
		insert into public.audit_logs (workspace_id, actor_id, actor_type, action, resource_type, result, message)
		values ('${wsIds.owner}', '${users.owner.issuerUserId}', 'user', 'invoice.created', 'workspace', 'success', 'A9 tenancy audit row');
	`);
	const al1 = await rest("GET", "audit_logs", { token: users.owner.jwt, query: `?workspace_id=eq.${wsIds.owner}&select=id` });
	check("owner reads W1 audit rows (1)", (al1.body ?? []).length === 1, `rows=${(al1.body ?? []).length}`);
	const al2 = await rest("GET", "audit_logs", { token: users.outsider.jwt, query: `?workspace_id=eq.${wsIds.owner}&select=id` });
	check("outsider reads zero W1 audit rows", (al2.body ?? []).length === 0, `rows=${(al2.body ?? []).length}`);

	console.log("12) anon denied on real tables");
	const anon = await rest("GET", "workspaces", { token: null, query: "?select=id&limit=1" });
	check("anon denied (401/403)", anon.status === 401 || anon.status === 403, `status=${anon.status} ${anon.text}`);

	console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
	if (failed > 0) process.exitCode = 1;
}

try {
	await main();
} finally {
	await cleanup();
	// Real-data restoration is verified AFTER cleanup removed all scratch rows.
	const after = await countReal().catch(() => null);
	if (baseline && after) {
		const ok = after.ws === baseline.ws && after.wm === baseline.wm && after.cli === baseline.cli;
		console.log(`real data restored: ${ok ? "YES" : "NO"} (${after.ws}/${after.wm}/${after.cli} vs baseline ${baseline.ws}/${baseline.wm}/${baseline.cli})`);
		if (!ok) process.exitCode = 1;
	}
	console.log("cleanup: provider, auth users, and scratch rows removed");
}
