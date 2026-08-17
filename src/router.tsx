import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { getContext } from "./integrations/tanstack-query/root-provider";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const router = createTanStackRouter({
		routeTree,

		context: getContext(),

		scrollRestoration: true,
		defaultViewTransition: true,
		defaultHashScrollIntoView: {
			behavior: "smooth",
			block: "start",
		},
		defaultPreload: "intent",
		// Keep hover/focus preloads warm for a minute so a click after hovering
		// reuses the already-loaded chunk + data instead of starting over.
		defaultPreloadStaleTime: 60_000,
	});

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
