import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

let client: ConvexHttpClient | null = null;

function deploymentUrl() {
  return process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL ?? process.env.NUXT_CONVEX_URL ?? "";
}

export function getServerConvexClient() {
  if (client) return client;

  const url = deploymentUrl();
  if (!url) {
    throw new Error("Missing CONVEX_URL or VITE_CONVEX_URL for server integration callbacks.");
  }

  client = new ConvexHttpClient(url);
  return client;
}

export async function completeOAuthConnectionOnServer(args: {
  ownerId: string;
  provider: "quickbooks" | "xero";
  externalAccountId?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  configJson?: string;
}) {
  const convex = getServerConvexClient();
  return await convex.mutation(api.integrations.completeOAuthConnection, args);
}

export async function resolveWorkspaceOwnerIdOnServer(sessionUserId: string) {
  const convex = getServerConvexClient();
  return await convex.query(api.integrations.resolveWorkspaceOwnerFromSessionUser, {
    sessionUserId,
  });
}
