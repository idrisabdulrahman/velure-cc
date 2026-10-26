import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(
	new URL("./create-invoice-panel.tsx", import.meta.url),
	"utf8",
);
const listSource = readFileSync(
	new URL("../../../routes/invoices.index.lazy.tsx", import.meta.url),
	"utf8",
);

describe("invoice workbench UI contract", () => {
	it("keeps one creation entry point and discloses secondary filters", () => {
		expect(listSource).not.toContain("New pro-forma");
		expect(listSource).toContain("New invoice");

		const disclosure = listSource.slice(
			listSource.indexOf("<details"),
			listSource.indexOf("</details>") + "</details>".length,
		);
		expect(disclosure).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
		expect(disclosure).toContain("Filters");
		for (const label of ["Customer", "Schedule", "Document kind", "Due"]) {
			expect(disclosure).toContain(`label="${label}"`);
		}
	});

	it("uses a compact document selector and one calendar pattern", () => {
		const selector = panelSource.slice(
			panelSource.indexOf("DOCUMENT_TYPE_OPTIONS.map"),
			panelSource.indexOf("DOCUMENT_TYPE_OPTIONS.map") + 1_500,
		);
		expect(selector).toContain("aria-pressed");
		expect(selector).not.toContain("option.description");
		expect(panelSource.match(/<InvoiceDateField\n/g)).toHaveLength(2);
		expect(panelSource).not.toContain('type="date"');
		expect(panelSource).not.toContain("value.toISOString().slice(0, 10)");
	});

	it("keeps settings in the footer instead of duplicating them on paper", () => {
		expect(panelSource).not.toContain("Edit tax and compliance settings");
		expect(panelSource).not.toContain("Server-reserved when saved");
		expect(panelSource).not.toContain("Visible on invoice");
		expect(panelSource).toContain("Tax & compliance settings");
		expect(panelSource).toMatch(/<Settings2[^>]*\/>\s*Settings/);
	});

	it("anchors catalog results to the description and lets line items grow", () => {
		const pickerStart = panelSource.indexOf("id={`invoice-line-description-");
		const productPicker = panelSource.slice(pickerStart, pickerStart + 14_000);
		expect(productPicker).toContain(
			"absolute left-0 top-full z-50 mt-1 w-full max-w-[calc(100vw-16px)]",
		);
		expect(productPicker).toContain(
			'className="max-h-64 overflow-y-auto overscroll-contain"',
		);
		expect(panelSource).toContain('className="min-h-[52px] shrink-0"');
		expect(panelSource).not.toContain("max-h-[250px] overflow-y-auto");
	});
});
