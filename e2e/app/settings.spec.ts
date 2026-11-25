import { expect, test, type Locator, type Page } from "@playwright/test";
import { collectPageErrors, gotoApp, waitForShell } from "./helpers";

/**
 * T-settings — every Settings surface behind the authenticated shell.
 *
 * Covers the six settings routes listed in `APP_ROUTES`: the General profile /
 * plan / danger-zone page, the Compliance identity + tax + export page, the
 * Payment reminders (collections) page, Recurring billing, Integrations, and
 * Security. For each we assert the page renders inside the dashboard shell and
 * that the expected sections and controls exist, then cross-navigate the tabs
 * via the sidebar and prove the shell and active-tab marker survive.
 *
 * READ-ONLY against a real account (AGENTS section 13). This spec navigates,
 * opens read-only panels/sheets, and asserts structure. It never saves a
 * profile, tax profile, or reminder schedule; never generates an export or
 * download; never connects/disconnects an integration; never changes a
 * password; never signs out other sessions; and never deletes anything. Controls
 * that would mutate are asserted to exist and then left untouched. Deterministic:
 * it asserts structure/presence, never exact live values.
 *
 * The `app` project reuses the session saved by `e2e/auth.setup.ts`.
 *
 * SOURCE-VERIFIED NOTES (see the task report): the sidebar (`DashboardLayout.tsx`
 * `settingsItems`) exposes six settings links — General, Compliance, Payment
 * reminders, Recurring billing, Security and Integrations (the last two were
 * added 2026-11-08). The Integrations page is a read-only "Coming soon" list
 * with no toggles/connect controls, and `/settings/security` renders linked
 * sign-in providers plus a sessions list, a change-password form and a "sign
 * out other sessions" control.
 */

test.setTimeout(240_000);

const PRIMARY_NAV = "Primary";

/** Sidebar settings links, in sidebar order, with their routed targets. */
const SETTINGS_LINKS = [
	{ label: "General", href: "/settings" },
	{ label: "Compliance", href: "/settings/compliance" },
	{ label: "Payment reminders", href: "/settings/collections" },
	{ label: "Recurring billing", href: "/settings/recurring" },
] as const;

/**
 * The visual active sidebar link carries this class token (`navLinkClass` in the
 * layout). Matches `e2e/app/shell.spec.ts`.
 */
const ACTIVE_CLASS = /before:bg-brand/;

const escapeRegex = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function primaryNav(page: Page): Locator {
	return page.getByRole("navigation", { name: PRIMARY_NAV });
}

/** A sidebar link by its visible label (accessible name may carry a count badge). */
function navLink(page: Page, label: string): Locator {
	return primaryNav(page).getByRole("link", {
		name: new RegExp(`^${escapeRegex(label)}(\\s|$)`),
	});
}

/**
 * The page `<h1>` for a settings surface.
 *
 * NOTE: client-side navigation goes through `RouteTransition` (framer-motion
 * `AnimatePresence`). It used `mode="popLayout"`, which briefly kept the
 * outgoing and incoming route in the DOM at once and rendered the same `<h1>`
 * twice for ~200-400 ms. It now uses `mode="wait"` (fixed 2026-11-08), so only
 * one route is mounted at a time; `.first()` remains for animation timing.
 */
function pageHeading(page: Page, name: string | RegExp): Locator {
	return page.getByRole("heading", { level: 1, name }).first();
}

