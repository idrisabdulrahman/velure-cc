import { describe, expect, it, vi } from "vitest";
import {
	consumeFixedWindowRateLimit,
	getClientIp,
	MAX_WEBHOOK_BODY_BYTES,
	RequestBodyTooLargeError,
	readRequestText,
	safeErrorDetails,
} from "./http-security";

describe("HTTP security boundaries", () => {
	it("hashes rate-limit identifiers before calling the database", async () => {
		const rpc = vi.fn(
			async (_name: string, _args: Record<string, unknown>) => ({
				data: true,
				error: null,
			}),
		);
		const allowed = await consumeFixedWindowRateLimit(
			{ rpc } as never,
			"payment-token",
			"secret-invoice-token",
			5,
			600,
			Date.parse("2026-08-27T10:04:00Z"),
		);

		expect(allowed).toBe(true);
		expect(rpc).toHaveBeenCalledWith("consume_public_rate_limit", {
			input_key_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
			input_limit: 5,
			input_window_start: "2026-08-27T10:00:00.000Z",
		});
		expect(JSON.stringify(rpc.mock.calls[0]?.[1])).not.toContain(
			"secret-invoice-token",
		);
	});

	it("extracts the first forwarded client address", () => {
		const request = new Request("https://velure.example", {
			headers: { "x-forwarded-for": "203.0.113.8, 10.0.0.1" },
		});
		expect(getClientIp(request)).toBe("203.0.113.8");
	});

	it("rejects streamed bodies over the webhook ceiling", async () => {
		const request = new Request("https://velure.example/webhook", {
			method: "POST",
			body: "x".repeat(MAX_WEBHOOK_BODY_BYTES + 1),
		});

		await expect(readRequestText(request)).rejects.toBeInstanceOf(
			RequestBodyTooLargeError,
		);
	});

	it("does not copy exception messages into log metadata", () => {
		expect(safeErrorDetails(new Error("secret-public-token"))).toEqual({
			name: "Error",
		});
	});
});
