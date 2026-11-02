import { describe, expect, it } from "vitest";
import { NRS_INFORMATIONAL_DISCLAIMER } from "../../features/compliance/nigeria";
import {
	REV360_VAT_STATUS_CONFIG,
	rev360VatStatusFor,
} from "../../features/compliance/rev360-vat-status";
import {
	buildInvoiceExportArtifact,
	buildInvoiceExportContent,
	type ComplianceExportInvoiceRow,
} from "./compliance-export";

/**
 * T10 step 2 correction (2026-11-01) — Rev360 VAT sales schedule
 * (docs/EXPORT-FORMATS.md).
 *
 * NRS retired TaxPro Max; the Rev360 VAT sales schedule is a six-field XLSX
 * with one row per invoice LINE:
 *   beneficiary_name, beneficiary_tin, item, item_cost, item_description,
 *   vat_status
 * The buyer TIN prints the literal `0` when it is unknown. The status labels
 * come from `REV360_VAT_STATUS_CONFIG` (config, not hardcoded) and the layout
 * is labelled unverified in the file itself.
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

/** Column indices of the Rev360 schedule (see EXPORT-FORMATS.md). */
const COL = {
	beneficiaryName: 0,
	beneficiaryTin: 1,
	item: 2,
	itemCost: 3,
	itemDescription: 4,
	vatStatus: 5,
} as const;

const HEADERS = [
	"beneficiary_name",
	"beneficiary_tin",
	"item",
	"item_cost",
	"item_description",
	"vat_status",
];

type Grid = Array<Array<string | number>>;

async function vatGrid(invoices: ComplianceExportInvoiceRow[]): Promise<Grid> {
	const base64 = await buildInvoiceExportArtifact(
		"vat_sales_schedule_xlsx",
		invoices,
		0,
	);
	const XLSX = await import("xlsx");
	const workbook = XLSX.read(base64, { type: "base64" });
	const sheet = workbook.Sheets["VAT sales schedule"];
	expect(sheet).toBeDefined();
	const grid = XLSX.utils.sheet_to_json<Array<string | number | null>>(
		sheet ?? workbook.Sheets[workbook.SheetNames[0]],
		{ header: 1, raw: true, blankrows: false, defval: "" },
	);
	return grid.map((row) => row.map((cell) => cell ?? ""));
}

/** Data rows only: drops the disclaimer, the layout note and the header. */
async function dataRows(invoices: ComplianceExportInvoiceRow[]): Promise<Grid> {
	const grid = await vatGrid(invoices);
	return grid.slice(3);
}

describe("Rev360 VAT sales schedule layout", () => {
	it("leads with the disclaimer, the unverified-layout note and the header", async () => {
		const grid = await vatGrid([
			{ ...BASE, line_items: TWO_LINE, compliance: EXCLUSIVE },
		]);
		expect(grid[0][0]).toBe(NRS_INFORMATIONAL_DISCLAIMER);
		expect(String(grid[1][0])).toMatch(/unverified layout/i);
		expect(String(grid[1][0])).toMatch(
			/verify against your rev360 vat sales-schedule template/i,
		);
		expect(grid[2]).toEqual(HEADERS);
		expect(grid).toHaveLength(5); // note + disclaimer + header + two lines
	});

	it("emits one row per invoice line", async () => {
		const grid = await dataRows([
			{ ...BASE, line_items: TWO_LINE, compliance: EXCLUSIVE },
		]);
		expect(grid).toHaveLength(2);
		expect(grid[0][COL.item]).toBe("Goods A");
		expect(grid[1][COL.item]).toBe("Goods B");
	});

	it("is rejected by the sync builder and must use the async artifact", () => {
		expect(() =>
			buildInvoiceExportContent("vat_sales_schedule_xlsx", [{ ...BASE }], 0),
		).toThrow(/vat_sales_schedule_xlsx/);
	});
});

