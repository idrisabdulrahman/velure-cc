import { describe, expect, it } from "vitest";
import { getInvoiceBalance, getInvoiceStatus, getInvoiceTotal } from "./status";
import type { InvoiceRecord } from "./types";

function invoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
	return {
		id: "invoice",
		token: "pub-token",
		invoiceNumber: "INV-2026-0001",
		customerName: "Ada Ltd",
		currency: "NGN",
		type: "one-time",
		invoiceSize: "A4",
		dateFormat: "ng",
		paymentTermsDays: 14,
		template: "Default",
		issueDate: "2026-06-01",
		dueDate: "2026-06-30",
		status: "draft",
		total: 10_000,
		balance: 10_000,
		paymentAmount: 0,
		lineItems: [{ id: "line", name: "Service", quantity: 1, price: 10_000 }],
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

describe("derived invoice status", () => {
	it("keeps unsent invoices as draft", () => {
		expect(getInvoiceStatus(invoice())).toBe("draft");
	});

	it("treats delivered unpaid invoices as sent/unpaid", () => {
		const now = new Date("2026-06-19T12:00:00Z");

		expect(getInvoiceStatus(invoice({ deliveredAt: 1 }), now)).toBe("unpaid");
	});

	it("derives overdue, partially-paid, paid, and canceled states", () => {
		const now = new Date("2026-06-19T12:00:00Z");

		expect(
			getInvoiceStatus(invoice({ deliveredAt: 1, dueDate: "2026-06-01" }), now),
		).toBe("overdue");
		expect(getInvoiceStatus(invoice({ paymentAmount: 4_000 }), now)).toBe(
			"partially-paid",
		);
		expect(getInvoiceStatus(invoice({ paymentAmount: 10_000 }), now)).toBe(
			"paid",
		);
		expect(
			getInvoiceStatus(invoice({ canceledAt: 1, paymentAmount: 10_000 }), now),
		).toBe("canceled");
	});

	it("uses compliance net payable for total and balance", () => {
		const record = invoice({
			paymentAmount: 1_500,
			compliance: {
				seller: {},
				buyer: {},
				placeOfSupply: "NG",
				taxRuleSetVersion: "ng-nrs-2026.1",
				taxTreatment: "exclusive_rate",
				taxRate: 7.5,
				taxLabel: "VAT",
				taxLines: [],
				warnings: [],
				templateVariant: "vat_ready",
				subtotal: 10_000,
				totalTax: 750,
				withholding: {
					mode: "rule_based",
					category: "none",
					recipientEntityType: "corporate",
					recipientResidency: "resident",
					rate: 0,
					amount: 0,
					ruleVersion: "ng-nrs-2026.1",
					manualOverride: false,
				},
				withholdingTaxPreset: "none",
				withholdingTaxLabel: "WHT",
				withholdingTaxRate: 0,
				withholdingTaxAmount: 500,
				grandTotal: 10_750,
				netPayable: 10_250,
			},
		});

		expect(getInvoiceTotal(record)).toBe(10_250);
		expect(getInvoiceBalance(record)).toBe(8_750);
	});
});
