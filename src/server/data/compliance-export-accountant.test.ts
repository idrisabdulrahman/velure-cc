import { describe, expect, it } from "vitest";
import { NRS_INFORMATIONAL_DISCLAIMER } from "../../features/compliance/nigeria";
import {
	buildInvoiceExportArtifact,
	buildInvoiceExportContent,
	type ComplianceExportInvoiceRow,
} from "./compliance-export";

/**
 * T10 step 1 — accountant line export (docs/EXPORT-FORMATS.md).
 *
 * The pinned identities, in kobo, for EVERY stored invoice: Σ lineGross =
 * invoiceSubtotal, Σ lineDiscount = invoiceDiscount, Σ vat = invoiceVat,
 * Σ(lineNet + vat) = grandTotal. Everything is computed in kobo integer
 * arithmetic; WHT stays invoice-level; credit notes negate all money columns.
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

/** Stored snapshot values are major units; kobo math is ×100 below. */
const EXCLUSIVE = {
	taxTreatment: "exclusive_rate",
	subtotal: 1000,
	totalTax: 75,
	grandTotal: 1075,
	withholdingTaxAmount: 50,
	netPayable: 1025,
};

function rows(content: string): string[][] {
	// Every data cell is JSON-stringified or a bare number, so wrapping the
	// line in brackets parses it.
	const lines = content.split("\n");
	return lines
		.slice(2)
		.map((line) =>
			(JSON.parse(`[${line}]`) as Array<string | number | null>).map((cell) =>
				String(cell ?? ""),
			),
		);
}

function accountantCsv(rowsData: ComplianceExportInvoiceRow[]): string[][] {
	return rows(buildInvoiceExportContent("accountant_lines_csv", rowsData, 0));
}

/** Kobo sums of every money column (×100 from the naira decimals). */
function sums(data: string[][]): Record<string, number> {
	const sum = (index: number) =>
		data.reduce((total, row) => total + Number(row[index]), 0);
	return {
		gross: sum(11),
		discount: sum(12),
		vat: sum(13),
		net: sum(14),
		netPlusVat: sum(14) + sum(13),
		subtotal: Number(data[0][17]),
		invoiceDiscount: Number(data[0][18]),
		invoiceVat: Number(data[0][19]),
		wht: Number(data[0][20]),
		payable: Number(data[0][21]),
	};
}

const HEADERS =
	"invoiceNumber,customerName,documentType,currency,status,issueDate,dueDate,lineDescription,quantity,unit,unitPrice,lineGross,lineDiscount,vat,lineNet,vatCategory,classificationCode,invoiceSubtotal,invoiceDiscount,invoiceVat,invoiceWht,invoiceNetPayable";

describe("accountant line export layout", () => {
	it("leads with the disclaimer and the header row", () => {
		const content = buildInvoiceExportContent(
			"accountant_lines_csv",
			[{ ...BASE, line_items: TWO_LINE, compliance: EXCLUSIVE }],
			0,
		);
		const lines = content.split("\n");
		expect(lines[0]).toBe(JSON.stringify(NRS_INFORMATIONAL_DISCLAIMER));
		expect(lines[1]).toBe(HEADERS);
		expect(lines).toHaveLength(4);
	});

	it("emits one row per line with repeating keys and first-row money", () => {
		const data = accountantCsv([
			{ ...BASE, line_items: TWO_LINE, compliance: EXCLUSIVE },
		]);
		expect(data).toHaveLength(2);
		expect(data[0][0]).toBe("INV-2026-0001");
		expect(data[1][0]).toBe("INV-2026-0001");
		expect(data[1][7]).toBe("Goods B");
		// Invoice-level columns only on the first row of the group.
		for (const index of [17, 18, 19, 20, 21]) {
			expect(data[0][index]).not.toBe("");
			expect(data[1][index]).toBe("");
		}
		expect(data[0][17]).toBe("1000");
		expect(data[0][20]).toBe("50");
		expect(data[0][21]).toBe("1025");
	});

	it("matches the documented column names", () => {
		const content = buildInvoiceExportContent(
			"accountant_lines_csv",
			[{ ...BASE, line_items: TWO_LINE, compliance: EXCLUSIVE }],
			0,
		);
		expect(content.split("\n")[1]).toBe(HEADERS);
	});
});

