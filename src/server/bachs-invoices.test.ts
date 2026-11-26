import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	bachsConfig,
	parseBachsEvent,
	parseBachsPayment,
	validateBachsCheckoutResponse,
	verifyBachsWebhook,
} from "./bachs-invoices";

const event = {
	type: "checkout.completed",
	organization_id: "acct_sellerA",
	data: {
		checkout_id: "chk_invoiceA",
		status: "completed",
		mode: "payment",
		payment_status: "paid",
		charge: {
			id: "ch_invoiceA",
			amount: "10000.00",
			currency: "NGN",
			status: "succeeded",
		},
	},
};

describe("Bachs invoice confirmation", () => {
	it("authenticates the raw delivery, including during signing-key rotation", () => {
		const body = JSON.stringify(event);
		const time = 1_800_000_000;
		const signature = createHmac("sha256", "test-secret")
			.update(`${time}.${body}`)
			.digest("hex");
		const header = `t=${time},v1=${"0".repeat(64)},v1=${signature}`;
		expect(verifyBachsWebhook(body, header, "test-secret", time * 1000)).toBe(
			true,
		);
		expect(
			verifyBachsWebhook(`${body} `, header, "test-secret", time * 1000),
		).toBe(false);
		expect(
			verifyBachsWebhook(body, header, "test-secret", (time + 301) * 1000),
		).toBe(false);
	});

	it("extracts the exact seller, checkout and gross amount from a paid event", () => {
		expect(parseBachsPayment(event)).toMatchObject({
			input_account: "acct_sellerA",
			input_reference: "chk_invoiceA",
			input_amount: 10000,
			input_provider_payment_id: "ch_invoiceA",
			input_currency: "NGN",
		});
	});

	it("rejects unpaid, foreign-currency, malformed and platform-only events", () => {
		expect(
			parseBachsPayment({ ...event, organization_id: undefined }),
		).toBeNull();
		expect(
			parseBachsPayment({
				...event,
				data: { ...event.data, payment_status: "unpaid" },
			}),
		).toBeNull();
		for (const charge of [
			{ ...event.data.charge, currency: "USD" },
			{ ...event.data.charge, amount: "1e4" },
			{ ...event.data.charge, amount: "0.00" },
			{ ...event.data.charge, id: "pay_invoiceA" },
		]) {
			expect(
				parseBachsPayment({ ...event, data: { ...event.data, charge } }),
			).toBeNull();
		}
		expect(parseBachsPayment({ ...event, organization_id: 12345 })).toBeNull();
		expect(
			parseBachsPayment({
				...event,
				data: { ...event.data, checkout_id: "cs_invoiceA" },
			}),
		).toBeNull();
	});

	it("still accepts a legacy envelope that names the account as `account`", () => {
		const legacy = {
			...event,
			organization_id: undefined,
			account: "acct_sellerA",
		};
		expect(parseBachsPayment(legacy)).toMatchObject({
			input_account: "acct_sellerA",
			input_reference: "chk_invoiceA",
		});
	});
});

