import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * WP-A seller claim list. Identity and workspace scoping live in
 * `listPaymentClaims` (proven in `payment-claims.test.ts`); this pins the route
 * contract: session required, invoice id required, and the claims payload.
 */

const { getContextMock, listMock } = vi.hoisted(() => ({
	getContextMock: vi.fn(),
	listMock: vi.fn(),
}));

vi.mock("#/server/invoice-repository", () => ({
	getInvoiceUserContext: getContextMock,
}));
vi.mock("#/server/data/payment-claims", () => ({
	listPaymentClaims: listMock,
}));

import { handle, handlers } from "./claims.index";

afterEach(() => vi.clearAllMocks());

const CONTEXT = { client: { tag: "user-scoped" }, userId: "user-b" };

function request(
	url = "http://velure.test/api/invoice/claims?invoiceId=inv-b",
) {
	return new Request(url);
}

describe("GET /api/invoice/claims", () => {
	it("registers GET only", () => {
		expect(handlers).toHaveProperty("GET");
		expect(handlers).not.toHaveProperty("POST");
	});

	it("401s without a session and reads nothing", async () => {
		getContextMock.mockResolvedValue(null);

		const response = await handle({ request: request() });

		expect(response.status).toBe(401);
		expect(listMock).not.toHaveBeenCalled();
	});

	it("400s when invoiceId is missing", async () => {
		getContextMock.mockResolvedValue(CONTEXT);

		const response = await handle({
			request: request("http://velure.test/api/invoice/claims"),
		});

		expect(response.status).toBe(400);
		expect(listMock).not.toHaveBeenCalled();
	});

	it("returns the scoped claims for the requested invoice", async () => {
		getContextMock.mockResolvedValue(CONTEXT);
		listMock.mockResolvedValue([
			{
				id: "claim-1",
				invoiceId: "inv-b",
				claimedAmount: 5000,
				claimReference: "ref-1",
				note: null,
				status: "claimed",
				claimedAt: 1,
				resolvedAt: null,
				resolvedBy: null,
			},
		]);

		const response = await handle({ request: request() });

		expect(response.status).toBe(200);
		expect(listMock).toHaveBeenCalledWith(CONTEXT.client, "user-b", "inv-b");
		await expect(response.json()).resolves.toMatchObject({
			ok: true,
			claims: [{ id: "claim-1", status: "claimed" }],
		});
	});

	it("never leaks an internal error: a thrown failure becomes a generic 500", async () => {
		getContextMock.mockResolvedValue(CONTEXT);
		listMock.mockRejectedValue(new Error("relation payment_claims missing"));
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		const response = await handle({ request: request() });

		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toEqual({
			error: "Something went wrong.",
		});
		expect(error).toHaveBeenCalled();
	});
});
