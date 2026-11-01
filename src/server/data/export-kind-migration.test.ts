import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Export-kind migration contract (T10 step 1). The `kind` CHECK grew from 4
 * to 6 kinds. The change must be additive and reversible: the original kinds
 * keep their meaning, the named constraint (`invoice_exports_kind_check`, the
 * inline-CHECK auto-name) is replaced in one migration, and no existing row
 * is rewritten.
 */

const ORIGINAL_KINDS = [
	"invoices_csv",
	"tax_summary_csv",
	"customer_ledger_csv",
	"normalized_accounting",
] as const;

const NEW_KINDS = ["accountant_lines_csv", "accountant_lines_xlsx"] as const;

const migrationsDir = fileURLToPath(
	new URL("../../../supabase/migrations", import.meta.url),
);

const migrationFile =
	readdirSync(migrationsDir)
		.filter((file) => file.endsWith("_invoice_export_kinds_accountant.sql"))
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

describe("invoice_export kind widening migration", () => {
	it("exists under the accountant-kind filename", () => {
		expect(migrationFile).toMatch(
			/^2026\d{10}_invoice_export_kinds_accountant\.sql$/,
		);
	});

	it("replaces the named `invoice_exports_kind_check` constraint", () => {
		expect(upBody).toMatch(/drop\s+constraint\s+invoice_exports_kind_check/i);
		expect(upBody).toMatch(/add\s+constraint\s+invoice_exports_kind_check/i);
	});

	it("keeps every original kind and adds exactly the accountant kinds", () => {
		for (const kind of [...ORIGINAL_KINDS, ...NEW_KINDS]) {
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
		expect(upKinds).toEqual([...ORIGINAL_KINDS, ...NEW_KINDS].sort());
	});

	it("touches nothing but the constraint on invoice_exports", () => {
		expect(upBody).not.toMatch(/delete\s+from/i);
		expect(upBody).not.toMatch(/drop\s+table/i);
		expect(upBody.replace(/\s+/g, " ")).not.toMatch(/update\s+public\./i);
		expect(upBody.match(/alter\s+table/gi)?.length ?? 0).toBe(2);
	});

	it("documents a reversal that restores the original four kinds", () => {
		expect(reversalSql).toContain("delete from public.invoice_exports");
		expect(reversalSql).toContain("drop constraint invoice_exports_kind_check");
		for (const kind of ORIGINAL_KINDS) {
			expect(reversalSql).toContain(`'${kind}'`);
		}
		// Reversal is documentation only, never executed by the pipeline.
		const reversalStatements = reversalSql
			.split("\n")
			.filter((line) => line.trim().length > 0)
			.filter((line) => !line.trim().startsWith("--"));
		expect(reversalStatements).toEqual([]);
	});
});
