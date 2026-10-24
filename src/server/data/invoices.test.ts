import { describe, expect, it } from "vitest";
import {
	INVOICE_LIST_PAGE_SIZE,
	mapInvoice,
	mapPublicInvoice,
	paginateInvoiceRows,
	rowToInvoiceDoc,
} from "./invoices";

describe("invoice list contracts", () => {
	it("coerces string numerics from JSON columns in rowToInvoiceDoc", () => {
		// Supabase JSON columns can deliver numeric fields as strings; the
		// document contract declares them as numbers. Money math downstream
		// (totals, PDF rendering) breaks on strings — regression: the Cloudflare
		// PDF fallback crashed on `item.price.toFixed is not a function`.
		const doc = rowToInvoiceDoc({
			id: "inv-1",
			token: "pub-token",
			document_type: "standard",
			invoice_number: "INV-001",
			customer_name: "Acme",
			currency: "NGN",
			issue_date: "2026-01-01",
			due_date: "2026-02-01",
			status: "draft",
			line_items: [
				{ id: "li-1", name: "Item", quantity: "3", price: "2500.5" },
			],
			compliance: { subtotal: "7501.5", grandTotal: "8251.65" },
			created_at: 1,
			updated_at: 2,
		} as never);
		expect(doc.lineItems[0]?.quantity).toBe(3);
		expect(doc.lineItems[0]?.price).toBe(2500.5);
		expect(doc.compliance?.subtotal).toBe(7501.5);
		expect(doc.compliance?.grandTotal).toBe(8251.65);
	});

	it("uses Midday's bounded invoice page size", () => {
		expect(INVOICE_LIST_PAGE_SIZE).toBe(25);
		const rows = Array.from({ length: 52 }, (_, index) => ({
			id: String(index),
			lineItems: [],
			status: "draft",
			currency: "NGN",
			invoiceNumber: `INV-${index}`,
			customerName: "Test",
			issueDate: "2026-08-25",
			dueDate: "2026-09-25",
			createdAt: index,
			updatedAt: index,
		}));
		const first = paginateInvoiceRows(rows, {}, INVOICE_LIST_PAGE_SIZE);
		const second = paginateInvoiceRows(
			rows,
			{ cursor: first.continueCursor },
			INVOICE_LIST_PAGE_SIZE,
		);
		expect(first.page).toHaveLength(25);
		expect(second.page).toHaveLength(25);
		expect(
			new Set([...first.page, ...second.page].map((row) => row.id)).size,
		).toBe(50);
		console.log("pagination contract passed");
	});

	it("keeps deleted rows out of normal reads", async () => {
		const source = await import("node:fs/promises").then((fs) =>
			fs.readFile(new URL("./invoices.ts", import.meta.url), "utf8"),
		);
		expect(source).toContain('.is("deleted_at", null)');
		console.log("deletion visibility contract passed");
	});
});

describe("public invoice fiscalization projection", () => {
	const invoice = (fiscalization: Record<string, unknown>) =>
		({
			id: "invoice-a",
			token: "public-token",
			invoiceNumber: "INV-1",
			customerName: "Buyer",
			currency: "NGN",
			status: "unpaid",
			lineItems: [],
			total: 0,
			balance: 0,
			paymentAmount: 0,
			createdAt: 1,
			updatedAt: 1,
			fiscalization,
		}) as never;

	it("only exposes fully marked mock clearance artifacts and strips private fields", () => {
		const mock = mapPublicInvoice(
			invoice({
				status: "mock_cleared",
				provider: "mock",
				environment: "sandbox",
				mock: true,
				mockIrn: "MOCK-IRN-demo",
				qrCodePayload: "MOCK-SANDBOX|NOT-NRS-CLEARED|IRN=MOCK-IRN-demo",
				lastError: "private provider detail",
			}),
		);
		expect(mock.fiscalization).toEqual({
			status: "mock_cleared",
			provider: "mock",
			environment: "sandbox",
			mock: true,
			mockIrn: "MOCK-IRN-demo",
			qrCodePayload: "MOCK-SANDBOX|NOT-NRS-CLEARED|IRN=MOCK-IRN-demo",
		});
		expect(JSON.stringify(mock)).not.toContain("private provider detail");
	});

	it("hides legacy fiscalization artifacts publicly but never trusts compliance JSON as clearance", () => {
		const legacyFiscalization = {
			status: "fiscalized",
			uid: "possibly-real-irn",
			qrCodePayload: "unverified",
			lastError: "private error",
		};
		const mapped = mapPublicInvoice(invoice(legacyFiscalization));
		expect(mapped.fiscalization).toEqual({ status: "not_configured" });
		expect(JSON.stringify(mapped)).not.toContain("possibly-real-irn");
		expect(JSON.stringify(mapped)).not.toContain("unverified");
		expect(JSON.stringify(mapped)).not.toContain("private error");
		expect(mapInvoice(invoice(legacyFiscalization)).fiscalization).toEqual(
			legacyFiscalization,
		);
		const draftInvoice = {
			...(invoice({}) as unknown as Record<string, unknown>),
		};
		delete draftInvoice.fiscalization;
		draftInvoice.compliance = {
			fiscalization: {
				status: "mock_cleared",
				provider: "mock",
				environment: "sandbox",
				mock: true,
				mockIrn: "MOCK-IRN-forged",
				qrCodePayload: "MOCK-SANDBOX|NOT-NRS-CLEARED|forged",
			},
		};
		const forgedFromCompliance = mapPublicInvoice(draftInvoice as never);
		expect(forgedFromCompliance.fiscalization).toEqual({
			status: "not_configured",
		});
		expect(forgedFromCompliance.compliance).not.toHaveProperty("fiscalization");
	});
});
