import { importJWK, SignJWT } from "jose";
import { getAuthSessionFromRequest } from "#/server/security-stepup";

type MintedSession = {
	accessToken: string;
	expiresAt: number;
	velureUserId: string;
};

export async function mintSupabaseAccessToken(
	request: Request,
): Promise<MintedSession | null> {
	const session = await getAuthSessionFromRequest(request);
	const userId = session?.user.id;
	if (!userId) return null;
	const expiresAt = Math.floor(Date.now() / 1000) + 60 * 30;
	const privateJwk = process.env.SUPABASE_JWT_PRIVATE_JWK;
	const legacySecret = process.env.SUPABASE_JWT_SECRET;
	if (!privateJwk && !legacySecret) {
		throw new Error(
			"Configure SUPABASE_JWT_PRIVATE_JWK or SUPABASE_JWT_SECRET",
		);
	}
	const parsedJwk = privateJwk
		? (JSON.parse(privateJwk) as Record<string, unknown>)
		: null;
	if (privateJwk && typeof parsedJwk?.kid !== "string") {
		throw new Error(
			"SUPABASE_JWT_PRIVATE_JWK must include its Supabase key kid",
		);
	}
	const token = new SignJWT({
		sub: userId,
		velure_user_id: userId,
		role: "authenticated",
		aud: "authenticated",
	})
		.setIssuedAt()
		.setExpirationTime(expiresAt);
	const accessToken = privateJwk
		? await token
				.setProtectedHeader({
					alg: "ES256",
					kid: parsedJwk?.kid as string,
					typ: "JWT",
				})
				.sign(
					await importJWK(
						{
							...parsedJwk,
							key_ops: ["sign"],
						},
						"ES256",
					),
				)
		: await token
				.setProtectedHeader({ alg: "HS256", typ: "JWT" })
				.sign(new TextEncoder().encode(legacySecret));
	return { accessToken, expiresAt, velureUserId: userId };
}
