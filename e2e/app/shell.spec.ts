import { expect, test, type Page } from "@playwright/test";
import { collectPageErrors, gotoApp, waitForShell } from "./helpers";

/**
 * T-shell — the dashboard shell and global chrome.
 *
 * Covers the always-present frame around every authenticated screen: the
 * primary sidebar and its active state, the header breadcrumb, the command
 * palette, the theme and text-size toggles, and the workspace / profile
 * dropdowns. These are the controls a user touches on every visit, so a
 * regression here breaks the whole product rather than one screen.
 *
 * READ-ONLY against a real account (AGENTS section 13): this spec navigates,
 * opens menus, filters, and toggles presentation settings. It never submits a
 * create/update/delete, never sends mail, never pays, never changes a password,
 * never switches the active workspace, and never clicks Sign out / Log out.
 * Controls that would mutate on click are asserted to exist and then left
 * alone.
 *
 * The `app` project reuses the session saved by `e2e/auth.setup.ts`.
 */

test.setTimeout(180_000);

const PRIMARY_NAV = "Primary";

/** Workspace section links, in sidebar order, with their routed targets. */
const WORKSPACE_LINKS = [
	{ label: "Invoices", href: "/invoices" },
	{ label: "Clients", href: "/clients" },
	{ label: "Reports", href: "/reports" },
	{ label: "Expenses", href: "/expenses" },
	{ label: "Products", href: "/invoices/products" },
] as const;

/** Settings section links, in sidebar order, with their routed targets. */
const SETTINGS_LINKS = [
	{ label: "General", href: "/settings" },
	{ label: "Compliance", href: "/settings/compliance" },
	{ label: "Payment reminders", href: "/settings/collections" },
	{ label: "Recurring billing", href: "/settings/recurring" },
] as const;

/** Every dashboard route reachable from the sidebar, plus its page title. */
const ROUTE_TITLES = [
	{ href: "/invoices", label: "Invoices" },
	{ href: "/clients", label: "Clients" },
	{ href: "/reports", label: "Reports" },
	{ href: "/expenses", label: "Expenses" },
	{ href: "/invoices/products", label: "Products" },
	{ href: "/settings", label: "General" },
	{ href: "/settings/compliance", label: "Compliance" },
	{ href: "/settings/collections", label: "Payment reminders" },
	{ href: "/settings/recurring", label: "Recurring billing" },
] as const;

/**
 * The visual active sidebar link carries this class token (`navLinkClass` in
 * the layout). TanStack Router additionally writes `aria-current="page"` on
 * its own active link, but with a different (prefix) rule — see the accessibility
 * tests below.
 */
const ACTIVE_CLASS = /before:bg-brand/;

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function primaryNav(page: Page) {
	return page.getByRole("navigation", { name: PRIMARY_NAV });
}

/**
 * A sidebar link by its visible label. Accessible names carry an optional count
 * badge (`"Invoices 12"`), so match the label as a leading word.
 */
function navLink(page: Page, label: string) {
	return primaryNav(page).getByRole("link", {
		name: new RegExp(`^${escapeRegex(label)}(\\s|$)`),
	});
}

/** The workspace switcher button (first control in the sidebar header). */
function workspaceTrigger(page: Page) {
	return page.locator("aside button").first();
}

/** The header breadcrumb `<p>` (workspace label / current page title). */
function breadcrumb(page: Page) {
	return page.locator("header p").first();
}

/** The workspace label shown in the sidebar switcher / header. */
async function workspaceLabel(page: Page): Promise<string> {
	const label = (await workspaceTrigger(page).innerText()).trim();
	expect(label.length, "workspace label should not be empty").toBeGreaterThan(0);
	return label;
}

