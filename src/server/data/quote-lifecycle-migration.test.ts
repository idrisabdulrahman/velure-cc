import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * WP-D — quote lifecycle migration contract (authored, not applied).
 *
 * The migration is additive and reversible: four nullable columns plus a
 * partial unique index that makes a second conversion link impossible, and a
 * re-created `public_invoice_by_token` that exposes the public quote fields
 * but never the private conversion link.
 */

const migrationsDir = fileURLToPath(
	new URL("../../../supabase/migrations", import.meta.url),
);

const migrationFile =
	readdirSync(migrationsDir)
		.filter((file) => file.endsWith("_quote_lifecycle.sql"))
		.sort()
		.at(-1) ?? "";

const sql = readFileSync(join(migrationsDir, migrationFile), "utf8");
const downIndex = sql.indexOf("-- down");
const upSql = downIndex === -1 ? sql : sql.slice(0, downIndex);
const downSql = downIndex === -1 ? "" : sql.slice(downIndex);

/** Executable SQL only: the file documents itself in `--` prose. */
const upBody = upSql
	.split("\n")
	.filter((line) => !line.trimStart().startsWith("--"))
	.join("\n");

describe("quote lifecycle migration", () => {
	it("exists under the expected filename", () => {
		expect(migrationFile).toMatch(/^2026\d{10}_quote_lifecycle\.sql$/);
	});

	it("adds the four quote columns as nullable, with a bounded status check", () => {
		expect(upSql).toMatch(/add column quote_status text null/i);
		expect(upSql).toContain("'draft'");
		expect(upSql).toContain("'sent'");
		expect(upSql).toContain("'accepted'");
		expect(upSql).toMatch(/add column quote_sent_at timestamptz null/i);
		expect(upSql).toMatch(/add column quote_accepted_at timestamptz null/i);
		expect(upSql).toMatch(/add column quote_converted_invoice_id uuid null/i);
	});

	it("guards the conversion link with a partial unique index", () => {
		expect(upBody).toMatch(
			/create unique index invoices_quote_converted_invoice_unique/i,
		);
		expect(upBody).toMatch(
			/on public\.invoices \(quote_converted_invoice_id\)\s+where quote_converted_invoice_id is not null/i,
		);
	});

	it("changes no row data", () => {
		expect(upBody).not.toMatch(/delete\s+from/i);
		expect(upBody).not.toMatch(/truncate/i);
		expect(upBody).not.toMatch(/insert\s+into/i);
		expect(upBody).not.toMatch(/update\s+public\.invoices/i);
	});

	it("exposes the public quote fields but hides the conversion link", () => {
		expect(upSql).toContain("'quote_status', i.quote_status");
		expect(upSql).toContain("'quote_sent_at', i.quote_sent_at");
		expect(upSql).toContain("'quote_accepted_at', i.quote_accepted_at");
		expect(upSql).not.toContain("'quote_converted_invoice_id'");
		expect(upSql).toMatch(
			/grant execute on function public\.public_invoice_by_token\(text\)\s+to service_role/i,
		);
	});

	it("documents a comment-only reversal that drops every added object", () => {
		expect(downSql).toMatch(
			/drop index if exists public\.invoices_quote_converted_invoice_unique/i,
		);
		expect(downSql).toMatch(/drop column if exists quote_accepted_at/i);
		expect(downSql).toMatch(/drop column if exists quote_sent_at/i);
		expect(downSql).toMatch(/drop column if exists quote_status/i);
		expect(downSql).toMatch(
			/drop column if exists quote_converted_invoice_id/i,
		);
		const executableDown = downSql
			.split("\n")
			.filter((line) => line.trim().length > 0)
			.filter((line) => !line.trim().startsWith("--"));
		expect(executableDown).toEqual([]);
	});
});
