import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
	"supabase/migrations/20261026000000_einvoice_c4_mock_clearance_immutability.sql",
	"utf8",
);
const writeBoundaryMigration = readFileSync(
	"supabase/migrations/20261027000000_einvoice_c4_fiscalization_write_boundary.sql",
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
		expect(migration).toContain("Safe rollback for append-only history");
		expect(migration).toContain("not an acceptable rollback");
		const downMigration = migration.split("-- Down migration:")[1];
		expect(downMigration).toContain("drop trigger if exists");
		expect(downMigration).toContain("drop function if exists");
		expect(downMigration).toContain("'cleared'");
		expect(downMigration).not.toContain(
			"delete from public.invoice_submission_attempts",
		);
		expect(downMigration).not.toContain(
			"update public.invoice_submission_attempts",
		);
	});

	it("guards insert and update against client-written fiscalization artifacts", () => {
		expect(writeBoundaryMigration).toContain("if tg_op = 'INSERT' then");
		expect(writeBoundaryMigration).toContain(
			"before insert or update on public.invoices",
		);
		expect(writeBoundaryMigration).toContain("new.fiscalization is null");
		expect(writeBoundaryMigration).toContain(
			'\'{"status":"not_configured"}\'::jsonb',
		);
		expect(writeBoundaryMigration).toContain(
			"is_service_role and is_valid_mock_clearance",
		);
		expect(writeBoundaryMigration).toContain(
			"not is_service_role or not is_valid_mock_clearance",
		);
		expect(writeBoundaryMigration).toContain(
			"old.fiscalization ->> 'status' = 'mock_cleared'",
		);
		expect(writeBoundaryMigration).toContain(
			"Exact equality disallows every additional field",
		);
		expect(writeBoundaryMigration).toContain("Down migration:");
	});
});
