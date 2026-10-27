import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
	new URL("./create-invoice-panel.tsx", import.meta.url),
	"utf8",
);

describe("invoice editor responsive contract", () => {
	it("stacks line-item fields below the composer container breakpoint", () => {
		expect(source).toContain("const LINE_ITEM_GRID_COLUMNS =");
		expect(source.match(/LINE_ITEM_GRID_COLUMNS/g)?.length).toBe(3);
		expect(source).toContain("@md:sr-only");
		expect(source).toContain('aria-label="Drag to reorder"');
		expect(source).toContain("@md:group-hover:opacity-100");
		expect(source).toContain('className="mt-2 grid gap-2 @md:grid-cols-3"');
		expect(source).toContain(
			"absolute left-0 top-full z-50 mt-1 w-[360px] max-w-[calc(100vw-5rem)]",
		);
		expect(source).not.toContain("max-h-[250px] overflow-y-auto");
		expect(source).toContain('className="min-h-[52px] shrink-0"');
		expect(source).not.toContain(
			'className="mb-3 grid grid-cols-[minmax(0,1.7fr)_84px_120px_140px_32px]',
		);
	});

	it("keeps sheet actions fixed while the invoice paper body scrolls", () => {
		expect(source).toContain("h-[calc(100dvh-7rem)] min-h-0");
		expect(source).toContain('isSheetMode ? "h-full" : "max-h-[960px]"');
		expect(source).toContain(
			"flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain",
		);
		expect(source).toContain("mt-auto grid items-start gap-4 pt-10");
		expect(source).toContain('aria-hidden="true"');
		expect(source).toContain("receipt-edge-");
		expect(source).toContain(
			"min-h-20 w-full resize-none border-0 bg-transparent",
		);
	});

	it("scopes Midday-style inline controls to the invoice paper", () => {
		expect(source).toContain(
			'<div className="invoice-paper-controls @container flex min-h-0 flex-1 flex-col',
		);
	});
});
