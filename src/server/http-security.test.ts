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

	it("prefers the edge-set IP over the spoofable forwarded chain", () => {
		const edgeSet = new Request("https://invoicly.example", {
			headers: {
				"cf-connecting-ip": "198.51.100.4",
				"x-forwarded-for": "6.6.6.6, 10.0.0.1",
			},
		});
		expect(getClientIp(edgeSet)).toBe("198.51.100.4");
	});

	it("falls back to the last forwarded address, then x-real-ip", () => {
		const proxied = new Request("https://invoicly.example", {
			headers: { "x-forwarded-for": "203.0.113.8, 10.0.0.1" },
		});
		expect(getClientIp(proxied)).toBe("10.0.0.1");
		const direct = new Request("https://invoicly.example", {
			headers: { "x-real-ip": "203.0.113.9" },
		});
		expect(getClientIp(direct)).toBe("203.0.113.9");
	});

	it("rejects streamed bodies over the webhook ceiling", async () => {
		const request = new Request("https://invoicly.example/webhook", {
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
