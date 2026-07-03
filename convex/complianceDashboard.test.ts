import { describe, expect, it } from "vitest";
import { buildComplianceDashboardReport } from "./complianceDashboard";

describe("compliance dashboard reporting", () => {
	it("aggregates VAT, WHT, warnings, and customer compliance context", () => {
		const report = buildComplianceDashboardReport({
			baseCurrency: "NGN",
			now: new Date("2026-06-23T12:00:00.000Z"),
			window: { from: "2026-05-01", to: "2026-06-30" },
			invoices: [
				{
					_id: "inv-vat",
					invoiceNumber: "INV-2026-0001",
					customerName: "Acme Services Ltd",
					currency: "NGN",
					issueDate: "2026-05-15",
					lineItems: [{ quantity: 1, price: 100_000 }],
					compliance: {
						seller: { taxId: "1234567890", countryCode: "NG" },
						buyer: { countryCode: "NG" },
						subtotal: 100_000,
						totalTax: 7_500,
						withholdingTaxAmount: 5_375,
						withholding: {
							category: "professional_fees",
							manualOverride: true,
						},
						warnings: ["missing_buyer_tax_id", "manual_wht_override"],
						grandTotal: 107_500,
						netPayable: 999_999,
					},
				},
				{
					_id: "inv-open",
					invoiceNumber: "INV-2026-0002",
					customerName: "North Studio",
					currency: "NGN",
					issueDate: "2026-06-01",
					lineItems: [{ quantity: 2, price: 50_000 }],
					compliance: {
						seller: { taxId: "1234567890", countryCode: "NG" },
						buyer: { taxId: "0987654321", countryCode: "NG" },
						subtotal: 100_000,
						totalTax: 7_500,
						withholdingTaxAmount: 0,
						warnings: [],
						grandTotal: 107_500,
					},
				},
				{
					_id: "inv-cross-border",
					invoiceNumber: "INV-2026-0003",
					customerName: "Export Client",
					currency: "USD",
					issueDate: "2026-06-03",
					lineItems: [{ quantity: 1, price: 1_000 }],
					compliance: {
						seller: { taxId: "1234567890", countryCode: "NG" },
						buyer: { taxId: "US-TAX", countryCode: "US" },
						subtotal: 1_000,
						totalTax: 0,
						withholdingTaxAmount: 0,
						warnings: ["cross_border_review"],
						grandTotal: 1_000,
					},
				},
				{
					_id: "inv-canceled",
					invoiceNumber: "INV-2026-0004",
					customerName: "Canceled Client",
					currency: "NGN",
					issueDate: "2026-06-04",
					status: "canceled",
					lineItems: [{ quantity: 1, price: 999_999 }],
					compliance: {
						subtotal: 999_999,
						totalTax: 74_999.93,
						withholdingTaxAmount: 10_000,
						warnings: ["manual_tax_override"],
						grandTotal: 1_074_998.93,
					},
				},
			],
		});

		expect(report.primaryCurrency).toMatchObject({
			currency: "NGN",
			invoiceCount: 2,
			taxableInvoiceCount: 2,
			taxableBase: 200_000,
			vatAmount: 15_000,
			whtAmount: 5_375,
			grossAmount: 215_000,
			netPayable: 209_625,
			warningCount: 2,
			manualOverrideCount: 1,
			missingBuyerTaxIdCount: 1,
		});
		expect(report.currencySummaries.map((summary) => summary.currency)).toEqual(
			["NGN", "USD"],
		);
		expect(report.monthly.map((point) => point.key)).toEqual([
			"2026-05",
			"2026-06",
			"2026-06",
		]);
		expect(report.warnings).toEqual([
			{ code: "missing_buyer_tax_id", count: 1 },
			{ code: "manual_wht_override", count: 1 },
			{ code: "cross_border_review", count: 1 },
		]);
		expect(report.customerContexts[0]).toMatchObject({
			customerName: "Acme Services Ltd",
			warningCount: 2,
			missingBuyerTaxIdCount: 1,
		});
		expect(
			report.invoicesNeedingReview.map((invoice) => invoice.invoiceNumber),
		).toEqual(["INV-2026-0001", "INV-2026-0003"]);
	});

	it("filters by selected currency and excludes invoices outside the period", () => {
		const report = buildComplianceDashboardReport({
			baseCurrency: "NGN",
			currency: "USD",
			now: new Date("2026-06-23T00:00:00.000Z"),
			window: { from: "2026-06-01", to: "2026-06-30" },
			invoices: [
				{
					invoiceNumber: "INV-NGN",
					customerName: "Local Client",
					currency: "NGN",
					issueDate: "2026-06-10",
					lineItems: [{ quantity: 1, price: 100_000 }],
					compliance: { totalTax: 7_500, withholdingTaxAmount: 0 },
				},
				{
					invoiceNumber: "INV-USD",
					customerName: "Export Client",
					currency: "USD",
					issueDate: "2026-06-11",
					lineItems: [{ quantity: 1, price: 500 }],
					compliance: { totalTax: 0, withholdingTaxAmount: 25 },
				},
				{
					invoiceNumber: "INV-OLD",
					customerName: "Old Export Client",
					currency: "USD",
					issueDate: "2026-05-20",
					lineItems: [{ quantity: 1, price: 700 }],
					compliance: { totalTax: 0, withholdingTaxAmount: 35 },
				},
			],
		});

		expect(report.primaryCurrency).toMatchObject({
			currency: "USD",
			invoiceCount: 1,
			whtAmount: 25,
		});
		expect(report.currencySummaries).toHaveLength(1);
		expect(report.currencySummaries[0].currency).toBe("USD");
	});
});
