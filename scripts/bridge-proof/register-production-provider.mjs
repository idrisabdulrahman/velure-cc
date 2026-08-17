/**
 * Register the production better-auth issuer as the `custom:velure` OIDC
 * provider on `velure-cc`.
 *
 * To be run ONCE after the production issuer is deployed and reachable at
 * ISSUER_URL (Supabase fetches discovery + JWKS from it server-side):
 *
 *   SUPABASE_SERVICE_KEY=... ISSUER_URL=https://auth.yourdomain.com \
 *     node scripts/bridge-proof/register-production-provider.mjs
 *
 * The script is idempotent: if a provider with the same identifier exists it
 * updates its issuer to the new URL (registration is the only change; the
 * existing Supabase users/identities are untouched). It verifies the issuer's
 * discovery document is reachable and RS256-capable BEFORE registering, so a
 * dead or misconfigured issuer can never be registered.
 *
 * The provider id (`custom:velure`) must match what the custom access token
 * hook (`public.custom_access_token_hook`) filters on — see
 * 20260815223943_phase_a9_identity_sub_claim_hook.sql.
 *
 * Env: SUPABASE_SERVICE_KEY, ISSUER_URL (public production issuer URL).
 */
import process from "node:process";

const REF = "kbexydkmmfabfutgkbxn";
const API = `https://${REF}.supabase.co`;
const PROVIDER_IDENTIFIER = "custom:velure";

const serviceKey = process.env.SUPABASE_SERVICE_KEY;
const ISSUER_URL = process.env.ISSUER_URL;
if (!serviceKey) throw new Error("SUPABASE_SERVICE_KEY is required");
if (!ISSUER_URL) throw new Error("ISSUER_URL is required (the production issuer public URL)");

// 1. Verify the issuer is live and RS256 before touching anything.
console.log(`verifying issuer ${ISSUER_URL} ...`);
const discRes = await fetch(`${ISSUER_URL}/.well-known/openid-configuration`);
if (!discRes.ok) throw new Error(`issuer discovery failed: ${discRes.status}`);
const disc = await discRes.json();
if (!disc.jwks_uri || !disc.authorization_endpoint || !disc.token_endpoint) {
	throw new Error(`issuer discovery incomplete: ${JSON.stringify(Object.keys(disc))}`);
}
const jwksRes = await fetch(disc.jwks_uri);
const jwks = await jwksRes.json();
const hasRS256 = (jwks.keys ?? []).some((k) => k.alg === "RS256" && k.kty === "RSA");
if (!hasRS256) throw new Error("issuer JWKS has no RS256 RSA key — GoTrue cannot verify id_tokens");
console.log(`  discovery OK (jwks_uri=${disc.jwks_uri}, RS256 present)`);

// 2. Idempotent register/update.
const list = await fetch(`${API}/auth/v1/admin/custom-providers`, {
	headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
});
const listBody = await list.json();
const existing = (listBody.providers ?? []).find((p) => p.identifier === PROVIDER_IDENTIFIER);

if (existing) {
	const res = await fetch(`${API}/auth/v1/admin/custom-providers/${PROVIDER_IDENTIFIER}`, {
		method: "PUT",
		headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
		body: JSON.stringify({
			provider_type: "oidc",
			identifier: PROVIDER_IDENTIFIER,
			name: existing.name ?? "Velure (production issuer)",
			client_id: existing.client_id,
			client_secret: existing.client_secret,
			issuer: ISSUER_URL,
			scopes: existing.scopes ?? ["openid", "profile", "email"],
		}),
	});
	if (!res.ok) throw new Error(`update provider: ${res.status} ${await res.text()}`);
	console.log(`updated ${PROVIDER_IDENTIFIER} issuer -> ${ISSUER_URL}`);
} else {
	const res = await fetch(`${API}/auth/v1/admin/custom-providers`, {
		method: "POST",
		headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
		body: JSON.stringify({
			provider_type: "oidc",
			identifier: PROVIDER_IDENTIFIER,
			name: "Velure (production issuer)",
			client_id: "velure-supabase-client",
			client_secret: process.env.OIDC_CLIENT_SECRET ?? "velure-supabase-client-secret-prod",
			issuer: ISSUER_URL,
			scopes: ["openid", "profile", "email"],
		}),
	});
	if (!res.ok) throw new Error(`register provider: ${res.status} ${await res.text()}`);
	console.log(`registered ${PROVIDER_IDENTIFIER} -> ${ISSUER_URL}`);
}

// 3. Confirm.
const after = await fetch(`${API}/auth/v1/admin/custom-providers`, {
	headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
});
const afterBody = await after.json();
const prov = (afterBody.providers ?? []).find((p) => p.identifier === PROVIDER_IDENTIFIER);
console.log(`provider state: enabled=${prov?.enabled} issuer=${prov?.issuer} pkce=${prov?.pkce ?? "n/a"}`);
if (prov?.issuer !== ISSUER_URL) process.exitCode = 1;
