import { describe, expect, it } from "vitest";
import { lineTotalKobo, priceToKobo, subtotalKobo } from "./line-money";

describe("invoice line money", () => {
	it("keeps three visible line totals equal to subtotal in integer kobo", () => {
		const items = [
			{ quantity: 1, price: 10.01 },
			{ quantity: 2, price: 20.05 },
			{ quantity: 3, price: 0.1 },
		];
		const visibleTotals = items.map(lineTotalKobo);
		expect(visibleTotals).toEqual([1001, 4010, 30]);
		expect(subtotalKobo(items)).toBe(
			visibleTotals.reduce((sum, value) => sum + value, 0),
		);
	});

	it("parses editing decimals without binary float multiplication", () => {
		expect(priceToKobo("1,234.56")).toBe(123_456);
		expect(priceToKobo("0.1")).toBe(10);
		expect(priceToKobo("0.2")).toBe(20);
		expect(priceToKobo("1.005")).toBe(101);
		expect(() => priceToKobo("999999999999999")).toThrow(RangeError);
		expect(() => lineTotalKobo({ quantity: 1.5, price: 10 })).toThrow(
			RangeError,
		);
	});
});
