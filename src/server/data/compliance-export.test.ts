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
];

describe("compliance export content", () => {
	it("embeds the not-NRS-cleared disclaimer inside every exported artifact", () => {
		// SPEC A2: the disclaimer must live in the downloaded file itself, so
		// a spreadsheet or archive copy can never read as a cleared filing.
		for (const kind of ALL_KINDS) {
			const content = buildInvoiceExportContent(kind, [ROW], 1729000000000);
			expect(content, kind).toContain(NRS_INFORMATIONAL_DISCLAIMER);
		}
	});

	it("leads CSV exports with the disclaimer before the header row", () => {
		const lines = buildInvoiceExportContent(
			"tax_summary_csv",
			[ROW],
			1729000000000,
		).split("\n");
		expect(lines[0]).toBe(JSON.stringify(NRS_INFORMATIONAL_DISCLAIMER));
		expect(lines[1]).toBe(
			"invoiceNumber,customerName,currency,total,status,issueDate,dueDate",
		);
		expect(lines).toHaveLength(3);
	});

	it("keeps CSV rows unchanged behind the disclaimer line", () => {
		const csv = buildInvoiceExportContent("invoices_csv", [ROW], 0);
		expect(csv.split("\n")[2]).toBe(
			'"INV-2026-0001","Adaeze Foods Ltd","NGN",666500,"sent","2026-10-01","2026-10-15"',
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
