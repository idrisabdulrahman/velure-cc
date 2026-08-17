import { convexQuery } from "@convex-dev/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
export const Route = createFileRoute("/invoices/")({
	beforeLoad: ({ context }) => {
		// Fire-and-forget: warm the cache without blocking the transition.
		void context.queryClient
			.prefetchQuery(
				convexQuery(api.invoices.list, {
					q: "",
					status: "all",
					type: "all",
				}),
			)
			.catch(() => undefined);
	},
});
