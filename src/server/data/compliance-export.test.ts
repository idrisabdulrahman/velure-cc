import { describe, expect, it } from "vitest";
import { NRS_INFORMATIONAL_DISCLAIMER } from "../../features/compliance/nigeria";
import {
	buildInvoiceExportContent,
	type ComplianceExportInvoiceRow,
	type ComplianceExportKind,
} from "./compliance-export";

const ROW: ComplianceExportInvoiceRow = {
	invoice_number: "INV-2026-0001",
	customer_name: "Adaeze Foods Ltd",
	currency: "NGN",
	payment_amount: 666500,
	status: "sent",
	issue_date: "2026-10-01",
	due_date: "2026-10-15",
};

const ALL_KINDS: ComplianceExportKind[] = [
	"invoices_csv",
	"tax_summary_csv",
	"customer_ledger_csv",
	"normalized_accounting",
	"accountant_lines_csv",
];

// accountant_lines_xlsx is async (base64 workbook) and is covered in
// compliance-export-accountant.test.ts; calling the sync builder with it
// must fail loudly instead of emitting CSV bytes named `.xlsx`.
const SYNC_ONLY = "accountant_lines_xlsx";

describe("compliance export content", () => {
	it("embeds the not-NRS-cleared disclaimer inside every exported artifact", () => {
		// SPEC A2: the disclaimer must live in the downloaded file itself, so
		// a spreadsheet or archive copy can never read as a cleared filing.
		for (const kind of ALL_KINDS) {
			const content = buildInvoiceExportContent(kind, [ROW], 1729000000000);
			expect(content, kind).toContain(NRS_INFORMATIONAL_DISCLAIMER);
		}
	});

	it("rejects the async xlsx kind on the sync builder", () => {
		expect(() => buildInvoiceExportContent(SYNC_ONLY, [ROW], 0)).toThrow(
			/buildInvoiceExportArtifact/,
		);
	});

	it("leads CSV exports with the disclaimer before the header row", () => {
		const lines = buildInvoiceExportContent(
			"tax_summary_csv",
			[ROW],
			1729000000000,
		).split("\n");
		expect(lines[0]).toBe(JSON.stringify(NRS_INFORMATIONAL_DISCLAIMER));
		expect(lines[1]).toBe(
			"invoiceNumber,customerName,documentType,currency,subtotal,vat,withholdingTax,total,status,issueDate,dueDate",
		);
		expect(lines).toHaveLength(3);
	});

	it("keeps CSV rows behind the disclaimer line", () => {
		const csv = buildInvoiceExportContent("invoices_csv", [ROW], 0);
		expect(csv.split("\n")[2]).toBe(
			'"INV-2026-0001","Adaeze Foods Ltd","standard","NGN",0,0,0,666500,"sent","2026-10-01","2026-10-15"',
		);
	});

	it("adds a disclaimer field to the JSON export without dropping data", () => {
		const parsed = JSON.parse(
			buildInvoiceExportContent("normalized_accounting", [ROW], 42),
		) as {
			generatedAt: number;
			disclaimer: string;
			invoices: ComplianceExportInvoiceRow[];
		};
		expect(parsed.generatedAt).toBe(42);
		expect(parsed.disclaimer).toBe(NRS_INFORMATIONAL_DISCLAIMER);
		expect(parsed.invoices).toEqual([ROW]);
	});
});

/**
 * The `total` column used to be written from `payment_amount`, which is the
 * amount PAID — 0 for every draft, unpaid, overdue or canceled invoice — so the
 * compliance CSV reported 0 for most rows. It now uses the same precedence the
 * app uses for an invoice total (netPayable, else grandTotal less withholding,
 * else the summed line items).
 */
