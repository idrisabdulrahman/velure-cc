import { describe, expect, it } from "vitest";
import type { FiscalizationSnapshot } from "#/features/compliance/types";
import { calculateTotal } from "#/lib/invoice-document/utils/calculate";
import {
	mergeDocBlocks,
	toEditorDoc,
	toInvoiceDocument,
} from "./invoice-document-adapter";
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
			seller: { legalName: "Invoicly Ltd", countryCode: "NG" },
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

describe("toInvoiceDocument", () => {
	it("uses persisted template labels, units, discount, and QR preferences", () => {
		const invoice = toInvoiceDocument(
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

	it("renders credit and debit notes with distinct document labels", () => {
		for (const [documentType, title] of [
			["credit_note", "Credit note"],
			["debit_note", "Debit note"],
		] as const) {
			const rendered = toInvoiceDocument(buildInvoice({ documentType }));
			expect(rendered.template.title).toBe(title);
			expect(rendered.template.invoiceNoLabel).toBe(`${title} No`);
		}
	});

	it("passes inline top and bottom blocks to both renderers", () => {
		const topBlock = toEditorDoc("Project overview");
		const bottomBlock = toEditorDoc("Payment is due as agreed");
		const invoice = toInvoiceDocument(
			buildInvoice({
				topBlock: topBlock ?? undefined,
				bottomBlock: bottomBlock ?? undefined,
			}),
		);
		expect(invoice.topBlock).toEqual(topBlock);
		expect(invoice.bottomBlock).toEqual(bottomBlock);
	});
	it("passes customer PO numbers through to invoice templates", () => {
		expect(toInvoiceDocument(buildInvoice()).customerPoNumber).toBe(
			"PO-ACME-42",
		);
	});

	it("projects mock IRN and QR payload only from an explicit mock-cleared snapshot", () => {
		const artifacts = {
			status: "mock_cleared",
			provider: "mock",
			environment: "sandbox",
			mock: true,
			mockIrn: "MOCK-IRN-demo-1",
			qrCodePayload: "MOCK-SANDBOX|NOT-NRS-CLEARED|IRN=MOCK-IRN-demo-1",
		} as const;
		expect(
			toInvoiceDocument(buildInvoice({ fiscalization: artifacts }))
				.mockClearance,
		).toEqual({
			irn: artifacts.mockIrn,
			qrPayload: artifacts.qrCodePayload,
		});
		for (const fiscalization of [
			{ ...artifacts, status: "fiscalized", mock: false },
			{ ...artifacts, provider: "other" },
			{ ...artifacts, qrCodePayload: "real-looking-payload" },
		] as FiscalizationSnapshot[]) {
			expect(
				toInvoiceDocument(buildInvoice({ fiscalization })).mockClearance,
			).toBeUndefined();
		}
	});

	it("uses null when an invoice is not backed by a customer PO", () => {
		expect(
			toInvoiceDocument(buildInvoice({ customerPoNumber: undefined }))
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

		expect(toInvoiceDocument(invoice).amount).toBe(0.11);
	});

	it("keeps the rendered total aligned with the stored grand total for each invoice discount mode", () => {
		const baseCompliance = buildInvoice().compliance;
		if (!baseCompliance) throw new Error("Expected compliance fixture.");

		const cases = [
			{ mode: "invoice_before_tax", discount: 20, tax: 6, grand: 86 },
			{ mode: "invoice_after_tax", discount: 20, tax: 7.5, grand: 87.5 },
		] as const;

		for (const { mode, discount, tax, grand } of cases) {
			const invoice = toInvoiceDocument(
				buildInvoice({
					lineItems: [
						{ id: "line-1", name: "Service", quantity: 1, price: 100 },
					],
					compliance: {
						...baseCompliance,
						subtotal: 100,
						totalTax: tax,
						grandTotal: grand,
						netPayable: grand,
					},
					templateSettings: {
						includeDiscount: true,
						discount,
						discountMode: mode,
					},
				}),
			);

			expect(invoice.template.discountMode).toBe(mode);
			expect(invoice.amount).toBe(grand);

			// What the HTML summary computes must equal the stored grand total,
			// which the PDF prints from `amount` and the panel shows as net payable.
			const rendered = calculateTotal({
				lineItems: invoice.lineItems,
				taxRate: invoice.template.taxRate,
				vatRate: invoice.template.vatRate,
				discount: invoice.discount ?? 0,
				discountMode: invoice.template.discountMode,
				includeVat: invoice.template.includeVat,
				includeTax: invoice.template.includeTax,
			});
			expect(rendered.total).toBe(grand);
		}
	});

	it("maps line-level discounts to line mode and sums them for display", () => {
		const baseCompliance = buildInvoice().compliance;
		if (!baseCompliance) throw new Error("Expected compliance fixture.");
		const invoice = toInvoiceDocument(
			buildInvoice({
				lineItems: [
					{ id: "line-1", name: "A", quantity: 1, price: 100, discount: 20 },
				],
				compliance: {
					...baseCompliance,
					subtotal: 100,
					totalTax: 6,
					grandTotal: 86,
					netPayable: 86,
				},
				templateSettings: { includeDiscount: true, discountMode: "line" },
			}),
		);

		expect(invoice.template.discountMode).toBe("line");
		expect(invoice.discount).toBe(20);
		expect(invoice.amount).toBe(86);
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
