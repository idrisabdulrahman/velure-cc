import { createFileRoute } from "@tanstack/react-router";
import { auth } from "#/lib/auth";
import { withAuthConnection } from "#/server/auth-database";

export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET: ({ request }) => withAuthConnection(() => auth.handler(request)),
			POST: ({ request }) => withAuthConnection(() => auth.handler(request)),
		},
	},
});
