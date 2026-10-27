import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
	new URL("./create-invoice-panel.tsx", import.meta.url),
	"utf8",
);

describe("create invoice money and localization contract", () => {
	it("does not guess FX rates or rewrite line-item prices", () => {
		expect(source).not.toContain("NGN_PER_CURRENCY");
		expect(source).not.toContain("convertAmount");

		const updateCurrency = source.slice(
			source.indexOf("const updateCurrency"),
			source.indexOf("const openInvoiceTab"),
		);
		expect(updateCurrency).not.toContain("setLineItems");
	});

	it("uses Nigerian dates by default and the active currency for products", () => {
		expect(source).toContain('{ value: "ng", label: "DD/MM/YYYY" }');
		expect(source).toContain('useState<"iso" | "us" | "ng">("ng")');
		expect(source).toMatch(
			/formatMoney\(\s*product\.defaultUnitPrice,\s*currency,/,
		);
	});

	it("links customers by ID and keeps both selectors keyboard accessible", () => {
		expect(source).toContain("const selectClient = (client:");
		expect(source).not.toMatch(/clients\.find\([^)]*customerName/);
		expect(source).toMatch(/customerId,\s*\n/);
		expect(source.match(/role="combobox"/g)?.length).toBeGreaterThanOrEqual(2);
		expect(source.match(/role="listbox"/g)?.length).toBeGreaterThanOrEqual(2);
		for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) {
			expect(source).toContain(`event.key === "${key}"`);
		}
	});

	it("guides first-run users to choose or create a customer", () => {
		expect(source).toContain("Create your first invoice in three steps");
		for (const step of [
			"Choose a client",
			"Add a priced item",
			"Create and send",
		]) {
			expect(source).toContain(step);
		}
		expect(source).toContain("Select customer");
		expect(source).toContain("Create customer");
		expect(source).not.toContain("Start with your first client");
		expect(source).toContain("setCreateClientOpen(true)");
	});
});
