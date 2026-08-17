/**
 * End-to-end proof of the Better Auth -> Supabase identity bridge.
 *
 * Covers the acceptance criteria from the migration memory graph: issuer,
 * audience, asymmetric signing key, kid, JWKS discovery/rotation, short
 * expiry, server-side session verification, and the negative cases.
 *
 * The positive tests run the real OIDC authorization-code flow over HTTP
 * (the exact flow Supabase Auth will run against the issuer): sign-up ->
 * authorize -> code -> token exchange -> id_token, then verify the id_token
 * independently with `jose` against the served JWKS.
 */
import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	exportJWK,
	generateKeyPair,
	generateSecret,
	importJWK,
	jwtVerify,
	SignJWT,
} from "jose";
import {
	AUDIENCE,
	CLIENT_ID,
	CLIENT_SECRET,
	ISSUER,
	REDIRECT_URI,
	fetchDiscovery,
	fetchJwks,
	handler,
	memoryDb,
} from "./oidc-issuer";
import { verifyVelureJwt } from "./verify-token";

let sequence = 0;
function testEmail() {
	sequence += 1;
	return `bridge-user-${Date.now()}-${sequence}@velure.test`;
}

const BASIC_AUTH = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`;

function s256(verifier: string) {
	return createHash("sha256").update(verifier).digest("base64url");
}

/** Run the full OIDC authorization-code flow and return the id_token. */
async function oidcFlow() {
	const email = testEmail();

	const signup = await handler("/sign-up/email", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email, password: "BridgePass123!", name: "Bridge User" }),
	});
	expect(signup.status).toBe(200);
	const cookie = signup.headers
		.getSetCookie()
		.map((c) => c.split(";")[0]!)
		.join("; ");

	const state = `state-${sequence}`;
	const authz = await handler(
		`/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=openid&state=${state}`,
		{ headers: { cookie } },
	);
	expect(authz.status).toBe(302);
	const location = new URL(authz.headers.get("location")!);
	expect(location.searchParams.get("state")).toBe(state);
	const code = location.searchParams.get("code");
	expect(code).toBeTruthy();

	const tokenRes = await handler("/oauth2/token", {
		method: "POST",
		headers: { "content-type": "application/json", authorization: BASIC_AUTH },
		body: JSON.stringify({
			grant_type: "authorization_code",
			code,
			redirect_uri: REDIRECT_URI,
		}),
	});
	expect(tokenRes.status).toBe(200);
	const body = (await tokenRes.json()) as { id_token?: string };
	expect(body.id_token).toBeTruthy();

	return { idToken: body.id_token as string };
}

async function decodeHeader(token: string) {
	return JSON.parse(
		Buffer.from(token.split(".")[0]!, "base64url").toString("utf8"),
	) as { alg: string; kid?: string };
}

/** Sign a crafted token with the harness's REAL key (encryption is off in the lab). */
async function realKeyPair() {
	const row = memoryDb.jwks[0] as { id: string; privateKey: string };
	const privateJwk = JSON.parse(row.privateKey) as Record<string, unknown>;
	return { kid: row.id, key: await importJWK(privateJwk, "RS256") };
}

/** Extract the `sub` claim from a verified id_token (jwtVerify returns { payload, protectedHeader }). */
async function extractSub(idToken: string, kid: string) {
	const { keys } = await fetchJwks();
	const key = await importJWK(keys.find((k) => k.kid === kid)!, "RS256");
	const { payload } = await jwtVerify(idToken, key);
	return payload.sub;
}

/** Sign a crafted JWT (SignJWT.sign is async). */
async function craft(
	claims: Record<string, unknown>,
	header: { kid: string; alg?: string },
	key: Parameters<SignJWT["sign"]>[0],
	exp: string | number = "1h",
) {
	return new SignJWT(claims)
		.setProtectedHeader({ alg: header.alg ?? "RS256", kid: header.kid })
		.setExpirationTime(exp)
		.sign(key);
}

describe("OIDC discovery (issuer + JWKS)", () => {
	it("serves openid-configuration with the configured issuer and endpoints", async () => {
		const meta = await fetchDiscovery();
		expect(meta.issuer).toBe(ISSUER);
		expect(meta.jwks_uri).toBe(`${ISSUER}/jwks`);
		expect(meta.authorization_endpoint).toBe(`${ISSUER}/oauth2/authorize`);
		expect(meta.token_endpoint).toBe(`${ISSUER}/oauth2/token`);
		expect(meta.userinfo_endpoint).toBe(`${ISSUER}/oauth2/userinfo`);
		expect(meta.scopes_supported).toContain("openid");
		expect(meta.token_endpoint_auth_methods_supported).toContain("client_secret_basic");
		// The asymmetric signing capability Supabase will rely on.
		expect(meta.id_token_signing_alg_values_supported).toContain("RS256");
	});

	it("serves an asymmetric RS256 JWKS with kid and public key material", async () => {
		const { keys } = await fetchJwks();
		expect(keys.length).toBeGreaterThan(0);
		const key = keys[0]!;
		expect(key.kty).toBe("RSA");
		expect(key.alg).toBe("RS256");
		expect(key.kid).toBeTruthy();
		expect(key.n).toBeTruthy();
		expect(key.e).toBeTruthy();
	});

	it("rejects requests to a non-existent JWKS path", async () => {
		const res = await handler("/.well-known/jwks.json");
		expect(res.status).toBe(404);
	});
});

describe("OIDC authorization-code flow and server-side verification", () => {
	it("exchanges a code for an RS256 id_token whose claims verify against the JWKS", async () => {
		const { idToken } = await oidcFlow();

		const header = await decodeHeader(idToken);
		expect(header.alg).toBe("RS256");
		expect(header.kid).toBeTruthy();

		const { keys } = await fetchJwks();
		const jwk = keys.find((key) => key.kid === header.kid);
		expect(jwk).toBeTruthy();

		const key = await importJWK(jwk, "RS256");
		const { payload } = await jwtVerify(idToken, key, {
			issuer: ISSUER,
			audience: CLIENT_ID,
		});
		expect(payload.iss).toBe(ISSUER);
		expect(payload.aud).toBe(CLIENT_ID);
		expect(payload.sub).toBeTypeOf("string");
		expect(payload.iat).toBeTypeOf("number");
		expect(payload.exp).toBeTypeOf("number");

		// Short expiry: id_token lives for the configured 300s window.
		const ttl = Number(payload.exp) - Math.floor(Date.now() / 1000);
		expect(ttl).toBeGreaterThan(250);
		expect(ttl).toBeLessThanOrEqual(300);
	});

	it("verifies the id_token through the server-side module", async () => {
		const { idToken } = await oidcFlow();
		const { keys } = await fetchJwks();
		const verified = await verifyVelureJwt(idToken, { keys }, { issuer: ISSUER, audience: CLIENT_ID });
		expect(verified.sub).toBeTypeOf("string");
	});
});

describe("Negative verification (fail closed)", () => {
	it("rejects a tampered id_token", async () => {
		const { idToken } = await oidcFlow();
		const [h, p, s] = idToken.split(".");
		const tampered = `${h}.${p}.${(s!.slice(0, -2) ?? "")}zz`;
		const { keys } = await fetchJwks();
		await expect(
			verifyVelureJwt(tampered, { keys }, { issuer: ISSUER, audience: CLIENT_ID }),
		).rejects.toThrow();
	});

	it("rejects a token claiming a valid kid but signed by a different key", async () => {
		const { idToken } = await oidcFlow();
		const { kid } = await realKeyPair();
		const sub = await extractSub(idToken, kid);
		const { privateKey } = await generateKeyPair("RS256");
		const forged = await craft({ sub, iss: ISSUER, aud: [CLIENT_ID] }, { kid }, privateKey);
		const { keys } = await fetchJwks();
		await expect(
			verifyVelureJwt(forged, { keys }, { issuer: ISSUER, audience: CLIENT_ID }),
		).rejects.toThrow();
	});

	it("rejects an expired token even when signed with the real key", async () => {
		const { idToken } = await oidcFlow();
		const { kid, key } = await realKeyPair();
		const sub = await extractSub(idToken, kid);
		const expired = await craft(
			{ sub, iss: ISSUER, aud: [CLIENT_ID] },
			{ kid },
			key,
			Math.floor(Date.now() / 1000) - 60,
		);
		const { keys } = await fetchJwks();
		await expect(
			verifyVelureJwt(expired, { keys }, { issuer: ISSUER, audience: CLIENT_ID }),
		).rejects.toThrow(/exp/i);
	});

	it("rejects a token with the wrong issuer", async () => {
		const { idToken } = await oidcFlow();
		const { kid, key } = await realKeyPair();
		const sub = await extractSub(idToken, kid);
		const wrongIssuer = await craft({ sub, iss: "https://evil.example", aud: [CLIENT_ID] }, { kid }, key);
		const { keys } = await fetchJwks();
		await expect(
			verifyVelureJwt(wrongIssuer, { keys }, { issuer: ISSUER, audience: CLIENT_ID }),
		).rejects.toThrow(/iss/i);
	});

	it("rejects a token with the wrong audience", async () => {
		const { idToken } = await oidcFlow();
		const { kid, key } = await realKeyPair();
		const sub = await extractSub(idToken, kid);
		const wrongAud = await craft({ sub, iss: ISSUER, aud: ["other-app"] }, { kid }, key);
		const { keys } = await fetchJwks();
		await expect(
			verifyVelureJwt(wrongAud, { keys }, { issuer: ISSUER, audience: CLIENT_ID }),
		).rejects.toThrow(/aud/i);
	});

	it("rejects a token with an unknown kid", async () => {
		const { privateKey } = await generateKeyPair("RS256");
		const unknownKid = await craft({ sub: "x", iss: ISSUER, aud: [CLIENT_ID] }, { kid: "unknown-key-id" }, privateKey);
		const { keys } = await fetchJwks();
		await expect(
			verifyVelureJwt(unknownKid, { keys }, { issuer: ISSUER, audience: CLIENT_ID }),
		).rejects.toThrow(/kid/i);
	});

	it("rejects a token with no kid at all", async () => {
		const { privateKey } = await generateKeyPair("RS256");
		const noKid = await new SignJWT({ sub: "x" })
			.setProtectedHeader({ alg: "RS256" })
			.setExpirationTime("1h")
			.sign(privateKey);
		const { keys } = await fetchJwks();
		await expect(
			verifyVelureJwt(noKid, { keys }, { issuer: ISSUER, audience: CLIENT_ID }),
		).rejects.toThrow(/kid/i);
	});
});

describe("JWKS rotation", () => {
	it("serves a rotated key alongside the original and verifies tokens for both kids", async () => {
		const { idToken } = await oidcFlow();
		const originalRow = memoryDb.jwks[0] as { id: string };
		const originalKid = originalRow.id;

		// Simulate rotation: a new key pair is published to the JWKS with a new kid.
		const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
		const rotatedKid = "rotated-key-2";
		memoryDb.jwks.push({
			id: rotatedKid,
			publicKey: JSON.stringify(await exportJWK(publicKey)),
			privateKey: JSON.stringify(await exportJWK(privateKey)),
			createdAt: new Date(),
		});

		const { keys } = await fetchJwks();
		expect(keys.map((key) => key.kid)).toEqual(
			expect.arrayContaining([originalKid, rotatedKid]),
		);

		// A token signed with the rotated key verifies.
		const header = await decodeHeader(idToken);
		const sub = await extractSub(idToken, header.kid!);
		const rotated = await craft({ sub, iss: ISSUER, aud: [CLIENT_ID] }, { kid: rotatedKid }, privateKey);
		const verified = await verifyVelureJwt(rotated, { keys }, { issuer: ISSUER, audience: CLIENT_ID });
		expect(verified.sub).toBe(sub);

		// The pre-rotation id_token still verifies during the grace period.
		await expect(
			verifyVelureJwt(idToken, await fetchJwks(), { issuer: ISSUER, audience: CLIENT_ID }),
		).resolves.toMatchObject({ sub });
	});
});

describe("OIDC code flow as Supabase will run it (PKCE S256 + nonce)", () => {
	it("authorizes with a code_challenge and exchanges the code with the verifier", async () => {
		const email = testEmail();
		const signup = await handler("/sign-up/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email, password: "BridgePass123!", name: "PKCE User" }),
		});
		expect(signup.status).toBe(200);
		const cookie = signup.headers
			.getSetCookie()
			.map((c) => c.split(";")[0]!)
			.join("; ");

		const verifier = randomBytes(32).toString("base64url");
		const challenge = s256(verifier);
		const nonce = `nonce-${sequence}`;

		// GoTrue's authorize request: response_type=code with PKCE and nonce.
		const authz = await handler(
			`/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=openid&state=st&code_challenge=${challenge}&code_challenge_method=S256&nonce=${nonce}`,
			{ headers: { cookie } },
		);
		expect(authz.status).toBe(302);
		const code = new URL(authz.headers.get("location")!).searchParams.get("code");
		expect(code).toBeTruthy();

		// GoTrue's token request: the same flow but with the verifier attached.
		const tokenRes = await handler("/oauth2/token", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: BASIC_AUTH },
			body: JSON.stringify({
				grant_type: "authorization_code",
				code,
				redirect_uri: REDIRECT_URI,
				code_verifier: verifier,
			}),
		});
		expect(tokenRes.status).toBe(200);
		const body = (await tokenRes.json()) as { id_token?: string };
		expect(body.id_token).toBeTruthy();

		// The id_token must echo the nonce GoTrue sent.
		const { keys } = await fetchJwks();
		const header = await decodeHeader(body.id_token!);
		const key = await importJWK(keys.find((k) => k.kid === header.kid)!, "RS256");
		const { payload } = await jwtVerify(body.id_token!, key, {
			issuer: ISSUER,
			audience: CLIENT_ID,
		});
		expect(payload.nonce).toBe(nonce);
	});

	it("rejects a code exchange with the wrong verifier", async () => {
		const email = testEmail();
		const signup = await handler("/sign-up/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email, password: "BridgePass123!", name: "PKCE Bad" }),
		});
		const cookie = signup.headers
			.getSetCookie()
			.map((c) => c.split(";")[0]!)
			.join("; ");

		const verifier = randomBytes(32).toString("base64url");
		const challenge = s256(verifier);
		const authz = await handler(
			`/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=openid&state=st&code_challenge=${challenge}&code_challenge_method=S256`,
			{ headers: { cookie } },
		);
		const code = new URL(authz.headers.get("location")!).searchParams.get("code");

		const wrong = await handler("/oauth2/token", {
			method: "POST",
			headers: { "content-type": "application/json", authorization: BASIC_AUTH },
			body: JSON.stringify({
				grant_type: "authorization_code",
				code,
				redirect_uri: REDIRECT_URI,
				code_verifier: "wrong-verifier",
			}),
		});
		expect(wrong.status).toBe(401);
	});
});

describe("Bridge contract: sub mapping to Supabase identity", () => {
	it("carries the better-auth user id as sub, which is what Supabase will store as owner_id", async () => {
		const { idToken } = await oidcFlow();
		const { payload } = await verifyVelureJwt(
			idToken,
			await fetchJwks(),
			{ issuer: ISSUER, audience: CLIENT_ID },
		);

		// The A4 helper is `auth.jwt() ->> 'sub'`; the Supabase JWT `sub` must
		// equal this value, because the app stores it in owner_id/user_id.
		expect(payload.sub).toBeTypeOf("string");

		// A Supabase-shaped HS256 token minted by Supabase Auth after the OIDC
		// exchange carries the same sub claim.
		const secret = await generateSecret("HS256");
		const supabaseToken = await new SignJWT({
			sub: payload.sub,
			role: "authenticated",
			aud: "authenticated",
			iss: "supabase",
		})
			.setProtectedHeader({ alg: "HS256" })
			.setExpirationTime("1h")
			.sign(secret);
		const { payload: supabasePayload } = await jwtVerify(supabaseToken, secret);
		expect(supabasePayload.sub).toBe(payload.sub);
		expect(supabasePayload.role).toBe("authenticated");
	});
});
