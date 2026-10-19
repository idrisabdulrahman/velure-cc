import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	NIGERIA_TIN_PATTERN,
	PLACEHOLDER_TIN_VALUES,
} from "#/features/compliance/supplier-profile";

/**
 * B2 migration contract: existing client rows are FLAGGED, not deleted or
 * rewritten. These tests pin the migration to flag-only writes so a future
 * edit cannot silently destroy user buyer data (name, email, address, TIN).
 */

const migrationsDir = fileURLToPath(
	new URL("../../../supabase/migrations", import.meta.url),
);

const migrationFile =
	readdirSync(migrationsDir)
		.filter((file) => file.endsWith("_einvoice_b2_buyer_profile_flags.sql"))
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

describe("buyer profile flag migration", () => {
	it("exists", () => {
		expect(migrationFile).toMatch(
			/^2026\d{10}_einvoice_b2_buyer_profile_flags\.sql$/,
		);
	});

	it("adds the B2B/B2C buyer type with a 'b2b' default and CHECK", () => {
		expect(upSql).toMatch(
			/buyer_type text not null default 'b2b'\s+check \(\s*buyer_type in \('b2b', 'b2c'\)\s*\)/,
		);
	});

	it("adds the flag columns with a non-null 'needs_review' default", () => {
		expect(upSql).toMatch(
			/buyer_profile_status text not null default 'needs_review'/,
		);
		expect(upSql).toMatch(
			/buyer_profile_issues jsonb not null default '\[\]'::jsonb/,
		);
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
			"buyer_profile_issues",
			"buyer_profile_status",
		]);
		// No top-level WHERE: every pre-existing row is classified.
		expect(
			statement
				.trimEnd()
				.replace(/[\s)]+$/, "")
				.endsWith("'[]'::jsonb"),
		).toBe(true);
	});

	it("documents a reversal that drops exactly the added columns", () => {
		expect(reversalSql).toMatch(/drop column buyer_type/);
		expect(reversalSql).toMatch(/drop column buyer_profile_status/);
		expect(reversalSql).toMatch(/drop column buyer_profile_issues/);
		// The reversal block is commented documentation only: it must never be
		// executable alongside the up migration.
		const reversalStatements = reversalSql
			.split("\n")
			.filter((line) => line.trim().length > 0)
			.filter((line) => !line.trim().startsWith("--"));
		expect(reversalStatements).toEqual([]);
	});
});

/**
 * B2 validator/migration parity: the app validator
 * (src/features/clients/buyer-profile.ts) is the save-path rule; the SQL
 * backfill is a one-time classifier for rows that predate the buyer fields.
 * Rules that decide accept-vs-flag must stay in lockstep.
 */
describe("buyer profile validator / migration parity", () => {
	// Postgres POSIX regex spells `\d` as `[0-9]`; everything else has to
	// match the app patterns byte for byte, or this pin fails and forces a
	// deliberate decision on both sides.
	const sqlShape = (pattern: RegExp) => pattern.source.replace(/\\d/g, "[0-9]");

	it("rejects the same placeholder TINs in both places", () => {
		const sqlPlaceholders = [...upSql.matchAll(/'(\d{10})'/g)]
			.map((match) => match[1])
			.sort();
		expect(sqlPlaceholders).toEqual([...PLACEHOLDER_TIN_VALUES].sort());
	});

	it("uses the same TIN shape rule", () => {
		expect(upSql).toContain(`~ '${sqlShape(NIGERIA_TIN_PATTERN)}'`);
	});

	it("checks the TIN shape before the placeholder rules, like the app", () => {
		// The backfill's CASE evaluates in order, so the placeholder checks
		// only ever see 10-digit values — the same order as the app validator
		// (validateSupplierTin: format check, then placeholder check).
		expect(upSql).toContain("'^(.)\\1{9}$'");
		expect(upSql.indexOf(sqlShape(NIGERIA_TIN_PATTERN))).toBeLessThan(
			upSql.indexOf("^(.)\\1{9}$"),
		);
	});

	it("documents the intended validator/migration differences", () => {
		// 1. Every pre-existing row is backfilled as B2B (the column default),
		//    so the TIN rules apply to all of them. The app validator applies
		//    them only when the effective buyer_type is b2b.
		expect(upSql).toMatch(/buyer_type text not null default 'b2b'/);
		// 2. The backfill only trims ends: it classifies legacy text and never
		//    normalises or rewrites it (the UPDATE writes flag columns only).
		//    The app validator additionally compacts internal whitespace, so a
		//    stored "8129 473650" is flagged tin_format by the backfill but
		//    accepted and normalised on the next save.
		expect(upSql).toMatch(/btrim\(/);
		expect(upSql).not.toMatch(/regexp_replace/);
		// 3. Name and email are already NOT NULL + server-validated, so the
		//    backfill never emits their issue codes — the app validator
		//    re-checks them on every save.
		expect(upSql).not.toContain("name_required");
		expect(upSql).not.toContain("email_required");
		expect(upSql).not.toContain("email_format");
		// 4. address_too_long and buyer_type_invalid are app-only: legacy rows
		//    cannot carry an invalid buyer_type (new column, new CHECK) and the
		//    free-text billing_address column has no length cap.
		expect(upSql).not.toContain("address_too_long");
		expect(upSql).not.toContain("buyer_type_invalid");
	});
});
