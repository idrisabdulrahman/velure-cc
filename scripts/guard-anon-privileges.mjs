#!/usr/bin/env node
/**
 * CI guard: fail when any public-schema relation grants privileges to `anon`
 * (or to PUBLIC, which anon inherits) without an explicit revoke.
 *
 * Supabase's default privileges grant anon (and authenticated) full access to
 * tables created in the public schema. Every migration must explicitly revoke
 * before selective grants; this guard enforces that posture against the
 * actual database state (the landmine the 2026-08-15 live RLS run exposed).
 *
 * Usage:
 *   node scripts/guard-anon-privileges.mjs                 # remote project
 *   node scripts/guard-anon-privileges.mjs --local         # local database
 *   node scripts/guard-anon-privileges.mjs --local --db-url postgresql://...
 *
 * Remote mode (default) uses the Supabase Management API SQL endpoint:
 *   SUPABASE_ACCESS_TOKEN  (falls back to ~/.supabase/access-token)
 *   --project-ref REF      (falls back to supabase/.temp/project-ref)
 *
 * Local mode executes the same query against a Postgres reachable at
 * SUPABASE_DB_URL (or --db-url). It shells out to `psql` when available,
 * otherwise to `docker run --rm --network host postgres:17 psql` (Linux).
 *
 * Exit codes: 0 = no anon grants; 1 = at least one relation grants to anon;
 * 2 = could not run the check (missing credentials/connection/tooling), so a
 * silent no-op can never pass CI.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const QUERY = readFileSync(join(__dirname, "guard-anon-privileges.sql"), "utf8").trim();
const COUNT_QUERY = `
  select count(*)::int
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'v', 'm');
`;

const args = process.argv.slice(2);
const flag = (name) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
};
const has = (name) => args.includes(name);

function fail(message, code = 2) {
	console.error(`[guard:anon-privileges] ${message}`);
	process.exit(code);
}

function readCachedAccessToken() {
	try {
		return readFileSync(join(homedir(), ".supabase", "access-token"), "utf8").trim();
	} catch {
		return undefined;
	}
}

/** Run the query against the linked project via the Management API. */
async function runRemote() {
	const token = process.env.SUPABASE_ACCESS_TOKEN || readCachedAccessToken();
	if (!token) fail("no Supabase access token (set SUPABASE_ACCESS_TOKEN)");
	const ref =
		flag("--project-ref") ??
		(() => {
			try {
				return readFileSync(join(ROOT, "supabase", ".temp", "project-ref"), "utf8").trim();
			} catch {
				return undefined;
			}
		})();
	if (!ref) fail("no project ref (set --project-ref or link the project)");

	const run = async (query) => {
		const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ query }),
		});
		const body = await res.json().catch(() => null);
		if (!res.ok) {
			const detail = body && (body.message ?? body.error) ? JSON.stringify(body) : `HTTP ${res.status}`;
			fail(`management API query failed (${ref}): ${detail}`);
		}
		return body;
	};

	const [offenders, countRows] = await Promise.all([run(QUERY), run(COUNT_QUERY)]);
	return {
		offenders: Array.isArray(offenders) ? offenders : [],
		total: Array.isArray(countRows) && countRows[0]?.count ? Number(countRows[0].count) : 0,
	};
}

/** Run the query against a local Postgres via psql (or docker fallback). */
function runLocal() {
	const url = flag("--db-url") || process.env.SUPABASE_DB_URL;
	if (!url) fail("local mode needs --db-url or SUPABASE_DB_URL");

	const psqlArgs = (query) => ["-X", "-t", "-A", "-F", "|", "-c", query, url];
	const probe = spawnSync("psql", ["--version"], { stdio: "ignore" });
	const command = probe.status === 0 ? "psql" : "docker";
	const prefix = command === "docker" ? ["run", "--rm", "--network", "host", "postgres:17", "psql"] : [];

	const execQuery = (query) => {
		const res = spawnSync(command, [...prefix, ...psqlArgs(query)], {
			encoding: "utf8",
			maxBuffer: 16 * 1024 * 1024,
		});
		if (res.error) fail(`could not run ${command}: ${res.error.message}`);
		if (res.status !== 0) fail(`psql exited ${res.status}: ${(res.stderr ?? "").trim()}`);
		return res.stdout.trim();
	};

	const offenders = execQuery(QUERY)
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [schema, relation, kind, grantee, granted] = line.split("|");
			return { schema, relation, kind, grantee, granted_privileges: granted };
		});
	const total = Number(execQuery(COUNT_QUERY)) || 0;
	return { offenders, total };
}

async function main() {
	const mode = has("--local") ? "local" : "remote";
	const result = mode === "local" ? runLocal() : await runRemote();

	if (result.offenders.length > 0) {
		console.error(`[guard:anon-privileges] FAIL: ${result.offenders.length} public-schema relation(s) grant privileges to anon or PUBLIC:`);
		for (const row of result.offenders) {
			console.error(`  - ${row.schema}.${row.relation} (${row.kind}): ${row.grantee} -> ${row.granted_privileges}`);
			const roles =
				row.grantee === "PUBLIC"
					? "anon, authenticated, public"
					: "anon, authenticated";
			console.error(`    fix: revoke all on table ${row.schema}.${row.relation} from ${roles};`);
		}
		process.exit(1);
	}

	console.log(
		`[guard:anon-privileges] OK: no public-schema relation grants privileges to anon (checked ${result.total} relations).`,
	);
}

await main();
