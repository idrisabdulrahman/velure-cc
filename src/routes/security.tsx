import { createFileRoute, redirect } from "@tanstack/react-router";

// Folded into the landing page (/#security). Kept as a redirect so existing
// links and bookmarks resolve instead of 404.
export const Route = createFileRoute("/security")({
	beforeLoad: () => {
		throw redirect({ to: "/", hash: "security", replace: true });
	},
});
