import { createFileRoute } from "@tanstack/react-router";
import {
	buildOAuthStateCookie,
	createOAuthState,
	getXeroAuthorizeUrl,
} from "#/server/integrations-oauth";
import { getAuthSessionFromRequest } from "#/server/security-stepup";

async function handle({ request }: { request: Request }) {
	const session = await getAuthSessionFromRequest(request);
	if (!session?.user?.id || !session.session?.id) {
		return new Response("Authentication required.", { status: 401 });
	}

	const oauthState = createOAuthState("xero", {
		userId: session.user.id,
		sessionId: session.session.id,
	});
	return new Response(null, {
		status: 302,
		headers: {
			location: getXeroAuthorizeUrl(request, oauthState.state),
			"set-cookie": buildOAuthStateCookie(request, oauthState),
		},
	});
}

export const Route = createFileRoute("/api/integrations/xero/connect")({
	server: {
		handlers: {
			GET: handle,
		},
	},
});
