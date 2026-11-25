import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Signing in with Google must land an existing email+password user in their own
 * account, without a manual trip to Security.
 *
 * The bug (reported 2026-11-04, reproduced here): Better Auth links implicitly
 * only when
 *
 *   `(!isTrustedProvider && !userInfo.emailVerified) || enabled === false`
 *   (`better-auth/dist/oauth2/link-account.mjs:21`)
 *
 * and `callback.mjs:100` repeats the same test for the explicit `link` flow.
 * With no `account.accountLinking` config there are no trusted providers, so the
 * outcome hung on Google's `email_verified` claim alone. When that claim is
 * missing or false the callback redirects to `errorCallbackURL` with
 * `error=account_not_linked`, and `/auth` renders "Google sign-in is only
 * available after you link Google from Security" - a dead end, because the user
 * is not signed in yet and cannot reach Security to link anything.
 *
 * Two layers are checked:
 *
 *   - **Wiring**: the real singleton must trust Google and must not allow a
 *     different email to attach to an existing account.
 *   - **Behaviour**: a real Better Auth handler, on the memory adapter, driving
 *     `/sign-in/social` then `/callback/google` with a stubbed Google token
 *     endpoint. The ID token is a synthetic JWT (`getUserInfo` decodes it
 *     without verifying, `core/dist/social-providers/index.mjs`), so this needs
 *     no network and no real Google account.
 */

const SECRET = "google-linking-test-secret-at-least-32-chars";
const EMAIL = "existing.user@gmail.com";

type LinkingOptions = {
	enabled?: boolean;
	trustedProviders?: string[];
	allowDifferentEmails?: boolean;
};

/** The option block the production instance actually ships (see `#/lib/auth`). */
let linking: LinkingOptions;

beforeAll(async () => {
	process.env.BETTER_AUTH_SECRET = SECRET;
	process.env.RESEND_API_KEY = "test-resend-key";
	process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
	process.env.BETTER_AUTH_URL = "http://localhost:3000";
	process.env.SITE_URL = "http://localhost:3000";
	const { auth } = await import("#/lib/auth");
	const options = auth.options as unknown as {
		account?: { accountLinking?: LinkingOptions };
	};
	linking = options.account?.accountLinking ?? {};
});

function fakeIdToken(payload: Record<string, unknown>) {
	const enc = (value: unknown) =>
		Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${enc({ alg: "RS256", typ: "JWT", kid: "test" })}.${enc(payload)}.sig`;
}

/**
 * Google's token endpoint, answering with an ID token. `emailVerified` is left
 * out entirely for the case that used to fail.
 */
function stubGoogleTokenEndpoint(email: string, emailVerified?: boolean) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input instanceof Request ? input.url : input);
			if (!url.includes("oauth2.googleapis.com")) {
				throw new Error(`unexpected fetch to ${url}`);
			}
			const claims: Record<string, unknown> = {
				sub: "google-sub-1",
				email,
				name: "Existing User",
				aud: "test-client-id",
				iss: "https://accounts.google.com",
				iat: Math.floor(Date.now() / 1000),
				exp: Math.floor(Date.now() / 1000) + 3600,
			};
			if (emailVerified !== undefined) claims.email_verified = emailVerified;

			return new Response(
				JSON.stringify({
					access_token: "test-access-token",
					expires_in: 3599,
					scope: "openid email profile",
					token_type: "Bearer",
					id_token: fakeIdToken(claims),
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}),
	);
}

async function signInWithGoogle(email: string, emailVerified?: boolean) {
	const { betterAuth } = await import("better-auth");
	const { memoryAdapter } = await import("better-auth/adapters/memory");

	const auth = betterAuth({
		baseURL: "http://localhost:3000",
		secret: SECRET,
		database: memoryAdapter({
			user: [],
			session: [],
			account: [],
			verification: [],
			rateLimit: [],
		}),
		emailAndPassword: { enabled: true, minPasswordLength: 8 },
		socialProviders: {
			google: { clientId: "test-client-id", clientSecret: "test-secret" },
		},
		rateLimit: { enabled: false },
		account: { accountLinking: linking },
	});

	const signUp = await auth.api.signUpEmail({
		body: { email: EMAIL, password: "correct-horse-battery", name: "Existing" },
	});

	stubGoogleTokenEndpoint(email, emailVerified);

	const start = await auth.handler(
		new Request("http://localhost:3000/api/auth/sign-in/social", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				provider: "google",
				callbackURL: "/",
				errorCallbackURL: "/auth?google=failed",
			}),
		}),
	);
	const { url } = (await start.json()) as { url: string };
	const stateCookie = (start.headers.get("set-cookie") ?? "").split(";")[0];
	const state = new URL(url).searchParams.get("state") ?? "";

	const callback = await auth.handler(
		new Request(
			`http://localhost:3000/api/auth/callback/google?code=test-code&state=${encodeURIComponent(state)}`,
			{ headers: { cookie: stateCookie } },
		),
	);

	const sessionCookie = (callback.headers.get("set-cookie") ?? "")
		.split(",")
		.map((part) => part.trim().split(";")[0])
		.filter((part) => part.includes("session_token"))
		.join("; ");
	const session = sessionCookie
		? await auth.api
				.getSession({ headers: new Headers({ cookie: sessionCookie }) })
				.catch(() => null)
		: null;

	const context = await (
		auth as unknown as {
			$context: Promise<{
				internalAdapter: {
					listUsers: () => Promise<Array<{ id: string; email: string }>>;
					findAccounts: (
						userId: string,
					) => Promise<Array<{ providerId: string }>>;
				};
			}>;
		}
	).$context;
	const users = await context.internalAdapter.listUsers();
	const accounts = await context.internalAdapter.findAccounts(signUp.user.id);

	return {
		location: callback.headers.get("location") ?? "",
		existingUserId: signUp.user.id,
		sessionUserId: session?.user?.id ?? null,
		userEmails: users.map((user) => user.email).sort(),
		existingUserProviders: accounts.map((account) => account.providerId).sort(),
	};
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("google account linking configuration", () => {
	it("trusts Google so the link does not depend on the email_verified claim", () => {
		expect(linking.enabled).toBe(true);
		expect(linking.trustedProviders).toContain("google");
	});

	it("never attaches a Google account with a different email to an existing user", () => {
		// Account takeover guard: linking still requires the emails to match.
		expect(linking.allowDifferentEmails).not.toBe(true);
	});
});

describe("google sign-in for an existing email+password user", () => {
	it("signs into the existing account when Google omits email_verified", async () => {
		const result = await signInWithGoogle(EMAIL, undefined);

		expect(result.location).toBe("/");
		expect(result.sessionUserId).toBe(result.existingUserId);
		expect(result.existingUserProviders).toEqual(["credential", "google"]);
		expect(result.userEmails).toEqual([EMAIL]);
	});

	it("signs into the existing account when Google reports a verified email", async () => {
		const result = await signInWithGoogle(EMAIL, true);

		expect(result.location).toBe("/");
		expect(result.sessionUserId).toBe(result.existingUserId);
	});

	it("creates a separate user instead of attaching a different Google email", async () => {
		const result = await signInWithGoogle("someone.else@gmail.com", true);

		expect(result.location).toBe("/");
		expect(result.sessionUserId).not.toBe(result.existingUserId);
		expect(result.userEmails).toEqual([EMAIL, "someone.else@gmail.com"]);
		// The pre-existing account keeps only its password.
		expect(result.existingUserProviders).toEqual(["credential"]);
	});
});
