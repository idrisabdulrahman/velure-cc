#!/usr/bin/env node
/**
 * A8 audit trail: backfill `audit_logs.resource_id` (Option B from
 * migration-plan.md §8.3).
 *
 * The A8 importer assigned every row its UUID via a deterministic
 * `stableUuid(table, convexId)` (SHA-256, v5-style) but never rewrote
 * `audit_logs.resource_id` — so 228 audit rows still reference their
 * resources by Convex-era ids (`j57...`). Because `stableUuid` is a pure
 * function of (table, id), the mapping can be re-derived OFFLINE, without
 * re-running the import: for each audit row whose resource_type maps to a
 * migrated table, compute the UUID the importer wrote for that resource
 * and, if a row with that id exists, rewrite resource_id.
 *
 * Usage:
 *   node scripts/bridge-proof/backfill-audit-resource-ids.mjs            # dry-run (plan)
 *   node scripts/bridge-proof/backfill-audit-resource-ids.mjs --apply    # write changes
 *
 * Env: SUPABASE_ACCESS_TOKEN (or ~/.supabase/access-token),
 * SUPABASE_PROJECT_REF (default kbexydkmmfabfutgkbxn).
 *
 * Exit codes: 0 = all non-uuid resource ids resolved (or none to do);
 * 1 = some rows could not be resolved; 2 = could not run.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REF = process.env.SUPABASE_PROJECT_REF ?? "kbexydkmmfabfutgkbxn";
const MGMT = "https://api.supabase.com";
const PREFIX = "[backfill:audit-resource-ids]";

const APPLY = process.argv.includes("--apply");

// audit_logs.resource_type -> migrated target table (IMPORT_ORDER names).
const RESOURCE_TYPE_TO_TABLE = {
	invoice: "invoices",
	workspace: "workspaces",
	recurring_invoice_schedule: "recurring_invoice_schedules",
	invoice_export: "invoice_exports",
};

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Mirror of scripts/migrate-convex-to-supabase.mjs stableUuid(). */
function stableUuid(table, id) {
	const bytes = createHash("sha256").update(`${table}:${id}`).digest();
	bytes[6] = (bytes[6] & 0x0f) | 0x50;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	return [
		bytes.subarray(0, 4),
		bytes.subarray(4, 6),
		bytes.subarray(6, 8),
		bytes.subarray(8, 10),
		bytes.subarray(10, 16),
	]
		.map((part) => part.toString("hex"))
		.join("-");
}

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

async function mgmtSql(token, query) {
	const res = await fetch(`${MGMT}/v1/projects/${REF}/database/query`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ query }),
	});
	const text = await res.text();
	if (!res.ok) {
		throw new Error(`mgmt SQL failed: ${res.status} ${text.slice(0, 300)}`);
	}
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

async function main() {
	const token = process.env.SUPABASE_ACCESS_TOKEN || readCachedAccessToken();
	if (!token) fail("no Supabase access token (set SUPABASE_ACCESS_TOKEN)");

	// 1. Audit rows with non-uuid resource ids.
	const rows = await mgmtSql(
		token,
		`select id, resource_type, resource_id
		 from public.audit_logs
		 where resource_id is not null
		   and resource_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
		 order by resource_type, resource_id;`,
	);
	if (!Array.isArray(rows)) fail(`unexpected response: ${String(rows).slice(0, 200)}`);
	if (rows.length === 0) {
		console.log(`${PREFIX} nothing to do: all audit resource_ids are already uuids.`);
		return;
	}
	console.log(`${PREFIX} ${rows.length} audit rows hold non-uuid resource ids.`);

	// 2. Group by table and check which computed uuids actually exist.
	const byTable = new Map();
	for (const row of rows) {
		const table = RESOURCE_TYPE_TO_TABLE[row.resource_type];
		if (!table) {
			console.error(
				`${PREFIX} WARN: no target table for resource_type "${row.resource_type}" (${row.resource_id}) — leaving as-is.`,
			);
			continue;
		}
		if (!byTable.has(table)) byTable.set(table, []);
		byTable.get(table).push(row);
	}

	const resolved = [];
	const unresolved = [];
	for (const [table, group] of byTable) {
		const pairs = group.map((r) => ({ id: r.id, convexId: r.resource_id, uuid: stableUuid(table, r.resource_id) }));
		const existing = await mgmtSql(
			token,
			`select id from public.${table} where id in (${pairs.map((p) => `'${p.uuid}'`).join(",")});`,
		);
		const existingSet = new Set(existing.map((e) => e.id));
		for (const p of pairs) {
			if (existingSet.has(p.uuid)) resolved.push(p);
			else {
				unresolved.push({ ...p, table });
				console.error(
					`${PREFIX} WARN: ${table} has no row ${p.uuid} (convex ${p.convexId}) — resource likely deleted before the snapshot; leaving as-is.`,
				);
			}
		}
	}

	console.log(
		`${PREFIX} plan: resolve ${resolved.length} rows (${byTable.size} tables); ${unresolved.length} unresolvable.`,
	);

	if (!APPLY) {
		console.log(`${PREFIX} dry-run: no changes written. Re-run with --apply to write.`);
		if (unresolved.length > 0) process.exit(1);
		return;
	}

	// 3. Apply in per-table batches.
	let applied = 0;
	for (const [table, group] of byTable) {
		const pairs = group.map((r) => ({ id: r.id, uuid: stableUuid(table, r.resource_id) }));
		const existing = await mgmtSql(
			token,
			`select id from public.${table} where id in (${pairs.map((p) => `'${p.uuid}'`).join(",")});`,
		);
		const existingSet = new Set(existing.map((e) => e.id));
		const updates = pairs
			.filter((p) => existingSet.has(p.uuid))
			.map((p) => `update public.audit_logs set resource_id = '${p.uuid}' where id = '${p.id}';`);
		for (let i = 0; i < updates.length; i += 50) {
			await mgmtSql(token, updates.slice(i, i + 50).join(" "));
		}
		applied += updates.length;
		console.log(`${PREFIX} applied ${updates.length} updates on ${table}.`);
	}

	// 4. Verify.
	const remaining = await mgmtSql(
		token,
		`select count(*)::int as total from public.audit_logs
		 where resource_id is not null
		   and resource_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';`,
	);
	console.log(
		`${PREFIX} applied ${applied} total; ${remaining[0].total} non-uuid rows remain (expected = unresolvable count).`,
	);
	if (remaining[0].total !== unresolved.length) process.exit(1);
	if (unresolved.length > 0) process.exit(1);
}

await main().catch((error) => {
	console.error(`${PREFIX} ${error instanceof Error ? error.message : String(error)}`);
	process.exit(2);
});
