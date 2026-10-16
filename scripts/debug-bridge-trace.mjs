/**
 * Debug trace for the A10 Supabase session bridge.
 * Mirrors mintSupabaseAccessToken() but logs every hop so we can see
 * exactly where the OIDC flow stops producing redirects.
 *
 * Usage: node scripts/debug-bridge-trace.mjs
 * Reads ISSUER_URL / BRIDGE_ADMIN_TOKEN / VITE_SUPABASE_URL /
 * VITE_SUPABASE_PUBLISHABLE_KEY from the environment (.env is loaded
 * because vitest does not run here — pass them inline or via env file).
 */
import { readFileSync } from "node:fs";
import process from "node:process";

// Minimal .env loader (KEY=VALUE lines, no interpolation).
for (const line of readFileSync(".env", "utf8").split("\n")) {
	const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
	if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const ISSUER_URL = process.env.ISSUER_URL;
const BRIDGE_ADMIN_TOKEN = process.env.BRIDGE_ADMIN_TOKEN;
const API = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL).replace(/\/$/, "");
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY;

if (!ISSUER_URL || !BRIDGE_ADMIN_TOKEN || !API || !ANON) {
	throw new Error("missing env");
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

async function hop(label, url, { method = "GET", headers = {}, body, jar } = {}) {
	const res = await fetch(url, {
		method,
		headers: { ...headers, cookie: jar?.header() ?? "" },
		body: body === undefined ? undefined : body,
		redirect: "manual",
	});
	jar?.store(res);
	const location = res.headers.get("location");
	const contentType = res.headers.get("content-type") ?? "";
	let bodyText = "";
	if (contentType.includes("json")) {
		bodyText = (await res.clone().text()).slice(0, 400);
	} else if (res.status >= 400 || !location) {
		bodyText = (await res.clone().text()).slice(0, 400);
	}
	console.log(`--- ${label} ---`);
	console.log(`  ${method} ${url}`);
	console.log(`  status=${res.status} ctype=${contentType.split(";")[0]} location=${location ?? "-"}`);
	if (bodyText) console.log(`  body: ${bodyText}`);
	return res;
}

// 1) Provision the user at the issuer with the app's id.
const userId = "k57azk0s24fr7q1ss0fbdvtcnn8cnraz";
const email = "debug-1786984610@example.com";
const provision = await hop(
	"provision",
	`${ISSUER_URL}/__bridge/provision`,
	{
		method: "POST",
		headers: { "x-bridge-token": BRIDGE_ADMIN_TOKEN, "content-type": "application/json" },
		body: JSON.stringify({ userId, email, name: email }),
	},
);
if (provision.status !== 200) process.exit(1);
const { password } = await provision.json();

// 2) Sign in at the issuer.
const jar = makeCookieJar();
await hop(
	"issuer sign-in",
	`${ISSUER_URL}/sign-in/email`,
	{
		method: "POST",
		headers: { "content-type": "application/json", origin: ISSUER_URL },
		body: JSON.stringify({ email, password }),
		jar,
	},
);

// 3) Drive GoTrue authorize -> issuer -> callback.
async function follow(url, jar, headers = {}, hops = 0) {
	const res = await hop(`redirect hop ${hops}`, url, { headers, jar });
	let jsonRedirect = null;
	if (res.status === 200 && res.headers.get("content-type")?.includes("application/json")) {
		try {
			const parsed = await res.clone().json();
			if (parsed?.redirect === true && parsed.url) jsonRedirect = parsed.url;
		} catch {
			/* not a JSON redirect */
		}
	}
	const location = res.headers.get("location");
	const nextUrl = res.status >= 300 && res.status < 400 && location ? location : jsonRedirect;
	if (nextUrl) {
		const next = new URL(nextUrl, url);
		const inFlow =
			next.hostname.endsWith("supabase.co") || next.hostname === new URL(ISSUER_URL).hostname;
		if (!inFlow) {
			console.log(`--- HANDOFF (leaves flow) ---`);
			console.log(`  ${next.toString()}`);
			console.log(`  fragment: ${next.hash}`);
			return;
		}
		if (hops > 8) throw new Error("too many redirects");
		return follow(next.toString(), jar, headers, hops + 1);
	}
	console.log(`--- FLOW ENDED at hop ${hops} without handoff ---`);
}

await follow(`${API}/auth/v1/authorize?provider=custom:velure`, jar, { apikey: ANON });