describe("Bachs collection lifecycle", () => {
	const succeeded = {
		id: "evt_succeeded",
		type: "collection.succeeded",
		organization_id: "acct_sellerA",
		data: {
			charge_id: "ch_invoiceA",
			checkout_id: "chk_invoiceA",
			reference: "ORD-1",
			status: "SUCCEEDED",
			amount: "10000.00",
			currency: "NGN",
			customer: { id: "cust_1", email: "buyer@example.com" },
		},
	};

	it("settles a SUCCEEDED collection from the documented fulfilment event", () => {
		expect(parseBachsEvent(succeeded)).toEqual({
			kind: "settle",
			input_reference: "chk_invoiceA",
			input_account: "acct_sellerA",
			input_provider_payment_id: "ch_invoiceA",
			input_amount: 10000,
			input_currency: "NGN",
			input_event_type: "collection.succeeded",
			input_provider_status: "SUCCEEDED",
		});
	});

	it("settles a legacy collection that has no charge id", () => {
		expect(
			parseBachsEvent({
				...succeeded,
				data: { ...succeeded.data, charge_id: null },
			}),
		).toMatchObject({
			kind: "settle",
			input_reference: "chk_invoiceA",
			input_provider_payment_id: null,
			input_amount: 10000,
		});
	});

	it("never auto-settles ACCEPTED or OVERPAID collections", () => {
		for (const status of ["ACCEPTED", "OVERPAID"]) {
			expect(
				parseBachsEvent({
					...succeeded,
					data: { ...succeeded.data, status },
				}),
			).toMatchObject({
				kind: "lifecycle",
				input_outcome: "manual_review",
				input_reference: "chk_invoiceA",
				input_provider_status: status,
			});
		}
	});

	it("prefers the connected account over the organization on forwarded events", () => {
		expect(
			parseBachsEvent({
				...succeeded,
				organization_id: "acct_platform",
				account: "acct_sellerA",
			}),
		).toMatchObject({ input_account: "acct_sellerA" });
	});

	it("records a failed collection as retryable, not final", () => {
		expect(
			parseBachsEvent({
				type: "collection.failed",
				organization_id: "acct_sellerA",
				data: {
					charge_id: "ch_invoiceA",
					checkout_id: "chk_invoiceA",
					status: "FAILED",
					amount: "10000.00",
					currency: "NGN",
					reason: "Payment authorization failed",
				},
			}),
		).toEqual({
			kind: "lifecycle",
			input_reference: "chk_invoiceA",
			input_account: "acct_sellerA",
			input_provider_payment_id: "ch_invoiceA",
			input_event_type: "collection.failed",
			input_provider_status: "FAILED",
			input_outcome: "failed",
			input_reason: "Payment authorization failed",
		});
	});

	it("marks an expired checkout without cancelling the invoice", () => {
		expect(
			parseBachsEvent({
				type: "checkout.expired",
				organization_id: "acct_sellerA",
				data: {
					checkout_id: "chk_invoiceA",
					status: "expired",
					mode: "payment",
					payment_status: null,
					amount: "10000.00",
					currency: "NGN",
					charge: null,
				},
			}),
		).toEqual({
			kind: "lifecycle",
			input_reference: "chk_invoiceA",
			input_account: "acct_sellerA",
			input_provider_payment_id: null,
			input_event_type: "checkout.expired",
			input_provider_status: "expired",
			input_outcome: "expired",
			input_reason: null,
		});
	});

	it("ignores unrelated, unmatched and malformed deliveries", () => {
		expect(parseBachsEvent(null)).toBeNull();
		expect(parseBachsEvent({ type: "invoice.paid" })).toBeNull();
		expect(
			parseBachsEvent({
				...succeeded,
				data: { ...succeeded.data, checkout_id: null },
			}),
		).toBeNull();
		expect(
			parseBachsEvent({
				...succeeded,
				data: { ...succeeded.data, status: "PENDING" },
			}),
		).toBeNull();
		// A malformed, non-string status must not throw.
		expect(
			parseBachsEvent({
				...succeeded,
				data: { ...succeeded.data, status: 42 as unknown as string },
			}),
		).toBeNull();
	});

	it("parks a non-NGN success for manual review instead of dropping it", () => {
		expect(
			parseBachsEvent({
				...succeeded,
				data: { ...succeeded.data, currency: "USD" },
			}),
		).toMatchObject({
			kind: "lifecycle",
			input_reference: "chk_invoiceA",
			input_account: "acct_sellerA",
			input_outcome: "manual_review",
			input_reason: "currency_usd",
			input_event_type: "collection.succeeded",
			input_provider_status: "SUCCEEDED",
		});
	});

	it("keeps the settlement-only projection free of lifecycle events", () => {
		expect(
			parseBachsPayment({
				...succeeded,
				data: { ...succeeded.data, status: "ACCEPTED" },
			}),
		).toBeNull();
	});
});

