import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Export-kind migration contract (T10 step 2 correction, 2026-11-01). NRS
 * retired TaxPro Max for Rev360, so the provisional `vat_sales_schedule_csv`
 * kind is replaced by the six-field XLSX kind `vat_sales_schedule_xlsx`. The
 * change must be reversible and must touch only the named constraint: every
 * other kind keeps its meaning, no row is rewritten, and the earlier applied
 * migrations stay untouched.
 */

const SIX_KINDS = [
	"invoices_csv",
	"tax_summary_csv",
	"customer_ledger_csv",
	"normalized_accounting",
	"accountant_lines_csv",
	"accountant_lines_xlsx",
] as const;

const NEW_KIND = "vat_sales_schedule_xlsx" as const;
/** The retired provisional kind this migration removes from the CHECK. */
const RETIRED_KIND = "vat_sales_schedule_csv";

const migrationsDir = fileURLToPath(
	new URL("../../../supabase/migrations", import.meta.url),
);

const migrationFile =
	readdirSync(migrationsDir)
		.filter((file) =>
			file.endsWith("_invoice_export_kinds_rev360_vat_schedule.sql"),
		)
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

describe("Rev360 Vat schedule kind migration", () => {
	it("exists under the rev360 vat-schedule filename", () => {
		expect(migrationFile).toMatch(
			/^2026\d{10}_invoice_export_kinds_rev360_vat_schedule\.sql$/,
		);
	});

	it("replaces the named `invoice_exports_kind_check` constraint", () => {
		expect(upBody).toMatch(/drop\s+constraint\s+invoice_exports_kind_check/i);
		expect(upBody).toMatch(/add\s+constraint\s+invoice_exports_kind_check/i);
	});

	it("keeps the six kinds and admits exactly the new XLSX kind", () => {
		for (const kind of [...SIX_KINDS, NEW_KIND]) {
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
		expect(upKinds).toEqual([...SIX_KINDS, NEW_KIND].sort());
	});

	it("removes the retired provisional CSV kind from the executable SQL", () => {
		expect(upBody).not.toContain(`'${RETIRED_KIND}'`);
	});

	it("touches nothing but the constraint on invoice_exports", () => {
		expect(upBody).not.toMatch(/delete\s+from/i);
		expect(upBody).not.toMatch(/drop\s+table/i);
		expect(upBody.replace(/\s+/g, " ")).not.toMatch(/update\s+public\./i);
		expect(upBody.match(/alter\s+table/gi)?.length ?? 0).toBe(2);
	});

	it("documents a reversal that restores the retired seven-kind check", () => {
		expect(reversalSql).toContain(`delete from public.invoice_exports`);
		expect(reversalSql).toContain("drop constraint invoice_exports_kind_check");
		for (const kind of [...SIX_KINDS, RETIRED_KIND]) {
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
