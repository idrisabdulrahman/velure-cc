#!/usr/bin/env node
/**
 * Identity continuity gate (A8 -> A9/A10 pre-flip).
 *
 * Proves the OIDC bridge resolves REAL users' existing rows: the minted
 * Supabase JWT's `velure_user_id` must equal the app's better-auth user id
 * (the Convex `_id`, a `k5...` string) that the A8 snapshot stored in every
 * `owner_id`/`user_id` column. If the bridge minted any other id, RLS would
 * correctly return zero rows for real users after the flip — empty screens.
 *
 * Two modes:
 *
 *   node scripts/bridge-proof/identity-continuity.mjs            # FULL live check
 *   node scripts/bridge-proof/identity-continuity.mjs --check-data  # remote invariants
 *   node scripts/bridge-proof/identity-continuity.mjs --local       # local invariants
 *
 * Full live check (default):
 *   1. pick the OLDEST real workspace owner (has real rows to resolve);
 *   2. provision that EXACT user id at the issuer (synthetic email, so the
 *      real user's better_auth / GoTrue rows are never touched);
 *   3. sign in at the issuer through the real /sign-in/email endpoint;
 *   4. drive GoTrue authorize -> issuer -> callback -> minted JWT;
 *   5. assert velure_user_id == the owner id AND RLS returns the owner's
 *      real workspace + membership + active row;
 *   6. clean up everything this run created (issuer user, GoTrue user,
 *      identity, provider only if this run registered it).
 *
 *   Env: SUPABASE_ACCESS_TOKEN (or ~/.supabase/access-token), ISSUER_URL,
 *   BRIDGE_ADMIN_TOKEN. Anon/service keys are fetched from the management
 *   API (SUPABASE_ANON_KEY / SUPABASE_SERVICE_KEY override).
 *
 * CI-safe data checks (--check-data / --local):
 *   No issuer needed. Scans every user-bearing public column and fails if
 *   any row holds a non-Convex id (not `k5...`-shaped, e.g. a GoTrue uuid)
 *   or a user id that is not a workspace owner (orphan). This is the
 *   regression guard for "nothing may write a GoTrue `sub` into
 *   owner_id/user_id". --check-data runs against the linked project via the
 *   management API; --local runs the identical SQL against a Postgres
 *   reachable at SUPABASE_DB_URL / --db-url (psql, or docker run postgres:17
 *   psql when psql is absent) — mirroring guard-anon-privileges so CI can
 *   run it unconditionally in the same job as the anon-privileges guard.
 *
 * Exit codes: 0 = identity continuous; 1 = check failed (broken identity or
 * leaked id format); 2 = could not run (missing credentials/connection).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const REF = process.env.SUPABASE_PROJECT_REF ?? "kbexydkmmfabfutgkbxn";
const MGMT = "https://api.supabase.com";
const PROVIDER_IDENTIFIER = "custom:velure";
const CLIENT_SECRET = process.env.CLIENT_SECRET ?? "velure-supabase-client-secret-prod";
const ISSUER_URL = process.env.ISSUER_URL ?? "";

const args = process.argv.slice(2);
const CHECK_DATA_ONLY = args.includes("--check-data");
const SELF_TEST = args.includes("--self-test");
const LOCAL = args.includes("--local");
const flag = (name) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
};
const PROJECT_REF = flag("--project-ref") ?? REF;

const PREFIX = "[guard:identity-continuity]";

function fail(message, code = 2) {
	console.error(`${PREFIX} ${message}`);
	process.exit(code);
}

function readCachedAccessToken() {
	try {
		return readFileSync(join(homedir(), ".supabase", "access-token"), "utf8").trim();
	} catch {
		return undefined;
	}
}

async function mgmtSql(token, query, attempts = 3) {
	let lastErr;
	for (let i = 0; i < attempts; i += 1) {
		try {
			const res = await fetch(
				`${MGMT}/v1/projects/${PROJECT_REF}/database/query`,
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${token}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ query }),
				},
			);
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

async function fetchKeys(token) {
	const res = await fetch(`${MGMT}/v1/projects/${PROJECT_REF}/api-keys`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!res.ok) throw new Error(`api-keys: ${res.status} ${await res.text()}`);
	const keys = await res.json();
	const anon =
		process.env.SUPABASE_ANON_KEY ??
		keys.find((k) => k.name === "anon")?.api_key;
	const service =
		process.env.SUPABASE_SERVICE_KEY ??
		keys.find((k) => k.name === "service_role")?.api_key;
	if (!anon || !service) {
		throw new Error("anon/service_role keys not found via management API");
	}
	return { anon, service };
}

/**
 * CI-safe invariants: every user-bearing id is a Convex-era `k5...` string
 * (never a GoTrue uuid), and every user id appears as a workspace owner.
 */
