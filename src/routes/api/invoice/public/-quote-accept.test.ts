import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * WP-D buyer "Accept quote" endpoint.
 *
 * The repository is mocked at its seam (its token/rate-limit behavior is
 * proven in `public-invoice-repository.quote.test.ts`); what is pinned here is
 * the route contract: input validation, the token-only identity, the status
 * mapping and that no internal error ever reaches the client.
 */

const { submitMock, getClientIpMock } = vi.hoisted(() => ({
	submitMock: vi.fn(),
	getClientIpMock: vi.fn(() => "203.0.113.8"),
}));

vi.mock("#/server/public-invoice-repository", () => ({
	submitPublicQuoteAcceptance: submitMock,
}));
vi.mock("#/server/http-security", () => ({
	getClientIp: getClientIpMock,
}));

import { handle, handlers } from "./quote-accept";

afterEach(() => vi.clearAllMocks());

function request(body: unknown, raw = false) {
	return new Request("https://velure.example/api/invoice/public/quote-accept", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: raw ? (body as string) : JSON.stringify(body),
	});
}

describe("POST /api/invoice/public/quote-accept", () => {
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
		for (const token of [undefined, "", "   ", 42]) {
			const response = await handle({ request: request({ token }) });
			expect(response.status).toBe(400);
		}
		expect(submitMock).not.toHaveBeenCalled();
	});

	it("passes a trimmed token and the client IP to the repository", async () => {
		submitMock.mockResolvedValue({
			ok: true,
			invoiceId: "invoice-1",
			alreadyAccepted: false,
		});

		const response = await handle({ request: request({ token: "  tok_1  " }) });

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			ok: true,
			invoiceId: "invoice-1",
			alreadyAccepted: false,
		});
		expect(submitMock).toHaveBeenCalledWith("tok_1", {
			clientIp: "203.0.113.8",
		});
	});

	it("maps each repository reason to its status", async () => {
		const cases: Array<[string, number]> = [
			["rate_limited", 429],
			["not_found", 404],
			["not_quote", 409],
			["not_open", 409],
		];
		for (const [reason, status] of cases) {
			submitMock.mockResolvedValue({ ok: false, reason });
			const response = await handle({ request: request({ token: "t" }) });
			expect(response.status).toBe(status);
			await expect(response.json()).resolves.toMatchObject({ ok: false });
		}
	});

	it("sets Retry-After on a rate-limit response", async () => {
		submitMock.mockResolvedValue({ ok: false, reason: "rate_limited" });
		const response = await handle({ request: request({ token: "t" }) });
		expect(response.headers.get("retry-after")).toBe("600");
	});

	it("never leaks an internal error: a thrown failure becomes a generic 500", async () => {
		submitMock.mockRejectedValue(new Error("relation invoices missing"));
		const error = vi.spyOn(console, "error").mockImplementation(() => {});

		const response = await handle({ request: request({ token: "t" }) });

		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toEqual({
			error: "Something went wrong.",
		});
		expect(error).toHaveBeenCalled();
	});
});
