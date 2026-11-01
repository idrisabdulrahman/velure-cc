import { describe, expect, it } from "vitest";
import { NRS_INFORMATIONAL_DISCLAIMER } from "../../features/compliance/nigeria";
import {
	buildInvoiceExportContent,
	type ComplianceExportInvoiceRow,
	type ComplianceExportMeta,
} from "./compliance-export";

/**
 * T10 step 2 — provisional TaxPro Max-shaped VAT sales schedule
 * (docs/EXPORT-FORMATS.md).
 *
 * One row per invoice. The buyer TIN prints the literal `0` when it is
 * unknown; a valid 10-12 digit TIN passes through. Taxable/VAT come from the
 * stored snapshot with the calculator's discount rule, so
 * `taxableAmount + vatAmount = totalAmount` in every mode.
 */

const BASE: ComplianceExportInvoiceRow = {
	invoice_number: "INV-2026-0001",
	customer_name: "Adaeze Foods Ltd",
	currency: "NGN",
	payment_amount: 0,
	status: "sent",
	issue_date: "2026-01-01",
	due_date: "2026-01-10",
};

const TWO_LINE = [
	{ name: "Goods A", quantity: 2, price: 300 },
	{ name: "Goods B", quantity: 1, price: 400 },
];

const EXCLUSIVE = {
	taxTreatment: "exclusive_rate",
	subtotal: 1000,
	totalTax: 75,
	grandTotal: 1075,
	withholdingTaxAmount: 50,
	netPayable: 1025,
};

/** Column indices of the VAT schedule (see EXPORT-FORMATS.md). */
const COL = {
	supplierTin: 0,
	customerTin: 1,
	customerName: 2,
	invoiceNumber: 3,
	invoiceDate: 4,
	description: 5,
	taxableAmount: 6,
	vatAmount: 7,
	totalAmount: 8,
	documentType: 9,
	currency: 10,
} as const;

function rows(content: string): Array<Array<string | number>> {
	// Every data cell is JSON-stringified, so wrapping the line in brackets
	// parses it back to the cell array.
	return content
		.split("\n")
		.slice(2)
		.map((line) => JSON.parse(`[${line}]`) as Array<string | number | null>)
		.map((cells) => cells.map((cell) => cell ?? ""));
}

function vatCsv(
	invoices: ComplianceExportInvoiceRow[],
	meta: ComplianceExportMeta = {},
): Array<Array<string | number>> {
	return rows(
		buildInvoiceExportContent("vat_sales_schedule_csv", invoices, 0, meta),
	);
}

const HEADERS =
	"supplierTin,customerTin,customerName,invoiceNumber,invoiceDate,description,taxableAmount,vatAmount,totalAmount,documentType,currency";

describe("VAT sales schedule layout", () => {
	it("leads with the disclaimer and the header row", () => {
		const content = buildInvoiceExportContent(
			"vat_sales_schedule_csv",
			[{ ...BASE, line_items: TWO_LINE, compliance: EXCLUSIVE }],
			0,
		);
		const lines = content.split("\n");
		expect(lines[0]).toBe(JSON.stringify(NRS_INFORMATIONAL_DISCLAIMER));
		expect(lines[1]).toBe(HEADERS);
		expect(lines).toHaveLength(3); // disclaimer + header + one invoice row
	});

	it("emits one row per invoice", () => {
		const data = vatCsv([
			{ ...BASE, line_items: TWO_LINE, compliance: EXCLUSIVE },
			{
				...BASE,
				invoice_number: "INV-2026-0002",
				line_items: TWO_LINE,
				compliance: EXCLUSIVE,
			},
		]);
		expect(data).toHaveLength(2);
		expect(data[0][COL.invoiceNumber]).toBe("INV-2026-0001");
		expect(data[1][COL.invoiceNumber]).toBe("INV-2026-0002");
	});
});

