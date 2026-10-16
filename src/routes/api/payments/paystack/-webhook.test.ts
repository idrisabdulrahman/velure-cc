import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmPaystackWebhookPayment } from "#/server/data/payments";
import { MAX_WEBHOOK_BODY_BYTES } from "#/server/http-security";
import { handle, verifyPaystackSignature } from "./webhook";

vi.mock("#/server/data/payments", () => ({
	confirmPaystackWebhookPayment: vi.fn(),
}));

const originalSecret = process.env.PAYSTACK_SECRET_KEY;

function signature(secret: string, body: string) {
	return createHmac("sha512", secret).update(body).digest("hex");
}

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllEnvs();
	if (originalSecret === undefined) {
		delete process.env.PAYSTACK_SECRET_KEY;
	} else {
		process.env.PAYSTACK_SECRET_KEY = originalSecret;
	}
});

describe("Paystack webhook route", () => {
	it("verifies signatures with timing-safe hex comparison", () => {
		const secret = "sk_test_route_secret";
		const body = JSON.stringify({
			event: "charge.success",
			data: { reference: "velure-ref" },
		});

		expect(verifyPaystackSignature(secret, body, signature(secret, body))).toBe(
			true,
		);
		expect(
			verifyPaystackSignature(secret, body, signature("wrong", body)),
		).toBe(false);
		expect(verifyPaystackSignature(secret, body, null)).toBe(false);
		expect(verifyPaystackSignature(secret, body, "not-hex")).toBe(false);
	});

	it("fails closed when the Paystack secret is not configured", async () => {
		vi.stubEnv("PAYSTACK_SECRET_KEY", "");

		const response = await handle({
			request: new Request("http://localhost/api/payments/paystack/webhook", {
				method: "POST",
				body: "{}",
			}),
		});

		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toMatchObject({
			ok: false,
			error: "Server configuration error.",
		});
	});

	it("rejects a bad signature before parsing webhook business meaning", async () => {
		vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_route_secret");
		const invalidJsonBody = "{";

		const response = await handle({
			request: new Request("http://localhost/api/payments/paystack/webhook", {
				method: "POST",
				headers: {
					"x-paystack-signature": signature("wrong", invalidJsonBody),
				},
				body: invalidJsonBody,
			}),
		});

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toMatchObject({
			ok: false,
			error: "Unauthorized request.",
		});
	});

	it("rejects an oversized body before signature verification", async () => {
		vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_route_secret");
		const response = await handle({
			request: new Request("http://localhost/api/payments/paystack/webhook", {
				method: "POST",
				body: "x".repeat(MAX_WEBHOOK_BODY_BYTES + 1),
			}),
		});
		expect(response.status).toBe(413);
		expect(confirmPaystackWebhookPayment).not.toHaveBeenCalled();
	});

	it("rejects malformed JSON only after a valid signature", async () => {
		vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_route_secret");
		const invalidJsonBody = "{";

		const response = await handle({
			request: new Request("http://localhost/api/payments/paystack/webhook", {
				method: "POST",
				headers: {
					"x-paystack-signature": signature(
						"sk_test_route_secret",
						invalidJsonBody,
					),
				},
				body: invalidJsonBody,
			}),
		});

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			ok: false,
			error: "Invalid request payload.",
		});
	});

	it("rejects signed but incomplete Paystack payloads", async () => {
		vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_route_secret");
		const body = JSON.stringify({
			event: "charge.success",
			data: { status: "success", reference: "velure-ref" },
		});

		const response = await handle({
			request: new Request("http://localhost/api/payments/paystack/webhook", {
				method: "POST",
				headers: {
					"x-paystack-signature": signature("sk_test_route_secret", body),
				},
				body,
			}),
		});

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toMatchObject({
			ok: false,
			error: "Incomplete request payload.",
		});
	});

	it("passes a webhook replay through the same reference for idempotent handling", async () => {
		vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_route_secret");
		const body = JSON.stringify({
			event: "charge.success",
			data: {
				reference: "velure-replay-ref",
				status: "success",
				amount: 100000,
				currency: "NGN",
			},
		});
		const confirm = vi.mocked(confirmPaystackWebhookPayment);
		confirm
			.mockResolvedValueOnce({ ok: true, duplicate: false })
			.mockResolvedValueOnce({ ok: true, duplicate: true });

		const request = () =>
			handle({
				request: new Request("http://localhost/api/payments/paystack/webhook", {
					method: "POST",
					headers: {
						"x-paystack-signature": signature("sk_test_route_secret", body),
					},
					body,
				}),
			});

		await expect((await request()).json()).resolves.toMatchObject({
			ok: true,
			duplicate: false,
		});
		await expect((await request()).json()).resolves.toMatchObject({
			ok: true,
			duplicate: true,
		});
		expect(confirm).toHaveBeenCalledTimes(2);
		expect(confirm.mock.calls[0]?.[0]).toEqual(confirm.mock.calls[1]?.[0]);
	});
});
