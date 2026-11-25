import { describe, expect, it } from "vitest";
import {
	formatAccountingDate,
	ZOHO_INVOICE_HEADERS,
	ZOHO_MAX_FILE_BYTES,
	ZOHO_TAX_NAME_CONFIG,
	zohoVatNameFor,
} from "../../features/compliance/accounting-import";
import { NRS_INFORMATIONAL_DISCLAIMER } from "../../features/compliance/nigeria";
import {
	buildZohoInvoicesExport,
	type ComplianceExportInvoiceRow,
} from "./compliance-export";

/**
 * T10 step 3b (2026-11-02) — Zoho Books invoice import
 * (docs/EXPORT-FORMATS.md; prompts/zoho-invoice-export-2026-11.md).
 *
 * One row per invoice line, first line = the provisional headers exactly (no
 * disclaimer row), dates DD/MM/YYYY, the invoice number repeated on every
 * line. Zoho's wizard maps columns, so the header set is readable rather than a
 * rigid template. Tax Name is a blank-default config table; Tax Amount carries
 * the line VAT. Credit notes, discounted invoices, foreign-currency invoices
 * and rows without a customer are excluded with a returned warning; above
 * 10 MB the export aborts.
 */

const BASE: ComplianceExportInvoiceRow = {
	invoice_number: "INV-2026-0001",
	customer_name: "Adaeze Foods Ltd",
	currency: "NGN",
	payment_amount: 0,
	status: "sent",
	issue_date: "2026-01-05",
	due_date: "2026-01-19",
};

const TWO_LINE = [
	{ name: "Goods A", quantity: 2, price: 300 },
	{ name: "Goods B", quantity: 1, price: 400 },
];

const SNAPSHOT = {
	taxTreatment: "exclusive_rate",
	subtotal: 1000,
	totalTax: 75,
	grandTotal: 1075,
	withholdingTaxAmount: 50,
	netPayable: 1025,
};

/** Column indices of the provisional Zoho invoice columns. */
const COL = {
	invoiceNumber: 0,
	invoiceDate: 1,
	dueDate: 2,
	customerName: 3,
	itemName: 4,
	itemDescription: 5,
	quantity: 6,
	itemPrice: 7,
	itemTotal: 8,
	taxName: 9,
	taxAmount: 10,
} as const;

/** Minimal RFC 4180 reader so a quoted comma/newline cannot fake a column. */
function parseCsv(content: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	for (let index = 0; index < content.length; index += 1) {
		const char = content[index];
		if (quoted) {
			if (char === '"') {
				if (content[index + 1] === '"') {
					cell += '"';
					index += 1;
				} else {
					quoted = false;
				}
			} else {
				cell += char;
			}
			continue;
		}
		if (char === '"') {
			quoted = true;
		} else if (char === ",") {
			row.push(cell);
			cell = "";
		} else if (char === "\n") {
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
		} else if (char !== "\r") {
			cell += char;
		}
	}
	if (cell.length > 0 || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}
	return rows;
}

