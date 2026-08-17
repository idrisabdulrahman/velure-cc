import { createFileRoute, redirect } from "@tanstack/react-router";

// Folded into the landing page (/#enterprise). Kept as a redirect so existing
// links and bookmarks resolve instead of 404.
export const Route = createFileRoute("/solutions/enterprise")({
	beforeLoad: () => {
		throw redirect({ to: "/", hash: "enterprise", replace: true });
	},
});
