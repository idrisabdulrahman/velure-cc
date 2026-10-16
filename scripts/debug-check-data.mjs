/**
 * Check Supabase data presence: row counts per public table (service role)
 * plus an RLS-scoped read as the debug user's minted JWT.
 *
 * Usage: node scripts/debug-check-data.mjs <accessToken>
 * Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from .env.
 */
import { readFileSync } from "node:fs";
import process from "node:process";

for (const line of readFileSync(".env", "utf8").split("\n")) {
	const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
	if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const API = process.env.VITE_SUPABASE_URL.replace(/\/$/, "");
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const token = process.argv[2];

const TABLES = [
	"workspaces",
	"workspace_members",
	"clients",
	"products",
	"invoices",
	"invoice_items",
	"payments",
	"reminders",
	"integrations",
	"audit_logs",
];

console.log("=== service-role row counts (all data in Supabase) ===");
for (const t of TABLES) {
	const res = await fetch(`${API}/rest/v1/${t}?select=id&limit=1`, {
		headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
	});
	if (res.status === 404 || res.status === 400) {
		console.log(`  ${t}: NOT EXPOSED (${res.status})`);
		continue;
	}
	const body = await res.json();
	console.log(`  ${t}: ${Array.isArray(body) ? body.length : JSON.stringify(body).slice(0, 80)} (status ${res.status})`);
}

console.log("\n=== total counts (service role, head) ===");
for (const t of TABLES) {
	try {
		const res = await fetch(`${API}/rest/v1/${t}?select=id`, {
			headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` },
		});
		if (!res.ok) continue;
		const rows = await res.json();
		console.log(`  ${t}: ${rows.length} rows`);
	} catch {
		/* skip */
	}
}

if (token) {
	console.log("\n=== RLS-scoped read with minted user JWT ===");
	for (const t of ["workspaces", "workspace_members", "clients", "invoices", "payments", "reminders", "integrations"]) {
		const res = await fetch(`${API}/rest/v1/${t}?select=*&limit=5`, {
			headers: { apikey: ANON, authorization: `Bearer ${token}` },
		});
		const rows = await res.json();
		console.log(`  ${t}: status=${res.status} rows=${Array.isArray(rows) ? rows.length : "n/a"}`);
		if (Array.isArray(rows) && rows.length) console.log(`    sample: ${JSON.stringify(rows[0]).slice(0, 220)}`);
	}
}
