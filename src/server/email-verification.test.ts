import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
	MARK_EMAIL_VERIFIED_SQL,
	markEmailVerified,
	REVOKE_UNVERIFIED_CREDENTIAL_SQL,
	revokeUnverifiedCredentialAccount,
} from "./email-verification-db";
import {
	SHARED_RATE_LIMIT_CUSTOM_RULES,
	sharedRateLimitWindow,
} from "./rate-limit-store";

/**
 * Email verification for password accounts.
 *
 * Three layers are checked:
 *
 *   - **Wiring**: the production singleton must actually require verification,
 *     send on both sign-up and sign-in, and expose the revocation hook. Without
 *     this the behavioural tests below could pass against a test-only config.
 *   - **Behaviour**: a real Better Auth handler on the memory adapter, with the
 *     same options, drives sign-up, the blocked sign-in, the emailed token, and
 *     the post-verification sign-in.
 *   - **Database safety**: the two raw statements that 1.4.9 does not provide -
 *     the unverified-credential revocation and the password-reset verification
 *     - are pinned by text and parameter, because a mistake there is a silent
 *     security or lockout bug.
 */

const SECRET = "email-verification-test-secret-32-chars";
const PASSWORD = "correct-horse-battery";
const BASE_URL = "http://localhost:3000";

type SentVerification = {
	user: { email: string; name?: string | null };
	url: string;
	token: string;
};

type ProductionOptions = {
	emailAndPassword?: {
		requireEmailVerification?: boolean;
		onPasswordReset?: unknown;
		sendResetPassword?: unknown;
	};
	emailVerification?: {
		expiresIn?: number;
		sendOnSignUp?: boolean;
		sendOnSignIn?: boolean;
		autoSignInAfterVerification?: boolean;
		sendVerificationEmail?: unknown;
	};
	databaseHooks?: {
		account?: { create?: { after?: unknown } };
		user?: { create?: { after?: unknown } };
	};
};

let production: ProductionOptions;
let productionExpiresIn: number;

beforeAll(async () => {
	process.env.BETTER_AUTH_SECRET = SECRET;
	process.env.RESEND_API_KEY = "test-resend-key";
	process.env.RESEND_FROM_EMAIL = "Invoicly <no-reply@example.com>";
	process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
	process.env.BETTER_AUTH_URL = BASE_URL;
	process.env.SITE_URL = BASE_URL;

	const module = await import("#/lib/auth");
	production = module.auth.options as unknown as ProductionOptions;
	productionExpiresIn = module.EMAIL_VERIFICATION_EXPIRES_IN;
});

afterEach(() => {
	vi.unstubAllGlobals();
});

async function createTestAuth(sent: SentVerification[]) {
	const { betterAuth } = await import("better-auth");
	const { memoryAdapter } = await import("better-auth/adapters/memory");

	return betterAuth({
		baseURL: BASE_URL,
		secret: SECRET,
		database: memoryAdapter({
			user: [],
			session: [],
			account: [],
			verification: [],
			rateLimit: [],
		}),
		emailAndPassword: {
			enabled: true,
			minPasswordLength: 8,
			requireEmailVerification: true,
			revokeSessionsOnPasswordReset: true,
		},
		emailVerification: {
			expiresIn: productionExpiresIn,
			sendOnSignUp: true,
			sendOnSignIn: true,
			autoSignInAfterVerification: true,
			sendVerificationEmail: async (data: SentVerification) => {
				sent.push({
					user: { email: data.user.email, name: data.user.name },
					url: data.url,
					token: data.token,
				});
			},
		},
		rateLimit: { enabled: false },
	});
}

