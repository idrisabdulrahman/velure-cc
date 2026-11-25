import { expect, test, type Page, type Route } from "@playwright/test";
import { collectPageErrors, gotoApp } from "./helpers";

/**
 * T-reports-expenses — the two analysis surfaces, end to end.
 *
 *   - /reports   heading + description, KPI strip, the revenue bar chart, the
 *                five panels, the period/currency controls, the series toggles
 *                and the monthly/cumulative switch, zero/empty handling for a
 *                period with no data, malformed query params, XSS in a query
 *                value.
 *   - /expenses  heading + description, KPI strip, the log panel (list or empty
 *                state), the Export affordance, and the "Log an expense" form's
 *                field inventory and validation edges (empty required, zero,
 *                negative, invalid date).
 *
 * READ-ONLY against a real account (AGENTS section 13): this spec navigates,
 * opens selects, toggles presentation controls, filters, and drives the expense
 * form to its validation edges, then leaves. It never submits or saves an
 * expense (the submit button is only ever asserted, never clicked), never
 * exports/downloads a CSV, never edits/voids a row, and never switches the
 * workspace. To inspect validation edges without submitting, the number input
 * is queried through the DOM `validity` API — no submit event is ever fired.
 *
 * Deterministic: assertions check structure/presence, never exact live record
 * counts, so the suite is stable as the account data changes. The zero-state
 * test forces an empty period by intercepting the report's read-only Supabase
 * queries and returning `[]`, so it does not depend on the account being empty.
 *
 * NOTE: neither /reports nor /expenses renders a free-text search box; the only
 * user-typable field on either page is the expense form's Note textarea (and the
 * date field). The XSS test therefore targets that field and the report query
 * string. Follow-up: the period/currency `SelectTrigger`s expose no accessible
 * name (tracked as a `fixme` at the end, same root cause as the invoice ledger's
 * advanced filters).
 *
 * The `app` project reuses the session saved by `e2e/auth.setup.ts`.
 */

test.setTimeout(240_000);

/** Deliberate markup: if a field rendered it as HTML, the img onerror would fire. */
const XSS_PAYLOAD = "<img src=x onerror=alert(1)>";

/**
 * Malformed query params. Neither route declares `validateSearch`, so these are
 * presentation-ignored: the shell must still render, and nothing in them may be
 * interpreted as markup. `%zz` is an invalid percent-escape on purpose.
 */
const MALFORMED_QUERY_URL = "/reports?period=bogus&from=%zz&to=Infinity&q[]=1";

/** The documented period presets, in select order. */
const PERIOD_LABELS = ["Last 6 months", "Year to date", "Last 12 months"];

/** The seeded expense categories, in select order. */
const EXPENSE_CATEGORIES = [
	"Rent",
	"Utilities",
	"Salaries & wages",
	"Office supplies",
	"Travel",
	"Software & subscriptions",
	"Marketing",
	"Professional fees",
	"Bank & payment fees",
	"Taxes & levies",
	"Other",
];

function primaryNav(page: Page) {
	return page.getByRole("navigation", { name: "Primary" });
}

function reportsHeading(page: Page) {
	return page.getByRole("heading", { level: 1, name: "Revenue and cash flow" });
}

/**
 * The report's KPI strip sub-line. It renders once the query has settled (the
 * loader replaces it while pending) and always carries a count — "0 issued
 * invoices" for an empty period — so it is a data-independent settle marker.
 */
function reportSettled(page: Page) {
	return page.getByText(/\d+ issued invoices/);
}

/** The period control is the first combobox in the reports header. */
function periodSelect(page: Page) {
	return page.getByRole("combobox").first();
}

/** Uses the DOM constraint-validation API; never submits the form. */
async function amountValidity(page: Page) {
	return page
		.getByRole("spinbutton")
		.evaluate((el: HTMLInputElement) => ({
			valid: el.checkValidity(),
			valueMissing: el.validity.valueMissing,
			rangeUnderflow: el.validity.rangeUnderflow,
		}));
}

