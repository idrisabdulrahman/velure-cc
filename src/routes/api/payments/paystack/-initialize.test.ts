import { afterEach, describe, expect, it, vi } from "vitest";
import { ensurePaystackTransferCharge } from "#/server/data/paystack-server";
import {
	consumeFixedWindowRateLimit,
	getClientIp,
} from "#/server/http-security";
import { getSupabaseAdminClient } from "#/server/supabase";
import { handle, handlers } from "./initialize";

vi.mock("#/server/data/paystack-server", () => ({
	ensurePaystackTransferCharge: vi.fn(),
}));
vi.mock("#/server/http-security", () => ({
	consumeFixedWindowRateLimit: vi.fn(),
	getClientIp: vi.fn(),
	safeErrorDetails: (error: unknown) => ({
		name: error instanceof Error ? error.name : "UnknownError",
	}),
}));
vi.mock("#/server/supabase", () => ({
	getSupabaseAdminClient: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

function request(token = "invoice-token") {
	return new Request(
		"https://velure.example/api/payments/paystack/initialize",
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ token }),
		},
	);
}

describe("Paystack initialization route", () => {
	it("registers POST only", () => {
		expect(handlers).toHaveProperty("POST");
		expect(handlers).not.toHaveProperty("GET");
	});

	it("returns 429 before charge creation when the token limit is exhausted", async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue({} as never);
		vi.mocked(consumeFixedWindowRateLimit).mockResolvedValue(false);

		const response = await handle({ request: request() });

		expect(response.status).toBe(429);
		expect(response.headers.get("retry-after")).toBe("600");
		expect(ensurePaystackTransferCharge).not.toHaveBeenCalled();
	});

	it("applies token and client-IP limits before creating a charge", async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue({} as never);
		vi.mocked(getClientIp).mockReturnValue("203.0.113.8");
		vi.mocked(consumeFixedWindowRateLimit).mockResolvedValue(true);
		vi.mocked(ensurePaystackTransferCharge).mockResolvedValue({
			reference: "ref",
			status: "pending",
			amount: 100,
			currency: "NGN",
			expiresAt: Date.now() + 60_000,
		});

		const response = await handle({ request: request() });

		expect(response.status).toBe(200);
		expect(consumeFixedWindowRateLimit).toHaveBeenNthCalledWith(
			1,
			expect.anything(),
			"payment-token",
			"invoice-token",
			5,
			600,
		);
		expect(consumeFixedWindowRateLimit).toHaveBeenNthCalledWith(
			2,
			expect.anything(),
			"payment-ip",
			"203.0.113.8",
			30,
			600,
		);
		expect(ensurePaystackTransferCharge).toHaveBeenCalledWith("invoice-token");
	});

	it("fails closed when limiter persistence is unavailable", async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue({} as never);
		vi.mocked(consumeFixedWindowRateLimit).mockRejectedValue(
			new Error("database unavailable"),
		);

		const response = await handle({ request: request() });

		expect(response.status).toBe(503);
		expect(ensurePaystackTransferCharge).not.toHaveBeenCalled();
		await expect(response.json()).resolves.toEqual({
			ok: false,
			error: "Payment initialization is temporarily unavailable.",
		});
	});

	it("does not expose provider or server errors", async () => {
		vi.mocked(getSupabaseAdminClient).mockReturnValue({} as never);
		vi.mocked(consumeFixedWindowRateLimit).mockResolvedValue(true);
		vi.mocked(getClientIp).mockReturnValue(null);
		vi.mocked(ensurePaystackTransferCharge).mockRejectedValue(
			new Error("PAYSTACK_SECRET_KEY is not configured."),
		);

		const response = await handle({ request: request() });

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			ok: false,
			error: "Could not prepare transfer account.",
		});
	});
});
