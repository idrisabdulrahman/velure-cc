import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { collectPageErrors, waitForShell } from "./helpers";

/**
 * T-guards — route guards, redirects, public surfaces and API authorization.
 *
 * The `app` project reuses the session saved by `e2e/auth.setup.ts`, so the
 * default `page` is SIGNED IN. Every signed-out assertion below therefore runs
 * in a FRESH context (`browser.newContext()` with an explicit empty
 * storageState, because Playwright Test otherwise propagates the project's
 * storageState into new contexts). The one exception is the sign-in round trip,
 * which uses a fresh context and authenticates through the real
 * `/api/auth/sign-in/email` endpoint exactly once (Better Auth caps that
 * endpoint at 3 attempts / 10 s / IP).
 *
 * READ-ONLY against a real account (AGENTS section 13). This spec only issues
 * GET requests and browser navigations: no create/update/delete, no email, no
 * payments, no workspace switch. The API authorization checks deliberately use
 * GET-only protected endpoints so that, even if a guard somehow regressed, the
 * request could not mutate anything.
 */

test.setTimeout(240_000);

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/** Dashboard routes that must be gated behind a verified session. */
const PROTECTED_ROUTES = [
	"/invoices",
	"/clients",
	"/reports",
	"/expenses",
	"/settings",
	"/settings/security",
] as const;

/** Public marketing/legal pages that must render signed out. */
const MARKETING_ROUTES = [
	{ path: "/", heading: /Send the bill/i },
	{ path: "/features", heading: /Invoice operations without spreadsheet debt/i },
	{ path: "/pricing", heading: /Naira pricing for serious billing work/i },
	{ path: "/privacy", heading: /Privacy policy/i },
	{ path: "/terms", heading: /Terms/i },
] as const;

/**
 * Playwright Test propagates the project's `storageState` into
 * `browser.newContext()` in this version, so a bare `newContext()` is still
 * SIGNED IN. Passing an explicit empty storageState is what actually yields a
 * signed-out cookie jar.
 */
const SIGNED_OUT_STORAGE: {
	cookies: never[];
	origins: never[];
} = { cookies: [], origins: [] };

/**
 * Opens a signed-out browser context with the same baseURL the project uses,
 * so relative navigations and `ctx.request` calls resolve.
 */
async function openSignedOut(browser: Browser): Promise<{
	ctx: BrowserContext;
	page: Page;
}> {
	const ctx = await browser.newContext({
		baseURL: BASE_URL,
		storageState: SIGNED_OUT_STORAGE,
	});
	const page = await ctx.newPage();
	return { ctx, page };
}

/** The `redirect` search param of the current page URL, if any. */
function redirectParam(page: Page): string | null {
	return new URL(page.url()).searchParams.get("redirect");
}

