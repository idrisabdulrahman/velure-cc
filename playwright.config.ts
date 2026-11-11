import { defineConfig } from "@playwright/test";

/**
 * Authenticated app specs live under `e2e/app/` and reuse one sign-in captured
 * by `e2e/auth.setup.ts` (see that file for why it is cached). The pre-existing
 * `authenticated-responsive.spec.ts` needs the same session, so it runs in its
 * own `legacy-auth` project that also depends on `setup`. The genuinely
 * signed-out specs stay in the `public` project, which owns its own context.
 *
 *   E2E_EMAIL=... E2E_PASSWORD=... pnpm test:e2e            # everything
 *   E2E_EMAIL=... E2E_PASSWORD=... pnpm test:e2e --project=app
 *
 * Without the two env vars only the `public` project is registered, so a fresh
 * clone can still run `pnpm test:e2e` without credentials.
 */

const AUTH_STATE = "e2e/.auth/user.json";
const hasAuth = Boolean(process.env.E2E_EMAIL && process.env.E2E_PASSWORD);

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	reporter: "list",
	expect: { timeout: 15_000 },
	// One worker: the Vite dev server intermittently drops an SSR session lookup
	// when several route loads compile at once, which bounces an authenticated
	// page to /auth. Serial loads keep the run deterministic. Override with
	// `--workers=N` once the suite runs against a production build.
	workers: 1,
	use: {
		baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
		launchOptions: {
			executablePath:
				process.env.E2E_CHROMIUM_EXECUTABLE ?? "/usr/bin/chromium-browser",
			args: ["--no-sandbox", "--disable-setuid-sandbox"],
		},
	},
	projects: [
		...(hasAuth
			? [
					{
						name: "setup",
						testMatch: /auth\.setup\.ts/,
					},
					{
						name: "app",
						testMatch: /app\/.*\.spec\.ts/,
						dependencies: ["setup"],
						use: { storageState: AUTH_STATE },
					},
					{
						name: "legacy-auth",
						testMatch: /authenticated-responsive\.spec\.ts/,
						dependencies: ["setup"],
						use: { storageState: AUTH_STATE },
					},
				]
			: []),
		{
			name: "public",
			testMatch: /.*\.spec\.ts/,
			testIgnore: [
				/app\//,
				/auth\.setup\.ts/,
				/authenticated-responsive\.spec\.ts/,
			],
		},
	],
});
