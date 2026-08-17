import { createFileRoute, redirect } from "@tanstack/react-router";

// Folded into the landing page (/#compliance). Kept as a redirect so existing
// links and bookmarks resolve instead of 404.
export const Route = createFileRoute("/compliance")({
	beforeLoad: () => {
		throw redirect({ to: "/", hash: "compliance", replace: true });
	},
});