describe("Rev360 VAT sales schedule buyer TIN (unknown -> 0)", () => {
	it("prints 0 when the buyer TIN is missing or the invoice is unlinked", async () => {
		const grid = await dataRows([
			{ ...BASE, line_items: TWO_LINE, compliance: EXCLUSIVE },
		]);
		expect(grid[0][COL.beneficiaryTin]).toBe("0");
		expect(grid[1][COL.beneficiaryTin]).toBe("0");
	});

	it("prints 0 for a blank or malformed TIN", async () => {
		for (const customer_tin of ["", "   ", "123", "not-a-tin"]) {
			const grid = await dataRows([
				{
					...BASE,
					customer_tin,
					line_items: TWO_LINE,
					compliance: EXCLUSIVE,
				},
			]);
			expect(grid[0][COL.beneficiaryTin], customer_tin).toBe("0");
		}
	});

	it("prints 0 for a placeholder or all-same-digit TIN", async () => {
		for (const customer_tin of [
			"1234567890",
			"0123456789",
			"9876543210",
			"1111111111",
			"000000000000",
		]) {
			const grid = await dataRows([
				{
					...BASE,
					customer_tin,
					line_items: TWO_LINE,
					compliance: EXCLUSIVE,
				},
			]);
			expect(grid[0][COL.beneficiaryTin], customer_tin).toBe("0");
		}
	});

	it("passes a valid 10-12 digit buyer TIN through unchanged", async () => {
		for (const tin of ["2345678901", "23456789012", "234567890123"]) {
			const grid = await dataRows([
				{
					...BASE,
					customer_tin: tin,
					line_items: TWO_LINE,
					compliance: EXCLUSIVE,
				},
			]);
			expect(grid[0][COL.beneficiaryTin], tin).toBe(tin);
		}
	});
});

describe("Rev360 VAT sales schedule values", () => {
	it("carries the beneficiary name, item label and extended line cost", async () => {
		const grid = await dataRows([
			{ ...BASE, line_items: TWO_LINE, compliance: EXCLUSIVE },
		]);
		expect(grid[0][COL.beneficiaryName]).toBe("Adaeze Foods Ltd");
		expect(grid[0][COL.item]).toBe("Goods A");
		expect(grid[0][COL.itemDescription]).toBe("Goods A");
		// Money stays numeric for spreadsheet arithmetic: 2 x 300 = 600.
		expect(grid[0][COL.itemCost]).toBe(600);
		expect(grid[1][COL.itemCost]).toBe(400);
	});

	it("maps each line's VAT category through the config table", async () => {
		const grid = await dataRows([
			{
				...BASE,
				line_items: [
					{ name: "Std", quantity: 1, price: 100, vatCategory: "standard" },
					{
						name: "Zero",
						quantity: 1,
						price: 100,
						vatCategory: "zero_rated",
					},
					{ name: "Ex", quantity: 1, price: 100, vatCategory: "exempt" },
				],
				compliance: EXCLUSIVE,
			},
		]);
		expect(grid[0][COL.vatStatus]).toBe(REV360_VAT_STATUS_CONFIG.standard);
		expect(grid[1][COL.vatStatus]).toBe(REV360_VAT_STATUS_CONFIG.zero_rated);
		expect(grid[2][COL.vatStatus]).toBe(REV360_VAT_STATUS_CONFIG.exempt);
	});

	it("defaults a missing vat category to the standard status", async () => {
		const grid = await dataRows([
			{
				...BASE,
				line_items: [{ name: "Goods A", quantity: 1, price: 100 }],
				compliance: EXCLUSIVE,
			},
		]);
		expect(grid[0][COL.vatStatus]).toBe(rev360VatStatusFor("standard"));
	});
});

describe("Rev360 VAT sales schedule sign, legacy and safety", () => {
	it("negates item_cost for a credit note but never the text", async () => {
		const grid = await dataRows([
			{
				...BASE,
				document_type: "credit_note",
				line_items: TWO_LINE,
				compliance: EXCLUSIVE,
			},
		]);
		expect(grid[0][COL.itemCost]).toBe(-600);
		expect(grid[1][COL.itemCost]).toBe(-400);
		expect(grid[0][COL.beneficiaryName]).toBe("Adaeze Foods Ltd");
		expect(grid[0][COL.item]).toBe("Goods A");
	});

	it("uses a synthetic line when no line items are stored", async () => {
		const grid = await dataRows([
			{ ...BASE, payment_amount: 500, compliance: {} },
		]);
		expect(grid).toHaveLength(1);
		expect(grid[0][COL.item]).toBe("(no line items recorded)");
		expect(grid[0][COL.itemCost]).toBe(500);
	});

	it("neutralises a formula lead in item and beneficiary text", async () => {
		const grid = await dataRows([
			{
				...BASE,
				customer_name: "=cmd()",
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
		expect(grid[0][COL.beneficiaryName]).toBe("'=cmd()");
		expect(grid[0][COL.item]).toBe('\'=HYPERLINK("https://evil","click")');
	});

	it("aborts rather than writing an unsafe kobo value", async () => {
		await expect(
			buildInvoiceExportArtifact(
				"vat_sales_schedule_xlsx",
				[
					{
						...BASE,
						payment_amount: 0,
						compliance: { subtotal: Number("1e17") },
					},
				],
				0,
			),
		).rejects.toThrow(/safe minor-unit range/);
	});
});
