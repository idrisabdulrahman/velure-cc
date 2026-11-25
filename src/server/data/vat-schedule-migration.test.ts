import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Export-kind migration contract (T10 step 2). The `kind` CHECK grew from six
 * kinds to seven by adding `vat_sales_schedule_csv`. The change must be
 * additive and reversible: every previous kind keeps its meaning, the named
 * constraint (`invoice_exports_kind_check`) is replaced in one migration, and
 * no existing row is rewritten.
 */

const PREVIOUS_KINDS = [
	"invoices_csv",
	"tax_summary_csv",
	"customer_ledger_csv",
	"normalized_accounting",
	"accountant_lines_csv",
	"accountant_lines_xlsx",
] as const;

const NEW_KINDS = ["vat_sales_schedule_csv"] as const;

const migrationsDir = fileURLToPath(
	new URL("../../../supabase/migrations", import.meta.url),
);

const migrationFile =
	readdirSync(migrationsDir)
		.filter((file) => file.endsWith("_invoice_export_kinds_vat_schedule.sql"))
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

describe("VAT schedule kind widening migration", () => {
	it("exists under the vat-schedule filename", () => {
		expect(migrationFile).toMatch(
			/^2026\d{10}_invoice_export_kinds_vat_schedule\.sql$/,
		);
	});

	it("replaces the named `invoice_exports_kind_check` constraint", () => {
		expect(upBody).toMatch(/drop\s+constraint\s+invoice_exports_kind_check/i);
		expect(upBody).toMatch(/add\s+constraint\s+invoice_exports_kind_check/i);
	});

	it("keeps every previous kind and adds exactly the VAT schedule kind", () => {
		for (const kind of [...PREVIOUS_KINDS, ...NEW_KINDS]) {
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
		expect(upKinds).toEqual([...PREVIOUS_KINDS, ...NEW_KINDS].sort());
	});

	it("touches nothing but the constraint on invoice_exports", () => {
		expect(upBody).not.toMatch(/delete\s+from/i);
		expect(upBody).not.toMatch(/drop\s+table/i);
		expect(upBody.replace(/\s+/g, " ")).not.toMatch(/update\s+public\./i);
		expect(upBody.match(/alter\s+table/gi)?.length ?? 0).toBe(2);
	});

	it("documents a reversal that restores the previous six kinds", () => {
		expect(reversalSql).toContain("delete from public.invoice_exports");
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
