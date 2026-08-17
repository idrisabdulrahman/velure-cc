/**
 * Server-side verification of Velure JWTs against the OIDC JWKS.
 *
 * This is the piece the A9 runtime will use (and the RLS activation depends
 * on): any token accepted by PostgREST/Supabase must verify here with the same
 * issuer, audience, asymmetric signature and kid. Verification is done with
 * `jose` directly (not better-auth's own verify) to prove standards
 * compliance.
 */
import { importJWK, jwtVerify, type JWTPayload } from "jose";

export interface VerifiedToken {
	/** The Better Auth user id carried in the `sub` claim. */
	sub: string;
	payload: JWTPayload;
}

export interface VerifyOptions {
	issuer: string;
	audience: string | string[];
}

export async function verifyVelureJwt(
	token: string,
	jwks: { keys: Array<Record<string, string>> },
	expected: VerifyOptions,
): Promise<VerifiedToken> {
	if (typeof token !== "string" || token.split(".").length !== 3) {
		throw new Error("Not a JWT: expected three dot-separated segments");
	}

	const header = JSON.parse(
		Buffer.from(token.split(".")[0]!, "base64url").toString("utf8"),
	) as { alg?: string; kid?: string };

	if (!header.kid) throw new Error("JWT missing kid header");
	const jwk = jwks.keys.find((key) => key.kid === header.kid);
	if (!jwk) throw new Error(`No JWKS key found for kid ${header.kid}`);

	const key = await importJWK(jwk, header.alg);
	const { payload } = await jwtVerify(token, key, {
		issuer: expected.issuer,
		audience: expected.audience,
	});

	if (typeof payload.sub !== "string" || payload.sub.length === 0) {
		throw new Error("JWT missing non-empty sub claim");
	}

	return { sub: payload.sub, payload };
}
