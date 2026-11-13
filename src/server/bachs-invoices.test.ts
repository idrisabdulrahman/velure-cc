import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseBachsPayment, verifyBachsWebhook } from "./bachs-invoices";

const event = {
	type: "checkout.completed",
	account: "acct_sellerA",
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
			verifyBachsWebhook(body + " ", header, "test-secret", time * 1000),
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
		expect(parseBachsPayment({ ...event, account: undefined })).toBeNull();
		expect(
			parseBachsPayment({
				...event,
				data: { ...event.data, payment_status: "unpaid" },
			}),
		).toBeNull();
		for (const charge of [
			{ ...event.data.charge, currency: "USD" },
			{ ...event.data.charge, amount: "1e4" },
		]) {
			expect(
				parseBachsPayment({ ...event, data: { ...event.data, charge } }),
			).toBeNull();
		}
	});
});
