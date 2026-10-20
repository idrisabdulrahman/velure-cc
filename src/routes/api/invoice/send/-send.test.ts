import { describe, expect, it, vi } from "vitest";

const { resendSendSpy } = vi.hoisted(() => ({
	resendSendSpy: vi.fn(
		async (_payload: unknown, _options?: unknown) =>
			({ data: { id: "email-1" }, error: null }) as const,
	),
}));

vi.mock("#/server/invoice-repository", () => ({
	getInvoiceUserContext: vi.fn(async () => ({ client: {}, userId: "user-1" })),
	getAuthenticatedInvoiceById: vi.fn(async () => ({
		id: "inv-1",
		token: "share-token",
		invoiceNumber: "INV-2026-0001",
		customerName: "Acme Ltd",
		documentType: "standard",
		updatedAt: 1_700_000_000_000,
		// Ordinary issued invoice: line items keep the send-route B2 gate
		// derivation cheap, deliveredAt keeps it out of Draft (the gate only
		// rejects customer-less drafts — see -send-gate.test.ts).
		lineItems: [{ id: "li-1", name: "Service", quantity: 1, price: 100 }],
		deliveredAt: 1_700_000_000_000,
	})),
	// The delivery event + invoice send audit row fail after the email
	// already committed (G1 non-atomicity, finding 4).
	recordInvoiceDeliveryEvent: vi.fn(async () => {
		throw new Error("audit insert refused");
	}),
}));
vi.mock("#/server/data/paystack-server", () => ({
	ensurePaystackTransferCharge: vi.fn(async () => undefined),
}));
vi.mock("#/server/env", () => ({
	getServerEnv: (key: string) =>
		key === "RESEND_API_KEY" ? "re_test_key" : `${key}@velure.test`,
}));
vi.mock("#/server/pdf", () => ({
	renderInvoicePdf: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));
vi.mock("resend", () => ({
	Resend: class {
		emails = { send: resendSendSpy };
	},
}));

import { getInvoiceUserContext } from "#/server/invoice-repository";
import { handle, providerErrorMessage } from "./$id";

describe("invoice email errors", () => {
	it("does not expose provider response details", () => {
		expect(
			providerErrorMessage(
				new Error("API key invalid for account buyer@example.com"),
			),
		).toBe("Email could not be sent. Retry or use the share/download options.");
	});
});

describe("POST /api/invoice/send/$id (G1 audit non-atomicity)", () => {
	function sendRequest() {
		return new Request("http://velure.test/api/invoice/send/inv-1", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ to: "client@example.com" }),
		});
	}

	it("still answers 200 when the audit write fails after the send committed", async () => {
		const response = await handle({
			params: { id: "inv-1" },
			request: sendRequest(),
		});

		// A 500 here would make the UI retry and re-send an email that was
		// already delivered; the route reports success and logs the gap.
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, id: "email-1" });
		expect(getInvoiceUserContext).toHaveBeenCalledTimes(1);
	});

	it("retries reuse the same provider idempotency key, so no second delivery", async () => {
		resendSendSpy.mockClear();

		await handle({ params: { id: "inv-1" }, request: sendRequest() });
		await handle({ params: { id: "inv-1" }, request: sendRequest() });

		const keys = resendSendSpy.mock.calls.map(
			([, options]) =>
				(options as { idempotencyKey?: string } | undefined)?.idempotencyKey,
		);
		expect(keys).toHaveLength(2);
		expect(keys[0]).toMatch(/^invoice-email-[0-9a-f]{64}$/);
		expect(keys[1]).toBe(keys[0]);
	});
});
