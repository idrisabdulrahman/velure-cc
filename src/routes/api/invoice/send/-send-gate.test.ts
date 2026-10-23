import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WP6 audit round-1 — B2 on `POST /api/invoice/send/:id`.
 *
 * The route derives a Draft invoice out of Draft the moment the provider
 * accepts an email (the `sent` delivery event sets delivered_at → unpaid/
 * overdue), so the customer gate must fire BEFORE the PDF render, the
 * provider call and any delivery event. The invoice is read through the REAL
 * data-layer getter over the in-memory Supabase double
 * (`testing/fake-db.ts`, no RLS, no network), so the "state unchanged"
 * assertions observe the stored row itself; only the session bootstrap and
 * the delivery-event/audit write are stubbed.
 */

const harness = vi.hoisted(() => ({
	userId: "user-a",
	client: null as unknown,
	resendSendSpy: vi.fn(
		async (_payload: unknown, _options?: unknown) =>
			({ data: { id: "email-1" }, error: null }) as const,
	),
	recordDeliveryEventSpy: vi.fn(async () => ({
		ok: true as const,
		deliveryEventId: "delivery-1",
	})),
}));

vi.mock("#/server/invoice-repository", async () => {
	// Real read path: `getAuthenticatedInvoiceById` delegates to the data
	// layer so the route gates on the actual stored row (fake-db), not on a
	// hand-built object.
	const { getById } = await import("#/server/data/invoices");
	return {
		getInvoiceUserContext: vi.fn(async () => ({
			client: harness.client,
			userId: harness.userId,
		})),
		getAuthenticatedInvoiceById: vi.fn(
			async (
				id: string,
				context: {
					client: Parameters<typeof getById>[0];
					userId: string;
				},
			) => getById(context.client, context.userId, id),
		),
		recordInvoiceDeliveryEvent: harness.recordDeliveryEventSpy,
	};
});
vi.mock("#/server/data/paystack-server", () => ({
	ensurePaystackTransferCharge: vi.fn(async () => undefined),
}));
vi.mock("#/server/env", () => ({
	getServerEnv: (key: string) =>
		key === "RESEND_API_KEY" ? "re_test_key" : `${key}@velure.test`,
}));
vi.mock("#/server/pdf", () => ({
	renderInvoicePdf: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));
vi.mock("resend", () => ({
	Resend: class {
		emails = { send: harness.resendSendSpy };
	},
}));

import { CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE } from "#/features/invoices/customer-gate";
import {
	createFakeSupabase,
	type FakeTables,
} from "#/server/data/testing/fake-db";
import { renderInvoicePdf } from "#/server/pdf";
import { handle } from "./$id";

const USER_A = "user-a";
const WS_A = "ws-a";
const CLIENT_A = "client-a";

function seedTables(invoice: Record<string, unknown>): FakeTables {
	return {
		workspaces: [
			{
				id: WS_A,
				owner_id: USER_A,
				name: "Alpha",
				invoice_number_mode: "prefix",
				invoice_number_prefix: "INV",
				next_invoice_sequence: 5,
			},
		],
		active_workspaces: [{ user_id: USER_A, workspace_id: WS_A }],
		workspace_members: [{ workspace_id: WS_A, user_id: USER_A, role: "owner" }],
		clients: [
			{
				id: CLIENT_A,
				workspace_id: WS_A,
				owner_id: USER_A,
				name: "Client A",
				email: "client-a@example.test",
			},
		],
		invoices: [invoice],
		invoice_delivery_events: [],
	};
}

/** Raw stored row (snake_case) exactly as `getById` maps it back. */
function draftInvoiceRow(overrides: Record<string, unknown> = {}) {
	return {
		id: "inv-1",
		workspace_id: WS_A,
		token: "share-token",
		token_revoked_at: null,
		document_type: "standard",
		invoice_number: "INV-2026-0001",
		customer_name: "Acme Ltd",
		customer_id: null,
		currency: "NGN",
		invoice_type: "one-time",
		issue_date: "2026-01-01",
		// Far-future due date so nothing derives `overdue` from "today".
		due_date: "2099-12-31",
		status: "draft",
		payment_amount: 0,
		paid_at: null,
		payment_reference: null,
		canceled_at: null,
		deleted_at: null,
		delivered_at: null,
		finalized_at: null,
		line_items: [
			{
				id: "li-1",
				name: "Service",
				quantity: 1,
				price: 100,
				unit: "hour",
				vatCategory: "standard",
				classificationCode: "SVC-001",
			},
		],
		compliance: null,
		fiscalization: null,
		reminder: { enabled: true, paused: false, stage: "none" },
		sync: null,
		lifecycle: {},
		notes: null,
		owner_hint: USER_A,
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-06T00:00:00.000Z",
		...overrides,
	};
}

let tables: FakeTables;

function sendRequest() {
	return new Request("http://velure.test/api/invoice/send/inv-1", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ to: "client@example.test" }),
	});
}