test.describe("reports", () => {
	test("/reports renders its heading, description, KPI cards, chart and panels", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/reports");

		await expect(reportsHeading(page)).toBeVisible();
		await expect(
			page.getByText(/Track billed revenue, collections, open balances/),
		).toBeVisible();

		// KPI cards: each sub-line is unique to its card.
		await expect(reportSettled(page)).toBeVisible({ timeout: 30_000 });
		await expect(page.getByText(/\d+% collection rate/)).toBeVisible();
		await expect(page.getByText(/\d+ open invoices/)).toBeVisible();
		await expect(page.getByText(/\d+ overdue invoices/)).toBeVisible();

		// The insight callout always renders once loaded.
		await expect(page.getByRole("note").first()).toBeVisible();

		// The five panels.
		for (const title of [
			"Revenue visualization",
			"Top customers",
			"Late payers",
			"Product revenue",
			"Open invoices",
		]) {
			await expect(
				page.getByRole("heading", { name: title }),
				`"${title}" panel should render`,
			).toBeVisible();
		}

		// The chart surface mounts (Recharts renders an SVG inside it).
		await expect(page.locator('[data-slot="chart"]')).toBeVisible();

		// Controls: the period select and the currency select, in that order.
		const comboboxes = page.getByRole("combobox");
		await expect(comboboxes).toHaveCount(2);
		await expect(comboboxes.first()).toContainText(PERIOD_LABELS[0]);
		await expect(comboboxes.nth(1)).toHaveText(/^[A-Z]{3}$/);

		// Series toggles and the monthly/cumulative switch.
		await expect(
			page.getByRole("button", { name: "Billed", exact: true }),
		).toHaveAttribute("aria-pressed", "true");
		await expect(
			page.getByRole("button", { name: "Collected", exact: true }),
		).toHaveAttribute("aria-pressed", "true");
		await expect(
			page.getByRole("button", { name: "Monthly", exact: true }),
		).toHaveAttribute("aria-pressed", "true");
		await expect(
			page.getByRole("button", { name: "Cumulative", exact: true }),
		).toHaveAttribute("aria-pressed", "false");

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("changing the period re-renders without crashing and the shell persists", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/reports");
		await expect(reportSettled(page)).toBeVisible({ timeout: 30_000 });

		const period = periodSelect(page);
		await expect(period).toHaveText(PERIOD_LABELS[0]);

		// Cycle through every preset and back; each re-query must settle and the
		// shell must stay mounted. Client-side state only: the URL never changes.
		for (const label of [
			PERIOD_LABELS[1],
			PERIOD_LABELS[2],
			PERIOD_LABELS[0],
		]) {
			await period.click();
			await page.getByRole("option", { name: label, exact: true }).click();

			await expect(period).toHaveText(label);
			await expect(primaryNav(page)).toBeVisible();
			await expect(reportsHeading(page)).toBeVisible();
			await expect(reportSettled(page)).toBeVisible({ timeout: 30_000 });
			await expect(page.locator('[data-slot="chart"]')).toBeVisible();
			expect(new URL(page.url()).pathname).toBe("/reports");
		}

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("the series toggles and monthly/cumulative switch re-render without crashing", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/reports");
		await expect(reportSettled(page)).toBeVisible({ timeout: 30_000 });

		const billed = page.getByRole("button", { name: "Billed", exact: true });
		const collected = page.getByRole("button", {
			name: "Collected",
			exact: true,
		});
		const monthly = page.getByRole("button", { name: "Monthly", exact: true });
		const cumulative = page.getByRole("button", {
			name: "Cumulative",
			exact: true,
		});

		// Hide then restore each series; the chart surface never disappears.
		await billed.click();
		await expect(billed).toHaveAttribute("aria-pressed", "false");
		await expect(page.locator('[data-slot="chart"]')).toBeVisible();
		await billed.click();
		await expect(billed).toHaveAttribute("aria-pressed", "true");

		await collected.click();
		await expect(collected).toHaveAttribute("aria-pressed", "false");
		await collected.click();
		await expect(collected).toHaveAttribute("aria-pressed", "true");

		// Monthly <-> cumulative.
		await cumulative.click();
		await expect(cumulative).toHaveAttribute("aria-pressed", "true");
		await expect(monthly).toHaveAttribute("aria-pressed", "false");
		await expect(page.locator('[data-slot="chart"]')).toBeVisible();

		await monthly.click();
		await expect(monthly).toHaveAttribute("aria-pressed", "true");
		await expect(cumulative).toHaveAttribute("aria-pressed", "false");

		await expect(primaryNav(page)).toBeVisible();
		await expect(reportsHeading(page)).toBeVisible();

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("a period with no data shows the zero/empty states, not a crash or blank panel", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);

		// Force an empty period deterministically: the report reads issued
		// invoices, payments and products straight from Supabase, so returning
		// `[]` for those read-only selects produces the zero state without
		// touching the account.
		const empty = async (route: Route) => {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				headers: { "content-range": "0-0/0" },
				body: "[]",
			});
		};
		await page.route(/rest\/v1\/invoices(\?|$)/, empty);
		await page.route(/rest\/v1\/payment_transactions/, empty);
		await page.route(/rest\/v1\/products(\?|$)/, empty);

		await gotoApp(page, "/reports");

		// Zeros everywhere, the empty callout, the per-panel empty guards, and
		// the chart still mounted — never a blank panel or a crash.
		await expect(page.getByText("0 issued invoices")).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByText("0% collection rate")).toBeVisible();
		await expect(page.getByText("No revenue in this period.")).toBeVisible();
		await expect(
			page.getByText("No records for this period").first(),
		).toBeVisible();
		await expect(page.getByText("No late payers")).toBeVisible();
		await expect(page.locator('[data-slot="chart"]')).toBeVisible();
		await expect(primaryNav(page)).toBeVisible();

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("malformed query params still render the shell and the report", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, MALFORMED_QUERY_URL);

		await expect(primaryNav(page)).toBeVisible();
		await expect(reportsHeading(page)).toBeVisible();
		await expect(page.getByRole("combobox").first()).toContainText(
			PERIOD_LABELS[0],
		);
		await expect(reportSettled(page)).toBeVisible({ timeout: 30_000 });
		// The bogus params are never rendered as markup.
		expect(await page.locator("img[src=x]").count()).toBe(0);

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	// Fixed 2026-11-08 (E2E audit): both report `<SelectTrigger>`s now carry an
	// `aria-label` ("Period" / "Currency"), so a screen reader names them.
	test("reports: the period and currency selects expose an accessible name", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/reports");
		await expect(page.getByRole("combobox", { name: /period/i })).toBeVisible();
		await expect(
			page.getByRole("combobox", { name: /currency/i }),
		).toBeVisible();
		expect(errors, JSON.stringify(errors)).toEqual([]);
	});
});

