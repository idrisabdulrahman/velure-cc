import { describe, expect, it, vi } from "vitest";
import { getSupabaseAdminClient } from "#/server/supabase";
import { getInvoiceByToken } from "./public-invoice-repository";

vi.mock("#/server/supabase", () => ({
	getSupabaseAdminClient: vi.fn(),
}));

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
});