describe("Bachs checkout response validation", () => {
	const valid = {
		checkout_id: "chk_invoiceA",
		checkout_url: "https://sandbox-checkout.bachs.io/c/abc",
		expires_at: new Date(Date.now() + 600_000).toISOString(),
	};

	it("accepts a sandbox response that matches the configured environment", () => {
		expect(
			validateBachsCheckoutResponse(valid, "https://sandbox-checkout.bachs.io"),
		).toBe("https://sandbox-checkout.bachs.io/c/abc");
	});

	it("rejects a cross-environment, unprefixed, stale or malformed response", () => {
		const sandboxOrigin = "https://sandbox-checkout.bachs.io";
		expect(() =>
			validateBachsCheckoutResponse(
				{ ...valid, checkout_url: "https://checkout.bachs.io/c/abc" },
				sandboxOrigin,
			),
		).toThrow("Unexpected Bachs checkout response");
		expect(() =>
			validateBachsCheckoutResponse(
				{ ...valid, checkout_id: "cs_invoiceA" },
				sandboxOrigin,
			),
		).toThrow("Unexpected Bachs checkout response");
		expect(() =>
			validateBachsCheckoutResponse(
				{ ...valid, expires_at: new Date(Date.now() - 1).toISOString() },
				sandboxOrigin,
			),
		).toThrow("Unexpected Bachs checkout response");
		expect(() =>
			validateBachsCheckoutResponse(
				{ ...valid, expires_at: "not-a-date" },
				sandboxOrigin,
			),
		).toThrow("Unexpected Bachs checkout response");
		expect(() =>
			validateBachsCheckoutResponse(
				{ ...valid, checkout_url: "::not a url" },
				sandboxOrigin,
			),
		).toThrow("Unexpected Bachs checkout response");
		expect(() =>
			validateBachsCheckoutResponse(
				{ ...valid, checkout_url: undefined },
				sandboxOrigin,
			),
		).toThrow("Unexpected Bachs checkout response");
	});
});

describe("Bachs environment selection", () => {
	const sandboxEnv = {
		BACHS_API_KEY: "sk_sandbox_key",
		BACHS_WEBHOOK_SECRET: "sandbox-secret",
		BACHS_SANDBOX_WORKSPACE_ID: "workspace-a",
		BACHS_SANDBOX_ACCOUNT_ID: "acct_sellerA",
		BACHS_SANDBOX_PRODUCT_ID: "prod_a",
		BACHS_SANDBOX_RETURN_ORIGIN: "https://staging.example.com",
	};
	const liveEnv = {
		BACHS_LIVE_API_KEY: "sk_live_key",
		BACHS_LIVE_WEBHOOK_SECRET: "live-secret",
		BACHS_LIVE_WORKSPACE_ID: "workspace-a",
		BACHS_LIVE_ACCOUNT_ID: "acct_sellerA",
		BACHS_LIVE_PRODUCT_ID: "prod_a",
		BACHS_LIVE_RETURN_ORIGIN: "https://invoicly.cv",
	};

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("selects the sandbox environment against the sandbox API", () => {
		for (const [key, value] of Object.entries(sandboxEnv)) {
			vi.stubEnv(key, value);
		}
		expect(bachsConfig()).toMatchObject({
			api: "https://sandbox-api.bachs.io",
			key: "sk_sandbox_key",
			workspace: "workspace-a",
		});
	});

	it("selects the live environment against the production API", () => {
		for (const [key, value] of Object.entries(liveEnv)) {
			vi.stubEnv(key, value);
		}
		expect(bachsConfig()).toMatchObject({
			api: "https://api.bachs.io",
			key: "sk_live_key",
			workspace: "workspace-a",
		});
	});

	it("fails closed when both environments are configured at once", () => {
		for (const [key, value] of Object.entries({ ...sandboxEnv, ...liveEnv })) {
			vi.stubEnv(key, value);
		}
		expect(bachsConfig()).toBeNull();
	});

	it("fails closed on an incomplete or wrong-prefix live set", () => {
		vi.stubEnv("BACHS_LIVE_API_KEY", liveEnv.BACHS_LIVE_API_KEY);
		expect(bachsConfig()).toBeNull();
		vi.unstubAllEnvs();
		for (const [key, value] of Object.entries(liveEnv)) {
			vi.stubEnv(key, value);
		}
		vi.stubEnv("BACHS_LIVE_API_KEY", sandboxEnv.BACHS_API_KEY);
		expect(bachsConfig()).toBeNull();
	});
});
