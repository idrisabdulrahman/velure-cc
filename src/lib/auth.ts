import { betterAuth } from "better-auth";
import pg from "pg";
import { env } from "#/env";
import { sendOnboardingEmail } from "#/server/onboarding-mailer";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error(
		"DATABASE_URL is required for the Postgres Better Auth runtime; run the Better Auth migration first",
	);
}
const pool = new pg.Pool({
	connectionString: databaseUrl,
	options: "-c search_path=better_auth",
});

export const auth = betterAuth({
	appName: "Velure",
	baseURL: process.env.BETTER_AUTH_URL ?? process.env.SITE_URL,
	secret: env.BETTER_AUTH_SECRET,
	database: pool,
	trustedOrigins: [process.env.BETTER_AUTH_URL, process.env.SITE_URL].filter(
		(value): value is string => Boolean(value),
	),
	emailAndPassword: { enabled: true },
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
	advanced: { useSecureCookies: process.env.NODE_ENV === "production" },
});
