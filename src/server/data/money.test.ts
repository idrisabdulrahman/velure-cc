import { describe, expect, it } from "vitest";
import { koboToNaira, nairaToKobo } from "./money";

describe("nairaToKobo", () => {
	it("converts whole naira to kobo", () => {
		expect(nairaToKobo(1500)).toBe(150_000);
		expect(nairaToKobo(1)).toBe(100);
		expect(nairaToKobo(0)).toBe(0);
	});

	it("converts fractional naira exactly", () => {
		expect(nairaToKobo(1500.5)).toBe(150_050);
		expect(nairaToKobo(0.01)).toBe(1);
		expect(nairaToKobo(0.1)).toBe(10);
	});

	it("avoids the classic 19.99 float trap", () => {
		expect(nairaToKobo(19.99)).toBe(1999);
		expect(nairaToKobo(0.07)).toBe(7);
		expect(nairaToKobo(1234.56)).toBe(123_456);
	});

	it("handles large amounts within the safe integer range", () => {
		expect(nairaToKobo(90_071_992.54)).toBe(9_007_199_254);
		expect(nairaToKobo(2_147_483.64)).toBe(214_748_364);
	});

	it("rejects negative amounts", () => {
		expect(() => nairaToKobo(-1)).toThrow(/negative/);
		expect(() => nairaToKobo(-0.01)).toThrow(/negative/);
	});

	it("rejects NaN and non-finite amounts", () => {
		expect(() => nairaToKobo(Number.NaN)).toThrow(/finite/);
		expect(() => nairaToKobo(Number.POSITIVE_INFINITY)).toThrow(/finite/);
	});

	it("rejects more than two decimal places", () => {
		expect(() => nairaToKobo(1.005)).toThrow(/two decimal/);
		expect(() => nairaToKobo(0.001)).toThrow(/two decimal/);
	});

	it("rejects float-noise that is not a clean two-decimal amount", () => {
		expect(() => nairaToKobo(0.1 + 0.2)).toThrow(/two decimal/);
	});
});

describe("koboToNaira", () => {
	it("returns an exact two-decimal string", () => {
		expect(koboToNaira(150_000)).toBe("1500.00");
		expect(koboToNaira(150_050)).toBe("1500.50");
		expect(koboToNaira(1)).toBe("0.01");
		expect(koboToNaira(1999)).toBe("19.99");
		expect(koboToNaira(0)).toBe("0.00");
	});

	it("round-trips with nairaToKobo", () => {
		for (const naira of [0, 1, 0.01, 19.99, 1500, 1500.5, 1234.56]) {
			expect(Number(koboToNaira(nairaToKobo(naira)))).toBe(naira);
		}
	});

	it("rejects non-integer, negative and unsafe minor units", () => {
		expect(() => koboToNaira(1.5)).toThrow(/integer/);
		expect(() => koboToNaira(-1)).toThrow(/negative/);
		expect(() => koboToNaira(Number.MAX_SAFE_INTEGER + 2)).toThrow(/integer/);
	});
});