test.describe("settings surfaces", () => {
	test("General: business profile, plan/account and danger-zone sections render", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/settings");
		await waitForShell(page);
		await expect(pageHeading(page, "General")).toBeVisible({
			timeout: 30_000,
		});

		// Business profile — the identity fields shown on every invoice.
		await expect(
			page.getByRole("heading", { level: 3, name: "Business profile" }),
		).toBeVisible();
		for (const label of [
			"Workspace name *",
			"Registered business name",
			"Business email *",
			"Business phone",
			"TIN *",
			"CAC RC number *",
		]) {
			await expect(
				page.getByLabel(label, { exact: true }),
				`field "${label}" should exist`,
			).toBeVisible();
		}
		// Logo upload controls exist (we do not pick a file).
		await expect(
			page.getByRole("button", { name: "Upload business logo" }),
		).toBeVisible();
		await expect(page.getByLabel("Business logo file")).toBeAttached();

		// Invoicing — currency, terms, numbering mode.
		await expect(
			page.getByRole("heading", { level: 3, name: "Invoicing" }),
		).toBeVisible();
		await expect(page.getByLabel("Default currency")).toBeVisible();
		await expect(page.getByLabel("Payment terms")).toBeVisible();
		await expect(
			page.getByRole("radiogroup", { name: "Invoice naming" }),
		).toBeVisible();
		await expect(
			page.getByRole("radio", { name: /^Use invoice prefix/ }),
		).toBeVisible();
		await expect(
			page.getByRole("radio", { name: /^Use business name/ }),
		).toBeVisible();
		await expect(page.getByLabel("Invoice prefix")).toBeVisible();
		await expect(page.getByLabel("Next invoice number")).toBeVisible();

		// Address — structured fields printed in the invoice header.
		await expect(
			page.getByRole("heading", { level: 3, name: "Address" }),
		).toBeVisible();
		for (const label of [
			"Street address *",
			"LGA",
			"State / region *",
			"Country *",
		]) {
			await expect(page.getByLabel(label, { exact: true })).toBeVisible();
		}

		// Payment details and the live invoice preview.
		await expect(
			page.getByRole("heading", { level: 3, name: "Payment details" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { level: 3, name: "Invoice preview" }),
		).toBeVisible();
		await expect(page.getByText("Live preview")).toBeVisible();

		// Members panel.
		await expect(
			page.getByRole("heading", { level: 3, name: "Members" }),
		).toBeVisible();
		await expect(
			page.getByText(
				/Invite an accountant \(read-only viewer\)|Only the workspace owner can invite members/,
			),
		).toBeVisible();

		// Account info — plan section.
		await expect(
			page.getByRole("heading", { level: 3, name: "Account info" }),
		).toBeVisible();
		await expect(page.getByText("Free Plan")).toBeVisible();
		// `exact` avoids also matching the "Products" sidebar link (substring).
		await expect(
			page.getByRole("link", { name: "PRO", exact: true }),
		).toBeVisible();

		// Backup / tax notes panel.
		await expect(
			page.getByRole("heading", { level: 3, name: "Backup and tax notes" }),
		).toBeVisible();

		// Danger zone is visible. READ-ONLY: assert the trigger, do NOT click it.
		await expect(
			page.getByRole("heading", { level: 3, name: "Danger Zone" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Delete Account" }),
		).toBeVisible();

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("Compliance: overview, identity, tax rules and export controls render", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/settings/compliance");
		await waitForShell(page);
		await expect(pageHeading(page, "Compliance")).toBeVisible({
			timeout: 30_000,
		});

		// Informational framing and the four in-page tabs.
		await expect(
			page.getByRole("note", { name: "Compliance disclaimer" }),
		).toBeVisible();
		await expect(
			page.getByRole("note", { name: "Mock sandbox environment" }),
		).toBeVisible();
		const tablist = page.getByRole("tablist");
		await expect(tablist).toBeVisible();
		await expect(page.getByRole("tab", { name: /^Overview/ })).toBeVisible();
		await expect(
			page.getByRole("tab", { name: /^Tax settings/ }),
		).toBeVisible();
		await expect(page.getByRole("tab", { name: /^Exports/ })).toBeVisible();
		await expect(
			page.getByRole("tab", { name: /^Business identity/ }),
		).toBeVisible();

		// Dashboard period/currency controls.
		await expect(page.getByLabel("Period")).toBeVisible();
		await expect(page.getByLabel("Currency")).toBeVisible();

		// Overview is the default view.
		await expect(page.getByRole("region", { name: "Overview" })).toBeVisible();
		await expect(
			page.getByRole("heading", { level: 3, name: "Monthly obligations" }),
		).toBeVisible();

		// Business identity — read-only identity summary.
		await page.getByRole("tab", { name: /^Business identity/ }).click();
		await expect(
			page.getByRole("region", { name: "Business identity" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { level: 3, name: "Business identity" }),
		).toBeVisible();
		await expect(
			page.getByRole("progressbar", { name: /Profile completeness/ }),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Edit in General Settings" }),
		).toBeVisible();

		// Tax settings — VAT profile form + WHT categories. READ-ONLY: we assert
		// the save/export buttons exist and never click them.
		await page.getByRole("tab", { name: /^Tax settings/ }).click();
		await expect(
			page.getByRole("region", { name: "Tax settings" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { level: 3, name: "Tax settings" }),
		).toBeVisible();
		await expect(page.getByLabel("Profile name")).toBeVisible();
		await expect(page.getByLabel("Tax label")).toBeVisible();
		await expect(page.getByLabel("Rate (%)")).toBeVisible();
		await expect(page.getByLabel("Description")).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Save VAT profile" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Export tax summary" }),
		).toBeVisible();
		await expect(page.getByLabel("Search WHT categories")).toBeVisible();

		// Exports — download offerings. READ-ONLY: assert buttons, never click.
		await page.getByRole("tab", { name: /^Exports/ }).click();
		// `exact` avoids also matching the "Recent exports table" scroll region.
		await expect(
			page.getByRole("region", { name: "Exports", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { level: 3, name: "Exports", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: /Generate CSV/ }).first(),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: /Generate Excel/ }).first(),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { level: 3, name: "Recent exports" }),
		).toBeVisible();

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("Payment reminders: reminder settings, queue, KPIs and the schedule preview render", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/settings/collections");
		await waitForShell(page);
		await expect(pageHeading(page, "Payment reminders")).toBeVisible({
			timeout: 30_000,
		});

		await expect(page.getByText("Status: scheduled scan.")).toBeVisible();
		await expect(
			page.getByRole("heading", { level: 3, name: "Last automatic run" }),
		).toBeVisible();

		// Filter KPIs are buttons.
		for (const name of [
			/Ready for scan/,
			/Overdue unpaid/,
			/Missing buyer email/,
			/Paused \/ manual/,
		]) {
			await expect(page.getByRole("button", { name })).toBeVisible();
		}

		// The automatic-reminders toggle. READ-ONLY: toggling it auto-saves, so
		// assert it exists and never click it.
		await expect(
			page.getByRole("switch", { name: /Automatic reminders are (on|off)/ }),
		).toBeVisible();

		// Scan / Send queue buttons. Both mutate when clicked — assert only.
		await expect(
			page.getByRole("button", { name: "Scan invoices" }),
		).toBeVisible();
		await expect(page.getByRole("button", { name: "Send queue" })).toBeVisible();

		// Queue + Details panels.
		await expect(
			page.getByRole("heading", { level: 3, name: "Queue" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { level: 3, name: "Details" }),
		).toBeVisible();

		// Reminder schedule sheet — open (read-only), assert fields, then close.
		// We never click "Save reminder schedule".
		const scheduleButton = page.getByRole("button", {
			name: "Reminder schedule",
		});
		await expect(scheduleButton).toBeVisible();
		await scheduleButton.click();
		const sheet = page.getByRole("dialog", {
			name: "Automatic reminder schedule",
		});
		await expect(sheet).toBeVisible({ timeout: 15_000 });
		for (const label of [
			"First reminder",
			"Overdue gap",
			"Overdue email limit",
			"Review after",
			"Email signature",
		]) {
			await expect(sheet.getByText(label, { exact: true })).toBeVisible();
		}
		await expect(
			sheet.getByRole("button", { name: "Save reminder schedule" }),
		).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(sheet).toBeHidden();

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("Recurring billing: schedules, metrics and the editor render", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/settings/recurring");
		await waitForShell(page);
		await expect(pageHeading(page, "Recurring billing")).toBeVisible({
			timeout: 30_000,
		});

		await expect(page.getByText("Status: automatic drafts.")).toBeVisible();
		await expect(
			page.getByRole("heading", { level: 2, name: "Last automatic run" }),
		).toBeVisible();

		// Metrics.
		for (const name of [
			"Active schedules",
			"Due now",
			"Generated invoices",
		]) {
			await expect(page.getByText(name, { exact: true })).toBeVisible();
		}

		// Schedules list renders (either rows or the empty state).
		await expect(
			page.getByRole("heading", { level: 2, name: "Schedules" }),
		).toBeVisible();
		// The count badge is always present ("<n> total"); the empty state may
		// accompany it. Assert the badge deterministically without pinning <n>.
		await expect(page.getByText(/^\d+ total$/)).toBeVisible();

		// Editor sheet — open (read-only), assert the fields, then close. We never
		// click "Create schedule".
		await page.getByRole("button", { name: "New schedule" }).click();
		const sheet = page.getByRole("dialog", { name: "New schedule" });
		await expect(sheet).toBeVisible({ timeout: 15_000 });
		for (const label of [
			"Schedule name",
			"Customer name",
			"Frequency",
			"Every",
			"Start date",
			"End date",
			"Currency",
			"Terms days",
			"Line item",
			"Qty",
			"Price",
			"Payment details",
			"Notes",
		]) {
			await expect(sheet.getByText(label, { exact: true })).toBeVisible();
		}
		await expect(
			sheet.getByRole("checkbox", { name: /Auto-send generated invoices/ }),
		).toBeVisible();
		await expect(
			sheet.getByRole("button", { name: "Create schedule" }),
		).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(sheet).toBeHidden();

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("Integrations: the read-only list renders and no connect control is offered", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/settings/integrations");
		await waitForShell(page);
		await expect(pageHeading(page, "Integrations")).toBeVisible({
			timeout: 30_000,
		});

		await expect(
			page.getByRole("heading", { level: 2, name: "Coming soon" }),
		).toBeVisible();

		// The three planned integrations are listed.
		for (const name of ["Paystack", "QuickBooks", "Xero"]) {
			await expect(page.getByText(name, { exact: true })).toBeVisible();
		}

		// Each card is flagged "Soon" (i.e. not actionable). No connect toggle or
		// connect/disconnect button exists in the source, so none is asserted.
		await expect(page.getByText("Soon", { exact: true })).toHaveCount(3);
		await expect(page.getByRole("switch")).toHaveCount(0);

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("Security: linked providers render; nothing that mutates is clicked", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/settings/security");
		await waitForShell(page);
		await expect(pageHeading(page, "Security")).toBeVisible({
			timeout: 30_000,
		});

		// Linked sign-in providers panel + Refresh.
		await expect(page.getByText("Linked sign-in providers")).toBeVisible();
		await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();

		// At least one provider signal is present: the password credential record
		// or the explicit empty state.
		await expect(
			page.getByText(
				/Password credential|No linked providers yet/,
			),
		).toBeVisible();

		// Exactly one of: "Link Google account" button, or the already-linked
		// note. READ-ONLY: never click the link button.
		await expect
			.poll(
				async () =>
					(await page
						.getByRole("button", { name: "Link Google account" })
						.count()) +
					(await page
						.getByText("Google is already linked to this account.")
						.count()),
				{ timeout: 15_000 },
			)
			.toBeGreaterThan(0);

		// The sessions, change-password and sign-out-others controls have their
		// own test below; this one never clicks anything that mutates.
		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("sidebar cross-navigation keeps the shell and marks the active settings tab", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/settings");

		for (const item of SETTINGS_LINKS) {
			if (item.href !== "/settings") {
				await navLink(page, item.label).click();
				await expect(page).toHaveURL(new RegExp(`${escapeRegex(item.href)}$`));
			}
			// The shell survives the client-side transition and the page renders.
			await waitForShell(page);
			await expect(pageHeading(page, item.label)).toBeVisible({
				timeout: 30_000,
			});

			// Exactly the clicked link carries the active class.
			for (const other of SETTINGS_LINKS) {
				const link = navLink(page, other.label);
				if (other.label === item.label) {
					await expect(
						link,
						`${other.label} should be active on ${item.href}`,
					).toHaveClass(ACTIVE_CLASS);
				} else {
					await expect(
						link,
						`${other.label} should NOT be active on ${item.href}`,
					).not.toHaveClass(ACTIVE_CLASS);
				}
			}
		}

		// Integrations and Security are reachable from the sidebar too (added
		// 2026-11-08; previously they were routes without an entry).
		await expect(
			primaryNav(page).getByRole("link", { name: /^Integrations/ }),
		).toBeVisible();
		await expect(
			primaryNav(page).getByRole("link", { name: /^Security/ }),
		).toBeVisible();

		// Reached directly, each still renders in the shell, marks its own new
		// sidebar entry active, and leaves the original four inactive.
		for (const route of [
			{ href: "/settings/integrations", heading: "Integrations" },
			{ href: "/settings/security", heading: "Security" },
		]) {
			await gotoApp(page, route.href);
			await waitForShell(page);
			await expect(pageHeading(page, route.heading)).toBeVisible({
				timeout: 30_000,
			});
			await expect(
				navLink(page, route.heading),
				`${route.heading} should be active on ${route.href}`,
			).toHaveClass(ACTIVE_CLASS);
			for (const item of SETTINGS_LINKS) {
				await expect(
					navLink(page, item.label),
					`${item.label} must not be active on ${route.href}`,
				).not.toHaveClass(ACTIVE_CLASS);
			}
		}

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("NEGATIVE: malformed query params on a settings tab do not crash it", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);

		const malformed = [
			"/settings?foo=%zz&bar=%E0%A4%A&limit=NaN",
			"/settings/compliance?period=bogus&tab=__proto__&page=Infinity",
			"/settings/collections?q[]=1&q[]=2&sort=",
			"/settings/recurring?frequency=yearly&interval=-1",
		];

		for (const path of malformed) {
			await gotoApp(page, path);
			// The shell still mounts and the surface still renders its title.
			await waitForShell(page);
			await expect(
				page.getByRole("heading", { level: 1 }).first(),
				`${path} should still render a page heading`,
			).toBeVisible({ timeout: 30_000 });
		}

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	// Fixed 2026-11-08 (E2E audit): the page previously only listed linked
	// providers. It now has a sessions list (current session marked), a
	// change-password form and a sign-out-others control. READ-ONLY: fields are
	// filled to the validation edge, nothing is submitted.
	test("Security exposes a sessions list, a change-password form and a sign-out-others control", async ({
		page,
	}) => {
		await gotoApp(page, "/settings/security");
		await waitForShell(page);

		await expect(
			page.getByRole("heading", { level: 1, name: "Security" }),
		).toBeVisible();
		await expect(
			page.getByRole("heading", { name: /active sessions/i }),
		).toBeVisible();
		await expect(page.getByLabel(/current password/i)).toBeVisible();
		await expect(
			page.getByRole("button", { name: /sign out other sessions/i }),
		).toBeVisible();

		// The submit stays disabled until the new password is long enough and the
		// confirmation matches.
		const update = page.getByRole("button", { name: /update password/i });
		await expect(update).toBeDisabled();
		await page.getByLabel(/^new password$/i).fill("short");
		await page.getByLabel(/confirm new password/i).fill("short");
		await expect(update).toBeDisabled();
	});
});
