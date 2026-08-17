import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
	new URL("./create-invoice-panel.tsx", import.meta.url),
	"utf8",
);

describe("invoice editor responsive contract", () => {
	it("stacks line-item fields below md without losing accessible controls", () => {
		expect(source).toContain(
			"grid-cols-[minmax(0,1fr)_auto] items-end gap-3 md:grid-cols-[minmax(0,1.7fr)_84px_120px_140px_32px]",
		);
		expect(source).toContain("md:sr-only");
		expect(source).toContain('aria-label="Drag to reorder"');
		expect(source).toContain("md:group-hover:opacity-100");
		expect(source).toContain("<PopoverAnchor asChild>");
		expect(source).toContain(
			"w-[min(560px,calc(100vw-2rem))] border-rule bg-paper",
		);
		expect(source).not.toContain(
			'className="mb-3 grid grid-cols-[minmax(0,1.7fr)_84px_120px_140px_32px]',
		);
	});
});
