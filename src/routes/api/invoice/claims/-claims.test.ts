import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * WP-A seller action on a buyer claim.
 *
 * Session-scoped: identity comes only from the verified request session, the
 * path id is the only resource handle, and a failure never leaks an internal
 * message. The data layer owns the tenancy and RLS enforcement
 * (`payment-claims.test.ts`); this pins the route contract.
 */

const { getContextMock, confirmMock, rejectMock } = vi.hoisted(() => ({
	getContextMock: vi.fn(),
	confirmMock: vi.fn(),
	rejectMock: vi.fn(),
}));

vi.mock("#/server/invoice-repository", () => ({
	getInvoiceUserContext: getContextMock,
}));
vi.mock("#/server/data/payment-claims", () => ({
	confirmPaymentClaim: confirmMock,
	rejectPaymentClaim: rejectMock,
}));

import { handle, handlers } from "./$id";

afterEach(() => vi.clearAllMocks());

const CONTEXT = { client: { tag: "user-scoped" }, userId: "user-b" };

function request(body: unknown, raw = false) {
	return new Request("https://velure.example/api/invoice/claims/claim-1", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: raw ? (body as string) : JSON.stringify(body),
	});
}

describe("POST /api/invoice/claims/$id", () => {
	it("registers POST only", () => {
		expect(handlers).toHaveProperty("POST");
		expect(handlers).not.toHaveProperty("GET");
	});

	it("401s without a session and touches nothing", async () => {
		getContextMock.mockResolvedValue(null);

		const response = await handle({
			request: request({ action: "confirm" }),
			params: { id: "claim-1" },
		});

		expect(response.status).toBe(401);
		expect(confirmMock).not.toHaveBeenCalled();
		expect(rejectMock).not.toHaveBeenCalled();
	});

	it("400s on an unknown action", async () => {
		getContextMock.mockResolvedValue(CONTEXT);

		const response = await handle({
			request: request({ action: "delete" }),
			params: { id: "claim-1" },
		});

		expect(response.status).toBe(400);
		expect(confirmMock).not.toHaveBeenCalled();
		expect(rejectMock).not.toHaveBeenCalled();
	});

	it("confirms through the session client + user + path id only", async () => {
		getContextMock.mockResolvedValue(CONTEXT);
		confirmMock.mockResolvedValue({
			ok: true,
			duplicate: false,
			invoiceId: "inv-b",
		});

		// A forged workspace/user hint in the body must not steer the call.
		const response = await handle({
			request: request({
				action: "confirm",
				workspaceId: "ws-a",
				userId: "user-a",
			}),
			params: { id: "claim-1" },
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({ ok: true });
		expect(confirmMock).toHaveBeenCalledWith(
			CONTEXT.client,
			"user-b",
			"claim-1",
		);
		expect(rejectMock).not.toHaveBeenCalled();
	});

	it("rejects through the same session-derived seam", async () => {
		getContextMock.mockResolvedValue(CONTEXT);
		rejectMock.mockResolvedValue({ ok: true, invoiceId: "inv-b" });

		const response = await handle({
			request: request({ action: "reject" }),
			params: { id: "claim-1" },
		});

		expect(response.status).toBe(200);
		expect(rejectMock).toHaveBeenCalledWith(
			CONTEXT.client,
			"user-b",
			"claim-1",
		);
		expect(confirmMock).not.toHaveBeenCalled();
	});

	it("404s when the claim is not in the caller's workspace", async () => {
		getContextMock.mockResolvedValue(CONTEXT);
		confirmMock.mockRejectedValue(new Error("Payment claim not found."));

		const response = await handle({
			request: request({ action: "confirm" }),
			params: { id: "claim-of-workspace-a" },
		});

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({
			ok: false,
			error: "Payment claim not found.",
		});
	});

	it("never leaks an internal error: an unexpected throw becomes a generic 500", async () => {
		getContextMock.mockResolvedValue(CONTEXT);
		confirmMock.mockRejectedValue(new Error("duplicate key value violates"));
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		const response = await handle({
			request: request({ action: "confirm" }),
			params: { id: "claim-1" },
		});

		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toEqual({
			error: "Something went wrong.",
		});
		expect(error).toHaveBeenCalled();
	});
});
