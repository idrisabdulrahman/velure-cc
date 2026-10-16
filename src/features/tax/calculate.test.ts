import { describe, expect, it } from "vitest";
import {
	applyBps,
	computeInvoiceTotals,
	computeLineTax,
	type InvoiceLineTaxInput,
	VAT_RATE_BPS_SPEC_DEFAULT,
	type VatCategory,
} from "./calculate";

describe("constants", () => {
	it("defines the spec VAT rate as a named 7.5% constant", () => {
		expect(VAT_RATE_BPS_SPEC_DEFAULT).toBe(750);
	});
});

describe("computeLineTax (table-driven)", () => {
	const cases: Array<{
		name: string;
		netMinor: number;
		vatCategory: VatCategory;
		vatRateBps?: number;
		expectedMinor: number;
	}> = [
		{
			name: "standard 7.5% on ₦100.00 (10000 kobo) → ₦7.50",
			netMinor: 10_000,
			vatCategory: "standard",
			expectedMinor: 750,
		},
		{
			name: "zero-rated line contributes 0 VAT",
			netMinor: 10_000,
			vatCategory: "zero_rated",
			expectedMinor: 0,
		},
		{
			name: "exempt line contributes 0 VAT",
			netMinor: 10_000,
			vatCategory: "exempt",
			expectedMinor: 0,
		},
		{
			name: "1 kobo at 7.5% (0.075) rounds to 0",
			netMinor: 1,
			vatCategory: "standard",
			expectedMinor: 0,
		},
		{
			name: "₦0.20 at 7.5% is exactly 1.5 kobo → rounds half away from zero to 2",
			netMinor: 20,
			vatCategory: "standard",
			expectedMinor: 2,
		},
		{
			name: "₦0.03 at 50% is exactly 1.5 kobo → rounds half away from zero to 2",
			netMinor: 3,
			vatCategory: "standard",
			vatRateBps: 5_000,
			expectedMinor: 2,
		},
		{
			name: "₦0.01 at 50% is exactly 0.5 kobo → rounds half away from zero to 1",
			netMinor: 1,
			vatCategory: "standard",
			vatRateBps: 5_000,
			expectedMinor: 1,
		},
		{
			name: "credit line of −₦0.20 at 7.5% rounds away from zero to −2",
			netMinor: -20,
			vatCategory: "standard",
			expectedMinor: -2,
		},
		{
			name: "credit line of −1 kobo at 7.5% rounds to 0",
			netMinor: -1,
			vatCategory: "standard",
			expectedMinor: 0,
		},
		{
			name: "zero net → 0",
			netMinor: 0,
			vatCategory: "standard",
			expectedMinor: 0,
		},
		{
			name: "line-level rate override at 5% → ₦5.00",
			netMinor: 10_000,
			vatCategory: "standard",
			vatRateBps: 500,
			expectedMinor: 500,
		},
		{
			name: "0 bps on a standard line → 0",
			netMinor: 10_000,
			vatCategory: "standard",
			vatRateBps: 0,
			expectedMinor: 0,
		},
		{
			name: "large amount stays exact in integer arithmetic (₦10bn → ₦750m)",
			netMinor: 1_000_000_000_000,
			vatCategory: "standard",
			expectedMinor: 75_000_000_000,
		},
	];

	it.each(cases)(
		"$name",
		({ netMinor, vatCategory, vatRateBps, expectedMinor }) => {
			const result = computeLineTax({ netMinor, vatCategory, vatRateBps });
			expect(result).toBe(expectedMinor);
			expect(Number.isInteger(result)).toBe(true);
		},
	);

	const invalidCases: Array<{
		name: string;
		input: { netMinor: number; vatCategory: VatCategory; vatRateBps?: number };
	}> = [
		{
			name: "rejects a non-integer net (float money)",
			input: { netMinor: 10.5, vatCategory: "standard" },
		},
		{
			name: "rejects a non-integer rate",
			input: { netMinor: 1_000, vatCategory: "standard", vatRateBps: 750.5 },
		},
		{
			name: "rejects a negative rate",
			input: { netMinor: 1_000, vatCategory: "standard", vatRateBps: -1 },
		},
		{
			name: "rejects a rate above 100%",
			input: { netMinor: 1_000, vatCategory: "standard", vatRateBps: 10_001 },
		},
		{
			name: "rejects an unknown VAT category",
			input: {
				netMinor: 1_000,
				vatCategory: "reduced" as unknown as VatCategory,
			},
		},
	];

	it.each(invalidCases)("$name", ({ input }) => {
		expect(() => computeLineTax(input)).toThrow();
	});
});

describe("applyBps", () => {
	it("rounds half away from zero for positive and negative amounts", () => {
		expect(applyBps(1, 5_000)).toBe(1); // 0.5 → 1
		expect(applyBps(-1, 5_000)).toBe(-1); // −0.5 → −1
		expect(applyBps(3, 5_000)).toBe(2); // 1.5 → 2
		expect(applyBps(-3, 5_000)).toBe(-2); // −1.5 → −2
		expect(applyBps(1, 4_999)).toBe(0); // 0.4999 → 0
		expect(applyBps(10, 5_000)).toBe(5); // 50% of 10 = 5 exactly
	});

	it("rejects unsafe intermediate products", () => {
		expect(() => applyBps(Number.MAX_SAFE_INTEGER, 10_000)).toThrow(RangeError);
	});
});

