import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WP6 audit round-1 finding 3 (hardened in round 2, HIGH) — CSV import and
 * the B2 customer gate.
 *
 * `importCsv` writes historical rows; it best-effort links `customer_id` to
 * an existing client whose email matches the row's customer cell — SAME
 * workspace only, normalized with the clients module's
 * `trim().toLowerCase()`. Round 1 exempted issued-family rows from the
 * customer gate; round 2 REMOVED that exemption: a row whose CSV status is
 * unpaid / overdue / paid but whose customer cell resolves to no workspace
 * client now lands as a DRAFT (no `delivered_at` / `paid_at` /
 * `payment_amount`, the original CSV status kept in `internal_notes`) so
 * `assertCustomerForIssueTransition` stays the single choke point for
 * leaving Draft. Demoted rows are still counted in the returned
 * `needsBuyerMatch` flag, so the import UI reports them instead of dropping
 * them silently; unmatched draft rows stay ordinary customer-less drafts.
 * Probes use the no-RLS fake-db double; the browser-safe audit transport is
 * stubbed like in the other data suites.
 */

vi.mock("#/server/data/audit-client", () => ({
	recordInvoiceAudit: vi.fn(async () => {}),
}));

import { CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE } from "#/features/invoices/customer-gate";
import { type InvoiceImportRow, importCsv, updateStatus } from "./invoices";
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
		// Cross-workspace linkage is refused, and the issued-family row is
		// demoted to Draft — never linked, never issued, never silent.
		expect(rows[0]?.status).toBe("draft");
		expect(rows[0]?.delivered_at).toBeNull();
		expect(result.needsBuyerMatch).toBe(1);
	});

	it("demotes an unmatched issued-family row to Draft instead of importing it issued", async () => {
		const result = await importCsv(client, USER_A, [
			// No email in the cell → no candidate. The row ASKED for `unpaid`
			// but import may not exempt itself from the leave-Draft gate: it
			// lands as a buyer-less draft with no issue/payment stamp.
			rowInput("No Match Ltd", "unpaid"),
		]);

		expect(result).toMatchObject({ created: 1, skipped: 0, errors: [] });
		const rows = importedRows(WS_A);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.customer_id).toBeNull();
		expect(rows[0]?.status).toBe("draft");
		expect(rows[0]?.delivered_at).toBeNull();
		expect(rows[0]?.paid_at).toBeNull();
		expect(rows[0]?.payment_amount).toBe(0);
		// The original CSV status survives in the internal note so the buyer
		// can be linked later without losing the imported intent.
		expect(String(rows[0]?.internal_notes)).toContain('"unpaid"');
		// Not silent: the row still trips the import report.
		expect(result.needsBuyerMatch).toBe(1);
	});

	it("demotes an unmatched paid row without stamping paid_at or payment_amount", async () => {
		const result = await importCsv(client, USER_A, [
			rowInput("No Match Ltd", "paid"),
		]);

		expect(result).toMatchObject({ created: 1, skipped: 0, errors: [] });
		const rows = importedRows(WS_A);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.customer_id).toBeNull();
		expect(rows[0]?.status).toBe("draft");
		expect(rows[0]?.paid_at).toBeNull();
		expect(rows[0]?.delivered_at).toBeNull();
		expect(rows[0]?.payment_amount).toBe(0);
		expect(String(rows[0]?.internal_notes)).toContain('"paid"');
		expect(result.needsBuyerMatch).toBe(1);
	});

	it("keeps the gate as the single choke point after a demoted import", async () => {
		const result = await importCsv(client, USER_A, [
			rowInput("No Match Ltd", "overdue"),
		]);
		expect(result.created).toBe(1);
		const [imported] = importedRows(WS_A);
		expect(imported?.status).toBe("draft");

		// The imported draft must still pass `assertCustomerForIssueTransition`
		// to leave Draft — the import path cannot front-run it.
		await expect(
			updateStatus(client, USER_A, {
				id: String(imported?.id),
				status: "unpaid",
			}),
		).rejects.toThrow(CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE);
		expect(importedRows(WS_A)[0]?.status).toBe("draft");
		expect(importedRows(WS_A)[0]?.delivered_at).toBeNull();
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

	it("still matches a client that sits beyond one PostgREST page of workspace clients", async () => {
		// PostgREST caps an UNBOUNDED SELECT at 1000 rows by default, and the
		// fake now emulates that cap (`DEFAULT_MAX_ROWS` in
		// testing/fake-db.ts). A single all-clients read would therefore
		// truncate the email → id map for a workspace bigger than one page and
		// silently demote a matchable row to a buyer-less draft. Fill workspace
		// A past one page and give the matching client the LAST id (`zzz-…`) so
		// the link can only be made from the SECOND page of the paged lookup.
		const PAGE_SIZE = 1000;
		for (let index = 0; index < PAGE_SIZE + 150; index += 1) {
			tables.clients?.push(
				clientRow(
					`client-filler-${index}`,
					WS_A,
					USER_A,
					`filler-${index}@example.test`,
				),
			);
		}
		tables.clients?.push(
			clientRow("zzz-deep-client", WS_A, USER_A, "deep-buyer@example.test"),
		);

		const result = await importCsv(client, USER_A, [
			rowInput("deep-buyer@example.test", "unpaid"),
		]);

		expect(result).toMatchObject({
			created: 1,
			skipped: 0,
			errors: [],
			needsBuyerMatch: 0,
		});
		const rows = importedRows(WS_A);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.customer_id).toBe("zzz-deep-client");
		expect(rows[0]?.status).toBe("unpaid");
	});
});
