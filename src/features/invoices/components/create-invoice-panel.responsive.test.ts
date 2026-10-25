import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
	new URL("./create-invoice-panel.tsx", import.meta.url),
	"utf8",
);

describe("invoice editor responsive contract", () => {
	it("stacks line-item fields below the composer container breakpoint", () => {
		expect(source).toContain(
			"grid-cols-[minmax(0,1fr)_auto] items-end gap-2 @md:grid-cols-[minmax(0,1.4fr)_112px_minmax(0,1fr)_minmax(0,1.1fr)_24px]",
		);
		expect(source).toContain("@md:sr-only");
		expect(source).toContain('aria-label="Drag to reorder"');
		expect(source).toContain("@md:group-hover:opacity-100");
		expect(source).toContain('className="mt-2 grid gap-2 @md:grid-cols-3"');
		expect(source).toContain("<PopoverAnchor asChild>");
		expect(source).toContain(
			"w-[min(560px,calc(100vw-2rem))] border-rule bg-paper",
		);
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