test.describe("guards and redirects", () => {
	test("every protected route redirects a signed-out visitor to /auth with the intended return path", async ({
		browser,
	}) => {
		const { ctx, page } = await openSignedOut(browser);
		const errors = collectPageErrors(page);

		try {
			for (const path of PROTECTED_ROUTES) {
				await page.goto(path, { waitUntil: "domcontentloaded" });

				// The guard lives in DashboardLayout and fires once the session
				// settles to "no user"; wait for the client-side navigation.
				await page.waitForURL(/\/auth(\?|$)/, { timeout: 60_000 });

				const url = new URL(page.url());
				expect(url.pathname, `${path}: should land on /auth`).toBe("/auth");
				expect(
					redirectParam(page),
					`${path}: /auth should carry the protected path in ?redirect=`,
				).toBe(path);

				// Signed out, /auth renders the sign-in form rather than looping.
				await expect(
					page.getByRole("heading", { name: /Sign in to Invoicly/i }).first(),
					`${path}: the sign-in form should render after the redirect`,
				).toBeVisible({ timeout: 30_000 });
			}

			expect(errors, JSON.stringify(errors)).toEqual([]);
		} finally {
			await ctx.close();
		}
	});

	test("a signed-in visitor to /auth is sent to /invoices", async ({ page }) => {
		// `page` inherits the stored authenticated session.
		await page.goto("/auth", { waitUntil: "domcontentloaded" });
		await page.waitForURL(/\/invoices(\?|$)/, { timeout: 60_000 });
		await waitForShell(page);
	});

	test("round trip: signing in through the API grants the authenticated shell", async ({
		browser,
	}) => {
		const email = process.env.E2E_EMAIL;
		const password = process.env.E2E_PASSWORD;
		test.skip(!email || !password, "E2E credentials are required.");

		const ctx = await browser.newContext({
			baseURL: BASE_URL,
			storageState: SIGNED_OUT_STORAGE,
		});
		try {
			// ONE sign-in only: this shares the context cookie jar, so the page
			// created below is authenticated without a second attempt.
			const response = await ctx.request.post("/api/auth/sign-in/email", {
				data: { email, password },
			});
			expect(
				response.ok(),
				`sign-in failed: ${response.status()} ${await response.text()}`,
			).toBe(true);

			const page = await ctx.newPage();
			const errors = collectPageErrors(page);
			await page.goto("/invoices", { waitUntil: "domcontentloaded" });
			await waitForShell(page);

			expect(errors, JSON.stringify(errors)).toEqual([]);
		} finally {
			await ctx.close();
		}
	});

	test("marketing pages render signed out with a heading and no console errors", async ({
		browser,
	}) => {
		const { ctx, page } = await openSignedOut(browser);
		const errors = collectPageErrors(page);

		try {
			for (const route of MARKETING_ROUTES) {
				await page.goto(route.path, { waitUntil: "domcontentloaded" });

				// The landing page renders a bare loader until the session settles,
				// then swaps in the marketing markup.
				await expect(
					page.getByRole("heading", { level: 1, name: route.heading }).first(),
					`${route.path}: should render a level-1 heading`,
				).toBeVisible({ timeout: 45_000 });

				// Nothing should have bounced a signed-out visitor away.
				const url = new URL(page.url());
				expect(url.pathname, `${route.path}: should not redirect`).toBe(
					route.path,
				);
			}

			expect(errors, JSON.stringify(errors)).toEqual([]);
		} finally {
			await ctx.close();
		}
	});

	test("redirect-only routes resolve to their canonical destinations", async ({
		browser,
	}) => {
		const { ctx, page } = await openSignedOut(browser);

		try {
			const cases = [
				{ from: "/compliance", to: "/", hash: "#compliance" },
				{ from: "/security", to: "/", hash: "#security" },
				{ from: "/solutions/enterprise", to: "/features", hash: "" },
				{ from: "/solutions/small-business", to: "/features", hash: "" },
			] as const;

			for (const entry of cases) {
				await page.goto(entry.from, { waitUntil: "domcontentloaded" });
				await page.waitForURL(
					(url) => url.pathname === entry.to,
					{ timeout: 60_000 },
				);

				const url = new URL(page.url());
				expect(url.pathname, `${entry.from} should land on ${entry.to}`).toBe(
					entry.to,
				);
				if (entry.hash) {
					expect(url.hash, `${entry.from} should keep the ${entry.hash} anchor`).toBe(
						entry.hash,
					);
				}
			}
		} finally {
			await ctx.close();
		}
	});
});

