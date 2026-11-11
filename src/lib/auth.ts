import { betterAuth } from "better-auth";
import { env } from "#/env";
import { accountDeletionConfig } from "#/server/account-deletion";
import { createAuthPool } from "#/server/auth-database";
import { createAuthLogger } from "#/server/auth-logger";
import { detectAuthRuntime, trustedIpHeaders } from "#/server/auth-runtime";
import {
	markEmailVerified,
	revokeUnverifiedCredentialAccount,
} from "#/server/email-verification-db";
import { sendOnboardingEmail } from "#/server/onboarding-mailer";
import {
	hashPasswordWithBinding,
	verifyPasswordWithBinding,
} from "#/server/password-hasher-binding";
import { sendPasswordResetEmail } from "#/server/password-reset-mailer";
import {
	createRateLimitStore,
	SHARED_RATE_LIMIT_CUSTOM_RULES,
} from "#/server/rate-limit-store";
import { sendVerificationEmail } from "#/server/verification-mailer";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error(
		"DATABASE_URL is required for the Postgres Better Auth runtime; run the Better Auth migration first",
	);
}
// A module-scope `pg.Pool` is only safe on a long-lived Node host; in a Worker
// invocation it must not outlive the invocation. `createAuthPool` picks the
// right strategy from `AUTH_DB_MODE` (see `deploy/velure.env.example`).
const pool = createAuthPool(databaseUrl);

/**
 * `NODE_ENV=production` is set by the systemd unit. It drives secure cookies
 * (`__Secure-` prefix, HTTPS-only) and better-auth's rate limiting.
 */
const isProduction = process.env.NODE_ENV === "production";

/**
 * Whether this is the Cloudflare Workers runtime rather than the Node host.
 * Decides secure cookies and which client-address header is trusted (see
 * `#/server/auth-runtime` for why they differ).
 */
const authRuntime = detectAuthRuntime();
const isWorkersRuntime = authRuntime === "workers";

/**
 * How long a verification link stays usable. One hour matches Better Auth's
 * default and bounds how long a leaked inbox can be replayed.
 */
export const EMAIL_VERIFICATION_EXPIRES_IN = 3600;