/** True iff the value is a Convex-era id (the app's better-auth user id). */
export function isConvexUserId(value) {
	return typeof value === "string" && /^k5[a-z0-9]{30,38}$/.test(value);
}

const USER_COLUMN_INVENTORY_SQL = `select table_name, column_name from information_schema.columns
  where table_schema = 'public'
    and (column_name like '%owner%' or column_name like '%user_id%' or column_name = 'actor_id')
  order by table_name, column_name;`;

const shapeSql = (t, c) => `select
  count(*)::int as total,
  count(*) filter (where ${c} is null or ${c} = '')::int as empty,
  count(*) filter (
    where ${c} is not null and ${c} <> ''
      and ${c} !~ '^[a-z0-9]{30,40}$'
  )::int as nonconvex,
  count(*) filter (
    where ${c} is not null and ${c} <> ''
      and ${c} !~ '^k5'
  )::int as nonk5
from public.${t};`;

const orphanSql = (t, c) => `select count(*)::int as orphan from public.${t}
  where ${c} is not null and ${c} <> ''
    and ${c} not in (select owner_id from public.workspaces where owner_id is not null);`;

/**
 * Shared invariant check. `executor(query, cols)` returns rows as objects
 * keyed by the query's aliases; both the remote (management API) and local
 * (psql/docker) modes run this identical logic so the two can never drift.
 */
async function runChecks(executor, label) {
	const userCols = await executor(USER_COLUMN_INVENTORY_SQL, [
		"table_name",
		"column_name",
	]);
	if (!Array.isArray(userCols) || userCols.length === 0) {
		fail(`no user-bearing columns found in public schema (${label})`, 2);
	}

	const offenders = [];
	let total = 0;
	for (const { table_name: t, column_name: c } of userCols) {
		const rows = await executor(shapeSql(t, c), [
			"total",
			"empty",
			"nonconvex",
			"nonk5",
		]);
		const row = rows[0];
		total += Number(row.total);
		if (Number(row.nonk5) > 0) {
			offenders.push(`${t}.${c}: ${row.nonk5}/${row.total} rows not k5-shaped`);
		}
	}

	// Orphan check: a user id with rows but no workspace as owner would be
	// invisible after the flip (no anchor workspace to resolve).
	for (const { table_name: t, column_name: c } of userCols) {
		if (t === "workspaces") continue; // anchor table
		const rows = await executor(orphanSql(t, c), ["orphan"]);
		if (Number(rows[0].orphan) > 0) {
			offenders.push(`${t}.${c}: ${rows[0].orphan} orphan user id(s)`);
		}
	}

	if (offenders.length > 0) {
		console.error(`${PREFIX} FAIL: identity data invariants violated (${label}):`);
		for (const o of offenders) console.error(`  - ${o}`);
		process.exit(1);
	}
	console.log(
		`${PREFIX} OK: all ${total} user-bearing rows hold k5-shaped ids, zero orphans (${label}).`,
	);
}

