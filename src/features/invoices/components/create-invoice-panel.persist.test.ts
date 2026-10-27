// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { InvoiceComplianceSnapshot } from "#/features/compliance/types";
import { hasStoredComplianceSnapshot } from "#/server/data/einvoice-validation";
import { toPersistableCompliance } from "./create-invoice-panel";

/**
 * WP12 regression: the invoice panel used to drop `netPayable` while
 * serializing the compliance snapshot. The stored snapshot then failed
 * `hasStoredComplianceSnapshot`, so a UI-created invoice could never queue
 * for e-invoicing validation.
 */
const compliance: InvoiceComplianceSnapshot = {
	seller: {
		legalName: "Seller Ltd",
		countryCode: "NG",
		address: "1 Seller Road",
		taxId: "1234567891",
	},
	buyer: {
		legalName: "Buyer Ltd",
		countryCode: "NG",
		address: "2 Buyer Road",
		taxId: "1234567890",
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
	grandTotal: 107.5,
	netPayable: 107.5,
	withholdingTaxAmount: 0,
	withholding: {
		mode: "rule_based",
		category: "none",
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
};

describe("invoice compliance snapshot serialization", () => {
	it("keeps netPayable so the stored snapshot passes validation", () => {
		const stored = toPersistableCompliance(compliance);

		expect(stored.netPayable).toBe(107.5);
		expect(hasStoredComplianceSnapshot(stored)).toBe(true);
	});

	it("still strips the UI-only tax status toggle", () => {
		const stored = toPersistableCompliance({
			...compliance,
			sellerTaxStatus: "vat_registered",
		});

		expect("sellerTaxStatus" in stored).toBe(false);
	});

	it("drops warnings that are not part of the persisted contract", () => {
		const stored = toPersistableCompliance({
			...compliance,
			warnings: ["missing_buyer_tax_id", "manual_tax_override"],
		});

		expect(stored.warnings).toEqual(["missing_buyer_tax_id"]);
		expect(hasStoredComplianceSnapshot(stored)).toBe(true);
	});
});