function seed(row: Record<string, unknown>) {
	tables = seedTables(row);
	harness.client = createFakeSupabase(tables).client;
}

describe("POST /api/invoice/send/$id — B2 customer gate", () => {
	beforeEach(() => {
		// Keeps every probe's "not called / called once" assertions independent
		// (mockClear — implementations from the hoisted factories survive).
		vi.clearAllMocks();
	});

	it("rejects a customer-less draft with 4xx and leaves the stored row unchanged", async () => {
		seed(draftInvoiceRow());
		const rowBefore = {
			...(tables.invoices as Array<Record<string, unknown>>)[0],
		};

		const response = await handle({
			params: { id: "inv-1" },
			request: sendRequest(),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			ok: false,
			error: CUSTOMER_REQUIRED_TO_LEAVE_DRAFT_MESSAGE,
		});
		// No external side effect and no delivery event — the rejection happens
		// before the PDF render, the provider call and the delivery-event write.
		expect(renderInvoicePdf).not.toHaveBeenCalled();
		expect(harness.resendSendSpy).not.toHaveBeenCalled();
		expect(harness.recordDeliveryEventSpy).not.toHaveBeenCalled();
		// State unchanged: the invoice is still the same customer-less Draft
		// (delivered_at untouched → no derivation out of Draft) and no delivery
		// event row exists.
		expect((tables.invoices as Array<Record<string, unknown>>)[0]).toEqual(
			rowBefore,
		);
		expect(tables.invoices?.[0]?.delivered_at).toBeNull();
		expect(tables.invoices?.[0]?.status).toBe("draft");
		expect(tables.invoice_delivery_events).toHaveLength(0);
	});

	it("rejects a draft whose customer id belongs to another workspace", async () => {
		// The forged id points at a client that does not exist in ws-a, so the
		// workspace-scoped lookup inside the gate fails closed.
		seed(draftInvoiceRow({ customer_id: "client-from-elsewhere" }));

		const response = await handle({
			params: { id: "inv-1" },
			request: sendRequest(),
		});

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			ok: false,
			error: "Customer not found.",
		});
		expect(harness.resendSendSpy).not.toHaveBeenCalled();
		expect(harness.recordDeliveryEventSpy).not.toHaveBeenCalled();
		expect(tables.invoices?.[0]?.delivered_at).toBeNull();
		expect(tables.invoice_delivery_events).toHaveLength(0);
	});

	it("sends a draft with a linked workspace customer (unchanged success path)", async () => {
		seed(draftInvoiceRow({ customer_id: CLIENT_A }));

		const response = await handle({
			params: { id: "inv-1" },
			request: sendRequest(),
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, id: "email-1" });
		expect(renderInvoicePdf).toHaveBeenCalledTimes(1);
		expect(harness.resendSendSpy).toHaveBeenCalledTimes(1);
		expect(harness.recordDeliveryEventSpy).toHaveBeenCalledTimes(1);
		expect(harness.recordDeliveryEventSpy).toHaveBeenCalledWith(
			expect.objectContaining({ userId: USER_A }),
			expect.objectContaining({ invoiceId: "inv-1", status: "sent" }),
		);
	});

	it("still sends a legacy issued invoice that never had a customer", async () => {
		// Non-derived-Draft rows are not an exit from Draft, so the gate stays
		// out of the way (no retro-block on historical invoices).
		seed(
			draftInvoiceRow({
				status: "unpaid",
				delivered_at: "2026-01-05T00:00:00.000Z",
				finalized_at: "2026-01-05T00:00:00.000Z",
			}),
		);

		const response = await handle({
			params: { id: "inv-1" },
			request: sendRequest(),
		});

		expect(response.status).toBe(200);
		expect(harness.resendSendSpy).toHaveBeenCalledTimes(1);
	});
});
