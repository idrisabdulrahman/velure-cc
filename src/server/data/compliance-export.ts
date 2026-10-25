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
				row.invoice_number,
				row.customer_name,
				row.currency,
				row.payment_amount,
				row.status,
				row.issue_date,
				row.due_date,
			]
				.map((value) => JSON.stringify(value ?? ""))
				.join(","),
		),
	].join("\n");
}
