/**
 * Better Auth -> Supabase identity bridge proof harness.
 *
 * Stands up a standalone better-auth instance (the A9 shape: plain better-auth,
 * no Convex component) configured as an OpenID Connect provider:
 *
 *   - `jwt` plugin: RS256 asymmetric signing, explicit issuer + audience,
 *     short token expiry (1 minute), keys served from a JWKS endpoint.
 *   - `oidcProvider` plugin: OIDC discovery + authorization code + token
 *     exchange + userinfo, with a trusted client standing in for Supabase.
 *
 * Runs entirely in-process on a memory adapter; no server, no network, no
 * live-project writes. `auth.handler(request)` is better-auth's own request
 * handler.
 *
 * NOTE: `disablePrivateKeyEncryption` is on ONLY so the test suite can sign
 * crafted negative tokens (expired / wrong issuer / wrong audience) with the
 * real key. Production keeps private-key encryption enabled.
 */
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { jwt, oidcProvider } from "better-auth/plugins";

export const ISSUER = "https://auth.velure.test";
export const AUDIENCE = "velure-api";
export const CLIENT_ID = "velure-supabase-client";
export const CLIENT_SECRET = "velure-supabase-client-secret";
export const REDIRECT_URI = "https://app.velure.test/auth/callback";

export const memoryDb: Record<string, unknown[]> = {
	user: [],
	session: [],
	account: [],
	verification: [],
	jwks: [],
	oauthApplication: [],
	oauthAccessToken: [],
	oauthConsent: [],
};

export const auth = betterAuth({
	baseURL: ISSUER,
	basePath: "",
	secret: "bridge-proof-secret-do-not-use-in-production-0123456789",
	database: memoryAdapter(memoryDb),
	emailAndPassword: { enabled: true },
	plugins: [
		jwt({
			jwt: {
				issuer: ISSUER,
				audience: [AUDIENCE],
				expirationTime: "1 minute",
			},
			jwks: {
				keyPairConfig: { alg: "RS256" },
				disablePrivateKeyEncryption: true,
			},
		}),
		oidcProvider({
			useJWTPlugin: true,
			accessTokenExpiresIn: 300,
			allowDynamicClientRegistration: false,
			trustedClients: [
				{
					clientId: CLIENT_ID,
					clientSecret: CLIENT_SECRET,
					redirectUrls: [REDIRECT_URI],
					skipConsent: true,
					metadata: {},
				},
			],
		}),
	],
});

/** In-process request against the better-auth handler. */
export function handler(path: string, init?: RequestInit): Promise<Response> {
	return auth.handler(new Request(`${ISSUER}${path}`, init));
}

/** Fetch the served JWKS through the handler. */
export async function fetchJwks(): Promise<{ keys: Array<Record<string, string>> }> {
	const res = await handler("/jwks");
	if (res.status !== 200) throw new Error(`JWKS endpoint returned ${res.status}`);
	return res.json();
}

/** Fetch OIDC discovery metadata through the handler. */
export async function fetchDiscovery(): Promise<Record<string, unknown>> {
	const res = await handler("/.well-known/openid-configuration");
	if (res.status !== 200) throw new Error(`Discovery endpoint returned ${res.status}`);
	return res.json();
}
