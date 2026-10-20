import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WP6 audit round-1, finding 3 — CSV import client linkage.
 *
 * `importCsv` writes historical rows; before this round every imported row
 * carried only the free-text `customer_name`. Now the importer best-effort
 * links `customer_id` to an existing client whose email matches the row's
 * customer cell — SAME workspace only, normalized with the clients module's
 * `trim().toLowerCase()`. Rows without a match deliberately keep
 * `customer_id = null` (documented historical-import exemption at the status
 * derivation in src/server/data/invoices.ts) and are counted in the returned
 * `needsBuyerMatch` flag when they land in the issued family, so the import UI
 * reports them instead of dropping them silently; imported rows never run the
 * leave-Draft customer gate. Probes use the no-RLS fake-db double; the
 * browser-safe audit transport is stubbed like in the other data suites.
 */

vi.mock("#/server/data/audit-client", () => ({
	recordInvoiceAudit: vi.fn(async () => {}),
}));

import { type InvoiceImportRow, importCsv } from "./invoices";
import { createFakeSupabase, type FakeTables } from "./testing/fake-db";

const USER_A = "user-a";
const USER_B = "user-b";
const WS_A = "ws-a";
const WS_B = "ws-b";
const CLIENT_A = "client-a";

function workspaceRow(id: string, ownerId: string, name: string) {
	return {
		id,
		owner_id: ownerId,
		name,
		legal_name: `${name} Legal`,
		email: `${name.toLowerCase()}@example.test`,
		invoice_number_mode: "prefix",
		invoice_number_prefix: "INV",
		next_invoice_sequence: 5,
		updated_at: "2026-01-01T00:00:00.000Z",
	};
}

function clientRow(
	id: string,
	workspaceId: string,
	ownerId: string,
	email: string,
) {
	return {
		id,
		workspace_id: workspaceId,
		owner_id: ownerId,
		name: `Client ${id}`,
		email,
		contact: { email },
		favorite: false,
		status: "active",
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
	};
}

function seedTables(): FakeTables {
	return {
		workspaces: [
			workspaceRow(WS_A, USER_A, "Alpha"),
			workspaceRow(WS_B, USER_B, "Beta"),
		],
		active_workspaces: [
			{ user_id: USER_A, workspace_id: WS_A },
			{ user_id: USER_B, workspace_id: WS_B },
		],
		workspace_members: [
			{ workspace_id: WS_A, user_id: USER_A, role: "owner" },
			{ workspace_id: WS_B, user_id: USER_B, role: "owner" },
		],
		clients: [
			clientRow(CLIENT_A, WS_A, USER_A, "client-a@example.test"),
			clientRow("client-b", WS_B, USER_B, "client-b@example.test"),
		],
		invoices: [],
	};
}

function rowInput(customerName: string, status?: InvoiceImportRow["status"]) {
	return {
		customerName,
		description: "Consulting",
		quantity: 1,
		price: 500,
		status,
	};
}

let tables: FakeTables;
let client: ReturnType<typeof createFakeSupabase>["client"];

function importedRows(workspaceId?: string) {
	return (tables.invoices as Array<Record<string, unknown>>).filter(
		(entry) => workspaceId === undefined || entry.workspace_id === workspaceId,
	);
}

beforeEach(() => {
	tables = seedTables();
	client = createFakeSupabase(tables).client;
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("CSV import → workspace client linkage by email", () => {
	it("links a row to the existing client whose email matches (normalized)", async () => {
		const result = await importCsv(client, USER_A, [
			// Free-text cell with surrounding whitespace and mixed case — the
			// importer normalizes with trim().toLowerCase() on both sides.
			rowInput(" Client-A@Example.TEST ", "unpaid"),
		]);

		expect(result).toMatchObject({ created: 1, skipped: 0, errors: [] });
		const rows = importedRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.workspace_id).toBe(WS_A);
		expect(rows[0]?.customer_id).toBe(CLIENT_A);
		// The imported name itself is preserved verbatim (trimmed).
		expect(rows[0]?.customer_name).toBe("Client-A@Example.TEST");
		expect(rows[0]?.status).toBe("unpaid");
		// Issued row WITH a linked buyer → the import flag stays silent.
		expect(result.needsBuyerMatch).toBe(0);
	});

	it("never matches a client that belongs to another workspace", async () => {
		const result = await importCsv(client, USER_B, [
			// client-a's email exists only in workspace A.
			rowInput("client-a@example.test", "unpaid"),
		]);

		expect(result).toMatchObject({ created: 1, skipped: 0, errors: [] });
		const rows = importedRows(WS_B);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.customer_id).toBeNull();
		// Cross-workspace linkage is refused, and the unlinked issued row is
		// reported back (never linked, never silent).
		expect(result.needsBuyerMatch).toBe(1);
	});

	it("keeps customer_id null without a match and does not gate the import", async () => {
		const result = await importCsv(client, USER_A, [
			// No email in the cell → no candidate; issued-family rows are
			// historical imports and are never rejected by the B2 gate.
			rowInput("No Match Ltd", "unpaid"),
		]);

		expect(result).toMatchObject({ created: 1, skipped: 0, errors: [] });
		const rows = importedRows(WS_A);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.customer_id).toBeNull();
		expect(rows[0]?.status).toBe("unpaid");
		// Documented exemption + flag: the row is created, and the caller is
		// told it needs a buyer link.
		expect(result.needsBuyerMatch).toBe(1);
	});

	it("does not flag an unmatched row that stays a draft", async () => {
		const result = await importCsv(client, USER_A, [
			// A buyer-less draft is a legal document state (spec B2), so only
			// issued-family rows raise the flag.
			rowInput("No Match Ltd"),
		]);

		expect(result).toMatchObject({ created: 1, skipped: 0, errors: [] });
		const rows = importedRows(WS_A);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.customer_id).toBeNull();
		expect(rows[0]?.status).toBe("draft");
		expect(result.needsBuyerMatch).toBe(0);
	});
});
