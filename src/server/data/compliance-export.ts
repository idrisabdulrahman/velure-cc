import { NRS_INFORMATIONAL_DISCLAIMER } from "#/features/compliance/nigeria";

export type ComplianceExportKind =
	| "invoices_csv"
	| "tax_summary_csv"
	| "customer_ledger_csv"
	| "normalized_accounting";

export type ComplianceExportInvoiceRow = {
	invoice_number: string | null;
	customer_name: string | null;
	currency: string | null;
	payment_amount: number | string | null;
	status: string | null;
	issue_date: string | null;
	due_date: string | null;
	compliance?: unknown;
	line_items?: unknown;
};

const CSV_HEADERS = [
	"invoiceNumber",
	"customerName",
	"currency",
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
 * Applied only to the free-text columns so the numeric `total` column keeps its
 * type and still sums in a spreadsheet.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function csvTextCell(value: unknown): string {
	const text = value === null || value === undefined ? "" : String(value);
	return JSON.stringify(FORMULA_LEAD.test(text) ? `'${text}` : text);
}

function csvValueCell(value: unknown): string {
	return JSON.stringify(value ?? "");
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
		...rows.map((row) =>
			[
				csvTextCell(row.invoice_number),
				csvTextCell(row.customer_name),
				csvTextCell(row.currency),
				csvValueCell(invoiceTotalForExportRow(row)),
				csvValueCell(row.status),
				csvValueCell(row.issue_date),
				csvValueCell(row.due_date),
			].join(","),
		),
	].join("\n");
}