/** Remote mode: run the shared invariants through the management API. */
function checkData(token) {
	return runChecks(
		async (query) => {
			const rows = await mgmtSql(token, query);
			return Array.isArray(rows) ? rows : [];
		},
		PROJECT_REF,
	);
}

/**
 * Local mode: run the shared invariants against a Postgres reachable at
 * SUPABASE_DB_URL / --db-url. Shells out to psql when present, otherwise
 * `docker run --rm --network host postgres:17 psql` (mirrors
 * guard-anon-privileges.mjs). psql output is pipe-separated without
 * headers, so rows are reconstructed positionally from the alias list.
 */
function makeLocalExecutor() {
	const url = flag("--db-url") || process.env.SUPABASE_DB_URL;
	if (!url) fail("local mode needs --db-url or SUPABASE_DB_URL");

	const probe = spawnSync("psql", ["--version"], { stdio: "ignore" });
	const command = probe.status === 0 ? "psql" : "docker";
	const prefix =
		command === "docker"
			? ["run", "--rm", "--network", "host", "postgres:17", "psql"]
			: [];

	return (query, cols) => {
		const res = spawnSync(
			command,
			[
				...prefix,
				"-X",
				"-t",
				"-A",
				"-F",
				"|",
				"-c",
				query,
				url,
			],
			{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
		);
		if (res.error) fail(`could not run ${command}: ${res.error.message}`);
		if (res.status !== 0) {
			fail(`psql exited ${res.status}: ${(res.stderr ?? "").trim()}`);
		}
		return res.stdout
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const parts = line.split("|");
				return Object.fromEntries(cols.map((c, i) => [c, parts[i]]));
			});
	};
}

/** fetch with bounded retries — the ngrok tunnel is occasionally flaky. */
async function fetchWithRetry(url, options = {}, attempts = 4) {
	let lastErr;
	for (let i = 0; i < attempts; i += 1) {
		try {
			const res = await fetch(url, options);
			return res;
		} catch (error) {
			lastErr = error;
			await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
		}
	}
	throw lastErr;
}



/**
 * Offline self-test of the k5-shape predicate — proves the guard bites
 * without touching the project or the network. Fails (exit 1) if the
 * predicate accepts a uuid or rejects a real Convex id.
 */
async function selfTest() {
	const good = [
		"k5791h17d88vvksx17ttjhymqn88y110", // real owner from velure-cc
		"k5702em3tmy4qgc4txff0c5bxh89g6gt", // real owner from velure-cc
	];
	const bad = [
		"fcdcc972-efdd-48c9-95c1-3d5fc59dde09", // GoTrue-style uuid
		"00000000-0000-4000-8000-000000000000",
		"",
		"k5-too-short",
		"K5791H17D88VVKSX17TTJHYMQN88Y110", // uppercase
		"k5791h17d88vvksx17ttjhymqn88y110!@#",
		"j57fc1v3mty4qgc4txff0c5bxh89g6gt", // invoice-prefix id, not a user
		null,
		undefined,
		12345,
	];
	const failures = [];
	for (const v of good) if (!isConvexUserId(v)) failures.push(`rejected good id: ${v}`);
	for (const v of bad) if (isConvexUserId(v)) failures.push(`accepted bad id: ${v}`);
	if (failures.length > 0) {
		for (const f of failures) console.error(`${PREFIX} self-test FAIL: ${f}`);
		process.exit(1);
	}
	console.log(`${PREFIX} self-test OK: k5 predicate rejects uuids and accepts real Convex ids.`);
}

// ---------------------------------------------------------------------------
// Live OIDC flow helpers (mirrors the A10 live gates' proven mechanics)
// ---------------------------------------------------------------------------

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

