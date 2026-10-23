import { describe, expect, it } from "vitest";
import type { InvoiceRecord } from "../invoices/types";
import { canonicalDecimal, toCanonicalInvoice } from "./canonical-invoice";

function invoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
	return {
		id: "invoice-1",
		token: "private-token",
		documentType: "standard",
		invoiceNumber: "INV-2026-0001",
		customerName: "Northwind Ltd",
		currency: "NGN",
		type: "one-time",
		invoiceSize: "A4",
		dateFormat: "iso",
		paymentTermsDays: 14,
		template: "Default",
		issueDate: "2026-01-01",
		dueDate: "2026-01-15",
		status: "unpaid",
		total: 107.5,
		balance: 107.5,
		paymentAmount: 0,
		lineItems: [
			{
				id: "line-1",
				name: "Consulting",
				quantity: 2,
				price: 50,
				unit: "hour",
				vatCategory: "standard",
				classificationCode: "SVC-01",
			},
		],
		compliance: {
			seller: {
				legalName: "Velure Ltd",
				tradingName: "Velure",
				countryCode: "NG",
				address: "1 Seller Road",
				taxId: "TIN-SELLER",
				rcNumber: "REG-123",
			},
			buyer: {
				legalName: "Northwind Ltd",
				countryCode: "NG",
				email: "buyer@example.test",
			},
			placeOfSupply: "NG",
			taxRuleSetVersion: "ng-v1",
			taxTreatment: "exclusive_rate",
			taxRate: 7.5,
			taxLabel: "VAT",
			taxLines: [
				{
					label: "VAT",
					rate: 7.5,
					amount: 7.5,
					treatment: "exclusive_rate",
					jurisdictionCode: "NG",
				},
			],
			warnings: [],
			templateVariant: "vat_ready",
			subtotal: 100,
			totalTax: 7.5,
			withholding: {
				mode: "rule_based",
				category: "professional_fees",
				recipientEntityType: "corporate",
				recipientResidency: "resident",
				rate: 0,
				amount: 0,
				ruleVersion: "ng-v1",
				manualOverride: false,
			},
			withholdingTaxPreset: "none",
			withholdingTaxLabel: "WHT",
			withholdingTaxRate: 0,
			withholdingTaxAmount: 0,
			netPayable: 107.5,
			grandTotal: 107.5,
		},
		createdAt: 1,
		updatedAt: 2,
		...overrides,
	};
}

describe("canonicalDecimal", () => {
	it("preserves decimal edges, negative values, zero, and exponent notation", () => {
		expect(canonicalDecimal(1.005, "amount")).toBe("1.005");
		expect(canonicalDecimal(-1.005, "amount")).toBe("-1.005");
		expect(canonicalDecimal(0, "amount")).toBe("0");
		expect(canonicalDecimal(-0, "amount")).toBe("0");
		expect(canonicalDecimal(1e-7, "amount")).toBe("0.0000001");
		expect(canonicalDecimal(1e21, "amount")).toBe("1000000000000000000000");
	});

	it("rejects non-finite money instead of replacing it with a value", () => {
		expect(() => canonicalDecimal(Number.NaN, "amount")).toThrow(RangeError);
		expect(() => canonicalDecimal(Number.POSITIVE_INFINITY, "amount")).toThrow(
			RangeError,
		);
	});
});

