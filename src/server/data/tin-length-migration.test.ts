import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	NIGERIA_TIN_PATTERN,
	PLACEHOLDER_TIN_VALUES,
} from "#/features/compliance/supplier-profile";

/**
 * TIN widening migration contract.
 *
 * The B1/B2 backfills (already applied) pin the historical 10-digit rule. This
 * later migration carries the widened 10-12 digit rule for the rows those
 * backfills flagged `tin_format`, and must stay flag-only, scoped, and
 * idempotent so it can never destroy profile data or reopen a fresh workspace.
 */

const migrationsDir = fileURLToPath(
	new URL("../../../supabase/migrations", import.meta.url),
);

const migrationFile =
	readdirSync(migrationsDir)
		.filter((file) => file.endsWith("_widen_nigeria_tin_length.sql"))
		.sort()
		.at(-1) ?? "";

const sql = readFileSync(join(migrationsDir, migrationFile), "utf8");
const reversalIndex = sql.indexOf("-- Reversal");
const upSql = reversalIndex === -1 ? sql : sql.slice(0, reversalIndex);
const reversalSql = reversalIndex === -1 ? "" : sql.slice(reversalIndex);

/** Executable SQL only: the file documents itself in `--` prose. */
const sqlBody = upSql
	.split("\n")
	.filter((line) => !line.trimStart().startsWith("--"))
	.join("\n");

function updateStatements(body: string): string[] {
	const statements: string[] = [];
	const re = /\bupdate\b/gi;
	let match = re.exec(body);
	while (match) {
		const start = match.index;
		const semicolon = body.indexOf(";", start);
		statements.push(
			body.slice(start, semicolon === -1 ? body.length : semicolon),
		);
		re.lastIndex = semicolon === -1 ? body.length : semicolon + 1;
		match = re.exec(body);
	}
	return statements;
}

function setTargets(statement: string): string[] {
	const setStart = statement.search(/\bset\b/i);
	const setClause = statement.slice(setStart).replace(/^\s*set\s+/i, "");
	return [...setClause.matchAll(/(?:^|,)\s*([a-z_]+)\s*=/gi)]
		.map((match) => match[1])
		.sort();
}

describe("TIN 10-12 widening migration", () => {
	it("exists under the widened-rule filename", () => {
		expect(migrationFile).toMatch(/^2026\d{10}_widen_nigeria_tin_length\.sql$/);
	});

	it("never deletes or inserts rows", () => {
		expect(sqlBody).not.toMatch(/delete\s+from/i);
		expect(sqlBody).not.toMatch(/truncate/i);
		expect(sqlBody).not.toMatch(/insert\s+into/i);
	});

	it("updates both profile tables exactly once", () => {
		const statements = updateStatements(sqlBody);
		expect(statements).toHaveLength(2);
		expect(statements[0]).toMatch(/update\s+public\.workspaces/i);
		expect(statements[1]).toMatch(/update\s+public\.clients/i);
	});

	it("writes only the flag columns for each table", () => {
		const statements = updateStatements(sqlBody);
		expect(statements.map(setTargets)).toEqual([
			["supplier_profile_issues", "supplier_profile_status"],
			["buyer_profile_issues", "buyer_profile_status"],
		]);
		// The stored TIN is a frozen user value: never rewritten by a backfill.
		expect(sqlBody).not.toMatch(/tax_id\s*=/i);
	});

	it("is scoped to rows already flagged tin_format", () => {
		expect(sqlBody).toContain(
			`supplier_profile_issues @> '["tin_format"]'::jsonb`,
		);
		expect(sqlBody).toContain(
			`buyer_profile_issues @> '["tin_format"]'::jsonb`,
		);
		// Non-TIN issue codes survive the rewrite.
		expect(sqlBody).toContain("issue <> 'tin_format'");
	});

	it("is idempotent via `is distinct from`", () => {
		expect(sqlBody).toContain("is distinct from");
		expect(
			sqlBody.match(/is distinct from/gi)?.length ?? 0,
		).toBeGreaterThanOrEqual(2);
	});

	it("documents a reversal that is comment-only", () => {
		expect(reversalSql).toMatch(/re-run the 10-digit/i);
		expect(reversalSql).toContain("^[0-9]{10}$");
		const reversalStatements = reversalSql
			.split("\n")
			.filter((line) => line.trim().length > 0)
			.filter((line) => !line.trim().startsWith("--"));
		expect(reversalStatements).toEqual([]);
	});
});

/**
 * Validator/migration parity: the widened SQL rule must match the live app
 * constant byte for byte (Postgres spells `\d` as `[0-9]`).
 */
describe("TIN widening validator / migration parity", () => {
	const sqlShape = (pattern: RegExp) => pattern.source.replace(/\\d/g, "[0-9]");

	it("uses the same widened TIN shape rule", () => {
		expect(upSql).toContain(`~ '${sqlShape(NIGERIA_TIN_PATTERN)}'`);
	});

	it("rejects the same placeholder TINs in both places", () => {
		const sqlPlaceholders = [
			...new Set([...upSql.matchAll(/'(\d{10})'/g)].map((match) => match[1])),
		].sort();
		expect(sqlPlaceholders).toEqual([...PLACEHOLDER_TIN_VALUES].sort());
	});

	it("checks the TIN shape before the placeholder rules, like the app", () => {
		expect(upSql).toContain("'^(.)\\1{9,11}$'");
		expect(upSql.indexOf(sqlShape(NIGERIA_TIN_PATTERN))).toBeLessThan(
			upSql.indexOf("^(.)\\1{9,11}$"),
		);
	});
});
