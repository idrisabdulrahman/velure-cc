import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Exports-tab structure contract.
 *
 * This repo has no component-test harness (node test environment, no
 * testing-library), so the densified Exports tab is pinned against the route
 * source: the two labelled card groups, every export offering, and the
 * recent-exports table. The guard stops a future edit from silently dropping
 * an export action or flattening the table back into an unlabelled list.
 */

const source = readFileSync(
	fileURLToPath(new URL("./settings.compliance.tsx", import.meta.url)),
	"utf8",
);

const EXPORT_TITLES = [
	"Invoice report",
	"Customer balance report",
	"Tax summary",
	"Accountant line export",
	"VAT sales data (Rev360)",
	"QuickBooks invoices (CSV)",
	"Zoho Books invoices (CSV)",
];

describe("compliance exports tab", () => {
	it("renders the shared ExportCard helper", () => {
		expect(source).toContain("function ExportCard(");
		expect(source).toContain("formats: string[]");
	});

	it("groups the offerings under labelled sections", () => {
		expect(source).toMatch(/>\s*Reports\s*</);
		expect(source).toMatch(/>\s*Accounting &amp; tax files\s*</);
	});

	it("keeps every export offering", () => {
		for (const title of EXPORT_TITLES) {
			expect(source, `missing export card ${title}`).toContain(
				`title="${title}"`,
			);
		}
	});

	it("keeps every export kind wired to a generate action", () => {
		for (const kind of [
			"invoices_csv",
			"customer_ledger_csv",
			"tax_summary_csv",
			"accountant_lines_csv",
			"accountant_lines_xlsx",
			"vat_sales_schedule_xlsx",
			"qbo_invoices_csv",
			"zoho_invoices_csv",
		]) {
			expect(source, `missing export kind ${kind}`).toContain(`"${kind}"`);
		}
	});

	it("renders recent exports as a labelled, keyboard-reachable table", () => {
		expect(source).toContain('aria-label="Recent exports table"');
		expect(source).toContain("visibleExports.map((record) => (");
		for (const header of ["Export", "File", "Status", "Created", "Actions"]) {
			expect(source, `missing table header ${header}`).toMatch(
				new RegExp(`font-medium">\\s*${header}\\s*<`),
			);
		}
	});

	it("keeps the empty state copy", () => {
		expect(source).toContain("No downloadable exports yet.");
	});
});
