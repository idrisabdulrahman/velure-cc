import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * WP-A buyer "I've paid" endpoint.
 *
 * The repository is mocked at its seam (its tenancy/rate-limit behavior is
 * proven in `public-invoice-repository.test.ts`); what is pinned here is the
 * route contract: input validation, the token-only identity, the status mapping
 * and that no internal error ever reaches the client.
 */

const { submitMock, getClientIpMock } = vi.hoisted(() => ({
	submitMock: vi.fn(),
	getClientIpMock: vi.fn(() => "203.0.113.8"),
}));

vi.mock("#/server/public-invoice-repository", () => ({
	submitPublicPaymentClaim: submitMock,
}));
vi.mock("#/server/http-security", () => ({
	getClientIp: getClientIpMock,
}));

import { handle, handlers } from "./claim";

afterEach(() => vi.clearAllMocks());

function request(body: unknown, raw = false) {
	return new Request("https://velure.example/api/invoice/public/claim", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: raw ? (body as string) : JSON.stringify(body),
	});
}

describe("POST /api/invoice/public/claim", () => {
	it("registers POST only", () => {
		expect(handlers).toHaveProperty("POST");
		expect(handlers).not.toHaveProperty("GET");
	});

	it("400s on a non-JSON body", async () => {
		const response = await handle({ request: request("not json", true) });
		expect(response.status).toBe(400);
		expect(submitMock).not.toHaveBeenCalled();
	});

	it("400s when the token is missing", async () => {
		const response = await handle({ request: request({ amount: 100 }) });
		expect(response.status).toBe(400);
		expect(submitMock).not.toHaveBeenCalled();
	});

	it("400s on a non-finite or non-positive amount", async () => {
		for (const amount of [
			0,
			-5,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			"abc",
			null,
		]) {
			const response = await handle({
				request: request({ token: "t", amount }),
			});
			expect(response.status).toBe(400);
		}
		expect(submitMock).not.toHaveBeenCalled();
	});

	it("accepts a fractional amount (major-unit money, not a forced integer)", async () => {
		submitMock.mockResolvedValue({ ok: true, duplicate: false });

		const response = await handle({
			request: request({ token: "t", amount: 1234.56 }),
		});

		expect(response.status).toBe(200);
		expect(submitMock).toHaveBeenCalledWith(
			"t",
			expect.objectContaining({ amount: 1234.56 }),
			expect.anything(),
		);
	});

	it("passes a trimmed, bounded payload and the client IP to the repository", async () => {
		submitMock.mockResolvedValue({ ok: true, duplicate: false });

		const response = await handle({
			request: request({
				token: "  tok_1  ",
				amount: 5000,
				reference: "  bank-ref-9  ",
				note: "  paid half  ",
			}),
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			ok: true,
			duplicate: false,
		});
		expect(submitMock).toHaveBeenCalledWith(
			"tok_1",
			{ amount: 5000, reference: "bank-ref-9", note: "paid half" },
			{ clientIp: "203.0.113.8" },
		);
	});

	it("maps each repository reason to its status", async () => {
		const cases: Array<[string, number]> = [
			["rate_limited", 429],
			["not_found", 404],
			["not_payable", 409],
			["amount_invalid", 422],
		];
		for (const [reason, status] of cases) {
			submitMock.mockResolvedValue({ ok: false, reason });
			const response = await handle({
				request: request({ token: "t", amount: 100 }),
			});
			expect(response.status).toBe(status);
			await expect(response.json()).resolves.toMatchObject({ ok: false });
		}
	});

	it("sets Retry-After on a rate-limit response", async () => {
		submitMock.mockResolvedValue({ ok: false, reason: "rate_limited" });
		const response = await handle({
			request: request({ token: "t", amount: 100 }),
		});
		expect(response.headers.get("retry-after")).toBe("600");
	});

	it("never leaks an internal error: a thrown failure becomes a generic 500", async () => {
		submitMock.mockRejectedValue(new Error("relation payment_claims missing"));
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		const response = await handle({
			request: request({ token: "t", amount: 100 }),
		});

		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toEqual({
			error: "Something went wrong.",
		});
		expect(error).toHaveBeenCalled();
	});
});
