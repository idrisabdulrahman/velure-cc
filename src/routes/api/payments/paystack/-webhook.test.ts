import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	confirmPaystackWebhookPayment,
	logPaymentAnomaly,
} from "#/server/data/paystack-server";
import { MAX_WEBHOOK_BODY_BYTES } from "#/server/http-security";
import { handle, verifyPaystackSignature } from "./webhook";

vi.mock("#/server/data/paystack-server", () => ({
	confirmPaystackWebhookPayment: vi.fn(),
	logPaymentAnomaly: vi.fn(),
}));

const originalSecret = process.env.PAYSTACK_SECRET_KEY;

function signature(secret: string, body: string) {
	return createHmac("sha512", secret).update(body).digest("hex");
}

function post(body: string, secret = "sk_test_route_secret", sig?: string) {
	return handle({
		request: new Request("http://localhost/api/payments/paystack/webhook", {
			method: "POST",
			headers: {
				"x-paystack-signature": sig ?? signature(secret, body),
			},
			body,
		}),
	});
}

function chargeSuccessBody(overrides: Record<string, unknown> = {}) {
	return JSON.stringify({
		event: "charge.success",
		data: {
			id: 12345,
			status: "success",
			reference: "velure-ref",
			amount: 150_000,
			currency: "NGN",
			customer: { email: "payer@example.com" },
			metadata: { invoiceId: "inv-1" },
			...overrides,
		},
	});
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

describe("verifyPaystackSignature", () => {
	it("accepts a valid signature and rejects a wrong key or missing header", () => {
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
	});

	it("does not throw on a different-length or non-hex header (timing-safe needs equal lengths)", () => {
		const secret = "sk_test_route_secret";
		const body = "{}";
		expect(verifyPaystackSignature(secret, body, "not-hex")).toBe(false);
		expect(verifyPaystackSignature(secret, body, "abc")).toBe(false);
	});

	it("rejects a body with a single changed byte", () => {
		const secret = "sk_test_route_secret";
		const body = JSON.stringify({
			event: "charge.success",
			data: { reference: "velure-ref", amount: 100 },
		});
		const tampered = body.replace("100", "999");
		expect(
			verifyPaystackSignature(secret, body, signature(secret, tampered)),
		).toBe(false);
	});
});

describe("Paystack webhook route", () => {
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
		const response = await post("{", "sk_test_route_secret", "deadbeef");

		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toMatchObject({
			ok: false,
			error: "Unauthorized request.",
		});
		expect(confirmPaystackWebhookPayment).not.toHaveBeenCalled();
	});

	it("rejects a missing signature header", async () => {
		vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_route_secret");
		const response = await handle({
			request: new Request("http://localhost/api/payments/paystack/webhook", {
				method: "POST",
				body: chargeSuccessBody(),
			}),
		});
		expect(response.status).toBe(401);
		expect(confirmPaystackWebhookPayment).not.toHaveBeenCalled();
	});

	it("rejects a body tampered after signing (amount changed)", async () => {
		vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_route_secret");
		const signed = chargeSuccessBody();
		const tampered = chargeSuccessBody({ amount: 1 });
		const response = await post(
			tampered,
			"sk_test_route_secret",
			signature("sk_test_route_secret", signed),
		);
		expect(response.status).toBe(401);
		expect(confirmPaystackWebhookPayment).not.toHaveBeenCalled();
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
		const response = await post("{");
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
		const response = await post(body);
		expect(response.status).toBe(400);
		expect(confirmPaystackWebhookPayment).not.toHaveBeenCalled();
	});

	it("rejects a payload with a non-integer (or negative) amount", async () => {
		vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_route_secret");
		expect((await post(chargeSuccessBody({ amount: 150.5 }))).status).toBe(400);
		expect((await post(chargeSuccessBody({ amount: -100 }))).status).toBe(400);
		expect(confirmPaystackWebhookPayment).not.toHaveBeenCalled();
	});

	it("rejects a payload with no currency rather than assuming NGN", async () => {
		vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_route_secret");
		const response = await post(chargeSuccessBody({ currency: undefined }));
		expect(response.status).toBe(400);
		expect(confirmPaystackWebhookPayment).not.toHaveBeenCalled();
	});

	it("passes integer kobo and the full parsed body to the confirmation path", async () => {
		vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_route_secret");
		const confirm = vi.mocked(confirmPaystackWebhookPayment);
		confirm.mockResolvedValueOnce({
			ok: true,
			duplicate: false,
			reference: "velure-ref",
			paid: true,
		});

		const body = chargeSuccessBody();
		const response = await post(body);

		expect(response.status).toBe(200);
		expect(confirm).toHaveBeenCalledTimes(1);
		const arg = confirm.mock.calls[0]?.[0];
		expect(arg).toMatchObject({
			reference: "velure-ref",
			amountKobo: 150_000,
			currency: "NGN",
			eventType: "charge.success",
			providerStatus: "success",
			providerPaymentId: "12345",
			customerEmail: "payer@example.com",
		});
		expect(arg?.rawEvent).toEqual(JSON.parse(body));
	});

	it("does not truncate a large payload before storing the raw event", async () => {
		vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_route_secret");
		const confirm = vi.mocked(confirmPaystackWebhookPayment);
		confirm.mockResolvedValueOnce({
			ok: true,
			duplicate: false,
			reference: "big-ref",
			paid: true,
		});
		// Metadata padding pushes the body well past the old 8000-char slice.
		const body = chargeSuccessBody({
			reference: "big-ref",
			metadata: { invoiceId: "inv-1", padding: "x".repeat(20_000) },
		});
		expect(body.length).toBeGreaterThan(8000);

		const response = await post(body);
		expect(response.status).toBe(200);
		const arg = confirm.mock.calls[0]?.[0];
		expect(arg?.rawEvent).toEqual(JSON.parse(body));
	});

	it("acknowledges a business rejection with 200 and credits nothing", async () => {
		vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_route_secret");
		for (const reason of [
			"unknown_reference",
			"amount_currency_mismatch",
			"invoice_canceled",
			"exceeds_balance",
		]) {
			vi.mocked(confirmPaystackWebhookPayment).mockResolvedValueOnce({
				ok: false,
				duplicate: false,
				reference: "velure-ref",
				reason,
			});
			const response = await post(chargeSuccessBody());
			expect(response.status).toBe(200);
			await expect(response.json()).resolves.toMatchObject({
				ok: true,
				processed: false,
				reason,
			});
			// F11: exactly one structured anomaly event per rejection.
			expect(logPaymentAnomaly).toHaveBeenCalledWith({
				type: "business_rejection",
				reference: "velure-ref",
				reason,
			});
		}
	});

	it("returns 500 so Paystack retries when confirmation throws", async () => {
		vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_route_secret");
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.mocked(confirmPaystackWebhookPayment).mockRejectedValueOnce(
			new Error("database unavailable"),
		);
		await expect(post(chargeSuccessBody())).rejects.toThrow(
			"database unavailable",
		);
		expect(error).toHaveBeenCalled();
		error.mockRestore();
	});

	it("ignores a non-success status with 200 and no confirmation", async () => {
		vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_route_secret");
		const response = await post(chargeSuccessBody({ status: "failed" }));
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			ok: true,
			ignored: true,
		});
		expect(confirmPaystackWebhookPayment).not.toHaveBeenCalled();
	});

	it("ignores an unhandled event type with 200 and no confirmation", async () => {
		vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_route_secret");
		const body = JSON.stringify({
			event: "transfer.success",
			data: {
				status: "success",
				reference: "velure-ref",
				amount: 100,
				currency: "NGN",
			},
		});
		const response = await post(body);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			ok: true,
			ignored: true,
		});
		expect(confirmPaystackWebhookPayment).not.toHaveBeenCalled();
	});

	it("passes a webhook replay through the same reference for idempotent handling", async () => {
		vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_route_secret");
		const body = chargeSuccessBody({ reference: "velure-replay-ref" });
		const confirm = vi.mocked(confirmPaystackWebhookPayment);
		confirm
			.mockResolvedValueOnce({
				ok: true,
				duplicate: false,
				reference: "velure-replay-ref",
				paid: true,
			})
			.mockResolvedValueOnce({
				ok: true,
				duplicate: true,
				reference: "velure-replay-ref",
			});

		await expect((await post(body)).json()).resolves.toMatchObject({
			ok: true,
			duplicate: false,
		});
		await expect((await post(body)).json()).resolves.toMatchObject({
			ok: true,
			duplicate: true,
		});
		expect(confirm).toHaveBeenCalledTimes(2);
		expect(confirm.mock.calls[0]?.[0]).toEqual(confirm.mock.calls[1]?.[0]);
	});
});

describe("Paystack boundary regressions", () => {
	it("rejects a valid hex digest followed by garbage", () => {
		const body = "{}";
		const secret = "sk_test_route_secret";
		expect(
			verifyPaystackSignature(secret, body, `${signature(secret, body)}zz`),
		).toBe(false);
	});
	it.each(["null", "[]", "42", '"text"'])(
		"handles signed non-object JSON %s without throwing",
		async (body) => {
			vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_route_secret");
			expect((await post(body)).status).toBe(400);
			expect(confirmPaystackWebhookPayment).not.toHaveBeenCalled();
		},
	);
	it("acknowledges an unrelated event without charge-specific fields", async () => {
		vi.stubEnv("PAYSTACK_SECRET_KEY", "sk_test_route_secret");
		const response = await post(
			JSON.stringify({
				event: "customeridentification.failed",
				data: { customer_id: 123 },
			}),
		);
		expect(response.status).toBe(200);
		expect(confirmPaystackWebhookPayment).not.toHaveBeenCalled();
	});
});
