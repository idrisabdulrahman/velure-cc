import { NRS_INFORMATIONAL_DISCLAIMER } from "#/features/compliance/nigeria";

export type ComplianceExportKind =
	| "invoices_csv"
	| "tax_summary_csv"
	| "customer_ledger_csv"
	| "normalized_accounting";

export type ComplianceExportInvoiceRow = {
	invoice_number: string | null;
	customer_name: string | null;
	/** Stored `invoices.document_type`; absent rows export as `standard`. */
	document_type?: string | null;
	currency: string | null;
	payment_amount: number | string | null;
	status: string | null;
	issue_date: string | null;
	due_date: string | null;
	compliance?: unknown;
	line_items?: unknown;
};

/**
 * Provisional accountant columns (see
 * `prompts/accountant-export-quality-2026-10.md`): the tax split and the
 * document type sit next to `total` so a spreadsheet can group and sum a
 * workspace's VAT and withholding without re-deriving them.
 */
const CSV_HEADERS = [
	"invoiceNumber",
	"customerName",
	"documentType",
	"currency",
	"subtotal",
	"vat",
	"withholdingTax",
	"total",
	"status",
	"issueDate",
	"dueDate",
] as const;

/** Stored snapshot values arrive as numbers or as numeric strings. */
function numeric(value: unknown): number | undefined {
	if (typeof value === "number")
		return Number.isFinite(value) ? value : undefined;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

/**
 * The invoice total for one export row, using the same precedence the app uses
 * everywhere else (`netPayableFromCompliance` / `invoiceAmount`): the stored
 * `netPayable`, else `grandTotal` less withholding, else the summed line items.
 *
 * `payment_amount` is the amount PAID, not the total — a draft or unpaid
 * invoice stores 0 there, so exporting it under the `total` header reported 0
 * for most rows. It is now only a last resort for a row with no stored
 * compliance and no usable line items.
 */
export function invoiceTotalForExportRow(
	row: ComplianceExportInvoiceRow,
): number {
	const compliance = (row.compliance ?? {}) as Record<string, unknown>;
	const netPayable = numeric(compliance.netPayable);
	if (netPayable !== undefined) return netPayable;

	const grandTotal = numeric(compliance.grandTotal);
	if (grandTotal !== undefined) {
		return grandTotal - (numeric(compliance.withholdingTaxAmount) ?? 0);
	}

	let value = 0;
	let sawLineItem = false;
	if (Array.isArray(row.line_items)) {
		for (const raw of row.line_items) {
			const item = (raw ?? {}) as Record<string, unknown>;
			const quantity = numeric(item.quantity);
			const price = numeric(item.price);
			if (quantity === undefined || price === undefined) continue;
			value += quantity * price;
			sawLineItem = true;
		}
	}
	if (sawLineItem) {
		return Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;
	}

	return Math.max(0, numeric(row.payment_amount) ?? 0);
}

/**
 * Spreadsheet formula injection guard (OWASP CSV injection). `JSON.stringify`
 * quotes and escapes a cell but does not stop Excel/Sheets from evaluating a
 * cell that starts with `=`, `+`, `-`, `@`, a tab or a CR — and this export is
 * a file the user downloads and opens. A leading apostrophe forces text.
 *
 * Applied only to the free-text columns so the numeric money columns keep
 * their type and still sum in a spreadsheet.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function csvTextCell(value: unknown): string {
	const text = value === null || value === undefined ? "" : String(value);
	return JSON.stringify(FORMULA_LEAD.test(text) ? `'${text}` : text);
}

function csvValueCell(value: unknown): string {
	return JSON.stringify(value ?? "");
}

/** The raw stored document type, defaulting to a standard invoice. */
function documentTypeForExportRow(row: ComplianceExportInvoiceRow): string {
	const value = row.document_type;
	return typeof value === "string" && value.length > 0 ? value : "standard";
}

/**
 * The money columns of one export row. `subtotal`/`vat`/`withholdingTax` come
 * straight from the stored compliance snapshot (`totalTax` is VAT);
 * `total` keeps the existing payable precedence.
 *
 * A credit note reduces revenue, so every money column is negated for it.
 * Debit notes, standard invoices and pro-formas stay positive. Missing
 * snapshot values fall back to `0` so a spreadsheet never sees `undefined` or
 * `NaN`, and no new float arithmetic is introduced (the values are the stored
 * decimals, negated exactly).
 */
function invoiceMoneyForExportRow(row: ComplianceExportInvoiceRow): {
	subtotal: number;
	vat: number;
	withholdingTax: number;
	total: number;
} {
	const compliance = (row.compliance ?? {}) as Record<string, unknown>;
	const sign = row.document_type === "credit_note" ? -1 : 1;
	return {
		subtotal: sign * (numeric(compliance.subtotal) ?? 0),
		vat: sign * (numeric(compliance.totalTax) ?? 0),
		withholdingTax: sign * (numeric(compliance.withholdingTaxAmount) ?? 0),
		total: sign * invoiceTotalForExportRow(row),
	};
}

/**
 * Builds the stored export artifact for `createInvoiceExport`. Every export
 * leaves the Compliance page, so every artifact carries the NRS disclaimer
 * inside the file itself (a leading quoted line for CSV, a `disclaimer`
 * field for JSON) — a downloaded copy can never read as a cleared tax
 * filing (e-invoicing SPEC A2).
 */
export function buildInvoiceExportContent(
	kind: ComplianceExportKind,
	rows: ComplianceExportInvoiceRow[],
	generatedAt: number,
): string {
	if (kind === "normalized_accounting") {
		return JSON.stringify(
			{
				generatedAt,
				disclaimer: NRS_INFORMATIONAL_DISCLAIMER,
				invoices: rows,
			},
			null,
			2,
		);
	}

	return [
		JSON.stringify(NRS_INFORMATIONAL_DISCLAIMER),
		CSV_HEADERS.join(","),
		...rows.map((row) => {
			const money = invoiceMoneyForExportRow(row);
			return [
				csvTextCell(row.invoice_number),
				csvTextCell(row.customer_name),
				csvTextCell(documentTypeForExportRow(row)),
				csvTextCell(row.currency),
				csvValueCell(money.subtotal),
				csvValueCell(money.vat),
				csvValueCell(money.withholdingTax),
				csvValueCell(money.total),
				csvValueCell(row.status),
				csvValueCell(row.issue_date),
				csvValueCell(row.due_date),
			].join(",");
		}),
	].join("\n");
}
