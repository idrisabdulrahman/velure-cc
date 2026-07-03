import { createFileRoute } from "@tanstack/react-router";
import { convexQuery } from "@convex-dev/react-query";
import { api } from "../../convex/_generated/api";

function toIsoDay(date: Date) {
	return date.toISOString().slice(0, 10);
}

function defaultReportWindow() {
	const now = new Date();
	const to = toIsoDay(now);
	const from = new Date(now);
	from.setDate(1);
	from.setMonth(from.getMonth() - 5);
	return { from: toIsoDay(from), to };
}

export const Route = createFileRoute("/reports/")({
	beforeLoad: async ({ context }) => {
		const window = defaultReportWindow();
		await context.queryClient.prefetchQuery(
			convexQuery(api.reports.getRevenueCashFlow, {
				from: window.from,
				to: window.to,
				limit: 8,
			}),
		);
	},
});
