import { describe, expect, it } from "vitest";
import { buildRevenueCashFlowReport } from "./revenueReporting";

describe("revenue cash flow reporting", () => {
	it("aggregates billed revenue, collections, outstanding balances, and overdue clients", () => {
		const report = buildRevenueCashFlowReport({
			baseCurrency: "NGN",
			now: new Date("2026-06-23T12:00:00.000Z"),
			window: { from: "2026-05-01", to: "2026-06-30" },
			products: [
				{
					_id: "retainer",
					name: "Monthly retainer",
					type: "service",
				},
				{
					_id: "audit",
					name: "Compliance audit",
					type: "service",
				},
			],
			invoices: [
				{
					_id: "inv-paid",
					invoiceNumber: "INV-2026-0001",
					customerName: "Acme Services Ltd",
					currency: "NGN",
					issueDate: "2026-05-01",
					dueDate: "2026-05-15",
					paymentAmount: 107_500,
					paidAt: Date.parse("2026-05-20T00:00:00.000Z"),
					compliance: {
						grandTotal: 107_500,
						withholdingTaxAmount: 0,
					},
					lineItems: [
						{
							name: "Monthly retainer",
							quantity: 1,
							price: 100_000,
							productId: "retainer",
						},
					],
				},
				{
					_id: "inv-partial",
					invoiceNumber: "INV-2026-0002",
					customerName: "Acme Services Ltd",
					currency: "NGN",
					issueDate: "2026-06-01",
					dueDate: "2026-06-10",
					deliveredAt: Date.parse("2026-06-01T00:00:00.000Z"),
					paymentAmount: 50_000,
					compliance: {
						netPayable: 215_000,
					},
					lineItems: [
						{
							name: "Monthly retainer",
							quantity: 1,
							price: 200_000,
							productId: "retainer",
						},
						{
							name: "Compliance audit",
							quantity: 1,
							price: 15_000,
							productId: "audit",
						},
					],
				},
				{
					_id: "inv-open",
					invoiceNumber: "INV-2026-0003",
					customerName: "North Studio",
					currency: "NGN",
					issueDate: "2026-06-15",
					dueDate: "2026-07-01",
					deliveredAt: Date.parse("2026-06-15T00:00:00.000Z"),
					paymentAmount: 0,
					lineItems: [
						{
							name: "Compliance audit",
							quantity: 1,
							price: 80_000,
							productId: "audit",
						},
					],
				},
				{
					_id: "inv-canceled",
					invoiceNumber: "INV-2026-0004",
					customerName: "Canceled Client",
					currency: "NGN",
					issueDate: "2026-06-10",
					dueDate: "2026-06-20",
					status: "canceled",
					canceledAt: Date.parse("2026-06-11T00:00:00.000Z"),
					paymentAmount: 0,
					lineItems: [{ name: "Ignored", quantity: 1, price: 999_999 }],
				},
			],
			payments: [
				{
					invoiceId: "inv-paid",
					amount: 107_500,
					currency: "NGN",
					source: "manual",
					createdAt: Date.parse("2026-05-20T00:00:00.000Z"),
				},
				{
					invoiceId: "inv-partial",
					amount: 50_000,
					currency: "NGN",
					source: "paystack",
					provider: "paystack",
					createdAt: Date.parse("2026-06-12T00:00:00.000Z"),
				},
			],
		});

		expect(report.primaryCurrency).toMatchObject({
			currency: "NGN",
			billedAmount: 402_500,
			collectedAmount: 157_500,
			outstandingAmount: 245_000,
			overdueAmount: 165_000,
			invoiceCount: 3,
			paidInvoiceCount: 1,
			openInvoiceCount: 2,
			overdueInvoiceCount: 1,
		});
		expect(report.primaryCurrency.collectionRate).toBeCloseTo(
			157_500 / 402_500,
		);
		expect(report.timeline.map((point) => point.key)).toEqual([
			"2026-05",
			"2026-06",
		]);
		expect(report.topCustomers[0]).toMatchObject({
			customerName: "Acme Services Ltd",
			billedAmount: 322_500,
			collectedAmount: 157_500,
			outstandingAmount: 165_000,
			overdueAmount: 165_000,
			averagePaymentDelayDays: 5,
		});
		expect(report.latePayers[0]).toMatchObject({
			customerName: "Acme Services Ltd",
			overdueAmount: 165_000,
			overdueInvoiceCount: 1,
			averageDaysOverdue: 13,
		});
		expect(report.topProducts[0]).toMatchObject({
			productId: "retainer",
			name: "Monthly retainer",
			revenue: 300_000,
			quantitySold: 2,
			invoiceCount: 2,
		});
		expect(report.openInvoices.map((invoice) => invoice.invoiceNumber)).toEqual(
			["INV-2026-0002", "INV-2026-0003"],
		);
	});

	it("keeps currencies separate and falls back to invoice payment state for legacy paid invoices", () => {
		const report = buildRevenueCashFlowReport({
			baseCurrency: "NGN",
			now: new Date("2026-06-23T00:00:00.000Z"),
			window: { from: "2026-06-01", to: "2026-06-30" },
			invoices: [
				{
					_id: "ngn-paid",
					invoiceNumber: "INV-NGN",
					customerName: "Legacy NGN",
					currency: "NGN",
					issueDate: "2026-06-01",
					dueDate: "2026-06-10",
					paymentAmount: 40_000,
					paidAt: Date.parse("2026-06-11T00:00:00.000Z"),
					lineItems: [{ name: "Support", quantity: 1, price: 40_000 }],
				},
				{
					_id: "usd-open",
					invoiceNumber: "INV-USD",
					customerName: "Export Client",
					currency: "USD",
					issueDate: "2026-06-05",
					dueDate: "2026-06-20",
					deliveredAt: Date.parse("2026-06-05T00:00:00.000Z"),
					paymentAmount: 25,
					lineItems: [{ name: "Advisory", quantity: 1, price: 100 }],
				},
			],
			payments: [],
		});

		expect(report.currencySummaries).toHaveLength(2);
		expect(
			report.currencySummaries.find((summary) => summary.currency === "NGN"),
		).toMatchObject({
			billedAmount: 40_000,
			collectedAmount: 40_000,
			outstandingAmount: 0,
		});
		expect(
			report.currencySummaries.find((summary) => summary.currency === "USD"),
		).toMatchObject({
			billedAmount: 100,
			collectedAmount: 0,
			outstandingAmount: 75,
			overdueAmount: 75,
		});
		expect(report.primaryCurrency.currency).toBe("NGN");
	});
});
