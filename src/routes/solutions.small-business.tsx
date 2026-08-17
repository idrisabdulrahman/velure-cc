import { createFileRoute, redirect } from "@tanstack/react-router";

// Folded into the landing page (/#small-business). Kept as a redirect so
// existing links and bookmarks resolve instead of 404.
export const Route = createFileRoute("/solutions/small-business")({
	beforeLoad: () => {
		throw redirect({ to: "/", hash: "small-business", replace: true });
	},
});
