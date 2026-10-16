import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/invoices/")({
	beforeLoad: ({ context }) => {
		// Fire-and-forget: warm the cache without blocking the transition.
		void context.queryClient.invalidateQueries({
			queryKey: ["supabase-invoices"],
		});
	},
});
