import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
	"supabase/migrations/20261026000000_einvoice_c4_mock_clearance_immutability.sql",
	"utf8",
);

describe("WP16 mock-clearance migration", () => {
	it("allows explicit mock result history and protects mock artifacts from forgery or replacement", () => {
		expect(migration).toContain("'cleared'");
		expect(migration).toContain("auth.role()");
		expect(migration).toContain("'service_role'");
		expect(migration).toContain("'mock_cleared'");
		expect(migration).toContain("MOCK-IRN-%");
		expect(migration).toContain("MOCK-SANDBOX|NOT-NRS-CLEARED|%");
		expect(migration).toContain("mock clearance artifacts are immutable");
		expect(migration).toContain("drop trigger if exists");
		expect(migration).toContain("Rollback");
	});
});
