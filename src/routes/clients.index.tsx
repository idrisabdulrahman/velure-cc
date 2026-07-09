import { convexQuery } from "@convex-dev/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";

export const Route = createFileRoute("/clients/")({
	beforeLoad: async ({ context }) => {
		await context.queryClient.prefetchQuery(
			convexQuery(api.clients.list, {
				q: "",
				status: "all",
			}),
		);
	},
});
