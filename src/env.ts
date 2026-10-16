import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		SERVER_URL: z.url().optional(),
		BETTER_AUTH_SECRET: z.string().min(1),
		SUPABASE_JWT_PRIVATE_JWK: z.string().min(1).optional(),
		SUPABASE_JWT_KEY_ID: z.string().min(1).optional(),
		SUPABASE_JWT_SECRET: z.string().min(1).optional(),
		RESEND_API_KEY: z.string().min(1),
		RESEND_FROM_EMAIL: z
			.string()
			.regex(
				/^(?:[^<>]+\s*)?<[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+>$/,
				"Use Name <email@domain> for RESEND_FROM_EMAIL",
			)
			.optional(),
		RESEND_WEBHOOK_SECRET: z.string().min(1).optional(),
		INVOICE_SCHEDULER_SECRET: z.string().min(32).optional(),
		SITE_URL: z.url().optional(),
		PAYSTACK_SECRET_KEY: z.string().min(1).optional(),
		PAYSTACK_PUBLIC_KEY: z.string().min(1).optional(),
		SUPABASE_URL: z.url().optional(),
		SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
		SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
	},

	client: {
		VITE_APP_TITLE: z.string().min(1).optional(),
		VITE_SUPABASE_URL: z.url().optional(),
		VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
	},
	clientPrefix: "VITE_",

	/**
	 * What object holds the environment variables at runtime. This is usually
	 * `process.env` or `import.meta.env`.
	 *
	 * In TanStack Start SSR (Nitro), import.meta.env may not have VITE_ vars
	 * because Nitro's SSR bundler handles env differently. Merge with
	 * process.env so SSR can find vars from the host environment too.
	 */
	runtimeEnv: {
		...import.meta.env,
		...(typeof process !== "undefined" ? process.env : {}),
	} as Record<string, string | undefined>,

	/**
	 * By default, this library will feed the environment variables directly to
	 * the Zod validator.
	 *
	 * This means that if you have an empty string for a value that is supposed
	 * to be a number (e.g. `PORT=` in a ".env" file), Zod will incorrectly flag
	 * it as a type mismatch violation. Additionally, if you have an empty string
	 * for a value that is supposed to be a string with a default value (e.g.
	 * `DOMAIN=` in an ".env" file), the default value will never be applied.
	 *
	 * In order to solve these issues, we recommend that all new projects
	 * explicitly specify this option as true.
	 */
	emptyStringAsUndefined: true,
});
