import { createFileRoute } from "@tanstack/react-router";
import { getAuthSessionFromRequest } from "#/server/security-stepup";
import {
  buildOAuthStateCookie,
  createOAuthState,
  getXeroAuthorizeUrl,
} from "#/server/integrations-oauth";

async function handle({ request }: { request: Request }) {
  const session = await getAuthSessionFromRequest(request);
  if (!session?.user?.id) {
    return new Response("Authentication required.", { status: 401 });
  }

  const oauthState = createOAuthState("xero");
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
