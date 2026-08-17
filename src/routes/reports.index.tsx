import { convexQuery } from "@convex-dev/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { resolvePeriod } from "#/utils/date";
import { api } from "../../convex/_generated/api";
export const Route = createFileRoute("/reports/")({
	beforeLoad: ({ context }) => {
		// Fire-and-forget: warm the cache without blocking the transition.
		const window = resolvePeriod("last-6-months");
		void context.queryClient
			.prefetchQuery(
				convexQuery(api.reports.getRevenueCashFlow, {
					from: window.from,
					to: window.to,
					limit: 8,
				}),
			)
			.catch(() => undefined);
	},
});