test.describe("public invoice surface", () => {
	test("an invalid token renders a graceful not-found state with no crash", async ({
		browser,
	}) => {
		const { ctx, page } = await openSignedOut(browser);
		const errors = collectPageErrors(page);

		try {
			// A random, well-formed token that cannot exist.
			await page.goto(
				`/i/${encodeURIComponent("e2e-invalid-token-9f3a1c")}`,
				{ waitUntil: "domcontentloaded" },
			);
			await expect(
				page.getByRole("heading", { name: /Invoice not found/i }),
			).toBeVisible({ timeout: 45_000 });
			await expect(
				page.getByText(/invalid or no longer available/i),
			).toBeVisible();

			// Path traversal encoded so the browser keeps it as ONE token segment
			// (`..%2F..%2Fetc%2Fpasswd`) rather than normalising the URL away.
			await page.goto(`/i/${encodeURIComponent("../../etc/passwd")}`, {
				waitUntil: "domcontentloaded",
			});
			await expect(
				page.getByRole("heading", { name: /Invoice not found/i }),
			).toBeVisible({ timeout: 45_000 });

			// Chromium logs the expected 404 of the public-invoice fetch as a
			// console error; only uncaught exceptions matter here.
			const unexpected = errors.filter(
				(error) => !error.includes("Failed to load resource"),
			);
			expect(unexpected, JSON.stringify(errors)).toEqual([]);
		} finally {
			await ctx.close();
		}
	});

	test("the public invoice API rejects missing and bogus tokens without leaking data", async ({
		browser,
	}) => {
		const ctx = await browser.newContext({
			baseURL: BASE_URL,
			storageState: SIGNED_OUT_STORAGE,
		});
		try {
			const assertNoInvoiceData = async (
				label: string,
				body: string,
			): Promise<void> => {
				expect(body, `${label}: must not leak an invoice payload`).not.toContain(
					"invoiceNumber",
				);
				expect(body, `${label}: must not leak a customer`).not.toContain(
					"customerName",
				);

				try {
					const parsed = JSON.parse(body) as Record<string, unknown>;
					expect(
						parsed.invoice,
						`${label}: no invoice object may be returned`,
					).toBeUndefined();
				} catch {
					// A non-JSON 404 (the route handler) is acceptable as long as
					// the body carries no invoice fields, asserted above.
				}
			};

			// No token at all: no route matches, so this is a 4xx.
			const noToken = await ctx.request.get("/api/invoice/public");
			expect(noToken.status(), "no token should be a 4xx").toBeGreaterThanOrEqual(
				400,
			);
			expect(noToken.status(), "no token should be a 4xx").toBeLessThan(500);
			await assertNoInvoiceData("no token", await noToken.text());

			// A random bogus token: the token-scoped handler answers 404 JSON.
			const bogus = await ctx.request.get(
				"/api/invoice/public/e2e-bogus-token-2b7d",
			);
			expect(bogus.status(), "bogus token should be 404").toBe(404);
			await assertNoInvoiceData("bogus token", await bogus.text());
		} finally {
			await ctx.close();
		}
	});

	// Fixed 2026-11-08 (E2E audit). A malformed token (null byte, path chars)
	// previously reached Postgres and made `withRequestObservability` answer 500.
	// The token guard now rejects it before any query, so the route keeps its
	// "404 when not found" contract.
	test("malformed token (null byte) returns a 4xx, not a 500", async ({
		browser,
	}) => {
		const ctx = await browser.newContext({
			baseURL: BASE_URL,
			storageState: SIGNED_OUT_STORAGE,
		});
		try {
			for (const method of ["get", "post"] as const) {
				const res = await ctx.request[method]("/api/invoice/public/%00");
				expect(res.status(), `${method} status`).toBe(404);
				const body = await res.text();
				expect(body, `${method} body must not leak invoice data`).not.toMatch(
					/invoiceNumber|lineItems|customer/i,
				);
			}
		} finally {
			await ctx.close();
		}
	});
});

test.describe("API authorization without a session", () => {
	test("protected GET endpoints answer 401 and leak nothing", async ({
		browser,
	}) => {
		// A fresh context has an empty cookie jar, so these requests carry no
		// session — unlike `page.request` on the signed-in default page.
		const ctx = await browser.newContext({
			baseURL: BASE_URL,
			storageState: SIGNED_OUT_STORAGE,
		});
		try {
			const endpoints = [
				"/api/workspace/members",
				"/api/invoice/submission/00000000-0000-0000-0000-000000000000",
			] as const;

			for (const endpoint of endpoints) {
				const res = await ctx.request.get(endpoint);
				expect(
					[401, 403],
					`${endpoint}: should be refused without a session`,
				).toContain(res.status());

				const body = await res.text();
				expect(body, `${endpoint}: must not leak member data`).not.toContain(
					"members",
				);
				expect(body, `${endpoint}: must not leak a member email`).not.toContain(
					"@",
				);

				const parsed = JSON.parse(body) as { ok?: unknown; error?: unknown };
				expect(parsed.ok, `${endpoint}: ok must not be true`).not.toBe(true);
				expect(
					typeof parsed.error,
					`${endpoint}: should explain the refusal`,
				).toBe("string");
			}
		} finally {
			await ctx.close();
		}
	});
});

test.describe("email verification surface", () => {
	test("/verify-email without a token renders gracefully", async ({ browser }) => {
		const { ctx, page } = await openSignedOut(browser);
		const errors = collectPageErrors(page);

		try {
			await page.goto("/verify-email", { waitUntil: "domcontentloaded" });

			await expect(
				page.getByRole("heading", { name: /Verify your email/i }).first(),
			).toBeVisible({ timeout: 45_000 });
			await expect(
				page.getByRole("button", { name: /Send verification email/i }),
			).toBeVisible();

			expect(errors, JSON.stringify(errors)).toEqual([]);
		} finally {
			await ctx.close();
		}
	});
});
