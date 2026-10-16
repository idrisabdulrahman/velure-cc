// Shared date formatters for Recharts time-series charts. Replaces the
// `chart-formatters` module of the retired visx system. Dependency-free.

export const shortDateFmt = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
});

export const weekdayDateFmt = new Intl.DateTimeFormat("en-US", {
	weekday: "short",
	month: "short",
	day: "numeric",
});

export const monthYearFmt = new Intl.DateTimeFormat("en-US", {
	month: "short",
	year: "numeric",
});

/** Coerce a chart x value (Date, timestamp, or ISO string) to a timestamp. */
export function toTimeValue(value: unknown): number {
	if (value instanceof Date) return value.getTime();
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Date.parse(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return Number.NaN;
}
