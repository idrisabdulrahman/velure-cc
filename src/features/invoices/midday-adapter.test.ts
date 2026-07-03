import { describe, expect, it } from "vitest";
import { toMiddayInvoice } from "./midday-adapter";
import type { InvoiceRecord } from "./types";

function buildInvoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
	return {
		id: "invoice-1",
		token: "public-token",
		invoiceNumber: "INV-2026-0001",
		customerName: "Acme Services Ltd",
		customerPoNumber: "PO-ACME-42",
		currency: "NGN",
		type: "one-time",
		invoiceSize: "A4",
		dateFormat: "ng",
		paymentTermsDays: 14,
		template: "default",
		issueDate: "2026-06-01",
		dueDate: "2026-06-15",
		status: "unpaid",
		total: 107_500,
		balance: 107_500,
		paymentAmount: 0,
		lineItems: [
			{ id: "line-1", name: "Consulting", quantity: 1, price: 100_000 },
		],
		compliance: {
			seller: { legalName: "Velure Ltd", countryCode: "NG" },
			buyer: { legalName: "Acme Services Ltd", countryCode: "NG" },
			sellerTaxStatus: "vat_registered",
			placeOfSupply: "NG",
			taxRuleSetVersion: "test",
			taxTreatment: "exclusive_rate",
			subtotal: 100_000,
			totalTax: 7_500,
			taxLabel: "VAT",
			taxRate: 7.5,
			taxLines: [
				{
					label: "VAT",
					rate: 7.5,
					amount: 7_500,
					treatment: "exclusive_rate",
					jurisdictionCode: "NG",
				},
			],
			templateVariant: "vat_ready",
			withholdingTaxAmount: 0,
			withholdingTaxLabel: "WHT",
			withholdingTaxRate: 0,
			withholdingTaxPreset: "none",
			withholding: {
				mode: "rule_based",
				category: "none",
				recipientEntityType: "corporate",
				recipientResidency: "resident",
				rate: 0,
				amount: 0,
				ruleVersion: "test",
				manualOverride: false,
			},
			grandTotal: 107_500,
			netPayable: 107_500,
			warnings: [],
		},
		createdAt: Date.parse("2026-06-01T00:00:00.000Z"),
		updatedAt: Date.parse("2026-06-01T00:00:00.000Z"),
		...overrides,
	};
}

describe("toMiddayInvoice", () => {
	it("passes customer PO numbers through to invoice templates", () => {
		expect(toMiddayInvoice(buildInvoice()).customerPoNumber).toBe("PO-ACME-42");
	});

	it("uses null when an invoice is not backed by a customer PO", () => {
		expect(
			toMiddayInvoice(buildInvoice({ customerPoNumber: undefined }))
				.customerPoNumber,
		).toBeNull();
	});
});
