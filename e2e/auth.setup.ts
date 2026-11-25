import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { expect, test as setup } from "@playwright/test";

/**
 * Signs in once and saves the session for every `app` spec to reuse.
 *
 * Better Auth caps `/sign-in/email` at 3 attempts per 10 s per IP. If each spec
 * signed in for itself - or every Playwright invocation re-authenticated - a
 * full run (or several runs in parallel) would trip that budget and fail with a
 * 429 that has nothing to do with the app. So a recent capture is reused, and a
 * sign-in only happens when the file is missing or older than the window below
 * (well inside the 7-day session cookie).
 */

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
const AUTH_STATE = "e2e/.auth/user.json";
const MAX_AGE_MS = 30 * 60 * 1000;

setup.skip(
	!EMAIL || !PASSWORD,
	"Set E2E_EMAIL and E2E_PASSWORD to run the authenticated app suite.",
);

setup("authenticate", async ({ page }) => {
	if (existsSync(AUTH_STATE)) {
		const ageMs = Date.now() - statSync(AUTH_STATE).mtimeMs;
		if (ageMs < MAX_AGE_MS) return;
	}

	const response = await page.context().request.post("/api/auth/sign-in/email", {
		data: { email: EMAIL, password: PASSWORD },
	});

	expect(
		response.ok(),
		`sign-in failed: ${response.status()} ${await response.text()}`,
	).toBe(true);

	mkdirSync(dirname(AUTH_STATE), { recursive: true });
	await page.context().storageState({ path: AUTH_STATE });
});