describe("VAT sales schedule buyer TIN (unknown → 0)", () => {
	it("prints 0 when the buyer TIN is missing", () => {
		const data = vatCsv([
			{ ...BASE, line_items: TWO_LINE, compliance: EXCLUSIVE },
		]);
		expect(data[0][COL.customerTin]).toBe("0");
	});

	it("prints 0 for a blank or malformed TIN", () => {
		for (const customer_tin of ["", "   ", "123", "not-a-tin"]) {
			const data = vatCsv([
				{
					...BASE,
					customer_tin,
					line_items: TWO_LINE,
					compliance: EXCLUSIVE,
				},
			]);
			expect(data[0][COL.customerTin], customer_tin).toBe("0");
		}
	});

	it("prints 0 for a placeholder or all-same-digit TIN", () => {
		for (const customer_tin of [
			"1234567890",
			"0123456789",
			"9876543210",
			"1111111111",
			"000000000000",
		]) {
			const data = vatCsv([
				{
					...BASE,
					customer_tin,
					line_items: TWO_LINE,
					compliance: EXCLUSIVE,
				},
			]);
			expect(data[0][COL.customerTin], customer_tin).toBe("0");
		}
	});

	it("passes a valid 10-12 digit buyer TIN through unchanged", () => {
		for (const tin of ["2345678901", "23456789012", "234567890123"]) {
			const data = vatCsv([
				{
					...BASE,
					customer_tin: tin,
					line_items: TWO_LINE,
					compliance: EXCLUSIVE,
				},
			]);
			expect(data[0][COL.customerTin], tin).toBe(tin);
		}
	});

	it("prints 0 for the seller TIN unless a valid one is supplied", () => {
		const noMeta = vatCsv([
			{ ...BASE, line_items: TWO_LINE, compliance: EXCLUSIVE },
		]);
		expect(noMeta[0][COL.supplierTin]).toBe("0");

		const placeholder = vatCsv(
			[{ ...BASE, line_items: TWO_LINE, compliance: EXCLUSIVE }],
			{ sellerTin: "1234567890" },
		);
		expect(placeholder[0][COL.supplierTin]).toBe("0");

		const valid = vatCsv(
			[{ ...BASE, line_items: TWO_LINE, compliance: EXCLUSIVE }],
			{ sellerTin: "2345678901" },
		);
		expect(valid[0][COL.supplierTin]).toBe("2345678901");
	});
});

