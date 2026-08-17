import { describe, expect, it } from "vitest";
import { mergeDocBlocks, toEditorDoc, toMiddayInvoice } from "./midday-adapter";
import type { InvoiceRecord } from "./types";

function buildInvoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
	return {
		id: "invoice-1",
		token: "public-token",
		invoiceNumber: "INV-2026-0001",
		customerName: "Acme Services Ltd",
		customerPoNumber: "PO-ACME-42",
		currency: "NGN",
		type: "one-time",
		invoiceSize: "A4",
		dateFormat: "ng",
		paymentTermsDays: 14,
		template: "default",
		issueDate: "2026-06-01",
		dueDate: "2026-06-15",
		status: "unpaid",
		total: 107_500,
		balance: 107_500,
		paymentAmount: 0,
		lineItems: [
			{ id: "line-1", name: "Consulting", quantity: 1, price: 100_000 },
		],
		compliance: {
			seller: { legalName: "Velure Ltd", countryCode: "NG" },
			buyer: { legalName: "Acme Services Ltd", countryCode: "NG" },
			sellerTaxStatus: "vat_registered",
			placeOfSupply: "NG",
			taxRuleSetVersion: "test",
			taxTreatment: "exclusive_rate",
			subtotal: 100_000,
			totalTax: 7_500,
			taxLabel: "VAT",
			taxRate: 7.5,
			taxLines: [
				{
					label: "VAT",
					rate: 7.5,
					amount: 7_500,
					treatment: "exclusive_rate",
					jurisdictionCode: "NG",
				},
			],
			templateVariant: "vat_ready",
			withholdingTaxAmount: 0,
			withholdingTaxLabel: "WHT",
			withholdingTaxRate: 0,
			withholdingTaxPreset: "none",
			withholding: {
				mode: "rule_based",
				category: "none",
				recipientEntityType: "corporate",
				recipientResidency: "resident",
				rate: 0,
				amount: 0,
				ruleVersion: "test",
				manualOverride: false,
			},
			grandTotal: 107_500,
			netPayable: 107_500,
			warnings: [],
		},
		createdAt: Date.parse("2026-06-01T00:00:00.000Z"),
		updatedAt: Date.parse("2026-06-01T00:00:00.000Z"),
		...overrides,
	};
}

describe("toMiddayInvoice", () => {
	it("uses persisted template labels, units, discount, and QR preferences", () => {
		const invoice = toMiddayInvoice(
			buildInvoice({
				lineItems: [
					{
						id: "line-1",
						name: "Hosting",
						quantity: 1,
						price: 100,
						unit: "month",
					},
				],
				templateSettings: {
					title: "Tax Invoice",
					descriptionLabel: "Service",
					includeUnits: true,
					includeDiscount: true,
					includeQr: true,
					discount: 10,
				},
			}),
		);

		expect(invoice.template.title).toBe("Tax Invoice");
		expect(invoice.template.descriptionLabel).toBe("Service");
		expect(invoice.template.includeUnits).toBe(true);
		expect(invoice.template.includeQr).toBe(true);
		expect(invoice.discount).toBe(10);
		expect(invoice.lineItems[0]?.unit).toBe("month");
	});

	it("passes inline top and bottom blocks to both renderers", () => {
		const topBlock = toEditorDoc("Project overview");
		const bottomBlock = toEditorDoc("Payment is due as agreed");
		const invoice = toMiddayInvoice(
			buildInvoice({
				topBlock: topBlock ?? undefined,
				bottomBlock: bottomBlock ?? undefined,
			}),
		);
		expect(invoice.topBlock).toEqual(topBlock);
		expect(invoice.bottomBlock).toEqual(bottomBlock);
	});
	it("passes customer PO numbers through to invoice templates", () => {
		expect(toMiddayInvoice(buildInvoice()).customerPoNumber).toBe("PO-ACME-42");
	});

	it("uses null when an invoice is not backed by a customer PO", () => {
		expect(
			toMiddayInvoice(buildInvoice({ customerPoNumber: undefined }))
				.customerPoNumber,
		).toBeNull();
	});

	it("preserves the rounded Nigerian compliance grand total", () => {
		const baseCompliance = buildInvoice().compliance;
		if (!baseCompliance) throw new Error("Expected compliance fixture.");
		const invoice = buildInvoice({
			lineItems: [{ id: "line-1", name: "Decimal", quantity: 1, price: 0.1 }],
			compliance: {
				...baseCompliance,
				subtotal: 0.1,
				totalTax: 0.01,
				grandTotal: 0.11,
				netPayable: 0.11,
			},
		});

		expect(toMiddayInvoice(invoice).amount).toBe(0.11);
	});
});

describe("toEditorDoc", () => {
	it("coerces a legacy string into a single paragraph doc", () => {
		expect(toEditorDoc("Hello")).toEqual({
			type: "doc",
			content: [
				{ type: "paragraph", content: [{ type: "text", text: "Hello" }] },
			],
		});
	});

	it("returns null for an empty legacy string", () => {
		expect(toEditorDoc("")).toBeNull();
		expect(toEditorDoc(undefined)).toBeNull();
	});

	it("passes editor docs through unchanged", () => {
		const doc = {
			type: "doc" as const,
			content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }],
		};
		expect(toEditorDoc(doc)).toBe(doc);
	});
});

describe("mergeDocBlocks", () => {
	const paragraph = (text: string) => ({
		type: "doc" as const,
		content: [{ type: "paragraph", content: [{ type: "text", text }] }],
	});

	it("merges blocks from each doc in order", () => {
		const doc = mergeDocBlocks([paragraph("a"), paragraph("b")]);
		expect(doc?.type).toBe("doc");
		expect(doc?.content).toHaveLength(2);
		expect(doc?.content?.[1]).toMatchObject({
			content: [{ type: "text", text: "b" }],
		});
	});

	it("returns null when there are no blocks", () => {
		expect(
			mergeDocBlocks([null, { type: "doc" as const, content: [] }, undefined]),
		).toBeNull();
	});
});
