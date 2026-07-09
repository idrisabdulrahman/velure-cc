import { convexQuery } from "@convex-dev/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "../../convex/_generated/api";

export const Route = createFileRoute("/invoices/")({
	beforeLoad: async ({ context }) => {
		await context.queryClient.prefetchQuery(
			convexQuery(api.invoices.list, {
				q: "",
				status: "all",
				type: "all",
			}),
		);
	},
});
