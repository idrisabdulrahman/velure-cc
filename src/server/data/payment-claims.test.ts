import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WP-A — buyer payment claims.
 *
 * Two properties matter here:
 *
 *   1. **Tenancy.** Every claim handle is workspace-family. The no-RLS fake
 *      below proves the app-layer filter: workspace B cannot list, confirm or
 *      reject workspace A's claim even though the fake would happily return
 *      the row (`AGENTS.md` §8).
 *   2. **Money safety.** A claim is evidence, not settlement. Confirming goes
 *      through `recordPayment` (mocked here; its own money invariants are
 *      pinned in `payments` tests) and the claim is marked confirmed only
 *      after that resolves. A failed settlement leaves the claim untouched.
 */

vi.mock("./audit-client", () => ({
	recordInvoiceAudit: vi.fn(async () => {}),
}));
vi.mock("./payments", () => ({
	recordPayment: vi.fn(),
}));

import {
	confirmPaymentClaim,
	insertPaymentClaim,
	listPaymentClaims,
	rejectPaymentClaim,
} from "./payment-claims";
import { recordPayment } from "./payments";
import { createFakeSupabase, type FakeTables } from "./testing/fake-db";
import type { Supabase } from "./workspaces";

const USER_A = "user-a";
const USER_B = "user-b";
const WS_A = "ws-a";
const WS_B = "ws-b";
const INV_A = "invoice-a";
const INV_B = "invoice-b";
const CLAIM_A = "claim-a";
const CLAIM_B = "claim-b";

function invoiceRow(id: string, workspaceId: string, ownerId: string) {
	return {
		id,
		workspace_id: workspaceId,
		token: `token-${id}`,
		token_revoked_at: null,
		document_type: "standard",
		invoice_number: `INV-2026-${id}`,
		customer_name: `Customer ${id}`,
		customer_id: null,
		currency: "NGN",
		invoice_type: "one-time",
		issue_date: "2026-01-01",
		due_date: "2026-02-01",
		status: "unpaid",
		payment_amount: 0,
		paid_at: null,
		payment_reference: null,
		canceled_at: null,
		deleted_at: null,
		delivered_at: "2026-01-05T00:00:00.000Z",
		line_items: [{ id: "li-1", name: "Service", quantity: 1, price: 100 }],
		compliance: { buyer: { email: `buyer-${id}@example.test` } },
		fiscalization: null,
		reminder: { enabled: true, paused: false, stage: "none" },
		sync: null,
		lifecycle: { sentAt: Date.parse("2026-01-05T00:00:00Z") },
		notes: null,
		internal_notes: null,
		owner_hint: ownerId,
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-06T00:00:00.000Z",
	};
}

function claimRow(
	id: string,
	workspaceId: string,
	invoiceId: string,
	overrides: Record<string, unknown> = {},
) {
	return {
		id,
		workspace_id: workspaceId,
		invoice_id: invoiceId,
		claimed_amount: 100,
		claim_reference: `ref-${id}`,
		note: null,
		status: "claimed",
		claimed_at: "2026-01-07T00:00:00.000Z",
		resolved_at: null,
		resolved_by: null,
		created_at: "2026-01-07T00:00:00.000Z",
		updated_at: "2026-01-07T00:00:00.000Z",
		...overrides,
	};
}

function seed(): FakeTables {
	return {
		workspaces: [
			{ id: WS_A, name: "Alpha", invoice_number_prefix: "INV" },
			{ id: WS_B, name: "Beta", invoice_number_prefix: "INV" },
		],
		active_workspaces: [
			{ user_id: USER_A, workspace_id: WS_A },
			{ user_id: USER_B, workspace_id: WS_B },
		],
		invoices: [
			invoiceRow(INV_A, WS_A, USER_A),
			invoiceRow(INV_B, WS_B, USER_B),
		],
		payment_claims: [
			claimRow(CLAIM_A, WS_A, INV_A),
			claimRow(CLAIM_B, WS_B, INV_B),
		],
	};
}

let tables: FakeTables;
let client: Supabase;

beforeEach(() => {
	tables = seed();
	client = createFakeSupabase(tables).client;
	vi.mocked(recordPayment).mockReset();
});

function claim(id: string) {
	return tables.payment_claims?.find((row) => row.id === id);
}

