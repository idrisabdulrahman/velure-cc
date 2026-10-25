import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WP3 — cross-tenant (IDOR) probes at the HTTP boundary.
 *
 * The data-layer suite (`src/server/data/tenant-isolation.test.ts`) proves
 * the session-scoped lookups themselves refuse workspace-A rows for
 * workspace-B credentials. What is proven HERE is the route contract those
 * lookups depend on: every id/token-bearing handler resolves its resource
 * through exactly one session-scoped (or token-scoped) function and fails
 * closed when that lookup returns nothing — there is no unscoped fallback
 * read, no identity taken from the body, and no provider side effect on a
 * cross-tenant miss.
 *
 * The repository/data functions are mocked at their seam; their internal
 * scoping is covered by the data-layer suite and the A10_LIVE RLS matrix.
 */

const {
	resendSendSpy,
	getInvoiceUserContextMock,
	getAuthenticatedInvoiceByIdMock,
	recordInvoiceDeliveryEventMock,
	getInvoiceByTokenMock,
	ensurePaystackTransferChargeMock,
	renderInvoicePdfMock,
	sendQueuedEmailsMock,
} = vi.hoisted(() => ({
	resendSendSpy: vi.fn(
		async (_payload: unknown, _options?: unknown) =>
			({ data: { id: "email-1" }, error: null }) as const,
	),
	getInvoiceUserContextMock: vi.fn(),
	getAuthenticatedInvoiceByIdMock: vi.fn(),
	recordInvoiceDeliveryEventMock: vi.fn(async () => {}),
	getInvoiceByTokenMock: vi.fn(),
	ensurePaystackTransferChargeMock: vi.fn(async () => undefined),
	renderInvoicePdfMock: vi.fn(async () => new Uint8Array([1, 2, 3])),
	sendQueuedEmailsMock: vi.fn(async () => ({ sent: 0, skipped: 0 })),
}));

vi.mock("#/server/invoice-repository", () => ({
	getInvoiceUserContext: getInvoiceUserContextMock,
	getAuthenticatedInvoiceById: getAuthenticatedInvoiceByIdMock,
	recordInvoiceDeliveryEvent: recordInvoiceDeliveryEventMock,
}));
vi.mock("#/server/public-invoice-repository", () => ({
	getInvoiceByToken: getInvoiceByTokenMock,
}));
vi.mock("#/server/data/paystack-server", () => ({
	ensurePaystackTransferCharge: ensurePaystackTransferChargeMock,
}));
vi.mock("#/server/data/reminders", () => ({
	sendQueuedEmails: sendQueuedEmailsMock,
}));
vi.mock("#/server/env", () => ({
	getServerEnv: (key: string) =>
		key === "RESEND_API_KEY" ? "re_test_key" : `${key}@velure.test`,
}));
vi.mock("#/server/pdf", () => ({
	renderInvoicePdf: renderInvoicePdfMock,
}));
vi.mock("resend", () => ({
	Resend: class {
		emails = { send: resendSendSpy };
	},
}));

import { handle as handleDownload } from "./invoice/download/$id";
import { handle as handleSend } from "./invoice/send/$id";
import { handle as handleSendQueue } from "./reminders/send-queue";

beforeEach(() => {
	vi.clearAllMocks();
});

const WORKSPACE_B_CONTEXT = { client: {}, userId: "user-b" };

