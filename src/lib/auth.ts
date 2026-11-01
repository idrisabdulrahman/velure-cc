import { betterAuth } from "better-auth";
import { env } from "#/env";
import { createAuthPool } from "#/server/auth-database";
import { createAuthLogger } from "#/server/auth-logger";
import { sendOnboardingEmail } from "#/server/onboarding-mailer";

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

export const auth = betterAuth({
	appName: "Velure",
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
		// Resetting a password must invalidate every other session.
		revokeSessionsOnPasswordReset: true,
	},
	rateLimit: {
		// better-auth only enables this by default in production. Pin it so a
		// mis-set `NODE_ENV` cannot silently drop brute-force protection.
		enabled: true,
		customRules: {
			// Pin the credentials endpoints this app exposes at the strict
			// built-in budget (3 attempts per 10 s per IP and path) so the limit
			// is explicit and reviewable rather than implicit.
			"/sign-in/email": { window: 10, max: 3 },
			"/sign-up/email": { window: 10, max: 3 },
			// Password reset is not covered by the strict built-in rule (it would
			// otherwise allow 100 per 10 s) and each call can send an email.
			"/forget-password*": { window: 3600, max: 5 },
			"/reset-password*": { window: 3600, max: 5 },
		},
	},
	databaseHooks: {
		user: {
			create: {
				after: async (user) => {
					try {
						await sendOnboardingEmail(user);
					} catch (error) {
						console.error("Failed to send onboarding email", error);
					}
				},
			},
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
		useSecureCookies: isProduction,
		ipAddress: {
			// Only the header the reverse proxy controls is trusted. better-auth
			// reads the FIRST entry of `x-forwarded-for`, so nginx must REPLACE it
			// (`proxy_set_header X-Forwarded-For $remote_addr`) and never append to
			// a client-supplied value, or the rate-limit key becomes spoofable.
			ipAddressHeaders: ["x-forwarded-for"],
		},
	},
});
