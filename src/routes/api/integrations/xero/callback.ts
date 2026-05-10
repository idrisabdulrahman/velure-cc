import { createFileRoute } from "@tanstack/react-router";
import { completeOAuthConnectionOnServer, resolveWorkspaceOwnerIdOnServer } from "#/server/convex";
import {
  clearOAuthStateCookie,
  exchangeXeroCode,
  getXeroTenant,
  readOAuthStateCookie,
} from "#/server/integrations-oauth";
import { getAuthSessionFromRequest } from "#/server/security-stepup";

async function handle({ request }: { request: Request }) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const session = await getAuthSessionFromRequest(request);
  const oauthState = readOAuthStateCookie(request);

  if (
    !session?.user?.id ||
    !oauthState ||
    oauthState.provider !== "xero" ||
    oauthState.state !== state ||
    !code
  ) {
    return new Response(null, {
      status: 302,
      headers: {
        location: `${url.origin}/settings/integrations?provider=xero&status=error`,
        "set-cookie": clearOAuthStateCookie(request),
      },
    });
  }

  try {
    const token = await exchangeXeroCode(request, code);
    const tenant = await getXeroTenant(token.access_token);
    const ownerId = await resolveWorkspaceOwnerIdOnServer(session.user.id);
    await completeOAuthConnectionOnServer({
      ownerId,
      provider: "xero",
      externalAccountId: tenant?.tenantId,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
      configJson: JSON.stringify(tenant ?? {}),
    });
    return new Response(null, {
      status: 302,
      headers: {
        location: `${url.origin}/settings/integrations?provider=xero&status=connected`,
        "set-cookie": clearOAuthStateCookie(request),
      },
    });
  } catch {
    return new Response(null, {
      status: 302,
      headers: {
        location: `${url.origin}/settings/integrations?provider=xero&status=error`,
        "set-cookie": clearOAuthStateCookie(request),
      },
    });
  }
}

export const Route = createFileRoute("/api/integrations/xero/callback")({
  server: {
    handlers: {
      GET: handle,
    },
  },
});