test.describe("dashboard shell", () => {
	test("sidebar renders every workspace and settings link with the right href", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/invoices");

		const nav = primaryNav(page);
		await expect(nav).toBeVisible();

		// Both section headings are present, so the links are grouped as
		// designed rather than dumped in one list.
		await expect(nav.getByText("Workspace", { exact: true })).toBeVisible();
		await expect(nav.getByText("Settings", { exact: true })).toBeVisible();

		for (const item of [...WORKSPACE_LINKS, ...SETTINGS_LINKS]) {
			const link = navLink(page, item.label);
			await expect(link, `${item.label} link should be visible`).toBeVisible();

			const href = await link.getAttribute("href");
			// TanStack Router renders a client-side href; accept an absolute form
			// (http://host/path) or the bare path, but the path must match exactly.
			expect(
				href === item.href || href === `http://localhost:3000${item.href}`,
				`${item.label} href should route to ${item.href} (was ${href})`,
			).toBe(true);
		}

		// The brand lockup links home to the ledger.
		await expect(
			page.locator("aside a").first(),
		).toHaveAttribute("href", /\/invoices$/);

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("the active route is marked on its link, and the header breadcrumb names the page", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/invoices");
		const wsLabel = await workspaceLabel(page);

		for (const route of ROUTE_TITLES) {
			await gotoApp(page, route.href);
			await waitForShell(page);

			// Breadcrumb: "<workspace label> / <page title>".
			const crumb = breadcrumb(page);
			await expect(crumb).toBeVisible();
			await expect(crumb).toContainText(wsLabel);
			await expect(
				crumb,
				`breadcrumb should name "${route.label}" on ${route.href}`,
			).toContainText(route.label);

			// The matching link is active (visual class), and no other is.
			for (const item of [...WORKSPACE_LINKS, ...SETTINGS_LINKS]) {
				const link = navLink(page, item.label);
				if (item.label === route.label) {
					await expect(
						link,
						`${item.label} should be active on ${route.href}`,
					).toHaveClass(ACTIVE_CLASS);
				} else {
					await expect(
						link,
						`${item.label} should NOT be active on ${route.href}`,
					).not.toHaveClass(ACTIVE_CLASS);
				}
			}
		}

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("active nav state is exposed on a flat route: aria-current matches the visual active link", async ({
		page,
	}) => {
		// On a flat route the markup agrees. The visual signal is the layout's
		// `navLinkClass(active)` (a gradient + `before:bg-brand` bar); TanStack
		// Router's `<Link>` also writes `aria-current="page"` on its active link.
		await gotoApp(page, "/invoices");

		const invoices = navLink(page, "Invoices");
		await expect(invoices).toHaveClass(ACTIVE_CLASS);
		await expect(invoices).toHaveAttribute("aria-current", "page");

		await expect(navLink(page, "Clients")).not.toHaveClass(ACTIVE_CLASS);
		await expect(navLink(page, "Clients")).not.toHaveAttribute(
			"aria-current",
			"page",
		);
		await expect(
			primaryNav(page).locator('[aria-current="page"]'),
		).toHaveCount(1);
	});

	test("nested routes expose exactly one aria-current, on the visually active link", async ({
		page,
	}) => {
		// Fixed 2026-11-08 (E2E audit). TanStack's `<Link>` writes
		// `aria-current="page"` from its *prefix* rule and spreads it last, so on
		// a nested route it marked the parent current too ("Invoices" AND
		// "Products"), which breaks the WAI-ARIA rule that exactly one item is
		// current. `SidebarNavLink` now derives the attribute from the layout's
		// own `match`, so the attribute tracks the `before:bg-brand` class.
		const scenarios = [
			{ path: "/invoices/products", active: "Products", inactive: "Invoices" },
			{
				path: "/settings/compliance",
				active: "Compliance",
				inactive: "General",
			},
		] as const;

		for (const scenario of scenarios) {
			await gotoApp(page, scenario.path);

			await expect(navLink(page, scenario.active)).toHaveClass(ACTIVE_CLASS);
			await expect(navLink(page, scenario.inactive)).not.toHaveClass(
				ACTIVE_CLASS,
			);
			// Exactly one current item, the visual one.
			await expect(navLink(page, scenario.active)).toHaveAttribute(
				"aria-current",
				"page",
			);
			await expect(navLink(page, scenario.inactive)).not.toHaveAttribute(
				"aria-current",
				"page",
			);
			await expect(
				primaryNav(page).locator('[aria-current="page"]'),
			).toHaveCount(1);
		}
	});

	test("clicking each workspace nav link navigates and keeps the shell mounted", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/invoices");

		for (const item of WORKSPACE_LINKS) {
			await navLink(page, item.label).click();

			await expect(page).toHaveURL(
				new RegExp(`${escapeRegex(item.href)}$`),
			);
			// The shell survives the client-side transition.
			await waitForShell(page);
			await expect(breadcrumb(page)).toContainText(item.label);
		}

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("command palette: header button, Ctrl+K and Meta+K open it; filtering, focus and Escape work", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/reports");

		const dialog = page.getByRole("dialog");
		// The palette input's accessible name is its placeholder, which uses a
		// Unicode ellipsis ("…"), not three ASCII dots.
		const input = page.getByRole("combobox", { name: /^Search or jump to/ });
		const desktopSearch = page.locator("header button:has(kbd)");

		// 1. Header search button (the md+ field carries the `⌘K` kbd hint).
		await desktopSearch.click();
		await expect(dialog).toBeVisible();
		await expect(input).toBeVisible();
		await expect(
			input,
			"focus should move into the palette input when it opens",
		).toBeFocused();

		// 2. Escape closes it.
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();

		// 3. Ctrl+K opens it again.
		await page.keyboard.press("Control+k");
		await expect(dialog).toBeVisible();
		await expect(input).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();

		// 4. Meta+K (macOS) is wired to the same handler.
		await page.keyboard.press("Meta+k");
		await expect(dialog).toBeVisible();
		await expect(input).toBeFocused();

		// 5. Typing filters the Pages list. "Compliance" is a page target and a
		// word no seeded record is named after, so the filter is deterministic.
		await expect(
			page.getByRole("option", { name: /Reports/ }),
		).toBeVisible();
		await input.fill("compliance");
		await expect(
			page.getByRole("option", { name: /Compliance/ }),
		).toBeVisible();
		await expect(
			page.getByRole("option", { name: /Reports/ }),
			"non-matching page targets should be filtered out",
		).toHaveCount(0);

		// 6. Escape closes.
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();

		// NEGATIVE: Escape with the palette already closed is a no-op.
		await page.keyboard.press("Escape");
		await expect(dialog).toHaveCount(0);
		await expect(primaryNav(page)).toBeVisible();

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("theme toggle flips the theme, persists to velure.theme and survives reload", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/invoices");

		const toggle = page.getByRole("button", {
			name: /Switch to (dark|light) mode/,
		});
		await expect(toggle).toBeVisible();

		const readState = () =>
			page.evaluate(() => ({
				stored: window.localStorage.getItem("velure.theme"),
				htmlClass: document.documentElement.className,
			}));

		// The provider seeds the default on mount; wait for it rather than
		// racing the first paint.
		await expect
			.poll(async () => (await readState()).stored)
			.toMatch(/^(dark|light)$/);
		const before = await readState();
		expect(["dark", "light"]).toContain(before.stored);

		await toggle.click();
		const after = await readState();
		expect(after.stored, "theme should change on toggle").not.toBe(before.stored);
		expect(after.htmlClass).toContain(after.stored ?? "");

		// Reload: the stored choice is re-applied.
		await gotoApp(page, "/invoices");
		const reloaded = await readState();
		expect(reloaded.stored).toBe(after.stored);

		// NEGATIVE: three rapid toggles leave store, class and button label in
		// agreement (odd count flips twice more -> back to the pre-toggle value).
		await toggle.click();
		await toggle.click();
		await toggle.click();
		const rapid = await readState();
		expect(["dark", "light"]).toContain(rapid.stored);
		expect(rapid.htmlClass).toContain(rapid.stored ?? "");
		// Restore the starting theme so the run leaves no persistent change.
		if (rapid.stored !== before.stored) {
			await toggle.click();
		}

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("text-size toggle cycles, persists to velure.textSize and survives reload", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/invoices");

		const toggle = page.getByRole("button", { name: /^Text size:/ });
		await expect(toggle).toBeVisible();

		const readState = () =>
			page.evaluate(() => ({
				stored: window.localStorage.getItem("velure.textSize"),
				htmlClass: document.documentElement.className,
			}));

		// The provider seeds the default on mount; wait for it rather than
		// racing the first paint.
		await expect
			.poll(async () => (await readState()).stored)
			.toMatch(/^(sm|base|lg)$/);
		const before = await readState();
		expect(["sm", "base", "lg"]).toContain(before.stored);

		await toggle.click();
		const after = await readState();
		expect(after.stored, "text size should change on cycle").not.toBe(
			before.stored,
		);
		expect(after.htmlClass).toMatch(/text-(sm|base|lg)/);

		// Reload: the stored choice is re-applied.
		await gotoApp(page, "/invoices");
		expect((await readState()).stored).toBe(after.stored);

		// NEGATIVE: rapid cycling stays inside the allowed set and the label matches.
		await toggle.click();
		await toggle.click();
		await toggle.click();
		const rapid = await readState();
		expect(["sm", "base", "lg"]).toContain(rapid.stored);
		await expect(toggle).toHaveAttribute("aria-label", `Text size: ${rapid.stored}`);
		// Restore the starting size. Bounded so a stuck control fails instead of
		// looping forever.
		for (let i = 0; i < 6; i++) {
			if ((await readState()).stored === before.stored) break;
			await toggle.click();
		}
		expect((await readState()).stored).toBe(before.stored);

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("workspace dropdown opens and lists the active workspace with its role", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/invoices");

		const label = await workspaceLabel(page);

		await workspaceTrigger(page).click();
		const menu = page.getByRole("menu");
		await expect(menu).toBeVisible();
		await expect(menu.getByText("Workspace", { exact: true })).toBeVisible();

		// The active workspace row shows its name and the caller's role.
		await expect(menu.getByText(label, { exact: true })).toBeVisible();
		await expect(menu).toContainText(/owner|member|viewer/i);

		// READ-ONLY: do NOT click a row (that would switch workspace).
		await page.keyboard.press("Escape");
		await expect(menu).toBeHidden();

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("profile dropdown opens and shows the signed-in user's name and email", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/invoices");

		// The name also renders in the sidebar footer, sourced from the same
		// session field, so it is a reliable referent for "the user's name".
		const footerName = (
			await page.locator("aside > div").last().locator("p").first().innerText()
		).trim();

		await page.getByTitle("Open user menu").click();
		const menu = page.getByRole("menu");
		await expect(menu).toBeVisible();

		const email = process.env.E2E_EMAIL ?? "";
		if (email) {
			await expect(menu).toContainText(email);
		}
		if (footerName) {
			await expect(menu).toContainText(footerName);
		} else {
			// Fallback when the account has no display name: the menu still has
			// a non-empty name line above the email.
			const nameText = (await menu.locator("p").first().innerText()).trim();
			expect(nameText.length).toBeGreaterThan(0);
		}

		// READ-ONLY: do NOT click Log out. It must exist, so assert, then Escape.
		await expect(
			menu.getByText("Log out", { exact: true }),
		).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(menu).toBeHidden();

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});
});

test.describe("dashboard shell (mobile 375x812)", () => {
	test.use({ viewport: { width: 375, height: 812 } });

	test("hamburger opens the navigation overlay, Close and a link both dismiss it", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/invoices");

		const open = page.getByRole("button", { name: "Open navigation" });
		const close = page.getByRole("button", { name: "Close navigation" });

		await expect(open).toBeVisible();
		await expect(close).toHaveCount(0);

		// 1. Open the overlay.
		await open.click();
		await expect(close).toBeVisible();
		await expect(navLink(page, "Clients")).toBeVisible();

		// 2. "Close navigation" dismisses it. The scrim spans the viewport at
		// z-30 while the 240px drawer sits at z-40 above it, so the scrim's
		// centre is covered by the drawer; click the exposed strip to its right,
		// as a user would.
		await close.click({ position: { x: 340, y: 400 } });
		await expect(close).toHaveCount(0);

		// 3. A nav link navigates AND closes the overlay.
		await open.click();
		await expect(close).toBeVisible();
		await navLink(page, "Clients").click();
		await expect(page).toHaveURL(/\/clients$/);
		await expect(close).toHaveCount(0);
		await waitForShell(page);

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});
});