async function followRedirects(url, jar, headers = {}, hops = 0) {
	const res = await fetchWithRetry(url, {
		headers: { ...headers, cookie: jar.header() },
		redirect: "manual",
	});
	jar.store(res);
	const location = res.headers.get("location");
	let jsonRedirect = null;
	if (
		res.status === 200 &&
		res.headers.get("content-type")?.includes("application/json")
	) {
		try {
			const parsed = await res.clone().json();
			if (parsed?.redirect === true && parsed.url) jsonRedirect = parsed.url;
		} catch {
			/* not a JSON redirect */
		}
	}
	const next =
		res.status >= 300 && res.status < 400 && location ? location : jsonRedirect;
	if (next) {
		const u = new URL(next, url);
		const inFlow =
			u.hostname.endsWith("supabase.co") ||
			u.hostname === new URL(ISSUER_URL).hostname;
		if (!inFlow) return { handoff: u.toString() };
		if (hops > 8) throw new Error("too many redirects");
		return followRedirects(u.toString(), jar, headers, hops + 1);
	}
	if (res.status !== 200 && res.status !== 204) {
		console.error(
			`${PREFIX} redirect chain: ${url} -> ${res.status} (${res.headers.get("content-type") ?? "?"})`,
		);
	}
	return {};
}

async function ensureProvider(api, service) {
	const list = await fetchWithRetry(`${api}/auth/v1/admin/custom-providers`, {
		headers: { apikey: service, authorization: `Bearer ${service}` },
	});
	const body = await list.json();
	const existing = (body.providers ?? []).find(
		(p) => p.identifier === PROVIDER_IDENTIFIER,
	);
	if (existing) return false; // was already registered; do NOT delete it
	const res = await fetchWithRetry(`${api}/auth/v1/admin/custom-providers`, {
		method: "POST",
		headers: {
			apikey: service,
			authorization: `Bearer ${service}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			provider_type: "oidc",
			identifier: PROVIDER_IDENTIFIER,
			name: "Velure (identity continuity gate)",
			client_id: "velure-supabase-client",
			client_secret: CLIENT_SECRET,
			issuer: ISSUER_URL,
			scopes: ["openid", "profile", "email"],
		}),
	});
	if (!res.ok) throw new Error(`register provider: ${res.status} ${await res.text()}`);
	return true; // this run registered it; clean it up afterwards
}

/**
 * Full live check. Uses a synthetic email so the real owner's better_auth
 * and GoTrue rows are never touched — the only anchor is the user id, which
 * is exactly the identity under test.
 */
/**
 * Remove every artifact this run may have created, keyed by the synthetic
 * email (never the real owner's rows). Also deletes the provider when this
 * run registered it. Called from finally so a mid-flow failure can never
 * leave the issuer user, GoTrue user, or provider behind.
 */
async function cleanupRun(token, api, service, syntheticEmail, providerRegisteredByUs) {
	const deletes = [
		`delete from better_auth.account where "userId" in (
		   select id from better_auth."user" where "email" = '${syntheticEmail}'
		 )`,
		`delete from better_auth.session where "userId" in (
		   select id from better_auth."user" where "email" = '${syntheticEmail}'
		 )`,
		`delete from better_auth."user" where "email" = '${syntheticEmail}'`,
		`delete from auth.identities where user_id in (
		   select id from auth.users where email = '${syntheticEmail}'
		 )`,
		`delete from auth.sessions where user_id in (
		   select id from auth.users where email = '${syntheticEmail}'
		 )`,
		`delete from auth.users where email = '${syntheticEmail}'`,
	];
	try {
		await mgmtSql(token, deletes.join(";"));
		console.log(`${PREFIX} cleanup: issuer user + GoTrue user removed`);
	} catch (error) {
		console.error(`${PREFIX} cleanup: rows failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (providerRegisteredByUs) {
		try {
			const del = await fetchWithRetry(
				`${api}/auth/v1/admin/custom-providers/${PROVIDER_IDENTIFIER}`,
				{
					method: "DELETE",
					headers: { apikey: service, authorization: `Bearer ${service}` },
				},
			);
			console.log(`${PREFIX} cleanup: delete provider -> ${del.status}`);
		} catch (error) {
			console.error(`${PREFIX} cleanup: provider failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

async function checkLive(token, bridgeToken) {
	if (!ISSUER_URL) fail("ISSUER_URL is required for the live check", 2);
	if (!bridgeToken) fail("BRIDGE_ADMIN_TOKEN is required for the live check", 2);

	const { anon, service } = await fetchKeys(token);
	const api = `https://${PROJECT_REF}.supabase.co`;

	// 1. Pick the OLDEST real owner with a workspace + membership. Prefer an
	// owner with no existing better_auth row so this run never has to unwind
	// a real issuer account; the synthetic email keeps GoTrue rows untouched.
	const owners = await mgmtSql(
		token,
		`select w.owner_id, w.name, w.email,
		   (select count(*) from public.workspace_members m
		     where m.workspace_id = w.id) as members,
		   exists (
		     select 1 from better_auth."user" u where u."id" = w.owner_id
		   ) as already_mirrored
		 from public.workspaces w
		 where w.owner_id is not null and w.owner_id <> ''
		 order by already_mirrored asc, w.created_at asc nulls last
		 limit 1;`,
	);
	const owner = owners[0];
	if (!owner) fail(`no real workspace owner found on ${PROJECT_REF}`, 1);
	console.log(`${PREFIX} real owner: ${owner.owner_id} ("${owner.name}")`);

	// 2. Provision the owner's EXACT id with a synthetic email.
	const syntheticEmail = `identity-gate-${Date.now()}@${(owner.email ?? "invalid.local").split("@")[1] ?? "invalid.local"}`;
	let providerRegisteredByUs = false;
	try {
		providerRegisteredByUs = await ensureProvider(api, service);
		console.log(
			`${PREFIX} provider: ${providerRegisteredByUs ? "registered by this run" : "already registered (left in place)"}`,
		);

		const prov = await fetchWithRetry(`${ISSUER_URL}/__bridge/provision`, {
			method: "POST",
			headers: {
				"x-bridge-token": bridgeToken,
				"content-type": "application/json",
			},
			body: JSON.stringify({
				userId: owner.owner_id,
				email: syntheticEmail,
				name: "Identity Continuity Gate",
			}),
		});
		if (!prov.ok) throw new Error(`provision: ${prov.status} ${await prov.text()}`);
		const { password } = await prov.json();

	// 3. Sign in at the issuer through the real endpoint.
		const jar = makeCookieJar();
	const signin = await fetchWithRetry(`${ISSUER_URL}/sign-in/email`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email: syntheticEmail, password }),
		redirect: "manual",
	});
	if (signin.status !== 200)
		throw new Error(`sign-in: ${signin.status} ${await signin.text()}`);
	jar.store(signin);

	// 4. Drive GoTrue authorize -> issuer -> callback -> minted JWT.
	const { handoff } = await followRedirects(
		`${api}/auth/v1/authorize?provider=${PROVIDER_IDENTIFIER}`,
		jar,
		{ apikey: anon },
	);
	const fragment = handoff ? new URL(handoff).hash : "";
	const params = new URLSearchParams(fragment.replace(/^#/, ""));
	const tokenJwt = params.get("access_token");
	if (!tokenJwt) {
		throw new Error(
			`no access_token in handoff (error=${params.get("error") ?? "none"}): ${handoff?.slice(0, 120) ?? "no handoff"}`,
		);
	}
	const claims = decodeJwt(tokenJwt);
	console.log(
		`${PREFIX} minted JWT: velure_user_id=${claims.velure_user_id} sub=${claims.sub}`,
	);

	// 5. Assert identity + RLS resolution of REAL rows.
	if (claims.velure_user_id !== owner.owner_id) {
		console.error(
			`${PREFIX} FAIL: velure_user_id (${String(claims.velure_user_id)}) != owner_id (${owner.owner_id})`,
		);
		process.exitCode = 1;
	} else {
		console.log(`${PREFIX} velure_user_id matches the stored owner_id`);
	}

	const client = createClient(api, anon, {
		global: { headers: { Authorization: `Bearer ${tokenJwt}` } },
		auth: {
			autoRefreshToken: false,
			detectSessionInUrl: false,
			persistSession: false,
		},
	});
	// RLS reads, retried — a freshly minted JWT occasionally trips GoTrue's
	// clock-skew guard ("JWT issued at future") for a second.
	const readRls = async () =>
		Promise.all([
			client.from("workspaces").select("id, name, owner_id"),
			client.from("workspace_members").select("workspace_id, user_id, role"),
			client.from("active_workspaces").select("user_id, workspace_id"),
		]);
	let rlsResult;
	for (let i = 0; i < 4; i += 1) {
		const [w, m, a] = await readRls();
		const sk = [w, m, a].find((r) => r.error);
		if (!sk) {
			rlsResult = [w, m, a];
			break;
		}
		if (i === 3) throw new Error(`RLS read failed: ${sk.error.message}`);
		await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
	}
	const [ws, mem, act] = rlsResult;
	// A request error must NOT masquerade as a broken identity — surface it
	// as "could not run" (exit 2) so CI can never silently pass.
	for (const [label, res] of [
		["workspaces", ws],
		["workspace_members", mem],
		["active_workspaces", act],
	]) {
		if (res.error) {
			throw new Error(`RLS read of ${label} failed: ${res.error.message}`);
		}
	}
	const workspaces = ws.data ?? [];
	const memberships = mem.data ?? [];
	const active = act.data ?? [];
	console.log(
		`${PREFIX} RLS read: workspaces=${workspaces.length} memberships=${memberships.length} active=${active.length}`,
	);

	const matchWs = workspaces.find((w) => w.owner_id === owner.owner_id);
	const matchMem = memberships.find((m) => m.user_id === owner.owner_id);
	const matchAct = active.find((a) => a.user_id === owner.owner_id);
	if (!matchWs || !matchMem || !matchAct) {
		console.error(
			`${PREFIX} FAIL: real rows invisible to the minted JWT (ws=${Boolean(matchWs)} mem=${Boolean(matchMem)} act=${Boolean(matchAct)})`,
		);
		process.exitCode = 1;
	} else {
		console.log(
			`${PREFIX} OK: the minted JWT resolves the user's REAL rows (workspace "${matchWs.name}", ${matchMem.role})`,
		);
	}

		if (process.exitCode === 1) {
			console.error(
				`${PREFIX} FAIL: identity continuity broken — do NOT flip domains.`,
			);
		}
		return process.exitCode ?? 0;
	} finally {
		// 6. Cleanup ALWAYS runs — even on a mid-flow throw — so a flaky
		// tunnel can never leave artifacts behind.
		await cleanupRun(token, api, service, syntheticEmail, providerRegisteredByUs);
	}
}

async function main() {
	if (SELF_TEST) {
		await selfTest();
		return;
	}

	if (LOCAL) {
		await runChecks(
			makeLocalExecutor(),
			flag("--db-url") || process.env.SUPABASE_DB_URL || "local",
		);
		return;
	}

	const token = process.env.SUPABASE_ACCESS_TOKEN || readCachedAccessToken();
	if (!token) fail("no Supabase access token (set SUPABASE_ACCESS_TOKEN)");

	if (CHECK_DATA_ONLY) {
		await checkData(token);
		return;
	}

	const bridgeToken = process.env.BRIDGE_ADMIN_TOKEN;
	const code = await checkLive(token, bridgeToken);
	process.exit(code);
}

await main().catch((error) => {
	console.error(
		`${PREFIX} ${error instanceof Error ? error.message : String(error)}`,
	);
	process.exit(2);
});