describe("accountant line export reconciliation (the pinned identities)", () => {
	it("reconciles an exclusive invoice with no discount", () => {
		const data = accountantCsv([
			{ ...BASE, line_items: TWO_LINE, compliance: EXCLUSIVE },
		]);
		const s = sums(data);
		// kobo identities, ×100 from the stored major units
		expect(s.gross * 100).toBe(100_000);
		expect(s.discount * 100).toBe(0);
		expect(s.vat * 100).toBe(7_500);
		expect(s.netPlusVat * 100).toBe(107_500);
		// net = gross (exclusive); WHT only at invoice level
		expect(s.net * 100).toBe(100_000);
		expect(s.payable * 100).toBe(102_500);
	});

	it("reconciles an after-tax discount in exclusive mode", () => {
		const data = accountantCsv([
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
		const s = sums(data);
		expect(s.discount * 100).toBe(10_000);
		expect(s.vat * 100).toBe(7_500);
		expect(s.netPlusVat * 100).toBe(97_500);
	});

	it("reconciles a before-tax discount in exclusive mode", () => {
		const data = accountantCsv([
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
		const s = sums(data);
		expect(s.discount * 100).toBe(10_000);
		expect(s.vat * 100).toBe(6_750);
		expect(s.netPlusVat * 100).toBe(96_750);
		expect(s.payable * 100).toBe(91_750);
	});

	it("reconciles inclusive pricing (VAT sits inside the prices)", () => {
		const data = accountantCsv([
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
		const s = sums(data);
		expect(s.vat * 100).toBe(7_500);
		// net = gross − vat: Σ(net + vat) = stored grand total
		expect(s.netPlusVat * 100).toBe(100_000);
	});

	it("reconciles per-line discounts", () => {
		const data = accountantCsv([
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
		const s = sums(data);
		expect(s.discount * 100).toBe(8_000);
		expect(s.vat * 100).toBe(6_900);
		expect(s.netPlusVat * 100).toBe(98_900);
	});

	it("allocates by the largest remainder and never loses a unit", () => {
		// ₦33.33 discount over 600/400 gross: shares 2000/1333 kobo.
		const data = accountantCsv([
			{
				...BASE,
				line_items: TWO_LINE,
				template_settings: {
					includeDiscount: true,
					discount: 33.33,
					discountMode: "invoice_after_tax",
				},
				compliance: { ...EXCLUSIVE, grandTotal: 1075 - 33.33 },
			},
		]);
		expect(Number(data[0][12]) * 100).toBe(2_000);
		expect(Number(data[1][12]) * 100).toBe(1_333);
	});

	it("weights VAT over standard lines only; zero_rated/exempt take none", () => {
		const data = accountantCsv([
			{
				...BASE,
				line_items: [
					{ name: "Goods A", quantity: 1, price: 500 },
					{ name: "Books", quantity: 1, price: 500, vatCategory: "zero_rated" },
				],
				compliance: { ...EXCLUSIVE },
			},
		]);
		expect(Number(data[0][13]) * 100).toBe(7_500);
		expect(Number(data[1][13]) * 100).toBe(0);
	});

	it("keeps the whole VAT on the last line when no standard line exists", () => {
		const data = accountantCsv([
			{
				...BASE,
				line_items: [
					{
						name: "Books",
						quantity: 1,
						price: 1000,
						vatCategory: "exempt",
					},
				],
				compliance: EXCLUSIVE,
			},
		]);
		expect(Number(data[0][13]) * 100).toBe(7_500);
	});

	it("infers inclusive pricing for legacy rows without a treatment", () => {
		// grandTotal === subtotal − discount(0) while VAT > 0 → inclusive.
		const data = accountantCsv([
			{
				...BASE,
				line_items: TWO_LINE,
				compliance: {
					subtotal: 1064,
					totalTax: 74,
					grandTotal: 1064,
					withholdingTaxAmount: 0,
				},
			},
		]);
		const s = sums(data);
		expect(s.netPlusVat * 100).toBe(106_400);
		// net = gross − vat, not gross
		expect(s.net * 100).toBe(99_000);
	});
});

describe("accountant line export legacy and credit notes", () => {
	it("absorbs a legacy line-sum residual on the last line", () => {
		const data = accountantCsv([
			{
				...BASE,
				line_items: [
					{ name: "Goods A", quantity: 2, price: 300 },
					{ name: "Goods B", quantity: 1, price: 399.75 },
				],
				compliance: EXCLUSIVE, // subtotal 1000 ≠ Σ 999.75
			},
		]);
		// Last line gross absorbs the +0.25-major residual (25 kobo).
		expect(Number(data[1][11])).toBe(400);
		const s = sums(data);
		expect(s.gross * 100).toBe(100_000);
		expect(s.netPlusVat * 100).toBe(107_500);
	});

	it("synthesizes one line row when no line items are stored", () => {
		const data = accountantCsv([
			{ ...BASE, payment_amount: 500, compliance: {} },
		]);
		expect(data).toHaveLength(1);
		expect(data[0][7]).toBe("(no line items recorded)");
		expect(Number(data[0][11]) * 100).toBe(50_000);
		expect(data[0][17]).toBe("500");
		expect(data[0][21]).toBe("500");
	});

	it("degrades a corrupt discount combination instead of aborting", () => {
		// Write-path impossible, but a legacy row may carry both discount kinds.
		const data = accountantCsv([
			{
				...BASE,
				line_items: [...TWO_LINE, { ...TWO_LINE[0], discount: 25 }],
				template_settings: {
					includeDiscount: true,
					discount: 100,
					discountMode: "invoice_before_tax",
				},
				compliance: EXCLUSIVE,
			},
		]);
		const s = sums(data);
		expect(s.gross * 100).toBe(100_000);
		expect(s.discount * 100).toBe(0);
	});

	it("negates every money column of a credit note", () => {
		const data = accountantCsv([
			{
				...BASE,
				document_type: "credit_note",
				line_items: TWO_LINE,
				compliance: EXCLUSIVE,
			},
		]);
		expect(Number(data[0][11])).toBe(-600);
		expect(Number(data[0][13])).toBe(-45);
		expect(Number(data[0][14])).toBe(-600);
		expect(Number(data[0][17])).toBe(-1000);
		expect(Number(data[0][21])).toBe(-1025);
	});

	it("aborts rather than writing an unsafe kobo value", () => {
		expect(() =>
			buildInvoiceExportContent(
				"accountant_lines_csv",
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

	it("neutralises a formula lead in the line description", () => {
		const data = accountantCsv([
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
		expect(data[0][7]).toBe('\'=HYPERLINK("https://evil","click")');
	});
});

describe("accountant line XLSX round-trip", () => {
	it("parses back with the same header, disclaimer and values", async () => {
		const base64 = await buildInvoiceExportArtifact(
			"accountant_lines_xlsx",
			[{ ...BASE, line_items: TWO_LINE, compliance: EXCLUSIVE }],
			0,
		);
		expect(() => atob(base64)).not.toThrow();
		const XLSX = await import("xlsx");
		const workbook = XLSX.read(base64, { type: "base64" });
		const sheet = workbook.Sheets["Invoice lines"];
		expect(sheet).toBeDefined();
		const grid = XLSX.utils.sheet_to_json<Array<string | number | null>>(
			sheet ?? workbook.Sheets[workbook.SheetNames[0]],
			{ header: 1, raw: true, blankrows: false, defval: "" },
		);
		expect(grid[0][0]).toBe(NRS_INFORMATIONAL_DISCLAIMER);
		expect(grid[1]).toEqual(HEADERS.split(","));
		expect(grid[2][7]).toBe("Goods A");
		// Money cells stay numeric for spreadsheet arithmetic.
		expect(grid[2][11]).toBe(600);
		expect(grid[2][13]).toBe(45);
		expect(grid[2][14]).toBe(600);
		expect(grid[2][17]).toBe(1000);
		expect(grid[2][20]).toBe(50);
		expect(grid[2][21]).toBe(1025);
		// Continuation row has empty invoice-level cells.
		expect(grid[3][7]).toBe("Goods B");
		expect(grid[3][17]).toBe("");
		// A formula lead cannot become an executable spreadsheet statement.
		const hostile = await buildInvoiceExportArtifact(
			"accountant_lines_xlsx",
			[
				{
					...BASE,
					line_items: [
						{ name: "=SUM(1+1)", quantity: 1, price: 1 },
						...TWO_LINE,
					],
					compliance: EXCLUSIVE,
				},
			],
			0,
		);
		const wb2 = XLSX.read(hostile, { type: "base64" });
		const grid2 = XLSX.utils.sheet_to_json<Array<string | number | null>>(
			wb2.Sheets["Invoice lines"],
			{ header: 1, raw: true, blankrows: false, defval: "" },
		);
		expect(grid2[2][7]).toBe("'=SUM(1+1)");
	});
});
