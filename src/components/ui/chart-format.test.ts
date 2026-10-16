import { describe, expect, it } from "vitest";
import {
	monthYearFmt,
	shortDateFmt,
	toTimeValue,
	weekdayDateFmt,
} from "./chart-format";

describe("chart-format", () => {
	it("formats axis ticks as short month + day", () => {
		expect(shortDateFmt.format(new Date("2026-10-01T00:00:00"))).toBe("Oct 1");
	});

	it("formats tooltip date pills with weekday", () => {
		expect(weekdayDateFmt.format(new Date("2026-10-07T00:00:00"))).toContain(
			"Oct 7",
		);
	});

	it("formats month-year labels", () => {
		expect(monthYearFmt.format(new Date("2026-01-01T00:00:00"))).toContain(
			"2026",
		);
	});

	it("coerces Date, timestamp, and ISO strings to timestamps", () => {
		const date = new Date("2026-10-01T00:00:00");
		expect(toTimeValue(date)).toBe(date.getTime());
		expect(toTimeValue(date.getTime())).toBe(date.getTime());
		expect(toTimeValue("2026-10-01")).toBe(Date.parse("2026-10-01"));
	});

	it("returns NaN for unparseable x values", () => {
		expect(toTimeValue(undefined)).toBeNaN();
		expect(toTimeValue("not-a-date")).toBeNaN();
		expect(toTimeValue(Number.NaN)).toBeNaN();
	});
});
