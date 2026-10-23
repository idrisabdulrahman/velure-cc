import { describe, expect, it } from "vitest";
import type { CanonicalInvoice } from "./canonical-invoice";
import { validateCanonicalInvoice } from "./validate-canonical-invoice";

function invoice(overrides: Partial<CanonicalInvoice> = {}): CanonicalInvoice {
	return {
		id: "invoice-1",
		number: "INV-2026-0001",
		documentType: "standard",
		issueDate: "2026-01-01",
		dueDate: "2026-01-15",
		currency: "NGN",
		seller: {
			legalName: "Seller Ltd",
			address: "1 Seller Road",
			jurisdiction: { scheme: "source.jurisdictionCode", value: "NG" },
			identifiers: [{ scheme: "tax-id", value: "1234567891" }],
		},
		buyer: {
			legalName: "Buyer Ltd",
			address: "2 Buyer Road",
			jurisdiction: { scheme: "source.jurisdictionCode", value: "NG" },
			identifiers: [{ scheme: "tax-id", value: "1234567892" }],
		},
		lines: [
			{
				description: "Service",
				quantity: 1,
				unit: "hour",
				unitPrice: "100",
				classification: {
					scheme: "source.classificationCode",
					value: "SVC-01",
				},
				taxCategory: { scheme: "source.vatCategory", value: "standard" },
			},
		],
		taxContext: {
			placeOfSupply: { scheme: "source.jurisdictionCode", value: "NG" },
			taxTreatment: { scheme: "source.taxTreatment", value: "exclusive_rate" },
			rate: 7.5,
			label: "VAT",
			taxRuleSetVersion: { scheme: "source.taxRuleSetVersion", value: "ng-v1" },
		},
		taxes: [
			{
				label: "VAT",
				rate: 7.5,
				amount: "7.5",
				treatment: { scheme: "source.taxTreatment", value: "exclusive_rate" },
				jurisdiction: { scheme: "source.jurisdictionCode", value: "NG" },
			},
		],
		withholding: {
			amount: "0",
			rate: 0,
			mode: "rule_based",
			category: { scheme: "source.withholdingCategory", value: "none" },
			recipientEntityType: "corporate",
			recipientResidency: "resident",
			ruleVersion: "ng-v1",
			manualOverride: false,
		},
		totals: {
			invoiceTotal: "107.5",
			subtotal: "100",
			taxTotal: "7.5",
			withholdingTotal: "0",
			grossTotal: "107.5",
			payableTotal: "107.5",
		},
		...overrides,
	};
}

function treatmentContext(
	base: CanonicalInvoice,
	treatment: string,
): NonNullable<CanonicalInvoice["taxContext"]> {
	if (!base.taxContext) throw new Error("Test invoice needs a tax context.");
	return {
		...base.taxContext,
		taxTreatment: { scheme: "source.taxTreatment", value: treatment },
	};
}

