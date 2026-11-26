import { createHmac } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { handle } from "./webhook";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
const { notifySettled } = vi.hoisted(() => ({ notifySettled: vi.fn() }));
vi.mock("#/server/supabase", () => ({
	getSupabaseAdminClient: () => ({ rpc }),
}));
vi.mock("#/server/payment-notifications", () => ({
	notifySellerPaymentSettled: notifySettled,
}));
afterEach(() => {
	vi.unstubAllEnvs();
	rpc.mockReset();
	notifySettled.mockReset();
});

function deliveryOf(secret: string, event: unknown) {
	const body = JSON.stringify(event);
	const time = Math.floor(Date.now() / 1000);
	const signature = createHmac("sha256", secret)
		.update(`${time}.${body}`)
		.digest("hex");
	return new Request("https://staging.example.com/api/payments/bachs/webhook", {
		method: "POST",
		body,
		headers: { "X-Bachs-Signature-V2": `t=${time},v1=${signature}` },
	});
}

function delivery(secret: string) {
	return deliveryOf(secret, {
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
	});
}

const collectionSucceeded = {
	type: "collection.succeeded",
	organization_id: "acct_sellerA",
	data: {
		charge_id: "ch_invoiceA",
		checkout_id: "chk_invoiceA",
		status: "SUCCEEDED",
		amount: "10000.00",
		currency: "NGN",
	},
};

const checkoutExpired = {
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
};

it("rejects a forged payment before touching the ledger", async () => {
	vi.stubEnv("BACHS_WEBHOOK_SECRET", "sandbox-secret");
	expect((await handle({ request: delivery("wrong-secret") })).status).toBe(
		401,
	);
	expect(rpc).not.toHaveBeenCalled();
});

it("fails closed when sandbox and live secrets are configured at once", async () => {
	vi.stubEnv("BACHS_WEBHOOK_SECRET", "sandbox-secret");
	vi.stubEnv("BACHS_LIVE_WEBHOOK_SECRET", "live-secret");
	expect((await handle({ request: delivery("sandbox-secret") })).status).toBe(
		404,
	);
	expect(rpc).not.toHaveBeenCalled();
});

it("passes the verified seller and checkout to the atomic confirmation function", async () => {
	vi.stubEnv("BACHS_WEBHOOK_SECRET", "sandbox-secret");
	rpc.mockResolvedValue({ data: { ok: true, duplicate: true }, error: null });
	expect((await handle({ request: delivery("sandbox-secret") })).status).toBe(
		200,
	);
	expect(rpc).toHaveBeenCalledWith(
		"confirm_bachs_payment",
		expect.objectContaining({
			input_account: "acct_sellerA",
			input_reference: "chk_invoiceA",
			input_amount: 10000,
		}),
	);
});

it("returns a retryable status on a database failure", async () => {
	vi.stubEnv("BACHS_WEBHOOK_SECRET", "sandbox-secret");
	rpc.mockResolvedValue({ data: null, error: { message: "unavailable" } });
	expect((await handle({ request: delivery("sandbox-secret") })).status).toBe(
		503,
	);
});

it("notifies the seller once a payment settles for real", async () => {
	vi.stubEnv("BACHS_WEBHOOK_SECRET", "sandbox-secret");
	rpc.mockResolvedValue({
		data: { ok: true, duplicate: false, paid: true, reference: "chk_invoiceA" },
		error: null,
	});
	expect((await handle({ request: delivery("sandbox-secret") })).status).toBe(
		200,
	);
	expect(notifySettled).toHaveBeenCalledWith({
		reference: "chk_invoiceA",
		amount: 10000,
		currency: "NGN",
		paidInFull: true,
	});
});

it("does not notify on a replayed (duplicate) webhook", async () => {
	vi.stubEnv("BACHS_WEBHOOK_SECRET", "sandbox-secret");
	rpc.mockResolvedValue({ data: { ok: true, duplicate: true }, error: null });
	await handle({ request: delivery("sandbox-secret") });
	expect(notifySettled).not.toHaveBeenCalled();
});

it("settles the matching invoice from a signed collection.succeeded", async () => {
	vi.stubEnv("BACHS_WEBHOOK_SECRET", "sandbox-secret");
	rpc.mockResolvedValue({
		data: { ok: true, duplicate: false, paid: true },
		error: null,
	});
	const response = await handle({
		request: deliveryOf("sandbox-secret", collectionSucceeded),
	});
	expect(response.status).toBe(200);
	expect(rpc).toHaveBeenCalledWith(
		"confirm_bachs_payment",
		expect.objectContaining({
			input_account: "acct_sellerA",
			input_reference: "chk_invoiceA",
			input_amount: 10000,
			input_currency: "NGN",
			input_provider_payment_id: "ch_invoiceA",
			input_event_type: "collection.succeeded",
			input_provider_status: "SUCCEEDED",
		}),
	);
	expect(notifySettled).toHaveBeenCalledTimes(1);
});

it("records an expired checkout without settling or notifying", async () => {
	vi.stubEnv("BACHS_WEBHOOK_SECRET", "sandbox-secret");
	rpc.mockResolvedValue({ data: { ok: true }, error: null });
	const response = await handle({
		request: deliveryOf("sandbox-secret", checkoutExpired),
	});
	expect(response.status).toBe(200);
	expect(rpc).toHaveBeenCalledWith("record_bachs_payment_outcome", {
		input_reference: "chk_invoiceA",
		input_account: "acct_sellerA",
		input_event_type: "checkout.expired",
		input_provider_status: "expired",
		input_outcome: "expired",
		input_reason: undefined,
		input_provider_payment_id: undefined,
		input_raw_event: checkoutExpired,
	});
	expect(notifySettled).not.toHaveBeenCalled();
});

it("leaves the invoice untouched when a lifecycle write fails", async () => {
	vi.stubEnv("BACHS_WEBHOOK_SECRET", "sandbox-secret");
	rpc.mockResolvedValue({ data: null, error: { message: "unavailable" } });
	const response = await handle({
		request: deliveryOf("sandbox-secret", checkoutExpired),
	});
	expect(response.status).toBe(503);
	expect(notifySettled).not.toHaveBeenCalled();
});