function jsonRequest(path: string, body: Record<string, unknown>) {
	return new Request(`${BASE_URL}${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

function sessionCookieFrom(response: Response) {
	return (response.headers.get("set-cookie") ?? "")
		.split(",")
		.map((part) => part.trim().split(";")[0])
		.filter((part) => part.includes("session_token"))
		.join("; ");
}

async function signUp(auth: Awaited<ReturnType<typeof createTestAuth>>) {
	return auth.handler(
		jsonRequest("/api/auth/sign-up/email", {
			email: "ada@example.com",
			password: PASSWORD,
			name: "Ada Lovelace",
		}),
	);
}

async function signIn(auth: Awaited<ReturnType<typeof createTestAuth>>) {
	return auth.handler(
		jsonRequest("/api/auth/sign-in/email", {
			email: "ada@example.com",
			password: PASSWORD,
		}),
	);
}

describe("production configuration", () => {
	it("requires a verified address before a password can sign in", () => {
		expect(production.emailAndPassword?.requireEmailVerification).toBe(true);
	});

	it("sends on sign-up and on sign-in, and auto-signs-in after verification", () => {
		expect(production.emailVerification?.expiresIn).toBe(3600);
		expect(productionExpiresIn).toBe(3600);
		expect(production.emailVerification?.sendOnSignUp).toBe(true);
		expect(production.emailVerification?.sendOnSignIn).toBe(true);
		expect(production.emailVerification?.autoSignInAfterVerification).toBe(
			true,
		);
		expect(typeof production.emailVerification?.sendVerificationEmail).toBe(
			"function",
		);
	});

	it("treats a completed password reset as proof of address ownership", () => {
		expect(typeof production.emailAndPassword?.onPasswordReset).toBe(
			"function",
		);
	});

	it("exposes the reset-password callback /request-password-reset requires", () => {
		// Without this callback Better Auth answers /request-password-reset with
		// 400 "Reset password isn't enabled" instead of sending the mail - the
		// production bug this assertion would have caught.
		expect(typeof production.emailAndPassword?.sendResetPassword).toBe(
			"function",
		);
	});

	it("wires the unverified-credential revocation onto social account creation", () => {
		expect(typeof production.databaseHooks?.account?.create?.after).toBe(
			"function",
		);
		// The onboarding welcome mail must stay attached to user creation.
		expect(typeof production.databaseHooks?.user?.create?.after).toBe(
			"function",
		);
	});

	it("rate limits verification mail to a per-hour budget", () => {
		expect(SHARED_RATE_LIMIT_CUSTOM_RULES["/send-verification-email*"]).toEqual(
			{
				window: 3600,
				max: 5,
			},
		);
		// The store and Better Auth must count over the same window, or the
		// counter resets long before the hourly budget expires.
		expect(sharedRateLimitWindow("203.0.113.7/send-verification-email")).toBe(
			3600,
		);
	});
});

describe("password sign-up before verification", () => {
	it("creates the account without a session and emails a verification link", async () => {
		const sent: SentVerification[] = [];
		const auth = await createTestAuth(sent);

		const signUpResponse = await signUp(auth);
		expect(signUpResponse.status).toBe(200);
		const body = (await signUpResponse.json()) as {
			token: string | null;
			user: { emailVerified: boolean };
		};
		expect(body.token).toBeNull();
		expect(body.user.emailVerified).toBe(false);
		expect(sessionCookieFrom(signUpResponse)).toBe("");

		expect(sent).toHaveLength(1);
		expect(sent[0]?.user.email).toBe("ada@example.com");
		expect(sent[0]?.url).toContain(`${BASE_URL}/api/auth/verify-email?token=`);
		expect(sent[0]?.token).toBeTruthy();
	});

	it("refuses the password sign-in and mails a fresh link", async () => {
		const sent: SentVerification[] = [];
		const auth = await createTestAuth(sent);
		await signUp(auth);

		const response = await signIn(auth);
		expect(response.status).toBe(403);
		expect(sessionCookieFrom(response)).toBe("");

		const body = (await response.json()) as { message?: string };
		expect(body.message?.toLowerCase()).toContain("email not verified");

		// sendOnSignIn: the blocked attempt replaces the lost link.
		expect(sent).toHaveLength(2);
		expect(sent[1]?.url).toContain("/api/auth/verify-email?token=");
	});
});

describe("opening the verification link", () => {
	it("verifies the address, signs the user in, and returns to the callback", async () => {
		const sent: SentVerification[] = [];
		const auth = await createTestAuth(sent);
		await signUp(auth);

		const token = new URL(sent[0]?.url ?? "").searchParams.get("token");
		expect(token).toBeTruthy();

		const callbackURL = `${BASE_URL}/verify-email?next=%2Finvoices`;
		const verification = await auth.handler(
			new Request(
				`${BASE_URL}/api/auth/verify-email?token=${token}&callbackURL=${encodeURIComponent(callbackURL)}`,
			),
		);
		expect(verification.status).toBe(302);
		expect(verification.headers.get("location")).toBe(callbackURL);

		const cookie = sessionCookieFrom(verification);
		expect(cookie).toContain("session_token");

		const session = await auth.api.getSession({
			headers: new Headers({ cookie }),
		});
		expect(session?.user.email).toBe("ada@example.com");
		expect(session?.user.emailVerified).toBe(true);

		// The password now opens a session.
		const response = await signIn(auth);
		expect(response.status).toBe(200);
		expect(sessionCookieFrom(response)).toContain("session_token");
	});

	it("redirects an unusable token back with an error instead of verifying", async () => {
		const sent: SentVerification[] = [];
		const auth = await createTestAuth(sent);
		await signUp(auth);

		const callbackURL = `${BASE_URL}/verify-email?next=%2Finvoices`;
		const verification = await auth.handler(
			new Request(
				`${BASE_URL}/api/auth/verify-email?token=not-a-token&callbackURL=${encodeURIComponent(callbackURL)}`,
			),
		);

		expect(verification.status).toBe(302);
		expect(verification.headers.get("location")).toBe(
			`${callbackURL}&error=invalid_token`,
		);
		expect(sessionCookieFrom(verification)).toBe("");

		// Still unverified: the password remains unusable.
		const response = await signIn(auth);
		expect(response.status).toBe(403);
	});
});

describe("resending", () => {
	it("answers the same for an unknown address and sends nothing", async () => {
		const sent: SentVerification[] = [];
		const auth = await createTestAuth(sent);

		const response = await auth.handler(
			jsonRequest("/api/auth/send-verification-email", {
				email: "nobody@example.com",
				callbackURL: `${BASE_URL}/verify-email?next=%2Finvoices`,
			}),
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ status: true });
		// No account enumeration: identical response, but no mail.
		expect(sent).toHaveLength(0);
	});
});

describe("unverified credential revocation", () => {
	type Query = (text: string, values?: unknown[]) => Promise<unknown>;

	function fakeDb(rowCount: number) {
		const calls: Array<{ text: string; values?: unknown[] }> = [];
		const query: Query = async (text, values) => {
			calls.push({ text, values });
			return { rowCount };
		};
		return { calls, db: { query } as never };
	}

	it("deletes only an unverified password when a social provider links", async () => {
		const { calls, db } = fakeDb(1);

		await expect(
			revokeUnverifiedCredentialAccount(db, {
				userId: "user_1",
				providerId: "google",
			}),
		).resolves.toBe(true);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.text).toBe(REVOKE_UNVERIFIED_CREDENTIAL_SQL);
		expect(calls[0]?.text).toContain('better_auth."account"');
		expect(calls[0]?.text).toContain(`a."providerId" = 'credential'`);
		expect(calls[0]?.text).toContain('u."emailVerified" = false');
		expect(calls[0]?.values).toEqual(["user_1"]);
	});

	it("skips the credential account that sign-up itself is creating", async () => {
		const { calls, db } = fakeDb(1);

		await expect(
			revokeUnverifiedCredentialAccount(db, {
				userId: "user_1",
				providerId: "credential",
			}),
		).resolves.toBe(false);

		expect(calls).toHaveLength(0);
	});

	it("reports no revocation when the user was already verified", async () => {
		const { db } = fakeDb(0);

		await expect(
			revokeUnverifiedCredentialAccount(db, {
				userId: "user_1",
				providerId: "google",
			}),
		).resolves.toBe(false);
	});

	it("marks the address verified after a password reset", async () => {
		const { calls, db } = fakeDb(1);

		await markEmailVerified(db, "user_1");

		expect(calls).toHaveLength(1);
		expect(calls[0]?.text).toBe(MARK_EMAIL_VERIFIED_SQL);
		expect(calls[0]?.text).toContain('set "emailVerified" = true');
		expect(calls[0]?.values).toEqual(["user_1"]);
	});
});
