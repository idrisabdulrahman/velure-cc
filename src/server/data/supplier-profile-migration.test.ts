import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * B1 migration contract: existing invalid supplier profiles are FLAGGED, not
 * deleted or rewritten. These tests pin the migration to flag-only writes so a
 * future edit cannot silently destroy user registration data.
 */

const migrationsDir = fileURLToPath(
	new URL("../../../supabase/migrations", import.meta.url),
);

const migrationFile =
	readdirSync(migrationsDir)
		.filter((file) => file.endsWith("_supplier_profile_validation_flags.sql"))
		.sort()
		.at(-1) ?? "";

const sql = readFileSync(join(migrationsDir, migrationFile), "utf8");
const reversalIndex = sql.indexOf("-- Reversal");
const upSql = reversalIndex === -1 ? sql : sql.slice(0, reversalIndex);
const reversalSql = reversalIndex === -1 ? "" : sql.slice(reversalIndex);

function firstUpdateStatement(body: string): string {
	const start = body.search(/\bupdate\b/i);
	expect(start).toBeGreaterThanOrEqual(0);
	const semicolon = body.indexOf(";", start);
	return body.slice(start, semicolon === -1 ? body.length : semicolon);
}

describe("supplier profile flag migration", () => {
	it("exists", () => {
		expect(migrationFile).toMatch(
			/^2026\d{10}_supplier_profile_validation_flags\.sql$/,
		);
	});

	it("adds the flag columns with a non-null 'needs_review' default", () => {
		expect(upSql).toMatch(
			/supplier_profile_status text not null default 'needs_review'/,
		);
		expect(upSql).toMatch(
			/supplier_profile_issues jsonb not null default '\[\]'::jsonb/,
		);
	});

	it("adds the structured address columns as nullable", () => {
		expect(upSql).toMatch(/add column address_street text/);
		expect(upSql).toMatch(/add column address_lga text/);
		expect(upSql).toMatch(/add column address_state text/);
	});

	it("never deletes or inserts rows", () => {
		expect(upSql).not.toMatch(/delete\s+from/i);
		expect(upSql).not.toMatch(/truncate/i);
		expect(upSql).not.toMatch(/insert\s+into/i);
	});

	it("performs exactly one UPDATE whose set clause only writes flag columns", () => {
		expect(upSql.match(/\bupdate\b/gi)).toHaveLength(1);
		const statement = firstUpdateStatement(upSql);
		const setStart = statement.search(/\bset\b/i);
		const setClause = statement.slice(setStart).replace(/^\s*set\s+/i, "");
		const targets = [...setClause.matchAll(/(?:^|,)\s*([a-z_]+)\s*=/gi)].map(
			(match) => match[1],
		);
		expect(targets.sort()).toEqual([
			"supplier_profile_issues",
			"supplier_profile_status",
		]);
		// No top-level WHERE: every pre-existing profile is flagged.
		expect(
			statement
				.trimEnd()
				.replace(/[\s)]+$/, "")
				.endsWith("'[]'::jsonb"),
		).toBe(true);
	});

	it("documents a reversal that drops exactly the added columns", () => {
		expect(reversalSql).toMatch(/drop column address_street/);
		expect(reversalSql).toMatch(/drop column address_lga/);
		expect(reversalSql).toMatch(/drop column address_state/);
		expect(reversalSql).toMatch(/drop column supplier_profile_status/);
		expect(reversalSql).toMatch(/drop column supplier_profile_issues/);
		// The reversal block is commented documentation only: it must never be
		// executable alongside the up migration.
		const reversalStatements = reversalSql
			.split("\n")
			.filter((line) => line.trim().length > 0)
			.filter((line) => !line.trim().startsWith("--"));
		expect(reversalStatements).toEqual([]);
	});
});
