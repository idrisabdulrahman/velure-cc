import { createFileRoute } from "@tanstack/react-router";
import { completeOAuthConnectionOnServer, resolveWorkspaceOwnerIdOnServer } from "#/server/convex";
import {
  clearOAuthStateCookie,
  exchangeQuickBooksCode,
  readOAuthStateCookie,
} from "#/server/integrations-oauth";
import { getAuthSessionFromRequest } from "#/server/security-stepup";

async function handle({ request }: { request: Request }) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId") ?? undefined;
  const session = await getAuthSessionFromRequest(request);
  const oauthState = readOAuthStateCookie(request);

  if (
    !session?.user?.id ||
    !oauthState ||
    oauthState.provider !== "quickbooks" ||
    oauthState.state !== state ||
    !code
  ) {
    return new Response(null, {
      status: 302,
      headers: {
        location: `${url.origin}/settings/integrations?provider=quickbooks&status=error`,
        "set-cookie": clearOAuthStateCookie(request),
      },
    });
  }

  try {
    const token = await exchangeQuickBooksCode(request, code);
    const ownerId = await resolveWorkspaceOwnerIdOnServer(session.user.id);
    await completeOAuthConnectionOnServer({
      ownerId,
      provider: "quickbooks",
      externalAccountId: realmId,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
      configJson: JSON.stringify({ realmId }),
    });
    return new Response(null, {
      status: 302,
      headers: {
        location: `${url.origin}/settings/integrations?provider=quickbooks&status=connected`,
        "set-cookie": clearOAuthStateCookie(request),
      },
    });
  } catch {
    return new Response(null, {
      status: 302,
      headers: {
        location: `${url.origin}/settings/integrations?provider=quickbooks&status=error`,
        "set-cookie": clearOAuthStateCookie(request),
      },
    });
  }
}

export const Route = createFileRoute("/api/integrations/quickbooks/callback")({
  server: {
    handlers: {
      GET: handle,
    },
  },
});
