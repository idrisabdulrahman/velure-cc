export function toIsoDay(date: Date) {
	return date.toISOString().slice(0, 10);
}

export type PeriodPreset = "last-6-months" | "year-to-date" | "last-12-months";

export const PERIOD_OPTIONS: Array<{
	value: PeriodPreset;
	label: string;
}> = [
	{ value: "last-6-months", label: "Last 6 months" },
	{ value: "year-to-date", label: "Year to date" },
	{ value: "last-12-months", label: "Last 12 months" },
];

export function resolvePeriod(value: PeriodPreset) {
	const now = new Date();
	const to = toIsoDay(now);

	if (value === "year-to-date") {
		return { from: `${now.getFullYear()}-01-01`, to };
	}

	const from = new Date(now);
	from.setDate(1);
	from.setMonth(from.getMonth() - (value === "last-6-months" ? 5 : 11));
	return { from: toIsoDay(from), to };
}
