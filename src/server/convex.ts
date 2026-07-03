import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

let client: ConvexHttpClient | null = null;

function deploymentUrl() {
	return (
		process.env.CONVEX_URL ??
		process.env.VITE_CONVEX_URL ??
		process.env.NUXT_CONVEX_URL ??
		""
	);
}

export function getServerConvexClient() {
	if (client) return client;

	const url = deploymentUrl();
	if (!url) {
		throw new Error(
			"Missing CONVEX_URL or VITE_CONVEX_URL for server integration callbacks.",
		);
	}

	client = new ConvexHttpClient(url);
	return client;
}

export async function completeOAuthConnectionOnServer(
	sessionToken: string,
	args: {
		provider: "quickbooks" | "xero";
		externalAccountId?: string;
		accessToken: string;
		refreshToken?: string;
		expiresAt?: number;
		configJson?: string;
	},
) {
	const url = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL ?? "";
	if (!url) {
		throw new Error("Missing CONVEX_URL or VITE_CONVEX_URL.");
	}
	const convex = new ConvexHttpClient(url);
	convex.setAuth(sessionToken);
	return await convex.action(
		api.integrations.completeOAuthConnectionAction,
		args,
	);
}
