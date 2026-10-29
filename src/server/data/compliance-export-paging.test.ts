import { describe, expect, it, vi } from "vitest";

vi.mock("#/server/data/audit-client", () => ({
	recordInvoiceAudit: vi.fn(async () => {}),
}));

import { recordInvoiceAudit } from "#/server/data/audit-client";
import { createInvoiceExport } from "./compliance";
import { createFakeSupabase, type FakeTables } from "./testing/fake-db";

/**
 * The export read used to be a single unbounded `.select()`, which PostgREST
 * caps at 1000 rows. A workspace with more invoices than one page got a
 * compliance/tax export that silently omitted invoices — with the audit entry
 * recording the truncated count as if it were complete. The read now pages in
 * `id` order until a short page ends the loop.
 */
const USER = "user-a";
const WS = "ws-a";
const PAGE_SIZE = 1000;

function invoiceRow(index: number) {
	return {
		id: `inv-${String(index).padStart(5, "0")}`,
		workspace_id: WS,
		invoice_number: `INV-2026-${String(index + 1).padStart(4, "0")}`,
		customer_name: `Customer ${index}`,
		currency: "NGN",
		payment_amount: 0,
		status: "draft",
		issue_date: "2026-01-01",
		due_date: "2026-01-15",
		compliance: { netPayable: 1000 + index },
		line_items: [],
	};
}

function seedTables(invoiceCount: number): FakeTables {
	return {
		workspaces: [{ id: WS, name: "Alpha", legal_name: "Alpha Ltd" }],
		active_workspaces: [{ user_id: USER, workspace_id: WS }],
		workspace_members: [{ workspace_id: WS, user_id: USER, role: "owner" }],
		clients: [],
		invoices: Array.from({ length: invoiceCount }, (_, index) =>
			invoiceRow(index),
		),
		invoice_exports: [],
	};
}

describe("compliance export read", () => {
	it("includes invoices beyond the first page", async () => {
		const tables = seedTables(PAGE_SIZE + 1);
		const { client } = createFakeSupabase(tables);

		const result = await createInvoiceExport(client, USER, "invoices_csv");
		const lines = result.content.split("\n");

		// One disclaimer line + the header row + one line per invoice.
		expect(lines).toHaveLength(PAGE_SIZE + 1 + 2);
		// The row that used to be dropped: the first of the second page.
		expect(result.content).toContain("INV-2026-1001");
	});

	it("audits the true row count, not a truncated page", async () => {
		const tables = seedTables(PAGE_SIZE + 1);
		const { client } = createFakeSupabase(tables);

		await createInvoiceExport(client, USER, "tax_summary_csv");

		expect(vi.mocked(recordInvoiceAudit)).toHaveBeenCalledWith(
			client,
			USER,
			expect.objectContaining({
				action: "invoice.export",
				after: expect.objectContaining({ rowCount: PAGE_SIZE + 1 }),
			}),
		);
	});

	it("exports the stored invoice total for an unpaid row", async () => {
		// Regression for the `total` column being fed the paid amount: this row
		// is unpaid (`payment_amount` 0) but has a real total.
		const tables = seedTables(1);
		(tables.invoices[0] as Record<string, unknown>).compliance = {
			netPayable: "161250",
		};
		(tables.invoices[0] as Record<string, unknown>).payment_amount = 0;
		const { client } = createFakeSupabase(tables);

		const result = await createInvoiceExport(client, USER, "invoices_csv");

		expect(result.content.split("\n")[2]).toContain('"NGN",161250,');
	});
});