describe("listPaymentClaims — workspace scoping", () => {
	it("returns the caller's own claims for the invoice", async () => {
		const claims = await listPaymentClaims(client, USER_A, INV_A);
		expect(claims).toHaveLength(1);
		expect(claims[0]).toMatchObject({
			id: CLAIM_A,
			invoiceId: INV_A,
			claimedAmount: 100,
			claimReference: "ref-claim-a",
			status: "claimed",
		});
	});

	it("answers [] for a foreign invoice id (workspace B asking for A's invoice)", async () => {
		await expect(listPaymentClaims(client, USER_B, INV_A)).resolves.toEqual([]);
	});

	it("never leaks another workspace's claim list even for the caller's own invoice", async () => {
		const claims = await listPaymentClaims(client, USER_B, INV_B);
		expect(claims.map((entry) => entry.id)).toEqual([CLAIM_B]);
	});
});

describe("confirmPaymentClaim — evidence, not settlement", () => {
	it("settles through recordPayment, then marks the claim confirmed", async () => {
		vi.mocked(recordPayment).mockResolvedValue({
			ok: true,
			duplicate: false,
			invoiceId: INV_A,
		});

		const result = await confirmPaymentClaim(client, USER_A, CLAIM_A);

		expect(recordPayment).toHaveBeenCalledWith(client, USER_A, {
			invoiceId: INV_A,
			amount: 100,
			reference: "ref-claim-a",
		});
		expect(result).toEqual({
			ok: true,
			duplicate: false,
			invoiceId: INV_A,
		});
		expect(claim(CLAIM_A)).toMatchObject({
			status: "confirmed",
			resolved_by: USER_A,
		});
		expect(claim(CLAIM_A)?.resolved_at).toEqual(expect.any(String));
	});

	it("leaves the claim claimed when settlement throws (no false confirmation)", async () => {
		vi.mocked(recordPayment).mockRejectedValue(new Error("not payable"));

		await expect(confirmPaymentClaim(client, USER_A, CLAIM_A)).rejects.toThrow(
			"not payable",
		);
		expect(claim(CLAIM_A)).toMatchObject({
			status: "claimed",
			resolved_by: null,
		});
	});

	it("is idempotent: an already-confirmed claim does not settle twice", async () => {
		tables.payment_claims = [
			claimRow(CLAIM_A, WS_A, INV_A, { status: "confirmed" }),
		];

		const result = await confirmPaymentClaim(client, USER_A, CLAIM_A);

		expect(result).toEqual({ ok: true, duplicate: true, invoiceId: INV_A });
		expect(recordPayment).not.toHaveBeenCalled();
	});

	it("refuses a foreign claim and never settles it", async () => {
		await expect(confirmPaymentClaim(client, USER_B, CLAIM_A)).rejects.toThrow(
			"Payment claim not found.",
		);
		expect(recordPayment).not.toHaveBeenCalled();
		expect(claim(CLAIM_A)).toMatchObject({ status: "claimed" });
	});
});

describe("rejectPaymentClaim", () => {
	it("marks the claim rejected, resolving it without deleting", async () => {
		const result = await rejectPaymentClaim(client, USER_A, CLAIM_A);
		expect(result).toEqual({ ok: true, invoiceId: INV_A });
		expect(claim(CLAIM_A)).toMatchObject({
			status: "rejected",
			resolved_by: USER_A,
		});
		// The row still exists: rejection is a status change, not a delete.
		expect(claim(CLAIM_A)).toBeDefined();
	});

	it("refuses a foreign claim", async () => {
		await expect(rejectPaymentClaim(client, USER_B, CLAIM_A)).rejects.toThrow(
			"Payment claim not found.",
		);
		expect(claim(CLAIM_A)).toMatchObject({ status: "claimed" });
	});
});

describe("insertPaymentClaim — public submit idempotency", () => {
	function stubClient(result: { data: unknown; error: unknown }): Supabase {
		return {
			from: () => ({
				insert: () => ({
					select: () => ({ maybeSingle: async () => result }),
				}),
			}),
		} as unknown as Supabase;
	}

	it("returns the new id on a first insert", async () => {
		const inserted = await insertPaymentClaim(
			stubClient({ data: { id: "claim-new" }, error: null }),
			{ workspaceId: WS_A, invoiceId: INV_A, amount: 100, reference: "ref" },
		);
		expect(inserted).toEqual({ id: "claim-new", duplicate: false });
	});

	it("reports a unique-violation as a duplicate no-op, not an error", async () => {
		const inserted = await insertPaymentClaim(
			stubClient({ data: null, error: { code: "23505" } }),
			{ workspaceId: WS_A, invoiceId: INV_A, amount: 100, reference: "ref" },
		);
		expect(inserted).toEqual({ id: null, duplicate: true });
	});

	it("rethrows any other error", async () => {
		await expect(
			insertPaymentClaim(stubClient({ data: null, error: { code: "42P01" } }), {
				workspaceId: WS_A,
				invoiceId: INV_A,
				amount: 100,
			}),
		).rejects.toMatchObject({ code: "42P01" });
	});
});
