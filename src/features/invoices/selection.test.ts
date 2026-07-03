import { describe, expect, it } from "vitest";
import {
	keepVisibleInvoiceSelection,
	setInvoiceSelectionForIds,
	toggleInvoiceSelection,
} from "./selection";

describe("invoice row selection", () => {
	it("selects, deselects, and keeps exactly the requested invoice ids", () => {
		const first = "invoice-a";
		const second = "invoice-b";
		const third = "invoice-c";

		let selection = new Set<string>();

		selection = toggleInvoiceSelection(selection, first, true);
		expect(Array.from(selection)).toEqual([first]);

		selection = toggleInvoiceSelection(selection, first, false);
		expect(Array.from(selection)).toEqual([]);

		selection = toggleInvoiceSelection(selection, first, true);
		selection = toggleInvoiceSelection(selection, third, true);
		expect(selection.has(first)).toBe(true);
		expect(selection.has(second)).toBe(false);
		expect(selection.has(third)).toBe(true);
		expect(selection).toHaveLength(2);
	});

	it("selects visible invoice ids without mutating existing selection state", () => {
		const initial = new Set(["invoice-a"]);
		const next = setInvoiceSelectionForIds(
			initial,
			["invoice-b", "invoice-d"],
			true,
		);

		expect(initial).not.toBe(next);
		expect(Array.from(initial)).toEqual(["invoice-a"]);
		expect(Array.from(next).sort()).toEqual([
			"invoice-a",
			"invoice-b",
			"invoice-d",
		]);
	});

	it("drops selections that are no longer visible", () => {
		const initial = new Set(["invoice-a", "invoice-b", "invoice-c"]);
		const next = keepVisibleInvoiceSelection(
			initial,
			new Set(["invoice-a", "invoice-c"]),
		);

		expect(next).not.toBe(initial);
		expect(Array.from(next).sort()).toEqual(["invoice-a", "invoice-c"]);
	});
});
