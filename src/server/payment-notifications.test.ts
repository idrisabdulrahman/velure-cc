import { afterEach, describe, expect, it, vi } from "vitest";
import {
	notifySellerPaymentClaimed,
	notifySellerPaymentSettled,
} from "./payment-notifications";

const { send, query, from } = vi.hoisted(() => ({
	send: vi.fn(),
	query: vi.fn(),
	from: vi.fn(),
}));

vi.mock("resend", () => ({
	Resend: class {
		emails = { send };
	},
}));

vi.mock("./env", () => ({
	getServerEnv: (name: string) =>
		({
			RESEND_API_KEY: "key",
			RESEND_FROM_EMAIL: "Invoicly <billing@example.com>",
			SITE_URL: "https://invoicly.cv",
		})[name],
}));

vi.mock("./member-directory", () => ({
	getMemberDirectoryPool: () => ({ query }),
}));

vi.mock("./supabase", () => ({
	getSupabaseAdminClient: () => ({ from }),
}));

/** `from("payment_charges").select(...).eq(...).eq(...).maybeSingle()`. */
function chargeLookup(data: unknown) {
	const maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
	const eq = vi.fn(() => ({ eq: () => ({ maybeSingle }) }));
	return { select: () => ({ eq }) };
}

afterEach(() => {
	send.mockReset().mockResolvedValue({ data: { id: "email-1" }, error: null });
	query.mockReset();
	from.mockReset();
});

describe("payment notifications", () => {
	it("emails the workspace owner when a settlement arrives", async () => {
		from.mockReturnValue(
			chargeLookup({
				workspace_id: "ws-1",
				invoices: { invoice_number: "INV-1", customer_name: "Ada Ltd" },
			}),
		);
		query.mockResolvedValue({ rows: [{ email: "seller@example.com" }] });

		await notifySellerPaymentSettled({
			reference: "chk_1",
			amount: 1000,
			currency: "NGN",
			paidInFull: true,
		});

		expect(query).toHaveBeenCalledWith(
			expect.stringContaining('better_auth."user"'),
			["ws-1"],
		);
		expect(send).toHaveBeenCalledTimes(1);
		const [message, options] = send.mock.calls[0];
		expect(message).toMatchObject({
			to: "seller@example.com",
			subject: "Payment received — invoice INV-1",
			tags: [{ name: "source", value: "payment-received" }],
		});
		expect(message.text).toContain("Ada Ltd");
		expect(message.text).toContain("fully paid");
		expect(options.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
	});

	it("emails the seller when a buyer marks an invoice paid (claim)", async () => {
		query.mockResolvedValue({ rows: [{ email: "seller@example.com" }] });

		await notifySellerPaymentClaimed({
			workspaceId: "ws-1",
			invoiceNumber: "INV-2",
			customerName: "Bola",
			amount: 500,
			currency: "NGN",
		});

		expect(send).toHaveBeenCalledTimes(1);
		expect(send.mock.calls[0][0]).toMatchObject({
			to: "seller@example.com",
			subject: "Payment notice — invoice INV-2",
		});
		expect(send.mock.calls[0][0].text).toContain("confirm the payment");
	});

	it("sends nothing when the workspace owner has no identity row", async () => {
		from.mockReturnValue(
			chargeLookup({
				workspace_id: "ws-1",
				invoices: { invoice_number: "INV-1", customer_name: "Ada Ltd" },
			}),
		);
		query.mockResolvedValue({ rows: [] });

		await notifySellerPaymentSettled({
			reference: "chk_1",
			amount: 1000,
			currency: "NGN",
			paidInFull: false,
		});

		expect(send).not.toHaveBeenCalled();
	});

	it("swallows a delivery failure so it can never fail the payment path", async () => {
		query.mockResolvedValue({ rows: [{ email: "seller@example.com" }] });
		send.mockResolvedValue({ data: null, error: { name: "validation_error" } });
		const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(
			notifySellerPaymentClaimed({
				workspaceId: "ws-1",
				invoiceNumber: "INV-2",
				customerName: "Bola",
				amount: 500,
				currency: "NGN",
			}),
		).resolves.toBeUndefined();
		expect(errorLog).toHaveBeenCalled();
		errorLog.mockRestore();
	});
});
