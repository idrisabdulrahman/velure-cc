import { afterEach, describe, expect, it, vi } from "vitest";
import { getSupabaseAdminClient } from "#/server/supabase";
import {
	getInvoiceByToken,
	isWellFormedPublicInvoiceToken,
	recordPublicInvoiceView,
} from "./public-invoice-repository";

vi.mock("#/server/supabase", () => ({
	getSupabaseAdminClient: vi.fn(),
}));

afterEach(() => {
	vi.restoreAllMocks();
});

/** The snake_case RPC invoice the hardened function returns, minimal but valid. */
function snakeInvoice(overrides: Record<string, unknown> = {}) {
	return {
		id: "invoice-view-1",
		token: "public-token",
		document_type: "standard",
		shipment_details: null,
		invoice_number: "INV-VIEW",
		customer_name: "Acme",
		logo_url: null,
		customer_po_number: null,
		currency: "NGN",
		invoice_type: "one-time",
		invoice_size: "A4",
		date_format: "ng",
		payment_terms_days: 14,
		template: "Default",
		issue_date: "2026-08-27",
		due_date: "2026-09-10",
		status: "unpaid",
		payment_amount: 0,
		delivered_at: null,
		canceled_at: null,
		payment_details: null,
		payment_link: null,
		payment_provider: null,
		paid_at: null,
		payment_reference: null,
		finalized_at: null,
		scheduled_at: null,
		schedule_version: null,
		notes: null,
		line_items: [{ name: "Service", quantity: 1, price: 100 }],
		template_settings: null,
		top_block: null,
		bottom_block: null,
		compliance: null,
		fiscalization: null,
		lifecycle: {},
		created_at: "2026-08-27T09:00:00.000Z",
		updated_at: "2026-08-27T10:00:00.000Z",
		...overrides,
	};
}

