import { describe, expect, it } from "vitest";
import { buildClientIntelligence } from "./clientIntelligence";

describe("client intelligence", () => {
	it("aggregates matching client invoices without crossing to other customers", () => {
		const result = buildClientIntelligence({
			client: {
				name: "Acme Services Ltd",
				email: "billing@acme.test",
				currency: "NGN",
			},
			now: new Date("2026-06-23T00:00:00.000Z"),
			invoices: [
				{
					_id: "invoice-1",
					invoiceNumber: "INV-2026-0001",
					customerName: "Acme Services Ltd",
					currency: "NGN",
					issueDate: "2026-05-01",
					dueDate: "2026-05-15",
					paymentAmount: 107_500,
					paidAt: Date.parse("2026-05-20T00:00:00.000Z"),
					compliance: {
						buyer: { email: "billing@acme.test" },
						grandTotal: 107_500,
						withholdingTaxAmount: 0,
					},
					lineItems: [
						{ name: "Support retainer", quantity: 1, price: 100_000 },
					],
				},
				{
					_id: "invoice-2",
					invoiceNumber: "INV-2026-0002",
					customerName: "Acme Services Ltd",
					currency: "NGN",
					issueDate: "2026-06-01",
					dueDate: "2026-06-10",
					deliveredAt: Date.parse("2026-06-01T00:00:00.000Z"),
					paymentAmount: 50_000,
					compliance: {
						buyer: { email: "billing@acme.test" },
						netPayable: 215_000,
					},
					lineItems: [
						{ name: "Support retainer", quantity: 1, price: 200_000 },
						{ name: "Training", quantity: 2, price: 7_500 },
					],
				},
				{
					_id: "invoice-3",
					invoiceNumber: "INV-2026-0003",
					customerName: "Other Client",
					currency: "NGN",
					issueDate: "2026-06-01",
					dueDate: "2026-06-10",
					paymentAmount: 300_000,
					compliance: {
						buyer: { email: "finance@other.test" },
						netPayable: 300_000,
					},
					lineItems: [{ name: "Ignored", quantity: 1, price: 300_000 }],
				},
			],
		});

		expect(result.invoiceCount).toBe(2);
		expect(result.primaryCurrency.totalRevenue).toBe(322_500);
		expect(result.primaryCurrency.outstandingBalance).toBe(165_000);
		expect(result.primaryCurrency.paidRevenue).toBe(157_500);
		expect(result.primaryCurrency.averageInvoiceValue).toBe(161_250);
		expect(result.primaryCurrency.paidInvoiceCount).toBe(1);
		expect(result.primaryCurrency.overdueInvoiceCount).toBe(1);
		expect(result.averagePaymentDelayDays).toBe(5);
		expect(result.topProducts[0]).toMatchObject({
			name: "Support retainer",
			quantity: 2,
			invoiceCount: 2,
		});
		expect(
			result.recentInvoices.map((invoice) => invoice.invoiceNumber),
		).toEqual(["INV-2026-0002", "INV-2026-0001"]);
	});

	it("falls back to exact normalized customer name when invoice email is absent", () => {
		const result = buildClientIntelligence({
			client: {
				name: "North Studio",
				email: "accounts@north.test",
				currency: "NGN",
			},
			invoices: [
				{
					invoiceNumber: "INV-2026-0010",
					customerName: " north   studio ",
					currency: "NGN",
					issueDate: "2026-06-01",
					dueDate: "2026-06-14",
					paymentAmount: 0,
					lineItems: [{ name: "Design", quantity: 1, price: 75_000 }],
				},
			],
		});

		expect(result.invoiceCount).toBe(1);
		expect(result.primaryCurrency.totalRevenue).toBe(75_000);
	});
});
