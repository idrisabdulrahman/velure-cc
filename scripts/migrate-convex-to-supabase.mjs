import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const TABLES = [
	"workspaces", "workspaceMembers", "active_workspaces", "audit_logs",
	"jurisdictions", "tax_profiles", "clients", "products", "invoices",
	"recurring_invoice_schedules", "recurring_invoice_runs", "invoice_exports",
	"invoice_delivery_events", "email_events", "payment_transactions",
	"payment_charges", "reminder_rules", "reminder_runs", "reminder_events",
	"collections_cases", "integration_connections", "integration_sync_jobs",
	"integration_logs", "integration_webhooks", "job_runs",
];
const IMPORT_ORDER = [
	"jurisdictions", "workspaces", "workspaceMembers", "active_workspaces",
	"tax_profiles", "clients", "products", "invoices",
	"recurring_invoice_schedules", "recurring_invoice_runs", "invoice_exports",
	"invoice_delivery_events", "email_events", "payment_transactions",
	"payment_charges", "reminder_rules", "reminder_runs", "reminder_events",
	"collections_cases", "integration_connections", "integration_sync_jobs",
	"integration_logs", "integration_webhooks", "audit_logs", "job_runs",
];
const JSON_KEYS = /(?:json|payload|meta|metadata|raw_event|raw_response)$/i;
const TIME_KEYS = /(?:At|For|_at|_for)$/;
const REF_TABLES = {
	activeWorkspaceId: "workspaces",
	clientId: "clients",
	customerId: "clients",
	deliveryEventId: "invoice_delivery_events",
	invoiceId: "invoices",
	lastGeneratedInvoiceId: "invoices",
	productId: "products",
	scheduleId: "recurring_invoice_schedules",
	taxProfileId: "tax_profiles",
	workspaceId: "workspaces",
};

// Unresolvable references to nullable FK columns are imported as null (per
// migration-plan.md §A8); every other unmapped reference fails closed. Keyed by
// `<sourceTable>.<fieldName>` using the Convex field name.
const NULLABLE_REFS = new Set([
	"audit_logs.workspaceId",
	"clients.workspaceId",
	"email_events.deliveryEventId",
	"email_events.invoiceId",
	"email_events.workspaceId",
	"invoice_exports.invoiceId",
	"invoice_exports.workspaceId",
	"invoices.customerId",
	"job_runs.workspaceId",
	"recurring_invoice_runs.invoiceId",
	"recurring_invoice_schedules.lastGeneratedInvoiceId",
	"workspaces.defaultTaxProfileId",
]);

// Canonical rule-set ids and the legacy aliases written by earlier Velure
// versions. The workspaces.tax_rule_set_version FK rejects anything else, so
// unknown values fail closed instead of silently importing.
const RULE_SET_VERSIONS = new Map([
	["ng-2026-q1", "ng-2026-q1"],
	["ng-nrs-2026.1", "ng-2026-q1"],
	["NG-2026-v1", "ng-2026-q1"],
]);

// Convex-only fields with no Supabase column; dropped at import.
const IGNORE_FIELDS = new Set(["convertedToInvoiceId"]);

// Fields whose snake_case name differs from the Supabase column name.
const COLUMN_RENAMES = {
	invoices: { type: "invoice_type" },
};

// Column defaults mirrored from the Supabase migrations. PostgREST array
// upserts null-fill any key missing from a row, which bypasses column defaults
// and violates NOT NULL (e.g. invoices.document_type). Pre-filling the
// defaulted columns keeps omitted optional values importing as their defaults.
const DEFAULT_VALUES = {
	invoices: {
		date_format: "ng",
		document_type: "standard",
		invoice_size: "A4",
		invoice_type: "one-time",
		payment_amount: 0,
		status: "draft",
	},
	recurring_invoice_schedules: { generated_count: 0 },
	payment_charges: { provider: "paystack" },
};

