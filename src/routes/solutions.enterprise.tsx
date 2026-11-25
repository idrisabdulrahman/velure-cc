import { createFileRoute, redirect } from "@tanstack/react-router";

// The dedicated solutions page was retired and its content folded into the
// features marketing page. Redirect directly to that route instead of the
// never-existing `/#enterprise` anchor, so old links and bookmarks land on real
// content rather than the top of the homepage.
export const Route = createFileRoute("/solutions/enterprise")({
	beforeLoad: () => {
		throw redirect({ to: "/features", replace: true });
	},
});
