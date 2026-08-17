import { describe, expect, it } from "vitest";
import { calculateInvoiceCompliance, roundCurrency } from "./calculate";

describe("calculateInvoiceCompliance", () => {
	const lineItems = [{ quantity: 2, price: 100_000 }];

	it("defaults Nigerian VAT-registered sellers to 7.5% VAT", () => {
		const result = calculateInvoiceCompliance({
			seller: { legalName: "Acme", countryCode: "NG", taxId: "1234567890" },
			buyer: { legalName: "Client", countryCode: "NG" },
			sellerTaxStatus: "vat_registered",
			lineItems,
		});

		expect(result.taxTreatment).toBe("exclusive_rate");
		expect(result.taxRate).toBe(7.5);
		expect(result.totalTax).toBe(15_000);
		expect(result.grandTotal).toBe(215_000);
	});

	it("does not auto-charge VAT for below-threshold sellers", () => {
		const result = calculateInvoiceCompliance({
			seller: { legalName: "Small Biz", countryCode: "NG" },
			buyer: { legalName: "Client", countryCode: "NG" },
			sellerTaxStatus: "below_threshold_not_charging_vat",
			lineItems,
		});

		expect(result.taxTreatment).toBe("none");
		expect(result.totalTax).toBe(0);
		expect(result.warnings).not.toContain("domestic_vat_not_applied");
	});

	it("resolves WHT rates from the 2024 rule matrix", () => {
		const result = calculateInvoiceCompliance({
			seller: { legalName: "Acme", countryCode: "NG", taxId: "1234567890" },
			buyer: { legalName: "Client", countryCode: "NG" },
			sellerTaxStatus: "vat_registered",
			withholding: {
				category: "professional_fees",
				recipientEntityType: "corporate",
				recipientResidency: "resident",
			},
			lineItems,
		});

		expect(result.withholding.rate).toBe(5);
		expect(result.withholdingTaxAmount).toBe(10_750);
		expect(result.netPayable).toBe(204_250);
	});

	it("marks migrated legacy WHT presets for review", () => {
		const result = calculateInvoiceCompliance({
			seller: { legalName: "Acme", countryCode: "NG", taxId: "1234567890" },
			buyer: { legalName: "Client", countryCode: "NG" },
			sellerTaxStatus: "vat_registered",
			withholdingTaxPreset: "consultancy_company",
			lineItems,
		});

		expect(result.withholding.mode).toBe("legacy_manual");
		expect(result.warnings).toContain("legacy_wht_mapping");
		expect(result.warnings).toContain("manual_wht_override");
		expect(result.withholding.rate).toBe(10);
	});

	it("rounds decimal VAT and WHT through the same currency boundary", () => {
		const result = calculateInvoiceCompliance({
			seller: { legalName: "Acme", countryCode: "NG", taxId: "1234567890" },
			buyer: { legalName: "Client", countryCode: "NG" },
			sellerTaxStatus: "vat_registered",
			withholding: {
				category: "professional_fees",
				recipientEntityType: "corporate",
				recipientResidency: "resident",
			},
			lineItems: [{ quantity: 1, price: 1.005 }],
		});

		expect(result.subtotal).toBe(1.01);
		expect(result.totalTax).toBe(0.08);
		expect(result.grandTotal).toBe(1.09);
		expect(result.withholdingTaxAmount).toBe(0.05);
		expect(result.netPayable).toBe(1.04);
	});
});

describe("roundCurrency", () => {
	it("rounds positive and negative half-cent values", () => {
		expect(roundCurrency(1.005)).toBe(1.01);
		expect(roundCurrency(-1.005)).toBe(-1.01);
		expect(roundCurrency(Number.NaN)).toBe(0);
	});
});
