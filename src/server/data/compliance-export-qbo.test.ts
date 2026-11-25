import { describe, expect, it } from "vitest";
import {
	formatAccountingDate,
	QBO_INVOICE_HEADERS,
	QBO_ITEM_TAX_CODE_CONFIG,
	qboItemTaxCodeFor,
} from "../../features/compliance/accounting-import";
import { NRS_INFORMATIONAL_DISCLAIMER } from "../../features/compliance/nigeria";
import {
	buildQboInvoicesExport,
	type ComplianceExportInvoiceRow,
	canonicalAccountingLines,
} from "./compliance-export";

/**
 * T10 step 3 (2026-11-02) — QuickBooks Online invoice import
 * (docs/EXPORT-FORMATS.md; prompts/qbo-invoice-export-2026-11.md).
 *
 * One row per invoice line, first line = the vendor headers exactly (no
 * disclaimer row: a leading row breaks the importer), dates DD/MM/YYYY, the
 * invoice number repeated on every line. Credit notes, discounted invoices,
 * foreign-currency invoices and rows without a customer are excluded with a
 * returned warning; above 100 invoices / 1,000 rows the export aborts.
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

/** Column indices of the QuickBooks invoice columns. */
const COL = {
	invoiceNo: 0,
	customer: 1,
	invoiceDate: 2,
	dueDate: 3,
	terms: 4,
	item: 5,
	itemDescription: 6,
	quantity: 7,
	rate: 8,
	amount: 9,
	taxCode: 10,
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

describe("QuickBooks invoice CSV layout", () => {
	it("starts with the vendor headers exactly and no disclaimer row", () => {
		const { content } = buildQboInvoicesExport([
			{ ...BASE, line_items: TWO_LINE, compliance: SNAPSHOT },
		]);
		const rows = parseCsv(content);
		expect(rows[0]).toEqual([...QBO_INVOICE_HEADERS]);
		expect(content).not.toContain(NRS_INFORMATIONAL_DISCLAIMER);
	});

	it("writes one row per line and repeats the invoice keys", () => {
		const { content, invoiceCount, lineCount } = buildQboInvoicesExport([
			{ ...BASE, line_items: TWO_LINE, compliance: SNAPSHOT },
		]);
		const rows = parseCsv(content);
		expect(rows).toHaveLength(3); // header + two lines
		expect(invoiceCount).toBe(1);
		expect(lineCount).toBe(2);
		for (const row of rows.slice(1)) {
			expect(row[COL.invoiceNo]).toBe("INV-2026-0001");
			expect(row[COL.customer]).toBe("Adaeze Foods Ltd");
		}
		expect(rows[1][COL.invoiceDate]).toBe("05/01/2026");
		expect(rows[1][COL.dueDate]).toBe("19/01/2026");
	});

	it("keeps money numeric and consistent (quantity × rate = amount)", () => {
		const rows = parseCsv(
			buildQboInvoicesExport([
				{ ...BASE, line_items: TWO_LINE, compliance: SNAPSHOT },
			]).content,
		);
		expect(rows[1][COL.item]).toBe("Goods A");
		expect(rows[1][COL.itemDescription]).toBe("Goods A");
		expect(rows[1][COL.quantity]).toBe("2");
		expect(rows[1][COL.rate]).toBe("300");
		expect(rows[1][COL.amount]).toBe("600");
		expect(rows[2][COL.item]).toBe("Goods B");
		expect(rows[2][COL.quantity]).toBe("1");
		expect(rows[2][COL.rate]).toBe("400");
		expect(rows[2][COL.amount]).toBe("400");
	});

	it("leaves Terms blank and the item tax code blank by default", () => {
		expect(QBO_ITEM_TAX_CODE_CONFIG).toEqual({
			standard: "",
			zero_rated: "",
			exempt: "",
		});
		expect(qboItemTaxCodeFor("standard")).toBe("");
		const rows = parseCsv(
			buildQboInvoicesExport([
				{ ...BASE, line_items: TWO_LINE, compliance: SNAPSHOT },
			]).content,
		);
		expect(rows[1][COL.terms]).toBe("");
		expect(rows[1][COL.taxCode]).toBe("");
	});

	it("honours the date-format option and blanks invalid dates", () => {
		expect(formatAccountingDate("2026-01-05", "MM/DD/YYYY")).toBe("01/05/2026");
		expect(formatAccountingDate("2026-01-05T10:30:00Z")).toBe("05/01/2026");
		expect(formatAccountingDate("2026-02-31")).toBe("");
		expect(formatAccountingDate("")).toBe("");
		expect(formatAccountingDate(null)).toBe("");
		const rows = parseCsv(
			buildQboInvoicesExport(
				[{ ...BASE, line_items: TWO_LINE, compliance: SNAPSHOT }],
				{ dateFormat: "MM/DD/YYYY" },
			).content,
		);
		expect(rows[1][COL.invoiceDate]).toBe("01/05/2026");
	});
});

describe("QuickBooks invoice exclusions", () => {
	it("leaves out credit notes with a warning", () => {
		const built = buildQboInvoicesExport([
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
		expect(rows.map((row) => row[COL.invoiceNo])).not.toContain("CN-2026-0001");
		expect(built.warnings).toContain(
			"1 credit note was left out; import credit notes as credit memos in QuickBooks.",
		);
	});

	it("keeps debit notes positive and included", () => {
		const built = buildQboInvoicesExport([
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
		const built = buildQboInvoicesExport([
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
			"1 discounted invoice was left out; the QuickBooks invoice columns have no discount field.",
		);
	});

	it("leaves out invoices in another currency with a warning", () => {
		const built = buildQboInvoicesExport([
			{
				...BASE,
				currency: "USD",
				line_items: TWO_LINE,
				compliance: SNAPSHOT,
			},
		]);
		expect(built.invoiceCount).toBe(0);
		expect(built.warnings).toContain(
			"1 invoice in another currency was left out; the QuickBooks import uses the company home currency.",
		);
	});

	it("leaves out an invoice without a customer name", () => {
		const built = buildQboInvoicesExport([
			{
				...BASE,
				customer_name: "   ",
				line_items: TWO_LINE,
				compliance: SNAPSHOT,
			},
		]);
		expect(built.invoiceCount).toBe(0);
		expect(built.warnings).toContain(
			"1 invoice without a customer name was left out; QuickBooks requires a customer.",
		);
	});

	it("reports a header-only file when nothing matches", () => {
		const built = buildQboInvoicesExport([]);
		expect(parseCsv(built.content)).toHaveLength(1);
		expect(built.warnings).toContain(
			"No invoices matched; the file has only the header row.",
		);
	});
});

describe("QuickBooks invoice legacy and safety", () => {
	it("exports an invoice with no stored lines as one synthetic line", () => {
		const built = buildQboInvoicesExport([
			{ ...BASE, payment_amount: 500, compliance: { subtotal: 500 } },
		]);
		const rows = parseCsv(built.content);
		expect(rows).toHaveLength(2);
		expect(rows[1][COL.item]).toBe("(no line items recorded)");
		expect(rows[1][COL.quantity]).toBe("1");
		expect(rows[1][COL.rate]).toBe("500");
		expect(rows[1][COL.amount]).toBe("500");
		expect(built.warnings).toContain(
			"1 invoice had no stored line items and was exported as a single line at the stored subtotal.",
		);
	});

	it("neutralises a formula lead in text cells but not in numbers", () => {
		const rows = parseCsv(
			buildQboInvoicesExport([
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
		expect(rows[1][COL.customer]).toBe("'=cmd()");
		expect(rows[1][COL.item]).toBe('\'=HYPERLINK("https://evil","click")');
		expect(rows[1][COL.rate]).toBe("10");
		expect(rows[1][COL.amount]).toBe("10");
	});

	it("aborts above 100 invoices instead of truncating", () => {
		const rows: ComplianceExportInvoiceRow[] = Array.from(
			{ length: 101 },
			(_, index) => ({
				...BASE,
				invoice_number: `INV-${index}`,
				line_items: [{ name: "Goods", quantity: 1, price: 10 }],
				compliance: { subtotal: 10, totalTax: 0, grandTotal: 10 },
			}),
		);
		expect(() => buildQboInvoicesExport(rows)).toThrow(/100 invoices/);
	});

	it("aborts above 1,000 rows instead of truncating", () => {
		const lines = Array.from({ length: 11 }, () => ({
			name: "Goods",
			quantity: 1,
			price: 1,
		}));
		const rows: ComplianceExportInvoiceRow[] = Array.from(
			{ length: 100 },
			(_, index) => ({
				...BASE,
				invoice_number: `INV-${index}`,
				line_items: lines,
				compliance: { subtotal: 11, totalTax: 0, grandTotal: 11 },
			}),
		);
		expect(() => buildQboInvoicesExport(rows)).toThrow(/1,000 rows/);
	});
});

describe("canonical accounting rows", () => {
	it("projects the accountant cells without re-deriving money", () => {
		const lines = canonicalAccountingLines([
			{ ...BASE, line_items: TWO_LINE, compliance: SNAPSHOT },
		]);
		expect(lines).toHaveLength(2);
		expect(lines[0].lineGross).toBe(600);
		expect(lines[1].lineGross).toBe(400);
		expect(lines[0].invoiceSubtotal).toBe(1000);
		expect(lines[0].invoiceNetPayable).toBe(1025);
		// Invoice-level cells belong to the first line only.
		expect(lines[1].invoiceSubtotal).toBeNull();
		expect(lines[1].invoiceNetPayable).toBeNull();
		expect(lines[0].synthetic).toBe(false);
	});
});
