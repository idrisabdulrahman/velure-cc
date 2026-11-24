import { createHmac } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { handle } from "./webhook";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("#/server/supabase", () => ({
	getSupabaseAdminClient: () => ({ rpc }),
}));
afterEach(() => {
	vi.unstubAllEnvs();
	rpc.mockReset();
});

function delivery(secret: string) {
	const body = JSON.stringify({
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