describe("validateCanonicalInvoice", () => {
	it("accepts trusted B2B and B2C profiles, requiring buyer TIN only for B2B", () => {
		expect(
			validateCanonicalInvoice(invoice(), { buyerType: "b2b" }).valid,
		).toBe(true);
		const b2c = invoice({
			buyer: {
				legalName: "Person",
				address: "3 Home Road",
				jurisdiction: { scheme: "source.jurisdictionCode", value: "NG" },
			},
		});
		expect(validateCanonicalInvoice(b2c, { buyerType: "b2c" })).toEqual({
			valid: true,
			issues: [],
		});
		expect(
			validateCanonicalInvoice(b2c, { buyerType: "b2b" }).issues.map(
				({ code }) => code,
			),
		).toContain("tin_required");
	});

	it("reuses Nigerian TIN format and placeholder rules", () => {
		const invalid = invoice({
			seller: {
				...invoice().seller,
				identifiers: [{ scheme: "tax-id", value: "1234567890" }],
			},
		});
		expect(
			validateCanonicalInvoice(invalid, { buyerType: "b2b" }).issues,
		).toContainEqual(
			expect.objectContaining({
				code: "tin_placeholder",
				path: "seller.identifiers",
			}),
		);
	});

	it("requires foreign B2B identifiers without applying Nigeria's TIN format", () => {
		const base = invoice();
		const gbParty = (
			identifiers?: CanonicalInvoice["buyer"]["identifiers"],
		) => ({
			...base.buyer,
			jurisdiction: { scheme: "source.jurisdictionCode" as const, value: "GB" },
			identifiers,
		});
		const foreignTin = [{ scheme: "tax-id" as const, value: "GB-ABC 123" }];
		expect(
			validateCanonicalInvoice(invoice({ buyer: gbParty(foreignTin) }), {
				buyerType: "b2b",
			}).valid,
		).toBe(true);
		expect(
			validateCanonicalInvoice(invoice({ buyer: gbParty() }), {
				buyerType: "b2b",
			}).issues.map(({ code }) => code),
		).toContain("tin_required");
		expect(
			validateCanonicalInvoice(invoice({ buyer: gbParty() }), {
				buyerType: "b2c",
			}).valid,
		).toBe(true);
	});

	it("rejects malformed VAT category and missing classification", () => {
		const line = invoice().lines[0];
		const result = validateCanonicalInvoice(
			invoice({
				lines: [
					{
						...line,
						taxCategory: { scheme: "source.vatCategory", value: "unknown" },
						classification: undefined,
					},
				],
			}),
			{ buyerType: "b2b" },
		);
		expect(result.issues.map(({ code }) => code)).toEqual(
			expect.arrayContaining([
				"vat_category_invalid",
				"classification_required",
			]),
		);
	});

	it("uses decimal arithmetic with half-away-from-zero currency rounding", () => {
		const base = invoice();
		const result = validateCanonicalInvoice(
			invoice({
				lines: [{ ...base.lines[0], unitPrice: "1.005" }],
				taxContext: treatmentContext(base, "none"),
				taxes: [],
				totals: {
					invoiceTotal: "1.01",
					subtotal: "1.01",
					taxTotal: "0",
					withholdingTotal: "0",
					grossTotal: "1.01",
					payableTotal: "1.01",
				},
			}),
			{ buyerType: "b2b" },
		);
		expect(result.valid).toBe(true);
	});

	it("rejects arithmetic mismatches and blocks undefined nonzero discount semantics", () => {
		const base = invoice();
		const result = validateCanonicalInvoice(
			invoice({ totals: { ...base.totals, subtotal: "99", discount: "1" } }),
			{ buyerType: "b2b" },
		);
		expect(result.issues.map(({ code }) => code)).toEqual(
			expect.arrayContaining([
				"subtotal_mismatch",
				"discount_semantics_unsupported",
			]),
		);
	});

	it("rejects negative tax-line amounts", () => {
		const base = invoice();
		const tax = base.taxes?.[0];
		if (!tax) throw new Error("Test invoice needs a tax line.");
		const result = validateCanonicalInvoice(
			invoice({ taxes: [{ ...tax, amount: "-1" }] }),
			{ buyerType: "b2b" },
		);
		expect(result.issues).toContainEqual(
			expect.objectContaining({
				code: "tax_amount_negative",
				path: "taxes[0].amount",
			}),
		);
	});

	it("supports all persisted no-tax treatments without recalculating rates", () => {
		for (const treatment of [
			"none",
			"exempt",
			"zero_rated",
			"reverse_charge",
		] as const) {
			const base = invoice();
			const result = validateCanonicalInvoice(
				invoice({
					taxContext: treatmentContext(base, treatment),
					taxes: [],
					totals: {
						invoiceTotal: "100",
						subtotal: "100",
						taxTotal: "0",
						withholdingTotal: "0",
						grossTotal: "100",
						payableTotal: "100",
					},
				}),
				{ buyerType: "b2b" },
			);
			expect(result.valid).toBe(true);
		}
	});

	it("rejects nonzero line tax or invoice tax totals for no-tax treatments", () => {
		const base = invoice();
		const noTax = treatmentContext(base, "exempt");
		const taxLine = base.taxes?.[0];
		if (!taxLine) throw new Error("Test invoice needs a tax line.");
		const result = validateCanonicalInvoice(
			invoice({
				taxContext: noTax,
				taxes: [
					{
						...taxLine,
						amount: "0.01",
						treatment: { scheme: "source.taxTreatment", value: "exempt" },
					},
				],
				totals: {
					invoiceTotal: "100.01",
					subtotal: "100",
					taxTotal: "0.01",
					withholdingTotal: "0",
					grossTotal: "100",
					payableTotal: "100",
				},
			}),
			{ buyerType: "b2b" },
		);
		expect(result.issues.map(({ code }) => code)).toContain(
			"no_tax_treatment_has_tax",
		);
	});

	it("does not mutate its canonical input", () => {
		const value = invoice();
		const before = structuredClone(value);
		validateCanonicalInvoice(value, { buyerType: "b2b" });
		expect(value).toEqual(before);
	});
});
