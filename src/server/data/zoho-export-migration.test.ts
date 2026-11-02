import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Export-kind migration contract (T10 step 3, 2026-11-02). The `kind` CHECK
 * grows from eight to nine kinds with the Zoho Books invoice import. The change
 * must be additive and reversible: the existing kinds keep their meaning, the
 * named constraint (`invoice_exports_kind_check`) is replaced in one migration,
 * no existing row is rewritten, and the earlier applied migrations stay
 * untouched.
 */

const PREVIOUS_KINDS = [
	"invoices_csv",
	"tax_summary_csv",
	"customer_ledger_csv",
	"normalized_accounting",
	"accountant_lines_csv",
	"accountant_lines_xlsx",
	"vat_sales_schedule_xlsx",
	"qbo_invoices_csv",
] as const;

const NEW_KIND = "zoho_invoices_csv" as const;

const migrationsDir = fileURLToPath(
	new URL("../../../supabase/migrations", import.meta.url),
);

const migrationFile =
	readdirSync(migrationsDir)
		.filter((file) => file.endsWith("_invoice_export_kinds_zoho.sql"))
		.sort()
		.at(-1) ?? "";

const sql = readFileSync(join(migrationsDir, migrationFile), "utf8");
const reversalIndex = sql.indexOf("-- Reversal");
const upSql = reversalIndex === -1 ? sql : sql.slice(0, reversalIndex);
const reversalSql = reversalIndex === -1 ? "" : sql.slice(reversalIndex);

/** Executable SQL only: the file documents itself in `--` prose. */
const upBody = upSql
	.split("\n")
	.filter((line) => !line.trimStart().startsWith("--"))
	.join("\n");

describe("Zoho Books invoice kind migration", () => {
	it("exists under the zoho-kind filename", () => {
		expect(migrationFile).toMatch(
			/^2026\d{10}_invoice_export_kinds_zoho\.sql$/,
		);
	});

	it("replaces the named `invoice_exports_kind_check` constraint", () => {
		expect(upBody).toMatch(/drop\s+constraint\s+invoice_exports_kind_check/i);
		expect(upBody).toMatch(/add\s+constraint\s+invoice_exports_kind_check/i);
	});

	it("keeps the eight kinds and admits exactly the Zoho kind", () => {
		for (const kind of [...PREVIOUS_KINDS, NEW_KIND]) {
			expect(upSql).toContain(`'${kind}'`);
		}
		const upKinds = [
			...new Set(
				[
					...upBody.matchAll(
						/'([a-z_]+_(?:csv|xlsx))'|'(normalized_accounting)'/g,
					),
				].map((match) => match[1] ?? match[2]),
			),
		].sort();
		expect(upKinds).toEqual([...PREVIOUS_KINDS, NEW_KIND].sort());
	});

	it("touches nothing but the constraint on invoice_exports", () => {
		expect(upBody).not.toMatch(/delete\s+from/i);
		expect(upBody).not.toMatch(/drop\s+table/i);
		expect(upBody.replace(/\s+/g, " ")).not.toMatch(/update\s+public\./i);
		expect(upBody.match(/alter\s+table/gi)?.length ?? 0).toBe(2);
	});

	it("documents a reversal that restores the eight-kind check", () => {
		expect(reversalSql).toContain("delete from public.invoice_exports");
		expect(reversalSql).toContain(`kind = '${NEW_KIND}'`);
		expect(reversalSql).toContain("drop constraint invoice_exports_kind_check");
		for (const kind of PREVIOUS_KINDS) {
			expect(reversalSql).toContain(`'${kind}'`);
		}
		// The reversal is documentation only, never executed by the pipeline.
		const reversalStatements = reversalSql
			.split("\n")
			.filter((line) => line.trim().length > 0)
			.filter((line) => !line.trim().startsWith("--"));
		expect(reversalStatements).toEqual([]);
	});
});