describe("compliance export totals", () => {
	function totalCell(row: ComplianceExportInvoiceRow) {
		return buildInvoiceExportContent("invoices_csv", [row], 0).split("\n")[2];
	}

	it("uses the stored netPayable instead of the paid amount", () => {
		expect(
			totalCell({
				...ROW,
				payment_amount: 0,
				compliance: { netPayable: "161250" },
			}),
		).toBe(
			'"INV-2026-0001","Adaeze Foods Ltd","standard","NGN",0,0,0,161250,"sent","2026-10-01","2026-10-15"',
		);
	});

	it("falls back to grandTotal less withholding tax", () => {
		expect(
			totalCell({
				...ROW,
				payment_amount: 0,
				compliance: { grandTotal: 100000, withholdingTaxAmount: 5000 },
			}),
		).toContain('"NGN",0,0,5000,95000,');
	});

	it("falls back to the summed line items", () => {
		expect(
			totalCell({
				...ROW,
				payment_amount: 0,
				compliance: {},
				line_items: [
					{ quantity: 2, price: 500 },
					{ quantity: 1, price: 250.25 },
				],
			}),
		).toContain('"NGN",0,0,0,1250.25,');
	});

	it("still exports the paid amount when nothing else is available", () => {
		expect(totalCell({ ...ROW, compliance: undefined })).toContain(
			'"NGN",0,0,0,666500,',
		);
	});
});

/**
 * The stored compliance snapshot already carries the tax split
 * (`subtotal`, `totalTax`, `withholdingTaxAmount`); the export used to drop it.
 * `document_type` identifies a credit note, whose money columns must export
 * negative so revenue reduces correctly in a spreadsheet.
 */
describe("compliance export tax split and document type", () => {
	function csvRow(row: ComplianceExportInvoiceRow) {
		return buildInvoiceExportContent("invoices_csv", [row], 0).split("\n")[2];
	}

	const SPLIT_SNAPSHOT = {
		subtotal: 100000,
		totalTax: 7500,
		withholdingTaxAmount: 5000,
		netPayable: 102500,
	};

	it("exports the stored subtotal, VAT and withholding split", () => {
		expect(
			csvRow({ ...ROW, payment_amount: 0, compliance: SPLIT_SNAPSHOT }),
		).toBe(
			'"INV-2026-0001","Adaeze Foods Ltd","standard","NGN",100000,7500,5000,102500,"sent","2026-10-01","2026-10-15"',
		);
	});

	it("defaults documentType to standard and missing money to zero", () => {
		expect(csvRow(ROW)).toContain('"standard","NGN",0,0,0,666500,');
	});

	it("signs credit notes negative and leaves standard invoices positive", () => {
		expect(
			csvRow({
				...ROW,
				document_type: "credit_note",
				compliance: SPLIT_SNAPSHOT,
			}),
		).toBe(
			'"INV-2026-0001","Adaeze Foods Ltd","credit_note","NGN",-100000,-7500,-5000,-102500,"sent","2026-10-01","2026-10-15"',
		);
		expect(
			csvRow({
				...ROW,
				document_type: "standard",
				compliance: SPLIT_SNAPSHOT,
			}),
		).toBe(
			'"INV-2026-0001","Adaeze Foods Ltd","standard","NGN",100000,7500,5000,102500,"sent","2026-10-01","2026-10-15"',
		);
	});

	it("keeps debit notes and pro-formas positive but identified", () => {
		expect(
			csvRow({
				...ROW,
				document_type: "debit_note",
				compliance: SPLIT_SNAPSHOT,
			}),
		).toContain('"debit_note","NGN",100000,7500,5000,102500,');
		expect(
			csvRow({
				...ROW,
				document_type: "proforma",
				compliance: SPLIT_SNAPSHOT,
			}),
		).toContain('"proforma","NGN",100000,7500,5000,102500,');
	});
});

/**
 * The export is a file the user downloads and opens in Excel / Sheets, so a
 * cell starting with `= + - @` (or a tab / CR) must not be evaluated.
 */
describe("compliance export spreadsheet safety", () => {
	it("neutralises a formula in a free-text column", () => {
		const csv = buildInvoiceExportContent(
			"invoices_csv",
			[{ ...ROW, customer_name: '=HYPERLINK("https://evil","click")' }],
			0,
		);
		const row = csv.split("\n")[2];
		expect(row).toContain("'=HYPERLINK");
		expect(row).not.toContain('"=HYPERLINK');
	});

	it("leaves the numeric money columns free of the guard", () => {
		// A leading apostrophe would turn the total into text and break
		// spreadsheet arithmetic on the very column the export exists for.
		const csv = buildInvoiceExportContent(
			"invoices_csv",
			[{ ...ROW, compliance: { netPayable: 161250 } }],
			0,
		);
		expect(csv.split("\n")[2]).toContain('"NGN",0,0,0,161250,');
	});
});