describe("toCanonicalInvoice", () => {
	it("maps a domestic snapshot without recalculating its totals", () => {
		const source = invoice();
		const canonical = toCanonicalInvoice(source);

		expect(canonical).toMatchObject({
			documentType: "standard",
			currency: "NGN",
			seller: {
				legalName: "Velure Ltd",
				countryCode: "NG",
				identifiers: [
					{ scheme: "tax-id", value: "TIN-SELLER" },
					{ scheme: "registration-number", value: "REG-123" },
				],
			},
			buyer: { legalName: "Northwind Ltd", email: "buyer@example.test" },
			lines: [
				{
					description: "Consulting",
					quantity: 2,
					unit: "hour",
					unitPrice: "50",
					classification: {
						scheme: "source.classificationCode",
						value: "SVC-01",
					},
					taxCategory: {
						scheme: "source.vatCategory",
						value: "standard",
					},
				},
			],
			taxes: [
				{
					amount: "7.5",
					jurisdiction: { scheme: "source.jurisdictionCode", value: "NG" },
				},
			],
			taxContext: {
				treatment: {
					scheme: "source.taxTreatment",
					value: "exclusive_rate",
				},
				rate: 7.5,
				label: "VAT",
				ruleSet: { scheme: "source.taxRuleSetVersion", value: "ng-v1" },
			},
			withholding: {
				amount: "0",
				mode: "rule_based",
				category: {
					scheme: "source.withholdingCategory",
					value: "professional_fees",
				},
			},
			totals: {
				invoiceTotal: "107.5",
				subtotal: "100",
				taxTotal: "7.5",
				grossTotal: "107.5",
				payableTotal: "107.5",
			},
		});
		expect(source.total).toBe(107.5);
		expect(Object.isFrozen(canonical)).toBe(true);
		expect(Object.isFrozen(canonical.lines)).toBe(true);
		expect(Object.isFrozen(canonical.lines[0])).toBe(true);
	});

	it("preserves cross-border metadata and correction/pro-forma document types", () => {
		const source = invoice();
		if (!source.compliance) throw new Error("Expected compliance fixture.");
		const crossBorder = invoice({
			documentType: "debit_note",
			correctsInvoiceId: "source-42",
			currency: "GBP",
			compliance: {
				...source.compliance,
				seller: { legalName: "Seller Ltd", countryCode: "GB" },
				buyer: { legalName: "Buyer Inc", countryCode: "US" },
				placeOfSupply: "GB",
				taxLines: [
					{
						label: "Tax",
						rate: 0,
						amount: 0,
						treatment: "reverse_charge",
						jurisdictionCode: "EU",
					},
				],
			},
		});
		expect(toCanonicalInvoice(crossBorder)).toMatchObject({
			documentType: "debit_note",
			currency: "GBP",
			seller: { countryCode: "GB" },
			buyer: { countryCode: "US" },
			relatedDocuments: [{ relation: "corrects", documentId: "source-42" }],
			taxes: [
				{
					jurisdiction: {
						scheme: "source.jurisdictionCode",
						value: "EU",
					},
				},
			],
		});
		expect(
			toCanonicalInvoice(invoice({ documentType: "credit_note" })).documentType,
		).toBe("credit_note");
		expect(
			toCanonicalInvoice(invoice({ documentType: "proforma" })).documentType,
		).toBe("proforma");
	});

	it("leaves unavailable optional data absent and preserves exact decimal edges", () => {
		const source = invoice({
			total: 1.005,
			lineItems: [{ id: "line-edge", name: "Edge", quantity: 1, price: 1.005 }],
			compliance: undefined,
			templateSettings: { includeDiscount: true, discount: 0.005 },
		});
		const canonical = toCanonicalInvoice(source);
		expect(canonical.taxes).toBeUndefined();
		expect(canonical.withholding).toBeUndefined();
		expect(canonical.lines[0]).not.toHaveProperty("classification");
		expect(canonical.lines[0]).not.toHaveProperty("taxCategory");
		expect(canonical.seller).toEqual({});
		expect(canonical.buyer).toEqual({ legalName: "Northwind Ltd" });
		expect(canonical.lines[0]?.unitPrice).toBe("1.005");
		expect(canonical.totals).toEqual({
			invoiceTotal: "1.005",
			discount: "0.005",
		});
	});

	it("rejects an unrepresentable source amount", () => {
		const source = invoice({
			lineItems: [
				{ id: "line-invalid", name: "Invalid", quantity: 1, price: Number.NaN },
			],
		});
		expect(() => toCanonicalInvoice(source)).toThrow(
			"Line line-invalid unit price must be a finite decimal amount.",
		);
	});
});