function snake(value) {
	return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function tableName(name) {
	return name === "workspaceMembers" ? "workspace_members" : name;
}

function stableUuid(table, id) {
	const bytes = createHash("sha256").update(`${table}:${id}`).digest();
	bytes[6] = (bytes[6] & 0x0f) | 0x50;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;
	return [bytes.subarray(0, 4), bytes.subarray(4, 6), bytes.subarray(6, 8), bytes.subarray(8, 10), bytes.subarray(10, 16)]
		.map((part) => part.toString("hex"))
		.join("-");
}

function parseArgs() {
	const args = process.argv.slice(2);
	const inputIndex = args.indexOf("--input");
	const deploymentIndex = args.indexOf("--convex-deployment");
	const input = inputIndex >= 0 ? args[inputIndex + 1] : undefined;
	const deployment = deploymentIndex >= 0 ? args[deploymentIndex + 1] : undefined;
	if ((!input && !deployment) || (input && deployment)) {
		throw new Error("Usage: node scripts/migrate-convex-to-supabase.mjs (--input snapshot.json|export-dir | --convex-deployment dev|prod) [--apply]");
	}
	return { input, deployment, apply: args.includes("--apply") };
}

function readSnapshot(path) {
	if (statSync(path).isDirectory()) {
		const tables = {};
		for (const table of TABLES) {
			const documents = join(path, table, "documents.jsonl");
			if (!existsSync(documents)) continue;
			tables[table] = readFileSync(documents, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
		}
		return tables;
	}
	const snapshot = JSON.parse(readFileSync(path, "utf8"));
	if (!snapshot || typeof snapshot.tables !== "object" || Array.isArray(snapshot.tables)) {
		throw new Error("Snapshot must be an object shaped as { tables: { tableName: rows[] } }.");
	}
	for (const [name, rows] of Object.entries(snapshot.tables)) {
		if (!TABLES.includes(name)) throw new Error(`Unknown Convex table: ${name}`);
		if (!Array.isArray(rows)) throw new Error(`Snapshot table ${name} must contain an array.`);
	}
	return snapshot.tables;
}

function exportConvex(deployment) {
	const directory = mkdtempSync(join(tmpdir(), "velure-convex-export-"));
	const archive = join(directory, "export.zip");
	const exported = spawnSync("pnpm", ["exec", "convex", "export", "--path", archive, "--deployment", deployment], { encoding: "utf8" });
	if (exported.error || exported.status !== 0) throw new Error(exported.stderr || exported.error?.message || "Convex export failed.");
	const extracted = join(directory, "extracted");
	const unzipped = spawnSync("unzip", ["-q", archive, "-d", extracted], { encoding: "utf8" });
	if (unzipped.error || unzipped.status !== 0) throw new Error(unzipped.stderr || unzipped.error?.message || "Convex export extraction failed.");
	return { directory, extracted };
}

function convertValue(key, value, sourceTable, idMap) {
	if (value === undefined) return undefined;
	if (typeof value === "string" && value === "NGN" && (sourceTable === "jurisdictions" || key.toLowerCase().includes("jurisdiction"))) return "NG";
	if (JSON_KEYS.test(key) && typeof value === "string") {
		try { return JSON.parse(value); } catch {
			// Some fields declared as free text in convex/schema.ts (e.g.
			// reminder_events.meta is v.string()) map to jsonb columns in
			// Supabase. Preserve the exact string as a JSON string literal
			// instead of failing the whole import.
			return value;
		}
	}
	if (typeof value === "number" && TIME_KEYS.test(key) && value > 1_000_000_000_000) return new Date(value).toISOString();
	if (typeof value === "string" && REF_TABLES[key]) {
		const targetTable = REF_TABLES[key];
		const mapped = idMap.get(`${targetTable}:${value}`);
		if (mapped) return mapped;
		if (NULLABLE_REFS.has(`${sourceTable}.${key}`)) return null;
		throw new Error(`Unresolvable required reference ${sourceTable}.${key}=${value}`);
	}
	if (key === "taxRuleSetVersion") {
		if (value === null) return value;
		const mapped = RULE_SET_VERSIONS.get(value);
		if (mapped) return mapped;
		throw new Error(`Unknown tax rule set version ${sourceTable}.${key}=${value}`);
	}
	return value;
}

function convertRow(sourceTable, row, idMap, ownerWorkspaces) {
	if (!row || typeof row !== "object" || Array.isArray(row) || typeof row._id !== "string") {
		throw new Error(`Every ${sourceTable} row must contain a string _id.`);
	}
	const targetTable = tableName(sourceTable);
	const output = { id: idMap.get(`${sourceTable}:${row._id}`) };
	for (const [key, value] of Object.entries(row)) {
		if (key === "_id" || key === "_creationTime" || value === undefined || IGNORE_FIELDS.has(key)) continue;
		const targetKey = snake(key);
		output[targetKey] = convertValue(key, value, sourceTable, idMap);
	}
	if (sourceTable === "clients" && !output.workspace_id && output.owner_id) {
		output.workspace_id = ownerWorkspaces.get(output.owner_id) ?? null;
	}
	if (COLUMN_RENAMES[sourceTable]) {
		for (const [from, to] of Object.entries(COLUMN_RENAMES[sourceTable])) {
			if (from in output) {
				output[to] = output[from];
				delete output[from];
			}
		}
	}
	if (DEFAULT_VALUES[sourceTable]) {
		for (const [column, value] of Object.entries(DEFAULT_VALUES[sourceTable])) {
			if (!(column in output)) output[column] = value;
		}
	}
	return { table: targetTable, row: output };
}

async function main() {
	const { input, deployment, apply } = parseArgs();
	const exported = deployment ? exportConvex(deployment) : null;
	if (exported) process.on("exit", () => rmSync(exported.directory, { recursive: true, force: true }));
	const source = readSnapshot(exported?.extracted ?? input);
	const idMap = new Map();
	for (const [table, rows] of Object.entries(source)) for (const row of rows) {
		if (typeof row?._id === "string") idMap.set(`${table}:${row._id}`, stableUuid(table, row._id));
	}
	const ownerWorkspaces = new Map();
	for (const row of source.workspaces ?? []) {
		if (row.ownerId) ownerWorkspaces.set(row.ownerId, idMap.get(`workspaces:${row._id}`));
	}
	const converted = new Map();
	for (const table of IMPORT_ORDER) converted.set(table, (source[table] ?? []).map((row) => convertRow(table, row, idMap, ownerWorkspaces)));

	if (!apply) {
		console.log(JSON.stringify(Object.fromEntries([...converted].map(([table, rows]) => [tableName(table), { source: rows.length, imported: 0, skipped: rows.length, errors: 0 }])), null, 2));
		return;
	}
	const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
	if (!process.env.VITE_SUPABASE_URL || !secretKey) throw new Error("--apply requires VITE_SUPABASE_URL and SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY).");
	const client = createClient(process.env.VITE_SUPABASE_URL, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
	const CHUNK_SIZE = 1000;
	const report = {};
	for (const [sourceTable, rows] of converted) {
		const targetTable = tableName(sourceTable);
		let imported = 0;
		for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
			const chunk = rows.slice(i, i + CHUNK_SIZE).map(({ row }) => row);
			const { error } = await client.from(targetTable).upsert(chunk, { onConflict: "id" });
			if (error) throw new Error(`${targetTable} rows ${i}-${i + chunk.length}: ${error.message}`);
			imported += chunk.length;
		}
		report[targetTable] = { source: rows.length, imported, skipped: 0, errors: 0 };
	}
	console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