export const auth = betterAuth({
	appName: "Invoicly",
	baseURL: process.env.BETTER_AUTH_URL ?? process.env.SITE_URL,
	secret: env.BETTER_AUTH_SECRET,
	database: pool,
	// Every log line is email-redacted and capped at `warn`; see the module doc.
	logger: createAuthLogger(),
	trustedOrigins: [process.env.BETTER_AUTH_URL, process.env.SITE_URL].filter(
		(value): value is string => Boolean(value),
	),
	emailAndPassword: {
		enabled: true,
		// Enterprise baseline: a 12-character minimum bounds guessing, and the
		// explicit maximum bounds the work one request can force. Both apply only
		// when a password is set, so existing credentials keep signing in.
		minPasswordLength: 12,
		maxPasswordLength: 128,
		// A password account must prove control of its address before the
		// password can open a session. Better Auth then:
		//   - returns no session from `/sign-up/email` (`token: null`),
		//   - refuses `/sign-in/email` with 403 "Email not verified",
		//   - accepts the emailed `/verify-email?token=` GET, from which
		//     `autoSignInAfterVerification` creates the session.
		// Social sign-in is unaffected; Google has already verified the address.
		requireEmailVerification: true,
		// Resetting a password must invalidate every other session.
		revokeSessionsOnPasswordReset: true,
		// Delivering the reset link. Better Auth refuses
		// `/request-password-reset` with "Reset password isn't enabled" unless
		// this callback exists, so it is the switch that turns the flow on.
		// `url` is Better Auth's `/api/auth/reset-password/<token>?callbackURL=`
		// link; the callbackURL is `/auth?mode=reset`, which then redirects to
		// the token-bearing reset form. Delivery mirrors the verification
		// mailer: failures are logged and swallowed so the anonymous response
		// stays identical whether or not the address exists.
		sendResetPassword: async ({ user, url }) => {
			await sendPasswordResetEmail({ user, url });
		},
		// A completed reset proves control of the inbox, so it also counts as
		// verification. Better Auth 1.4.9 does not set `emailVerified` itself on
		// this path; without this a reset user stays locked out by
		// `requireEmailVerification`.
		onPasswordReset: async ({ user }) => {
			try {
				await markEmailVerified(pool, user.id);
			} catch (error) {
				// Never fail a reset that already committed. The user can still
				// request a verification email from the sign-in screen.
				console.error(
					"Failed to mark email verified after password reset",
					error instanceof Error ? error.name : "unknown",
				);
			}
		},
		// scrypt needs ~160-235 ms of CPU, far past the Workers free-plan 10 ms
		// budget, so hashing is offloaded to a Durable Object (30 s budget) when
		// one is bound. With no binding (Node dev, the VPS build, tests) these
		// hash in process. The stored format is unchanged either way.
		password: {
			hash: hashPasswordWithBinding,
			verify: verifyPasswordWithBinding,
		},
	},
	/**
	 * Delivery of the verification link.
	 *
	 * The URL is built by Better Auth (`<baseURL>/api/auth/verify-email?token=...
	 * &callbackURL=...`) and points at our own `/verify-email` page, which shows
	 * the outcome and the resend form. Sending on sign-up covers the normal
	 * flow; sending on sign-in covers a link that expired or was lost, because
	 * the sign-in attempt fails with "Email not verified" and silently mails a
	 * fresh link. `/send-verification-email` is rate limited per IP (see
	 * `SHARED_RATE_LIMIT_CUSTOM_RULES`).
	 */
	emailVerification: {
		expiresIn: EMAIL_VERIFICATION_EXPIRES_IN,
		sendOnSignUp: true,
		sendOnSignIn: true,
		autoSignInAfterVerification: true,
		sendVerificationEmail: async ({ user, url }) => {
			await sendVerificationEmail({ user, url });
		},
	},
	rateLimit: {
		// better-auth only enables this by default in production. Pin it so a
		// mis-set `NODE_ENV` cannot silently drop brute-force protection.
		enabled: true,
		// The default store is a per-isolate `Map`, which does not hold across
		// Worker isolates. Credentialed paths use Postgres instead, so the login
		// flood that would spend the Durable Object request allowance is bounded;
		// session reads keep the in-isolate store so no page load gains a query.
		customStorage: createRateLimitStore({
			pool,
			secret: env.BETTER_AUTH_SECRET,
		}),
		// The rules live beside the store (see `SHARED_RATE_LIMIT_CUSTOM_RULES`)
		// because the store resets its counter on the same window Better Auth
		// enforces. Hard-coding them here would let the two drift.
		customRules: SHARED_RATE_LIMIT_CUSTOM_RULES,
	},
	/**
	 * Account deletion.
	 *
	 * Nothing in `public` references the identity row, so Better Auth's own
	 * `deleteUser` would leave the workspace, invoices, clients and the rest
	 * orphaned. `enabled` opens `POST /delete-user`; `beforeDelete` performs the
	 * application-side cascade through the verified session's user id (see
	 * `#/server/account-deletion` for the scope and why it is server-side).
	 */
	user: {
		deleteUser: accountDeletionConfig(pool),
	},
	databaseHooks: {
		user: {
			create: {
				after: async (user) => {
					try {
						await sendOnboardingEmail(user);
					} catch {
						// `sendOnboardingEmail` logged the provider's status code,
						// error name and redacted message. Re-logging the raw
						// error here would print the address it carries, and a
						// missing welcome mail must never fail the sign-up.
					}
				},
			},
		},
		account: {
			create: {
				/**
				 * Closes pre-hijacking: a password registered against someone
				 * else's address is removed the moment the real owner links a
				 * social provider for that same address. See
				 * `#/server/email-verification-db` for the attack and why the
				 * delete is conditional on the user still being unverified.
				 *
				 * The hook deliberately swallows its own failure. Throwing here
				 * would make the callback report "unable to link account" after
				 * the row was already inserted, and the retry would skip the
				 * hook (the account is linked), leaving the password in place.
				 * A logged failure is visible; a half-failed link is not.
				 */
				after: async (account) => {
					try {
						const revoked = await revokeUnverifiedCredentialAccount(pool, {
							userId: account.userId,
							providerId: account.providerId,
						});
						if (revoked) {
							console.warn(
								"Revoked an unverified password after a social account was linked",
								{ userId: account.userId, provider: account.providerId },
							);
						}
					} catch (error) {
						console.error(
							"Failed to revoke an unverified password after a social link",
							error instanceof Error ? error.name : "unknown",
						);
					}
				},
			},
		},
	},
	/**
	 * An existing email+password user who presses "Continue with Google" must be
	 * signed into that same account. Better Auth does link implicitly, but only
	 * when the provider *also* asserts a verified email:
	 *
	 *   `(!isTrustedProvider && !userInfo.emailVerified) || enabled === false`
	 *   (`better-auth/dist/oauth2/link-account.mjs:21`)
	 *
	 * With no `accountLinking` block there are no trusted providers, so the
	 * decision rests entirely on Google's `email_verified` claim. When that claim
	 * is absent or false the callback returns `?error=account_not_linked`, and
	 * the sign-in page reports "Google sign-in is only available after you link
	 * Google from Security" - the reported bug. Reproduced in
	 * `src/server/google-account-linking.test.ts` against the real handler.
	 *
	 * Trusting Google is correct: Google verifies control of the address before
	 * it issues an ID token, and the link still requires the Google email to
	 * equal the existing account's email (`allowDifferentEmails` stays false), so
	 * a different Google address creates a separate user instead of attaching to
	 * someone else's account.
	 */
	account: {
		accountLinking: {
			enabled: true,
			trustedProviders: ["google"],
		},
	},
	socialProviders:
		process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
			? {
					google: {
						clientId: process.env.GOOGLE_CLIENT_ID,
						clientSecret: process.env.GOOGLE_CLIENT_SECRET,
					},
				}
			: undefined,
	advanced: {
		// Workers has no `NODE_ENV`, and the deployed origin is HTTPS, so the
		// runtime counts as production for cookie purposes too.
		useSecureCookies: isProduction || isWorkersRuntime,
		ipAddress: {
			// Only the header the edge controls is trusted; a client-supplied value
			// would make the rate-limit key spoofable.
			//
			// On nginx that is `x-forwarded-for`, because the proxy must REPLACE it
			// (`proxy_set_header X-Forwarded-For $remote_addr`) and never append to
			// a client value. Cloudflare sends no `x-forwarded-for` for a direct
			// workers.dev request, so on Workers the equivalent authoritative header
			// is `cf-connecting-ip`, which the edge overwrites and strips from
			// client input. Picking by runtime keeps both deployments correct:
			// trusting `cf-connecting-ip` on the VPS would be spoofable (nothing
			// there validates it), and trusting only `x-forwarded-for` on Workers
			// removes the limit entirely (better-auth returns early when the IP is
			// missing - observed in production on 2026-11-03).
			ipAddressHeaders: trustedIpHeaders(authRuntime),
		},
	},
});
