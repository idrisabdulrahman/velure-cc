import { createClient } from "@supabase/supabase-js";

const REF = "kbexydkmmfabfutgkbxn";
const API = `https://${REF}.supabase.co`;
const MGMT = "https://api.supabase.com";
const ISSUER = "https://capsule-sandpit-undergrad.ngrok-free.dev";
const TOKEN = process.env.SUPABASE_MANAGEMENT_TOKEN;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
const BRIDGE_TOKEN = process.env.BRIDGE_ADMIN_TOKEN;
const CLIENT_SECRET = "velure-supabase-client-secret-prod";

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

async function mgmtSql(query) {
	const res = await fetch(`${MGMT}/v1/projects/${REF}/database/query`, {
		method: "POST",
		headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
		body: JSON.stringify({ query }),
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`mgmt SQL: ${res.status} ${text.slice(0, 300)}`);
	try { return JSON.parse(text); } catch { return text; }
}

async function ensureProvider() {
	const list = await fetch(`${API}/auth/v1/admin/custom-providers`, {
		headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
	});
	const body = await list.json();
	const existing = (body.providers ?? []).find((p) => p.identifier === "custom:velure");
	if (existing) { console.log("provider: already registered"); return; }
	const res = await fetch(`${API}/auth/v1/admin/custom-providers`, {
		method: "POST",
		headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" },
		body: JSON.stringify({
			provider_type: "oidc",
			identifier: "custom:velure",
			name: "Velure (remap proof)",
			client_id: "velure-supabase-client",
			client_secret: CLIENT_SECRET,
			issuer: ISSUER,
			scopes: ["openid", "profile", "email"],
		}),
	});
	if (!res.ok) throw new Error(`register provider: ${res.status} ${await res.text()}`);
	console.log("provider: registered");
}

async function followRedirects(url, jar, headers = {}, hops = 0) {
	const res = await fetch(url, { headers: { ...headers, cookie: jar.header() }, redirect: "manual" });
	jar.store(res);
	const location = res.headers.get("location");
	let jsonRedirect = null;
	if (res.status === 200 && res.headers.get("content-type")?.includes("application/json")) {
		try {
			const parsed = await res.clone().json();
			if (parsed?.redirect === true && parsed.url) jsonRedirect = parsed.url;
		} catch {}
	}
	const next = res.status >= 300 && res.status < 400 && location ? location : jsonRedirect;
	if (next) {
		const u = new URL(next, url);
		const inFlow = u.hostname.endsWith("supabase.co") || u.hostname === new URL(ISSUER).hostname;
		if (!inFlow) return { handoff: u.toString() };
		if (hops > 8) throw new Error("too many redirects");
		return followRedirects(u.toString(), jar, headers, hops + 1);
	}
	if (res.status !== 200 && res.status !== 204) {
		console.error(`redirect chain: ${url} -> status ${res.status} (content-type ${res.headers.get("content-type")})`);
	}
	return {};
}

async function main() {
	const rows = await mgmtSql(`
		select w.owner_id, w.name, w.email,
		  (select count(*) from public.workspace_members m where m.workspace_id = w.id) as members
		from public.workspaces w
		where w.owner_id is not null and w.owner_id <> ''
		order by w.created_at asc nulls last
		limit 1;
	`);
	const real = rows[0];
	if (!real) throw new Error("no real owner found");
	console.log("REAL OWNER:", JSON.stringify(real));

	await ensureProvider();

	const prov = await fetch(`${ISSUER}/__bridge/provision`, {
		method: "POST",
		headers: { "x-bridge-token": BRIDGE_TOKEN, "content-type": "application/json" },
		body: JSON.stringify({ userId: real.owner_id, email: real.email, name: "Remap Proof" }),
	});
	console.log("provision status:", prov.status);
	if (!prov.ok) throw new Error(`provision: ${prov.status} ${await prov.text()}`);
	const { password } = await prov.json();

	const jar = makeCookieJar();
	const email = real.email;
	const signin = await fetch(`${ISSUER}/sign-in/email`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email, password }),
		redirect: "manual",
	});
	console.log("sign-in status:", signin.status);
	if (signin.status !== 200) throw new Error(`sign-in: ${signin.status} ${await signin.text()}`);
	jar.store(signin);

	const { handoff } = await followRedirects(
		`${API}/auth/v1/authorize?provider=custom:velure`,
		jar,
		{ apikey: ANON },
	);
	console.log("handoff:", handoff ? handoff.slice(0, 120) : "(none)");
	const fragment = handoff ? new URL(handoff).hash : "";
	const params = new URLSearchParams(fragment.replace(/^#/, ""));
	const token = params.get("access_token");
	if (!token) throw new Error(`no access_token (error=${params.get("error") ?? "none"})`);
	const claims = decodeJwt(token);
	console.log("JWT velure_user_id:", claims.velure_user_id, "| sub:", claims.sub);

	const client = createClient(API, ANON, {
		global: { headers: { Authorization: `Bearer ${token}` } },
		auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
	});
	const ws = await client.from("workspaces").select("id, name, owner_id");
	const mem = await client.from("workspace_members").select("workspace_id, user_id, role");
	const act = await client.from("active_workspaces").select("user_id, workspace_id");
	const cli = await client.from("clients").select("id, name, owner_id");

	const workspaces = ws.data ?? [];
	const memberships = mem.data ?? [];
	console.log(`RLS read: workspaces=${workspaces.length} memberships=${memberships.length} active=${(act.data ?? []).length} clients=${(cli.data ?? []).length}`);
	const matchWs = workspaces.find((w) => w.owner_id === real.owner_id);
	const matchMem = memberships.find((m) => m.user_id === real.owner_id);
	console.log("owner's workspace visible:", Boolean(matchWs), "| owner's membership visible:", Boolean(matchMem));
	if (!matchWs || !matchMem) throw new Error("IDENTITY NOT CONTINUOUS: real rows invisible to minted JWT");

	console.log("RESULT: IDENTITY CONTINUOUS — minted JWT resolves the user's REAL existing rows");
	console.log("VISIBLE WORKSPACE:", JSON.stringify(matchWs));
}

main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
