import { expect, type Page } from "@playwright/test";

/**
 * Shared plumbing for the authenticated `app` specs (`e2e/app/*.spec.ts`).
 *
 * Every app spec inherits the storage state captured by `e2e/auth.setup.ts`, so
 * it starts signed in. This module only holds things that must behave the same
 * everywhere: the route inventory, a console-error collector, and a navigation
 * helper that waits for the dashboard shell.
 *
 * MUTATION POLICY (AGENTS section 13): these specs are read-only against a real
 * account. Navigate, filter, and fill fields to their validation edges, but do
 * not submit a create/update/delete, do not send email, do not pay, do not
 * change a password, and do not switch the active workspace.
 */

/** Every route that renders inside the dashboard shell. */
export const APP_ROUTES = [
	"/invoices",
	"/invoices/new",
	"/invoices/products",
	"/invoices/products/new",
	"/clients",
	"/clients/new",
	"/reports",
	"/expenses",
	"/settings",
	"/settings/compliance",
	"/settings/collections",
	"/settings/recurring",
	"/settings/integrations",
	"/settings/security",
] as const;

/** Public / signed-out surfaces, checked without the stored session. */
export const PUBLIC_ROUTES = [
	"/",
	"/features",
	"/pricing",
	"/privacy",
	"/terms",
] as const;

/**
 * Console errors and uncaught exceptions observed on a page.
 *
 * Network-level resource failures are dropped: on a local run the browser
 * sandbox and the machine's network produce transient `ERR_NETWORK_CHANGED` /
 * `ERR_NAME_NOT_RESOLVED` noise, and the backing Supabase project can answer a
 * request with 429 under sustained load. Neither says anything about the app.
 * Errors that *are* about the app - uncaught exceptions, React errors, or a
 * resource the server answered with a non-throttling status (e.g. a 500) - are
 * still collected.
 */
export function collectPageErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on("pageerror", (error) => {
		errors.push(`pageerror: ${error.message}`);
	});
	page.on("console", (message) => {
		if (message.type() !== "error") return;
		const text = message.text();
		if (/\bnet::ERR_[A-Z_]+/.test(text)) return;
		if (/status of 429\b/.test(text)) return;
		errors.push(`console: ${text}`);
	});
	return errors;
}

/**
 * How long to wait for the dashboard shell. The primary nav is the stable
 * marker for "shell mounted": it is present on every section and absent while
 * the loader gate is up. It mounts only after the session + Supabase bridge
 * settle, and on the Vite dev server a route compile takes several seconds, so
 * this is generous rather than tight.
 */
const SHELL_TIMEOUT_MS = 60_000;

/**
 * True when the page has settled on the sign-in screen instead of the shell.
 * A session lookup that fails transiently (the dev server's Supabase round
 * trip, under load) makes the app treat the visitor as signed out and redirect
 * to /auth. That is not a test failure of the page under audit, so `gotoApp`
 * retries it; a genuinely expired session keeps bouncing and fails loudly.
 */
const AUTH_BOUNCE_ATTEMPTS = 3;

/** Navigates to a dashboard route and waits for the shell. */
export async function gotoApp(page: Page, path: string): Promise<void> {
	const shell = page.getByRole("navigation", { name: "Primary" });
	let outcome: "shell" | "auth" | "other" = "other";

	for (let attempt = 1; attempt <= AUTH_BOUNCE_ATTEMPTS; attempt++) {
		await page.goto(path, { waitUntil: "domcontentloaded" });

		// Wait for whichever settles first: the shell mounting, or a bounce to
		// the sign-in screen. Racing them catches a late bounce instead of
		// waiting out the whole shell timeout first.
		outcome = await Promise.race([
			shell
				.waitFor({ state: "visible", timeout: SHELL_TIMEOUT_MS })
				.then(() => "shell" as const)
				.catch(() => "other" as const),
			page
				.waitForURL((url) => url.pathname === "/auth", {
					timeout: SHELL_TIMEOUT_MS,
				})
				.then(() => "auth" as const)
				.catch(() => "other" as const),
		]);

		if (outcome === "shell") return;

		if (outcome === "auth") {
			// Pause so a transient backend hiccup can clear before retrying.
			await page.waitForTimeout(2_000);
			continue;
		}

		// Neither the shell nor /auth appeared within the budget.
		break;
	}

	if (outcome === "other") {
		// Report what the page actually is, rather than a bare timeout.
		await expect(shell).toBeVisible({ timeout: 5_000 });
	}

	throw new Error(
		`gotoApp(${path}) landed on /auth ${AUTH_BOUNCE_ATTEMPTS} times: the session was not accepted`,
	);
}

/** The app shell mounts only after the workspace bridge settles; wait for it. */
export async function waitForShell(page: Page): Promise<void> {
	await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({
		timeout: SHELL_TIMEOUT_MS,
	});
}