describe("Zoho Books invoice CSV layout", () => {
	it("starts with the provisional headers exactly and no disclaimer row", () => {
		const { content } = buildZohoInvoicesExport([
			{ ...BASE, line_items: TWO_LINE, compliance: SNAPSHOT },
		]);
		const rows = parseCsv(content);
		expect(rows[0]).toEqual([...ZOHO_INVOICE_HEADERS]);
		expect(rows[0]).toHaveLength(11);
		expect(content).not.toContain(NRS_INFORMATIONAL_DISCLAIMER);
	});

	it("writes one row per line and repeats the invoice keys", () => {
		const { content, invoiceCount, lineCount } = buildZohoInvoicesExport([
			{ ...BASE, line_items: TWO_LINE, compliance: SNAPSHOT },
		]);
		const rows = parseCsv(content);
		expect(rows).toHaveLength(3); // header + two lines
		expect(invoiceCount).toBe(1);
		expect(lineCount).toBe(2);
		for (const row of rows.slice(1)) {
			expect(row[COL.invoiceNumber]).toBe("INV-2026-0001");
			expect(row[COL.customerName]).toBe("Adaeze Foods Ltd");
		}
		expect(rows[1][COL.invoiceDate]).toBe("05/01/2026");
		expect(rows[1][COL.dueDate]).toBe("19/01/2026");
	});

	it("keeps money numeric and consistent (quantity × price = total)", () => {
		const rows = parseCsv(
			buildZohoInvoicesExport([
				{ ...BASE, line_items: TWO_LINE, compliance: SNAPSHOT },
			]).content,
		);
		expect(rows[1][COL.itemName]).toBe("Goods A");
		expect(rows[1][COL.itemDescription]).toBe("Goods A");
		expect(rows[1][COL.quantity]).toBe("2");
		expect(rows[1][COL.itemPrice]).toBe("300");
		expect(rows[1][COL.itemTotal]).toBe("600");
		expect(rows[2][COL.itemName]).toBe("Goods B");
		expect(rows[2][COL.quantity]).toBe("1");
		expect(rows[2][COL.itemPrice]).toBe("400");
		expect(rows[2][COL.itemTotal]).toBe("400");
	});

	it("leaves the tax name blank by default and carries the line VAT", () => {
		expect(ZOHO_TAX_NAME_CONFIG).toEqual({
			standard: "",
			zero_rated: "",
			exempt: "",
		});
		expect(zohoVatNameFor("standard")).toBe("");
		const rows = parseCsv(
			buildZohoInvoicesExport([
				{ ...BASE, line_items: TWO_LINE, compliance: SNAPSHOT },
			]).content,
		);
		expect(rows[1][COL.taxName]).toBe("");
		// 75 tax over a 1000 subtotal, split across the 600/400 lines.
		expect(Number(rows[1][COL.taxAmount])).toBeCloseTo(45, 10);
		expect(Number(rows[2][COL.taxAmount])).toBeCloseTo(30, 10);
	});

	it("warns when a taxable line has no configured tax name", () => {
		const built = buildZohoInvoicesExport([
			{ ...BASE, line_items: TWO_LINE, compliance: SNAPSHOT },
		]);
		expect(built.warnings).toContain(
			"2 taxable lines carry VAT but no Zoho tax name is configured; choose a Tax Name in Zoho's import wizard.",
		);
	});

	it("honours the date-format option and blanks invalid dates", () => {
		expect(formatAccountingDate("2026-01-05", "MM/DD/YYYY")).toBe("01/05/2026");
		expect(formatAccountingDate("2026-01-05T10:30:00Z")).toBe("05/01/2026");
		expect(formatAccountingDate("2026-02-31")).toBe("");
		expect(formatAccountingDate("")).toBe("");
		expect(formatAccountingDate(null)).toBe("");
		const rows = parseCsv(
			buildZohoInvoicesExport(
				[{ ...BASE, line_items: TWO_LINE, compliance: SNAPSHOT }],
				{ dateFormat: "MM/DD/YYYY" },
			).content,
		);
		expect(rows[1][COL.invoiceDate]).toBe("01/05/2026");
	});
});