describe("VAT sales schedule taxable/VAT identity", () => {
	/** `taxable + vat = total`, in kobo, for one invoice. */
	function expectIdentity(data: Array<Array<string | number>>, index = 0) {
		const taxable = Number(data[index][COL.taxableAmount]) * 100;
		const vat = Number(data[index][COL.vatAmount]) * 100;
		const total = Number(data[index][COL.totalAmount]) * 100;
		expect(taxable + vat).toBe(total);
		return { taxable, vat, total };
	}

	it("reconciles an exclusive invoice with no discount", () => {
		const data = vatCsv([
			{ ...BASE, line_items: TWO_LINE, compliance: EXCLUSIVE },
		]);
		const { taxable, vat, total } = expectIdentity(data);
		expect(taxable).toBe(100_000);
		expect(vat).toBe(7_500);
		expect(total).toBe(107_500);
	});

	it("extracts VAT from inclusive prices", () => {
		const data = vatCsv([
			{
				...BASE,
				line_items: TWO_LINE,
				compliance: {
					taxTreatment: "inclusive_rate",
					subtotal: 1000,
					totalTax: 75,
					grandTotal: 1000,
					withholdingTaxAmount: 50,
					netPayable: 950,
				},
			},
		]);
		const { taxable, vat, total } = expectIdentity(data);
		expect(taxable).toBe(92_500);
		expect(vat).toBe(7_500);
		expect(total).toBe(100_000);
	});

	it("reduces the taxable base for a before-tax discount", () => {
		const data = vatCsv([
			{
				...BASE,
				line_items: TWO_LINE,
				template_settings: {
					includeDiscount: true,
					discount: 100,
					discountMode: "invoice_before_tax",
				},
				compliance: {
					...EXCLUSIVE,
					totalTax: 67.5,
					grandTotal: 967.5,
					netPayable: 917.5,
				},
			},
		]);
		const { taxable, vat, total } = expectIdentity(data);
		expect(taxable).toBe(90_000);
		expect(vat).toBe(6_750);
		expect(total).toBe(96_750);
	});

	it("does NOT reduce the taxable base for an after-tax discount", () => {
		const data = vatCsv([
			{
				...BASE,
				line_items: TWO_LINE,
				template_settings: {
					includeDiscount: true,
					discount: 100,
					discountMode: "invoice_after_tax",
				},
				compliance: { ...EXCLUSIVE, grandTotal: 975, netPayable: 975 },
			},
		]);
		const { taxable, vat, total } = expectIdentity(data);
		// Pre-discount VAT-able total; the commercial discount is post-tax.
		expect(taxable).toBe(100_000);
		expect(vat).toBe(7_500);
		expect(total).toBe(107_500);
	});

	it("reduces the taxable base for per-line discounts", () => {
		const data = vatCsv([
			{
				...BASE,
				line_items: [
					{ name: "Goods A", quantity: 2, price: 300, discount: 50 },
					{ name: "Goods B", quantity: 1, price: 400, discount: 30 },
				],
				compliance: {
					taxTreatment: "exclusive_rate",
					subtotal: 1000,
					totalTax: 69,
					grandTotal: 989,
					withholdingTaxAmount: 0,
					netPayable: 989,
				},
			},
		]);
		const { taxable, vat, total } = expectIdentity(data);
		expect(taxable).toBe(92_000);
		expect(vat).toBe(6_900);
		expect(total).toBe(98_900);
	});

	it("keeps the stored VAT total, never re-deriving it from a guessed rate", () => {
		const data = vatCsv([
			{
				...BASE,
				line_items: TWO_LINE,
				compliance: { ...EXCLUSIVE, totalTax: 74.99 },
			},
		]);
		expect(Number(data[0][COL.vatAmount])).toBe(74.99);
	});
});

describe("VAT sales schedule sign, legacy and safety", () => {
	it("negates every money column of a credit note but not the text", () => {
		const data = vatCsv([
			{
				...BASE,
				document_type: "credit_note",
				customer_tin: "2345678901",
				line_items: TWO_LINE,
				compliance: EXCLUSIVE,
			},
		]);
		expect(Number(data[0][COL.taxableAmount])).toBe(-1000);
		expect(Number(data[0][COL.vatAmount])).toBe(-75);
		expect(Number(data[0][COL.totalAmount])).toBe(-1075);
		expect(data[0][COL.customerName]).toBe("Adaeze Foods Ltd");
		expect(data[0][COL.customerTin]).toBe("2345678901");
	});

	it("uses a synthetic description when no line items are stored", () => {
		const data = vatCsv([{ ...BASE, payment_amount: 500, compliance: {} }]);
		expect(data[0][COL.description]).toBe("(no line items recorded)");
		expect(Number(data[0][COL.taxableAmount])).toBe(500);
		expect(Number(data[0][COL.vatAmount])).toBe(0);
		expect(Number(data[0][COL.totalAmount])).toBe(500);
	});

	it("neutralises a formula lead in the description", () => {
		const data = vatCsv([
			{
				...BASE,
				line_items: [
					{
						name: '=HYPERLINK("https://evil","click")',
						quantity: 1,
						price: 10,
					},
				],
				compliance: EXCLUSIVE,
			},
		]);
		expect(data[0][COL.description]).toBe(
			'\'=HYPERLINK("https://evil","click")',
		);
	});

	it("aborts rather than writing an unsafe kobo value", () => {
		expect(() =>
			buildInvoiceExportContent(
				"vat_sales_schedule_csv",
				[
					{
						...BASE,
						line_items: TWO_LINE,
						compliance: { subtotal: Number("1e17") },
					},
				],
				0,
			),
		).toThrow(/safe minor-unit range/);
	});
});