describe("computeInvoiceTotals (table-driven)", () => {
	it("computes a mixed invoice with discount; totals equal sum of lines", () => {
		const lines: InvoiceLineTaxInput[] = [
			{ netMinor: 10_000, vatCategory: "standard" }, // VAT 750
			{ netMinor: 5_000, vatCategory: "zero_rated" }, // VAT 0
			{ netMinor: 2_500, vatCategory: "exempt" }, // VAT 0
			{ netMinor: 20, vatCategory: "standard" }, // VAT 2 (1.5 → 2)
			{ netMinor: 2_000, discountMinor: 200, vatCategory: "standard" }, // taxable 1800, VAT 135
		];

		const totals = computeInvoiceTotals({ lines });

		expect(totals.lineTaxes.map((line) => line.vatMinor)).toEqual([
			750, 0, 0, 2, 135,
		]);
		expect(totals.totalNetMinor).toBe(19_520);
		expect(totals.totalDiscountMinor).toBe(200);
		expect(totals.totalTaxableNetMinor).toBe(19_320);
		expect(totals.totalVatMinor).toBe(887);
		expect(totals.grandTotalMinor).toBe(20_207);
		expect(totals.totalWhtMinor).toBe(0);
		expect(totals.netPayableMinor).toBe(20_207);

		// Zero-rated and exempt lines appear in the breakdown with 0 VAT.
		expect(totals.vatBreakdown).toEqual([
			{ category: "standard", taxableNetMinor: 11_820, vatMinor: 887 },
			{ category: "zero_rated", taxableNetMinor: 5_000, vatMinor: 0 },
			{ category: "exempt", taxableNetMinor: 2_500, vatMinor: 0 },
		]);

		// Invariants: totals equal the sum of the lines.
		const sumLineTotals = totals.lineTaxes.reduce(
			(sum, line) => sum + line.lineTotalMinor,
			0,
		);
		const sumLineVat = totals.lineTaxes.reduce(
			(sum, line) => sum + line.vatMinor,
			0,
		);
		expect(totals.grandTotalMinor).toBe(sumLineTotals);
		expect(totals.totalVatMinor).toBe(sumLineVat);
	});

	it("computes VAT per line, not on the invoice sum", () => {
		const twoLines = computeInvoiceTotals({
			lines: [
				{ netMinor: 20, vatCategory: "standard" },
				{ netMinor: 20, vatCategory: "standard" },
			],
		});
		const oneLine = computeInvoiceTotals({
			lines: [{ netMinor: 40, vatCategory: "standard" }],
		});

		// ₦0.20 per line → 1.5 kobo → 2 each → 4 total; ₦0.40 once → 3.0 → 3.
		expect(twoLines.totalVatMinor).toBe(4);
		expect(oneLine.totalVatMinor).toBe(3);
	});

	const whtCases: Array<{
		name: string;
		lines: InvoiceLineTaxInput[];
		whtRateBps?: number;
		expectedGrandTotalMinor: number;
		expectedWhtMinor: number;
		expectedNetPayableMinor: number;
	}> = [
		{
			name: "WHT at 5% on a ₦100 + ₦7.50 VAT invoice → 538 kobo deducted",
			lines: [{ netMinor: 10_000, vatCategory: "standard" }],
			whtRateBps: 500,
			expectedGrandTotalMinor: 10_750,
			expectedWhtMinor: 538,
			expectedNetPayableMinor: 10_212,
		},
		{
			name: "WHT at 10% on the same invoice → 1075 kobo deducted",
			lines: [{ netMinor: 10_000, vatCategory: "standard" }],
			whtRateBps: 1_000,
			expectedGrandTotalMinor: 10_750,
			expectedWhtMinor: 1_075,
			expectedNetPayableMinor: 9_675,
		},
		{
			name: "WHT still applies on a zero-rated payment; 5% of 10 kobo is 0.5 → 1",
			lines: [{ netMinor: 10, vatCategory: "zero_rated" }],
			whtRateBps: 500,
			expectedGrandTotalMinor: 10,
			expectedWhtMinor: 1,
			expectedNetPayableMinor: 9,
		},
		{
			name: "no WHT rate supplied → 0 deducted, net payable equals grand total",
			lines: [{ netMinor: 10_000, vatCategory: "standard" }],
			expectedGrandTotalMinor: 10_750,
			expectedWhtMinor: 0,
			expectedNetPayableMinor: 10_750,
		},
		{
			name: "credit invoice: WHT rounds away from zero (−538) and increases net payable",
			lines: [{ netMinor: -10_000, vatCategory: "standard" }],
			whtRateBps: 500,
			expectedGrandTotalMinor: -10_750,
			expectedWhtMinor: -538,
			expectedNetPayableMinor: -10_212,
		},
	];

	it.each(whtCases)(
		"$name",
		({
			lines,
			whtRateBps,
			expectedGrandTotalMinor,
			expectedWhtMinor,
			expectedNetPayableMinor,
		}) => {
			const totals = computeInvoiceTotals({ lines, whtRateBps });
			expect(totals.grandTotalMinor).toBe(expectedGrandTotalMinor);
			expect(totals.totalWhtMinor).toBe(expectedWhtMinor);
			expect(totals.netPayableMinor).toBe(expectedNetPayableMinor);
			expect(totals.netPayableMinor).toBe(
				totals.grandTotalMinor - totals.totalWhtMinor,
			);
		},
	);

	it("returns all-zero totals for an empty invoice, with all categories present", () => {
		const totals = computeInvoiceTotals({ lines: [] });
		expect(totals.lineTaxes).toEqual([]);
		expect(totals.totalNetMinor).toBe(0);
		expect(totals.totalDiscountMinor).toBe(0);
		expect(totals.totalTaxableNetMinor).toBe(0);
		expect(totals.totalVatMinor).toBe(0);
		expect(totals.totalWhtMinor).toBe(0);
		expect(totals.grandTotalMinor).toBe(0);
		expect(totals.netPayableMinor).toBe(0);
		expect(totals.vatBreakdown).toEqual([
			{ category: "standard", taxableNetMinor: 0, vatMinor: 0 },
			{ category: "zero_rated", taxableNetMinor: 0, vatMinor: 0 },
			{ category: "exempt", taxableNetMinor: 0, vatMinor: 0 },
		]);
	});

	it("has no float drift across a sweep of odd nets, rates, and WHT rates", () => {
		const nets = [1, 3, 19, 20, 99, 3_333, 12_345, -50];
		const vatRatesBps = [0, 1, 250, 750, 3_333, 5_000, 10_000];
		const whtRatesBps = [0, 500, 1_000];
		const categories: VatCategory[] = ["standard", "zero_rated", "exempt"];

		for (const vatRateBps of vatRatesBps) {
			for (const whtRateBps of whtRatesBps) {
				const lines: InvoiceLineTaxInput[] = nets.map((netMinor, i) => ({
					netMinor,
					vatCategory: categories[i % categories.length],
				}));
				const totals = computeInvoiceTotals({
					lines,
					vatRateBps,
					whtRateBps,
				});

				for (const field of [
					totals.totalNetMinor,
					totals.totalTaxableNetMinor,
					totals.totalVatMinor,
					totals.totalWhtMinor,
					totals.grandTotalMinor,
					totals.netPayableMinor,
				]) {
					expect(Number.isInteger(field)).toBe(true);
				}

				const sumLineTotals = totals.lineTaxes.reduce(
					(sum, line) => sum + line.lineTotalMinor,
					0,
				);
				const sumLineVat = totals.lineTaxes.reduce(
					(sum, line) => sum + line.vatMinor,
					0,
				);
				const sumLineNet = totals.lineTaxes.reduce(
					(sum, line) => sum + line.taxableNetMinor,
					0,
				);
				expect(totals.grandTotalMinor).toBe(sumLineTotals);
				expect(totals.totalVatMinor).toBe(sumLineVat);
				expect(totals.totalTaxableNetMinor).toBe(sumLineNet);
				expect(totals.totalNetMinor - totals.totalDiscountMinor).toBe(
					totals.totalTaxableNetMinor,
				);
				expect(
					totals.vatBreakdown.reduce(
						(sum, bucket) => sum + bucket.taxableNetMinor,
						0,
					),
				).toBe(totals.totalTaxableNetMinor);
				expect(
					totals.vatBreakdown.reduce((sum, bucket) => sum + bucket.vatMinor, 0),
				).toBe(totals.totalVatMinor);
			}
		}
	});

	it("rejects invalid inputs", () => {
		expect(() =>
			computeInvoiceTotals({
				lines: [{ netMinor: 1_500.5, vatCategory: "standard" }],
			}),
		).toThrow(RangeError);
		expect(() =>
			computeInvoiceTotals({
				lines: [{ netMinor: 100, discountMinor: -1, vatCategory: "standard" }],
			}),
		).toThrow(RangeError);
		expect(() =>
			computeInvoiceTotals({
				lines: [{ netMinor: 100, discountMinor: 150, vatCategory: "standard" }],
			}),
		).toThrow(RangeError);
		expect(() =>
			computeInvoiceTotals({
				lines: [
					{ netMinor: 100, discountMinor: 10.5, vatCategory: "standard" },
				],
			}),
		).toThrow(RangeError);
		expect(() =>
			computeInvoiceTotals({
				lines: [
					{ netMinor: 100, vatCategory: "reduced" as unknown as VatCategory },
				],
			}),
		).toThrow(TypeError);
		expect(() =>
			computeInvoiceTotals({
				lines: [{ netMinor: 100, vatCategory: "standard" }],
				vatRateBps: 10_001,
			}),
		).toThrow(RangeError);
		expect(() =>
			computeInvoiceTotals({
				lines: [{ netMinor: 100, vatCategory: "standard" }],
				whtRateBps: -1,
			}),
		).toThrow(RangeError);
	});
});