describe("Zoho Books invoice exclusions", () => {
	it("leaves out credit notes with a warning", () => {
		const built = buildZohoInvoicesExport([
			{ ...BASE, line_items: TWO_LINE, compliance: SNAPSHOT },
			{
				...BASE,
				invoice_number: "CN-2026-0001",
				document_type: "credit_note",
				line_items: TWO_LINE,
				compliance: SNAPSHOT,
			},
		]);
		const rows = parseCsv(built.content);
		expect(rows).toHaveLength(3); // header + the standard invoice's two lines
		expect(rows.map((row) => row[COL.invoiceNumber])).not.toContain(
			"CN-2026-0001",
		);
		expect(built.warnings).toContain(
			"1 credit note was left out; import credit notes as credit notes in Zoho Books.",
		);
	});

	it("keeps debit notes positive and included", () => {
		const built = buildZohoInvoicesExport([
			{
				...BASE,
				document_type: "debit_note",
				line_items: TWO_LINE,
				compliance: SNAPSHOT,
			},
		]);
		expect(built.invoiceCount).toBe(1);
		expect(parseCsv(built.content)).toHaveLength(3);
	});

	it("leaves out discounted invoices with a warning", () => {
		const built = buildZohoInvoicesExport([
			{
				...BASE,
				line_items: TWO_LINE,
				compliance: SNAPSHOT,
				template_settings: {
					includeDiscount: true,
					discount: 100,
					discountMode: "invoice_before_tax",
				},
			},
		]);
		expect(parseCsv(built.content)).toHaveLength(1);
		expect(built.invoiceCount).toBe(0);
		expect(built.warnings).toContain(
			"1 discounted invoice was left out; the provisional Zoho columns carry no discount.",
		);
	});

	it("leaves out invoices in another currency with a warning", () => {
		const built = buildZohoInvoicesExport([
			{
				...BASE,
				currency: "USD",
				line_items: TWO_LINE,
				compliance: SNAPSHOT,
			},
		]);
		expect(built.invoiceCount).toBe(0);
		expect(built.warnings).toContain(
			"1 invoice in another currency was left out; the Zoho import uses the organisation base currency.",
		);
	});

	it("leaves out an invoice without a customer name", () => {
		const built = buildZohoInvoicesExport([
			{
				...BASE,
				customer_name: "   ",
				line_items: TWO_LINE,
				compliance: SNAPSHOT,
			},
		]);
		expect(built.invoiceCount).toBe(0);
		expect(built.warnings).toContain(
			"1 invoice without a customer name was left out; Zoho Books requires a customer.",
		);
	});

	it("reports a header-only file when nothing matches", () => {
		const built = buildZohoInvoicesExport([]);
		expect(parseCsv(built.content)).toHaveLength(1);
		expect(built.warnings).toContain(
			"No invoices matched; the file has only the header row.",
		);
	});
});

describe("Zoho Books invoice legacy and safety", () => {
	it("exports an invoice with no stored lines as one synthetic line", () => {
		const built = buildZohoInvoicesExport([
			{ ...BASE, payment_amount: 500, compliance: { subtotal: 500 } },
		]);
		const rows = parseCsv(built.content);
		expect(rows).toHaveLength(2);
		expect(rows[1][COL.itemName]).toBe("(no line items recorded)");
		expect(rows[1][COL.quantity]).toBe("1");
		expect(rows[1][COL.itemPrice]).toBe("500");
		expect(rows[1][COL.itemTotal]).toBe("500");
		expect(built.warnings).toContain(
			"1 invoice had no stored line items and was exported as a single line at the stored subtotal.",
		);
	});

	it("neutralises a formula lead in text cells but not in numbers", () => {
		const rows = parseCsv(
			buildZohoInvoicesExport([
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
					compliance: { subtotal: 10, totalTax: 0, grandTotal: 10 },
				},
			]).content,
		);
		expect(rows[1][COL.customerName]).toBe("'=cmd()");
		expect(rows[1][COL.itemName]).toBe('\'=HYPERLINK("https://evil","click")');
		expect(rows[1][COL.itemPrice]).toBe("10");
		expect(rows[1][COL.itemTotal]).toBe("10");
	});

	it("aborts above the 10 MB file cap instead of truncating", () => {
		const bigName = "X".repeat(1024);
		const lines = Array.from({ length: 120 }, () => ({
			name: bigName,
			quantity: 1,
			price: 1,
		}));
		const rows: ComplianceExportInvoiceRow[] = Array.from(
			{ length: 100 },
			(_, index) => ({
				...BASE,
				invoice_number: `INV-${index}`,
				line_items: lines,
				compliance: { subtotal: 120, totalTax: 0, grandTotal: 120 },
			}),
		);
		expect(ZOHO_MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
		expect(() => buildZohoInvoicesExport(rows)).toThrow(/10 MB/);
	});
});
