import { convexQuery } from "@convex-dev/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";
export const Route = createFileRoute("/clients/")({
	beforeLoad: ({ context }) => {
		// Fire-and-forget: warm the cache without blocking the transition,
		// so navigation paints immediately and data streams in after.
		void context.queryClient
			.prefetchQuery(
				convexQuery(api.clients.list, {
					q: "",
					status: "all",
				}),
			)
			.catch(() => undefined);
	},
});
