import { describe, expect, it } from "vitest";
import {
	buildProductIntelligence,
	buildProductSuggestions,
} from "./productIntelligence";

const products = [
	{
		_id: "retainer",
		type: "service" as const,
		name: "Monthly retainer",
		defaultUnitPrice: 150_000,
		isActive: true,
	},
	{
		_id: "audit",
		type: "service" as const,
		name: "Compliance audit",
		defaultUnitPrice: 250_000,
		isActive: true,
	},
	{
		_id: "hosting",
		type: "service" as const,
		name: "Managed hosting",
		defaultUnitPrice: 45_000,
		isActive: true,
	},
];

describe("product intelligence", () => {
	it("aggregates product revenue, usage, clients, and co-sold products", () => {
		const result = buildProductIntelligence({
			products,
			now: new Date("2026-06-23T00:00:00.000Z"),
			invoices: [
				{
					_id: "inv-1",
					invoiceNumber: "INV-1",
					customerName: "Acme Ltd",
					currency: "NGN",
					issueDate: "2026-06-01",
					lineItems: [
						{
							name: "Monthly retainer",
							quantity: 1,
							price: 150_000,
							productId: "retainer",
						},
						{
							name: "Managed hosting",
							quantity: 2,
							price: 45_000,
							productId: "hosting",
						},
					],
				},
				{
					_id: "inv-2",
					invoiceNumber: "INV-2",
					customerName: "North Studio",
					currency: "NGN",
					issueDate: "2026-05-01",
					lineItems: [
						{
							name: "Monthly retainer",
							quantity: 2,
							price: 140_000,
							productId: "retainer",
						},
					],
				},
				{
					_id: "inv-canceled",
					invoiceNumber: "INV-X",
					customerName: "Canceled Client",
					currency: "NGN",
					issueDate: "2026-06-10",
					status: "canceled",
					lineItems: [
						{
							name: "Compliance audit",
							quantity: 1,
							price: 250_000,
							productId: "audit",
						},
					],
				},
			],
		});

		const retainer = result.products.find(
			(product) => product.productId === "retainer",
		);

		expect(result.summary.totalRevenue).toBe(520_000);
		expect(result.summary.usedProductCount).toBe(2);
		expect(result.summary.repeatClientProductCount).toBe(1);
		expect(retainer).toMatchObject({
			usageCount: 2,
			invoiceCount: 2,
			customerCount: 2,
			quantitySold: 3,
			revenue: 430_000,
			averagePrice: 143_333.33333333334,
			lastInvoiceNumber: "INV-1",
		});
		expect(retainer?.topClients.map((client) => client.customerName)).toEqual([
			"North Studio",
			"Acme Ltd",
		]);
		expect(retainer?.coSoldProducts[0]).toMatchObject({
			productId: "hosting",
			coInvoiceCount: 1,
		});
		expect(
			result.products.find((product) => product.productId === "audit")?.revenue,
		).toBe(0);
	});

	it("counts one product usage per invoice while preserving all line revenue", () => {
		const result = buildProductIntelligence({
			products,
			now: new Date("2026-06-23T00:00:00.000Z"),
			invoices: [
				{
					_id: "inv-split",
					invoiceNumber: "INV-SPLIT",
					customerName: "Acme Ltd",
					currency: "NGN",
					issueDate: "2026-06-01",
					lineItems: [
						{
							name: "Retainer A",
							quantity: 1,
							price: 100_000,
							productId: "retainer",
						},
						{
							name: "Retainer B",
							quantity: 2,
							price: 50_000,
							productId: "retainer",
						},
					],
				},
			],
		});

		expect(
			result.products.find((item) => item.productId === "retainer"),
		).toMatchObject({
			usageCount: 1,
			invoiceCount: 1,
			quantitySold: 3,
			revenue: 200_000,
		});
	});

	it("flags declining products by comparing recent and previous revenue windows", () => {
		const result = buildProductIntelligence({
			products,
			now: new Date("2026-06-23T00:00:00.000Z"),
			invoices: [
				{
					invoiceNumber: "INV-old",
					customerName: "Acme Ltd",
					currency: "NGN",
					issueDate: "2026-02-15",
					lineItems: [
						{
							name: "Compliance audit",
							quantity: 1,
							price: 250_000,
							productId: "audit",
						},
					],
				},
				{
					invoiceNumber: "INV-new",
					customerName: "Acme Ltd",
					currency: "NGN",
					issueDate: "2026-06-01",
					lineItems: [
						{
							name: "Compliance audit",
							quantity: 1,
							price: 50_000,
							productId: "audit",
						},
					],
				},
			],
		});

		expect(
			result.products.find((product) => product.productId === "audit")?.trend,
		).toBe("declining");
		expect(result.summary.decliningProductCount).toBe(1);
	});

	it("prioritizes client repeat suggestions before popular products", () => {
		const intelligence = buildProductIntelligence({
			products,
			now: new Date("2026-06-23T00:00:00.000Z"),
			invoices: [
				{
					invoiceNumber: "INV-1",
					customerName: "Acme Ltd",
					currency: "NGN",
					issueDate: "2026-06-01",
					lineItems: [
						{
							name: "Managed hosting",
							quantity: 1,
							price: 45_000,
							productId: "hosting",
						},
					],
				},
				{
					invoiceNumber: "INV-2",
					customerName: "Other Ltd",
					currency: "NGN",
					issueDate: "2026-06-01",
					lineItems: [
						{
							name: "Monthly retainer",
							quantity: 3,
							price: 150_000,
							productId: "retainer",
						},
					],
				},
			],
		});

		const suggestions = buildProductSuggestions({
			intelligence,
			clientName: " Acme   Ltd ",
			currentProductIds: [],
		});

		expect(suggestions[0]).toMatchObject({
			id: "hosting",
			reason: "client_repeat",
		});
		expect(suggestions[1]).toMatchObject({
			id: "retainer",
			reason: "popular",
		});
	});
});
