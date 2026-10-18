import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	NIGERIA_RC_PATTERN,
	NIGERIA_TIN_PATTERN,
	PLACEHOLDER_TIN_VALUES,
} from "#/features/compliance/supplier-profile";

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

/**
 * B1 validator/migration parity: the app validator
 * (src/features/compliance/supplier-profile.ts) is the save-path rule; the
 * SQL backfill is a one-time classifier for rows that predate the structured
 * columns. Rules that decide accept-vs-flag must stay in lockstep, and the
 * deliberate differences are pinned below so neither side drifts silently.
 */
describe("supplier profile validator / migration parity", () => {
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

	it("uses the same CAC RC shape rule (SQL matches case-insensitively; the app uppercases first)", () => {
		expect(upSql).toContain(`~* '${sqlShape(NIGERIA_RC_PATTERN)}'`);
	});

	it("checks the TIN shape before the all-same-digit rule, like the app", () => {
		// The backfill's CASE evaluates in order, so the all-same-digit regex
		// only ever sees 10-digit values — the same order as validateSupplierTin
		// (format check, then placeholder check).
		expect(upSql).toContain("'^(.)\\1{9}$'");
		expect(upSql.indexOf(sqlShape(NIGERIA_TIN_PATTERN))).toBeLessThan(
			upSql.indexOf("^(.)\\1{9}$"),
		);
	});

	it("documents the intended validator/migration differences", () => {
		// 1. address_not_structured is backfill-only: the migration reads the
		//    legacy free-text `address` column, which the structured form never
		//    writes again. The app validator only sees the structured columns
		//    (added by this same migration, NULL for every pre-existing row) and
		//    never emits this code.
		expect(upSql).toContain("'address_not_structured'");
		// 2. The backfill only trims ends: it classifies legacy text and never
		//    normalises or rewrites it (the UPDATE writes flag columns only).
		//    The app validator additionally compacts internal whitespace, so a
		//    stored "RC 1234567" is flagged cac_rc_format by the backfill but
		//    accepted and normalised on the next save.
		expect(upSql).toMatch(/btrim\(/);
		expect(upSql).not.toMatch(/regexp_replace/);
		// 3. The backfill never audits the structured state/country columns —
		//    they are NULL for every pre-existing row, so the app validator
		//    re-audits them on the first save after the migration.
		expect(upSql).not.toContain("address_state_required");
		expect(upSql).not.toContain("address_country_required");
		// 4. Round-2 rules are app-only: the backfill is immutable and predates
		//    the address max-length issue codes and the all-same-digit RC
		//    placeholder rule. The DB CHECK caps exist on both sides; only the
		//    flag codes differ, and the app re-audits every value on save.
		expect(upSql).not.toContain("cac_rc_placeholder");
		expect(upSql).not.toContain("address_street_too_long");
		expect(upSql).not.toContain("address_lga_too_long");
		expect(upSql).not.toContain("address_state_too_long");
		expect(upSql).toMatch(/char_length\(address_street\) <= 300/);
		expect(upSql).toMatch(/char_length\(address_lga\) <= 200/);
		expect(upSql).toMatch(/char_length\(address_state\) <= 200/);
	});
});