test.describe("expenses", () => {
	test("/expenses renders its heading, KPIs, log panel (list or empty) and actions", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/expenses");

		await expect(
			page.getByRole("heading", { level: 1, name: "Expenses" }),
		).toBeVisible();
		await expect(
			page.getByText(
				"Log and categorise business expenses. This is a spending record, not a ledger.",
			),
		).toBeVisible();

		// KPI strip.
		await expect(page.getByText("Total logged", { exact: true })).toBeVisible();
		await expect(page.getByText("This month", { exact: true })).toBeVisible();
		await expect(page.getByText("Categories used", { exact: true })).toBeVisible();
		await expect(page.getByText(/\d+ expenses/)).toBeVisible();

		// The log panel settles on a list of entries or the documented empty state.
		await expect(page.getByRole("heading", { name: "Expense log" })).toBeVisible();
		await expect(page.getByText(/\d+ active entr(y|ies)/)).toBeVisible();
		await expect(
			page
				.getByRole("list", { name: "Expenses" })
				.or(page.getByText("No expenses yet"))
				.first(),
		).toBeVisible({ timeout: 30_000 });

		// The form panel and its two affordances. The Export button is asserted,
		// never clicked (READ-ONLY).
		await expect(
			page.getByRole("heading", { name: "Log an expense" }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: /Export CSV/ }),
		).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Log expense", exact: true }),
		).toBeVisible();

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("the expense form enumerates its fields and enforces the required/amount/date edges", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/expenses");
		await expect(
			page.getByRole("heading", { name: "Log an expense" }),
		).toBeVisible();

		const form = page.locator("form").first();

		// Field inventory: labels + controls.
		for (const label of ["Amount", "Category", "Date", "Note"]) {
			await expect(
				form.getByText(label, { exact: true }),
				`label "${label}" should render`,
			).toBeVisible();
		}
		await expect(page.getByText("Optional", { exact: true })).toBeVisible();
		await expect(page.getByRole("spinbutton")).toBeVisible(); // Amount (type=number)
		await expect(page.getByPlaceholder("0.00")).toBeVisible();
		const category = page.getByRole("combobox", { name: "Expense category" });
		await expect(category).toBeVisible();
		await expect(category).toContainText("Select a category");
		await expect(page.getByPlaceholder("Select a date")).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Select date" }),
		).toBeVisible();
		await expect(page.getByPlaceholder("What was this for?")).toBeVisible();

		// Every seeded category is offered.
		await category.click();
		for (const name of EXPENSE_CATEGORIES) {
			await expect(
				page.getByRole("option", { name, exact: true }),
				`category "${name}" should be offered`,
			).toBeVisible();
		}
		await page.keyboard.press("Escape");

		// --- validation edges (assert only; never submit) ---
		const submit = page.getByRole("button", {
			name: "Log expense",
			exact: true,
		});

		// Empty required amount + no category -> submit disabled.
		await expect(submit).toBeDisabled();

		// Choosing a category alone is not enough; the amount is still required.
		await category.click();
		await page.getByRole("option", { name: "Other", exact: true }).click();
		await expect(submit).toBeDisabled();

		// A valid amount with a category enables submit (never clicked).
		const amount = page.getByRole("spinbutton");
		await amount.fill("1200.50");
		await expect(submit).toBeEnabled();

		// Zero is rejected by the native `min=0.01` constraint (range underflow).
		await amount.fill("0");
		const zero = await amountValidity(page);
		expect(zero.rangeUnderflow, "0 is below the 0.01 minimum").toBe(true);
		expect(zero.valid).toBe(false);

		// Negative is rejected by the same constraint.
		await amount.fill("-5");
		const negative = await amountValidity(page);
		expect(negative.rangeUnderflow).toBe(true);
		expect(negative.valid).toBe(false);

		// Empty is rejected as missing.
		await amount.fill("");
		const empty = await amountValidity(page);
		expect(empty.valueMissing).toBe(true);
		expect(empty.valid).toBe(false);
		await expect(submit).toBeDisabled();

		// Invalid date: the field keeps the literal text and never crashes; the
		// date is a free-text field (no inline validation error is designed).
		const date = page.getByPlaceholder("Select a date");
		await date.fill("not-a-real-date");
		await expect(date).toHaveValue("not-a-real-date");

		// Leave without saving: nothing was written, we are still on the log page.
		await gotoApp(page, "/expenses");
		await expect(
			page.getByRole("heading", { level: 1, name: "Expenses" }),
		).toBeVisible();

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});
});

test.describe("input safety", () => {
	test("markup typed into the expense note and the report query stays literal text", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		let dialogSeen = false;
		page.on("dialog", async (dialog) => {
			dialogSeen = true;
			await dialog.dismiss();
		});

		// The only free-text field on either page is the expense Note textarea.
		await gotoApp(page, "/expenses");
		const note = page.getByPlaceholder("What was this for?");
		await note.fill(XSS_PAYLOAD);
		await expect(note).toHaveValue(XSS_PAYLOAD);
		expect(
			await page.locator('img[src="x"]').count(),
			"the note must never become markup",
		).toBe(0);

		// A payload carried in the report query string is likewise ignored (the
		// route declares no `validateSearch` and renders no raw param).
		await gotoApp(
			page,
			`/reports?q=${encodeURIComponent(XSS_PAYLOAD)}&period=${encodeURIComponent(XSS_PAYLOAD)}`,
		);
		await expect(reportsHeading(page)).toBeVisible();
		await expect(reportSettled(page)).toBeVisible({ timeout: 30_000 });
		expect(await page.locator('img[src="x"]').count()).toBe(0);

		expect(dialogSeen, "no input may execute injected markup").toBe(false);
		expect(errors, JSON.stringify(errors)).toEqual([]);
	});
});
