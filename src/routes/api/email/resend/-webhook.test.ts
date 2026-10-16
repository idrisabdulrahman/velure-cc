import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_WEBHOOK_BODY_BYTES } from "#/server/http-security";
import { getSupabaseAdminClient } from "#/server/supabase";
import { handle } from "./webhook";

vi.mock("#/server/supabase", () => ({
	getSupabaseAdminClient: vi.fn(),
}));
vi.mock("resend", () => ({
	Resend: class {
		webhooks = {
			verify: ({
				payload,
				headers,
				webhookSecret,
			}: {
				payload: string;
				headers: { signature: string };
				webhookSecret: string;
			}) => {
				if (
					webhookSecret !== "resend-secret" ||
					headers.signature !== "valid-signature"
				)
					throw new Error("invalid signature");
				return JSON.parse(payload);
			},
		};
	},
}));

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllEnvs();
});

function request(body: unknown, signature = "valid-signature") {
	return new Request("http://localhost/api/email/resend/webhook", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"svix-id": "msg-1",
			"svix-timestamp": "1700000000",
			"svix-signature": signature,
		},
		body: JSON.stringify(body),
	});
}

function adminClient(options?: { delivery?: unknown; existing?: unknown }) {
	const delivery = options?.delivery ?? null;
	const existing = options?.existing ?? null;
	return {
		from: vi.fn((table: string) => {
			if (table === "invoice_delivery_events") {
				const chain = {
					select: vi.fn(() => chain),
					eq: vi.fn(() => chain),
					maybeSingle: vi.fn(async () => ({ data: delivery, error: null })),
				};
				return chain;
			}
			const chain = {
				select: vi.fn(() => chain),
				eq: vi.fn(() => chain),
				maybeSingle: vi.fn(async () => ({ data: existing, error: null })),
				insert: vi.fn(() => chain),
				single: vi.fn(async () => ({
					data: { id: "event-1", invoice_id: "invoice-1" },
					error: null,
				})),
			};
			return chain;
		}),
	};
}

describe("Resend webhook route", () => {
	it("fails closed when the webhook secret is missing", async () => {
		vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
		const response = await handle({ request: request({}) });
		expect(response.status).toBe(500);
	});

	it("rejects an invalid webhook secret", async () => {
		vi.stubEnv("RESEND_WEBHOOK_SECRET", "resend-secret");
		const response = await handle({ request: request({}, "wrong") });
		expect(response.status).toBe(401);
	});

	it("rejects an oversized body before provider verification", async () => {
		vi.stubEnv("RESEND_WEBHOOK_SECRET", "resend-secret");
		const response = await handle({
			request: new Request("http://localhost/api/email/resend/webhook", {
				method: "POST",
				body: "x".repeat(MAX_WEBHOOK_BODY_BYTES + 1),
			}),
		});
		expect(response.status).toBe(413);
		expect(getSupabaseAdminClient).not.toHaveBeenCalled();
	});

	it("ignores an unknown provider message without inserting an event", async () => {
		vi.stubEnv("RESEND_WEBHOOK_SECRET", "resend-secret");
		const client = adminClient();
		vi.mocked(getSupabaseAdminClient).mockReturnValue(client as never);
		const response = await handle({
			request: request({
				id: "provider-event-1",
				type: "email.delivered",
				data: { email_id: "unknown-message" },
			}),
		});
		await expect(response.json()).resolves.toEqual({ ok: true, ignored: true });
		expect(client.from).toHaveBeenCalledTimes(1);
	});

	it("stores a verified provider event", async () => {
		vi.stubEnv("RESEND_WEBHOOK_SECRET", "resend-secret");
		const client = adminClient({
			delivery: {
				id: "delivery-1",
				workspace_id: "workspace-1",
				owner_id: "owner-1",
				invoice_id: "invoice-1",
				recipient: "buyer@example.com",
			},
		});
		vi.mocked(getSupabaseAdminClient).mockReturnValue(client as never);
		const response = await handle({
			request: request({
				id: "provider-event-1",
				type: "email.delivered",
				data: { email_id: "message-1" },
			}),
		});
		await expect(response.json()).resolves.toEqual({
			ok: true,
			eventId: "event-1",
			invoiceId: "invoice-1",
		});
	});
});