function sendRequest(invoiceId: string) {
	return new Request(`http://velure.test/api/invoice/send/${invoiceId}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ to: "client@example.test" }),
	});
}

describe("POST /api/invoice/send/$id — cross-tenant id swap", () => {
	it("answers 404 with no email or side effects when the session-scoped lookup misses", async () => {
		// Workspace B posts workspace A's invoice id. The scoped repository
		// lookup returns null for a foreign id (proven in the data-layer
		// suite); the route must fail closed with nothing else touched.
		getInvoiceUserContextMock.mockResolvedValue(WORKSPACE_B_CONTEXT);
		getAuthenticatedInvoiceByIdMock.mockResolvedValue(null);

		const response = await handleSend({
			params: { id: "inv-a" },
			request: sendRequest("inv-a"),
		});

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			ok: false,
			error: "Invoice not found.",
		});
		expect(resendSendSpy).not.toHaveBeenCalled();
		expect(recordInvoiceDeliveryEventMock).not.toHaveBeenCalled();
		expect(ensurePaystackTransferChargeMock).not.toHaveBeenCalled();
		expect(renderInvoicePdfMock).not.toHaveBeenCalled();
	});

	it("resolves the resource only through the path id + session context — never the body", async () => {
		const context = WORKSPACE_B_CONTEXT;
		getInvoiceUserContextMock.mockResolvedValue(context);
		getAuthenticatedInvoiceByIdMock.mockResolvedValue({
			id: "inv-b",
			token: "token-b",
			invoiceNumber: "INV-2026-0002",
			customerName: "Beta Ltd",
			documentType: "standard",
			updatedAt: 1_700_000_000_000,
		});

		// A forged identity/resource hint in the body must not steer the lookup.
		const forged = new Request("http://velure.test/api/invoice/send/inv-b", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				to: "client@example.test",
				id: "inv-a",
				invoiceId: "inv-a",
				workspaceId: "ws-a",
				userId: "user-a",
			}),
		});
		const response = await handleSend({
			params: { id: "inv-b" },
			request: forged,
		});

		expect(response.status).toBe(200);
		expect(getAuthenticatedInvoiceByIdMock).toHaveBeenCalledWith(
			"inv-b",
			context,
		);
		expect(getAuthenticatedInvoiceByIdMock).toHaveBeenCalledTimes(1);
	});
});

describe("GET /api/invoice/download/$id — public token boundary", () => {
	it("answers 404 and renders nothing for an unknown/foreign token", async () => {
		getInvoiceByTokenMock.mockResolvedValue(null);

		const response = await handleDownload({
			params: { id: "no-such-token" },
		});

		expect(response.status).toBe(404);
		expect(renderInvoicePdfMock).not.toHaveBeenCalled();
	});

	it("keys the download on the share token only — no session or workspace handle exists", async () => {
		getInvoiceByTokenMock.mockResolvedValue({
			id: "inv-a",
			invoiceNumber: "INV-2026-0001",
			token: "pub-token-a",
		});

		const response = await handleDownload({
			params: { id: encodeURIComponent("pub-token-a") },
		});

		expect(response.status).toBe(200);
		// The handler has exactly one dependency: token → invoice. No
		// session context, workspace id or user id can be supplied.
		expect(getInvoiceByTokenMock).toHaveBeenCalledWith("pub-token-a");
		expect(getInvoiceByTokenMock).toHaveBeenCalledTimes(1);
	});
});

describe("POST /api/reminders/send-queue — session-derived tenancy", () => {
	it("401s without a session and never drains any queue", async () => {
		getInvoiceUserContextMock.mockResolvedValue(null);

		const response = await handleSendQueue({
			request: new Request("http://velure.test/api/reminders/send-queue", {
				method: "POST",
			}),
		});

		expect(response.status).toBe(401);
		expect(sendQueuedEmailsMock).not.toHaveBeenCalled();
	});

	it("passes only the session client + user into the queue drain (body is ignored)", async () => {
		const context = WORKSPACE_B_CONTEXT;
		getInvoiceUserContextMock.mockResolvedValue(context);

		const forged = new Request("http://velure.test/api/reminders/send-queue", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ userId: "user-a", workspaceId: "ws-a" }),
		});
		const response = await handleSendQueue({ request: forged });

		expect(response.status).toBe(200);
		expect(sendQueuedEmailsMock).toHaveBeenCalledWith(
			context.client,
			context.userId,
		);
	});
});