describe("public invoice repository", () => {
	it("uses the narrow RPC and excludes private invoice fields", async () => {
		const rpc = vi.fn(async () => ({
			data: {
				countryCode: "NG",
				invoice: {
					id: "invoice-1",
					token: "public-token",
					document_type: "standard",
					shipment_details: null,
					invoice_number: "INV-001",
					customer_name: "Acme",
					logo_url: null,
					customer_po_number: null,
					currency: "NGN",
					invoice_type: "one-time",
					invoice_size: "A4",
					date_format: "ng",
					payment_terms_days: 14,
					template: "Default",
					issue_date: "2026-08-27",
					due_date: "2026-09-10",
					status: "unpaid",
					payment_amount: 0,
					delivered_at: "2026-08-27T10:00:00.000Z",
					canceled_at: null,
					payment_details: null,
					payment_link: null,
					payment_provider: null,
					paid_at: null,
					payment_reference: null,
					finalized_at: null,
					scheduled_at: null,
					schedule_version: null,
					notes: null,
					line_items: [{ name: "Service", quantity: 1, price: 100 }],
					template_settings: null,
					top_block: null,
					bottom_block: null,
					compliance: null,
					fiscalization: null,
					lifecycle: {},
					created_at: "2026-08-27T09:00:00.000Z",
					updated_at: "2026-08-27T10:00:00.000Z",
				},
			},
			error: null,
		}));
		const from = vi.fn(() => {
			throw new Error("public invoice lookup must not query tables directly");
		});
		vi.mocked(getSupabaseAdminClient).mockReturnValue({ rpc, from } as never);

		const invoice = await getInvoiceByToken("public-token");

		expect(rpc).toHaveBeenCalledWith("public_invoice_by_token", {
			input_token: "public-token",
		});
		expect(invoice).toMatchObject({
			id: "invoice-1",
			invoiceNumber: "INV-001",
			total: 100,
			balance: 100,
		});
		expect(invoice).not.toHaveProperty("internalNotes");
		expect(invoice).not.toHaveProperty("customerId");
		expect(from).not.toHaveBeenCalled();
	});

	it("maps the hardened camelCase flat RPC doc without a snake husk", async () => {
		// Regression: the hardened RPC returns the camelCase doc directly (no
		// envelope, no snake_case keys). Feeding it through rowToInvoiceDoc
		// produced an empty husk — invoiceNumber was undefined and the PDF
		// route crashed in safePdfFileName (`undefined.trim()`).
		const rpc = vi.fn(async () => ({
			data: {
				id: "invoice-2",
				token: "pub-camel",
				documentType: "standard",
				invoiceNumber: "INV-002",
				customerName: "Camel Client",
				currency: "NGN",
				type: "one-time",
				invoiceSize: "A4",
				dateFormat: "ng",
				paymentTermsDays: 14,
				template: "Default",
				issueDate: "2026-09-01",
				dueDate: "2026-09-15",
				status: "unpaid",
				paymentAmount: 0,
				notes: null,
				lineItems: [
					{ id: "li-1", name: "Battery", price: 1300000, quantity: 1 },
				],
				compliance: { subtotal: 1300000, grandTotal: 1397500 },
				lifecycle: {},
				createdAt: 1790000000000,
				updatedAt: 1790000100000,
			},
			error: null,
		}));
		const from = vi.fn(() => {
			throw new Error("public invoice lookup must not query tables directly");
		});
		vi.mocked(getSupabaseAdminClient).mockReturnValue({ rpc, from } as never);

		const invoice = await getInvoiceByToken("pub-camel");

		expect(invoice).toMatchObject({
			id: "invoice-2",
			invoiceNumber: "INV-002",
			customerName: "Camel Client",
		});
		expect(invoice?.lineItems).toHaveLength(1);
		expect(invoice?.lineItems[0]?.price).toBe(1300000);
		expect(invoice).not.toHaveProperty("internalNotes");
		expect(invoice).not.toHaveProperty("customerId");
		expect(from).not.toHaveBeenCalled();
	});

	it("records the first public view, reads the workspace back and emits the share-open activation", async () => {
		const rpc = vi.fn(async () => ({
			data: { countryCode: "NG", invoice: snakeInvoice() },
			error: null,
		}));
		const maybeSingle = vi.fn(async () => ({
			data: { workspace_id: "ws-1" },
			error: null,
		}));
		const select = vi.fn(() => ({ maybeSingle }));
		const eq = vi.fn(() => ({ select }));
		const update = vi.fn(() => ({ eq }));
		const from = vi.fn(() => ({ update }));
		vi.mocked(getSupabaseAdminClient).mockReturnValue({ rpc, from } as never);
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		const result = await recordPublicInvoiceView("public-token");

		expect(result).toEqual({ ok: true, alreadyTracked: false });
		expect(from).toHaveBeenCalledWith("invoices");
		expect(update).toHaveBeenCalledTimes(1);
		// The workspace is read back in the same statement, not a second query.
		expect(select).toHaveBeenCalledWith("workspace_id");

		const payload = JSON.parse(log.mock.calls.at(-1)?.[0] as string) as Record<
			string,
			unknown
		>;
		expect(payload.event).toBe("activation");
		expect(payload.activation).toBe("invoice.share_opened");
		expect(payload.invoiceId).toBe("invoice-view-1");
		expect(payload.workspaceId).toBe("ws-1");
	});

	it("does not re-write or re-emit when the view was already tracked", async () => {
		const rpc = vi.fn(async () => ({
			data: {
				countryCode: "NG",
				invoice: snakeInvoice({ lifecycle: { firstViewedAt: 123 } }),
			},
			error: null,
		}));
		const from = vi.fn(() => {
			throw new Error("an already-tracked view must not write");
		});
		vi.mocked(getSupabaseAdminClient).mockReturnValue({ rpc, from } as never);
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		const result = await recordPublicInvoiceView("public-token");

		expect(result).toEqual({ ok: true, alreadyTracked: true });
		expect(from).not.toHaveBeenCalled();
		expect(log).not.toHaveBeenCalled();
	});

	describe("isWellFormedPublicInvoiceToken", () => {
		it("accepts the generated token shape and same-class values", () => {
			for (const token of [
				"pub-1b4e28ba-2fa1-11d2-883f-0016d3cca427",
				"public-token",
				"e2e-bogus-token-2b7d",
			]) {
				expect(isWellFormedPublicInvoiceToken(token), token).toBe(true);
			}
		});

		it("rejects a null byte, path characters and an over-long value", () => {
			for (const token of [
				"",
				"\0",
				"pub-1/../x",
				"a b",
				"a?b",
				"x".repeat(129),
			]) {
				expect(
					isWellFormedPublicInvoiceToken(token),
					JSON.stringify(token),
				).toBe(false);
			}
		});
	});

	it("treats a malformed token as not-found without touching Supabase", async () => {
		// Regression: a null byte made the RPC throw, so the route answered 500.
		// The guard rejects it before the client is ever built.
		const rpc = vi.fn(() => {
			throw new Error("a malformed token must not reach the RPC");
		});
		vi.mocked(getSupabaseAdminClient).mockClear();
		vi.mocked(getSupabaseAdminClient).mockReturnValue({ rpc } as never);

		await expect(getInvoiceByToken("pub-1/../%00")).resolves.toBeNull();
		await expect(recordPublicInvoiceView("\0")).resolves.toEqual({
			ok: false,
			alreadyTracked: false,
		});
		expect(rpc).not.toHaveBeenCalled();
		expect(getSupabaseAdminClient).not.toHaveBeenCalled();
	});
});
