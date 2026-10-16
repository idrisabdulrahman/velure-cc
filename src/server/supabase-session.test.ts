import { exportJWK, generateKeyPair, jwtVerify } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthSessionFromRequest = vi.fn();
vi.mock("#/server/security-stepup", () => ({ getAuthSessionFromRequest }));

describe("local Supabase session token", () => {
	beforeEach(async () => {
		const keys = await generateKeyPair("ES256", { extractable: true });
		const privateJwk = await exportJWK(keys.privateKey);
		privateJwk.kid = "test-key";
		privateJwk.key_ops = ["sign", "verify"];
		process.env.SUPABASE_JWT_PRIVATE_JWK = JSON.stringify(privateJwk);
		process.env.SUPABASE_JWT_KEY_ID = "test-key";
		(globalThis as { testPublicKey?: CryptoKey }).testPublicKey =
			keys.publicKey;
		getAuthSessionFromRequest.mockReset();
	});

	it("copies the verified Better Auth id into RLS claims", async () => {
		getAuthSessionFromRequest.mockResolvedValue({
			user: { id: "k5-user" },
			session: { id: "session" },
		});
		const { mintSupabaseAccessToken } = await import("./supabase-session");
		const minted = await mintSupabaseAccessToken(
			new Request("http://localhost"),
		);
		expect(minted).not.toBeNull();
		const publicKey = (globalThis as { testPublicKey?: CryptoKey })
			.testPublicKey;
		if (!publicKey) throw new Error("missing test public key");
		const verified = await jwtVerify(minted?.accessToken ?? "", publicKey);
		expect(verified.payload.sub).toBe("k5-user");
		expect(verified.payload.velure_user_id).toBe("k5-user");
		expect(verified.payload.role).toBe("authenticated");
	});

	it("does not mint without a verified session", async () => {
		getAuthSessionFromRequest.mockResolvedValue(null);
		const { mintSupabaseAccessToken } = await import("./supabase-session");
		expect(
			await mintSupabaseAccessToken(new Request("http://localhost")),
		).toBeNull();
	});

	it("supports the project's legacy JWT secret", async () => {
		delete process.env.SUPABASE_JWT_PRIVATE_JWK;
		process.env.SUPABASE_JWT_SECRET = "legacy-supabase-jwt-secret";
		getAuthSessionFromRequest.mockResolvedValue({
			user: { id: "k5-legacy" },
			session: { id: "session" },
		});
		const { mintSupabaseAccessToken } = await import("./supabase-session");
		const minted = await mintSupabaseAccessToken(
			new Request("http://localhost"),
		);
		const verified = await jwtVerify(
			minted?.accessToken ?? "",
			new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET),
		);
		expect(verified.payload.velure_user_id).toBe("k5-legacy");
	});
});
