import { expect, test, type Page } from "@playwright/test";
import { collectPageErrors, gotoApp } from "./helpers";

/**
 * T-invoices — the invoice ledger (/invoices) and the composer (/invoices/new).
 *
 * Covers the two highest-traffic invoice surfaces end to end:
 *   - /invoices      heading + description, KPI strip, primary actions, the
 *                    filter bar (search, status segments, advanced filters),
 *                    empty state, XSS/long input safety, malformed query params,
 *                    and the transient loading panel.
 *   - /invoices/new  the composer chrome (document types, client selector,
 *                    line items, totals) and the required-field submit edge.
 *
 * READ-ONLY against a real account (AGENTS section 13): this spec navigates,
 * filters, types, and drives the composer to its validation edge, then leaves.
 * It never clicks Create / Create & Send / Schedule, never saves, sends, pays,
 * or deletes anything, and never uses the Import CSV file input. The composer's
 * autosave only persists a *meaningful* draft (a customer, a priced line, an
 * edited default, ...); this spec only adds an empty line item, so no autosave
 * write is triggered, not even when navigating away.
 *
 * Deterministic: assertions check structure/presence, never exact live record
 * counts, so the suite is stable as the account data changes. The `app` project
 * reuses the session saved by `e2e/auth.setup.ts`.
 */

test.setTimeout(180_000);

/** An unlikely search term no real invoice or customer should match. */
const NO_MATCH_QUERY = "zzq-no-such-invoice-or-customer-8c4d2f6a";

/** Deliberate markup: if a field rendered it as HTML, the img onerror would fire. */
const XSS_PAYLOAD = "<img src=x onerror=alert(1)>";

/** Well past the "2000+ chars" boundary in the brief. */
const LONG_QUERY = "a".repeat(2400);

/**
 * Malformed search params. The ledger route has no `validateSearch`, so these
 * are presentation-ignored: the shell must still render, and nothing in them
 * may be interpreted as markup.
 */
const MALFORMED_QUERY_URL =
	"/invoices?status=%3Cscript%3E&type=all&documentType=all&q=%00";

function primaryNav(page: Page) {
	return page.getByRole("navigation", { name: "Primary" });
}

/** One per invoice row: the row menu's labelled trigger. */
function rowActions(page: Page) {
	return page.getByRole("button", { name: /^Actions for / });
}

/** The zero-state markers, for an empty or fully filtered ledger. */
function emptyState(page: Page) {
	return page.getByText(/No invoices (yet\.|match)/).first();
}

/** The loaded ledger region (mounts only once the loader is replaced). */
function listRegion(page: Page) {
	return page.getByRole("region", { name: "Invoice list" });
}

/** Waits until the ledger has settled on rows or an empty state. */
function ledgerSettled(page: Page) {
	return rowActions(page).first().or(emptyState(page));
}

/**
 * Opens the advanced-filter disclosure, idempotently.
 *
 * A filtered load can replace the toolbar, re-mounting the disclosure *closed*
 * — and a closed `<details>` drops its content from the accessibility tree, so
 * `getByRole` matches nothing until it is reopened. Rather than assume the
 * disclosure's prior state, toggle until the customer input is visible.
 */
async function openFilters(page: Page) {
	const input = page.getByPlaceholder("Any customer");
	const summary = page.getByText("Filters", { exact: true });
	for (let attempt = 0; attempt < 10; attempt++) {
		if (await input.isVisible().catch(() => false)) return;
		await summary.click({ timeout: 5_000 }).catch(() => undefined);
		await page.waitForTimeout(150);
	}
	await expect(input).toBeVisible();
}

/**
 * A Radix `SelectTrigger` inside the advanced-filters panel, located by its
 * visible field label ("Schedule" | "Document kind" | "Due").
 *
 * These triggers render `<button role="combobox">` with NO `aria-label` and NO
 * `aria-labelledby`, and `combobox` has no name-from-content, so their
 * accessible name is empty and a `getByRole(..., { name })` lookup never
 * resolves. The field label is a plain `<span>` (not a `<label for>`), so we
 * scope structurally to the `FilterField` div that owns it. See the `fixme`
 * guard at the end of this describe.
 */
function advancedSelect(page: Page, label: string) {
	return page.locator(`div:has(> span:text-is("${label}"))`).getByRole("combobox");
}

test.describe("invoices ledger", () => {
	test("/invoices renders its heading, KPI strip, actions and filter bar", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/invoices");

		await expect(
			page.getByRole("heading", { level: 1, name: "Invoices" }),
		).toBeVisible();
		await expect(
			page.getByText(/Review invoice status, search by customer/),
		).toBeVisible();

		// KPI / summary cards.
		await expect(
			page.getByText("Payment score", { exact: true }),
		).toBeVisible();
		await expect(page.getByText("Overdue", { exact: true }).first()).toBeVisible();
		await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();
		await expect(page.getByText("Open", { exact: true }).first()).toBeVisible();

		// Primary actions (present for a mutating role; asserted, never clicked).
		await expect(page.getByText("Import CSV", { exact: true })).toBeVisible();
		await expect(
			page.getByRole("button", { name: "New invoice" }).first(),
		).toBeVisible();
		await expect(
			page.locator('input[type="file"][accept*=".csv"]'),
		).toHaveCount(1);

		// Filter bar: search + status segments + the advanced filters disclosure.
		await expect(
			page.getByRole("textbox", { name: "Search invoice number or customer" }),
		).toBeVisible();
		for (const label of [
			"All",
			"Draft",
			"Sent",
			"Paid",
			"Overdue",
			"Canceled",
		]) {
			await expect(
				page.getByRole("button", { name: new RegExp(`^${label}\\b`) }).first(),
				`"${label}" status segment should render`,
			).toBeVisible();
		}
		await expect(page.getByText("Filters", { exact: true })).toBeVisible();

		// The ledger resolves to rows or an empty state.
		await expect(ledgerSettled(page)).toBeVisible({ timeout: 30_000 });

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("filters: customer search, status segment and document-kind select all narrow, then clear", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/invoices");
		await expect(ledgerSettled(page)).toBeVisible({ timeout: 30_000 });
		const baseline = await rowActions(page).count();

		// ---- customer search (advanced filter) ----
		// NOTE: a filtered load can replace the toolbar and re-mount the advanced
		// disclosure closed, so `openFilters` is idempotent and is called before
		// each advanced-field interaction.
		await openFilters(page);
		await page.getByPlaceholder("Any customer").fill(NO_MATCH_QUERY);
		await expect(page.getByText("No invoices match")).toBeVisible({
			timeout: 30_000,
		});
		await expect(rowActions(page)).toHaveCount(0);
		// A clear affordance appears once a filter is active.
		await expect(
			page.getByRole("button", { name: "Clear", exact: true }),
		).toBeVisible();

		// Clearing the customer input restores the ledger.
		await openFilters(page);
		await page.getByPlaceholder("Any customer").fill("");
		await expect(page.getByText("No invoices match")).toBeHidden({
			timeout: 30_000,
		});
		await expect(rowActions(page)).toHaveCount(baseline, { timeout: 30_000 });

		// ---- status segment ----
		const sent = page.getByRole("button", { name: /^Sent\b/ }).first();
		await sent.click();
		await expect(sent).toHaveAttribute("aria-pressed", "true");
		await expect(
			page.getByRole("button", { name: "Clear", exact: true }),
		).toBeVisible();
		await expect(ledgerSettled(page)).toBeVisible({ timeout: 30_000 });

		// ---- document-kind select ----
		await openFilters(page);
		const docKind = advancedSelect(page, "Document kind");
		await expect(docKind).toHaveText("All document kinds");
		await docKind.click();
		await page.getByRole("option", { name: "Standard", exact: true }).click();
		// The filtered load swaps the toolbar for the loading panel, and the
		// disclosure re-mounts *closed* — a closed `<details>` drops its content
		// from the accessibility tree, so `getByRole` matches nothing until it
		// is reopened. Settle, reopen, then read the trigger.
		await expect(ledgerSettled(page)).toBeVisible({ timeout: 30_000 });
		await openFilters(page);
		await expect(advancedSelect(page, "Document kind")).toHaveText("Standard");

		// ---- clear restores ----
		await page.getByRole("button", { name: "Clear", exact: true }).click();
		await expect(
			page.getByRole("button", { name: "Clear", exact: true }),
		).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: /^All\b/ }).first(),
		).toHaveAttribute("aria-pressed", "true");
		await expect(rowActions(page)).toHaveCount(baseline, { timeout: 30_000 });
		await openFilters(page);
		await expect(advancedSelect(page, "Document kind")).toHaveText(
			"All document kinds",
		);

		// Filter state is client-side only: the URL is not rewritten.
		const url = new URL(page.url());
		expect(url.pathname).toBe("/invoices");
		for (const key of ["q", "status", "type", "documentType", "customer"]) {
			expect(
				url.searchParams.has(key),
				`URL should not carry the "${key}" filter param`,
			).toBe(false);
		}

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("the toolbar search narrows to an empty state and restores on clear", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/invoices");
		await expect(ledgerSettled(page)).toBeVisible({ timeout: 30_000 });
		const baseline = await rowActions(page).count();

		const search = page.getByRole("textbox", {
			name: "Search invoice number or customer",
		});
		await search.fill(NO_MATCH_QUERY);
		await expect(page.getByText("No invoices match")).toBeVisible({
			timeout: 30_000,
		});
		await expect(rowActions(page)).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Clear search and filters" }),
		).toBeVisible();

		await search.fill("");
		await expect(page.getByText("No invoices match")).toBeHidden({
			timeout: 30_000,
		});
		await expect(rowActions(page)).toHaveCount(baseline, { timeout: 30_000 });

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("HTML typed into the search stays literal text and never executes", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		let dialogSeen = false;
		page.on("dialog", async (dialog) => {
			dialogSeen = true;
			await dialog.dismiss();
		});

		await gotoApp(page, "/invoices");
		await expect(ledgerSettled(page)).toBeVisible({ timeout: 30_000 });

		const search = page.getByRole("textbox", {
			name: "Search invoice number or customer",
		});
		await search.fill(XSS_PAYLOAD);
		await expect(search).toHaveValue(XSS_PAYLOAD);
		await expect(page.getByText("No invoices match")).toBeVisible({
			timeout: 30_000,
		});

		expect(
			await page.locator('img[src="x"]').count(),
			"the payload must never become markup",
		).toBe(0);
		expect(dialogSeen, "the search must not execute injected markup").toBe(false);

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("a 2000+ character search does not crash the page", async ({ page }) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/invoices");
		await expect(ledgerSettled(page)).toBeVisible({ timeout: 30_000 });

		expect(LONG_QUERY.length).toBeGreaterThan(2000);
		const search = page.getByRole("textbox", {
			name: "Search invoice number or customer",
		});
		await search.fill(LONG_QUERY);
		await expect(search).toHaveValue(LONG_QUERY);

		// The shell and heading survive, and the ledger still resolves.
		await expect(primaryNav(page)).toBeVisible();
		await expect(
			page.getByRole("heading", { level: 1, name: "Invoices" }),
		).toBeVisible();
		await expect(ledgerSettled(page)).toBeVisible({ timeout: 30_000 });

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("malformed query params still render the shell and the ledger", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, MALFORMED_QUERY_URL);

		await expect(primaryNav(page)).toBeVisible();
		await expect(
			page.getByRole("heading", { level: 1, name: "Invoices" }),
		).toBeVisible();
		await expect(
			page.getByRole("textbox", { name: "Search invoice number or customer" }),
		).toBeVisible();
		await expect(ledgerSettled(page)).toBeVisible({ timeout: 30_000 });
		// The `%00`/`<script>` payloads are never rendered as markup.
		expect(await page.locator("img[src=x]").count()).toBe(0);

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("the transient Loading invoices panel resolves to rows or an empty state", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/invoices");

		// The ledger region only mounts once the loader has been replaced.
		await expect(listRegion(page)).toBeVisible({ timeout: 30_000 });
		await expect(
			page.getByRole("status", { name: "Loading invoices" }),
		).toHaveCount(0);
		await expect(ledgerSettled(page)).toBeVisible({ timeout: 30_000 });

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	// Fixed 2026-11-08 (E2E audit): the Radix `SelectTrigger` renders
	// `<button role="combobox">` with no name-from-content, so these filters were
	// unlabelled. They now carry the field label as their `aria-label`.
	test("filters: advanced select triggers expose an accessible name", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/invoices");
		await expect(ledgerSettled(page)).toBeVisible({ timeout: 30_000 });
		await openFilters(page);

		await expect(
			page.getByRole("combobox", { name: "Schedule" }),
		).toBeVisible();
		await expect(
			page.getByRole("combobox", { name: "Document kind" }),
		).toBeVisible();
		await expect(page.getByRole("combobox", { name: "Due" })).toBeVisible();

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});
});

test.describe("invoice builder", () => {
	test("/invoices/new renders the composer and enforces the required-field edge", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/invoices/new");

		// The three-step orientation list proves the page mode, not the sheet.
		await expect(
			page.getByRole("list", {
				name: "Create your first invoice in three steps",
			}),
		).toBeVisible();

		// Document-type toggle group, with a default selection.
		// The composer uses the full label ("Standard invoice"); the ledger's
		// document-kind *filter* uses the short "Standard".
		const standard = page.getByRole("button", {
			name: "Standard invoice",
			exact: true,
		});
		await expect(standard).toBeVisible();
		await expect(standard).toHaveAttribute("aria-pressed", "true");
		for (const label of ["Credit note", "Debit note", "Pro-forma"]) {
			await expect(
				page.getByRole("button", { name: label, exact: true }),
				`"${label}" document type should render`,
			).toBeVisible();
		}

		// Client selector (To) and the sender field (From).
		await expect(
			page.getByRole("button", { name: /Select customer/ }),
		).toBeVisible();
		await expect(page.getByLabel("From", { exact: true })).toBeVisible();

		// Line items and totals.
		const descriptions = page.getByPlaceholder("Search product...");
		await expect(descriptions).toHaveCount(1);
		await expect(page.getByLabel("Quantity for line item 1")).toBeVisible();
		await expect(page.locator('[data-testid="invoice-line-total"]')).toHaveCount(1);
		await expect(page.getByText("Subtotal", { exact: true })).toBeVisible();
		await expect(page.locator('[data-testid="invoice-subtotal"]')).toBeVisible();
		// The summary row's "Total" label. (A line item also has a mobile-only
		// "Total" label that is hidden at the `@md` container size, so scope to
		// the visible match.)
		await expect(
			page
				.getByText("Total", { exact: true })
				.filter({ visible: true })
				.first(),
		).toBeVisible();

		// "Add item" appends a still-empty row. No create, no save.
		await page.getByRole("button", { name: "Add item" }).click();
		await expect(descriptions).toHaveCount(2, { timeout: 10_000 });
		await expect(page.getByLabel("Quantity for line item 2")).toBeVisible();
		await expect(page.locator('[data-testid="invoice-line-total"]')).toHaveCount(2);

		// Required-field edge: without a client (and a priced line) the composer
		// cannot be submitted. The primary action is aria-disabled and exposes
		// the blocker; assert it and leave without submitting.
		const create = page.getByRole("button", { name: "Create", exact: true });
		await expect(create).toBeVisible();
		await expect(create).toHaveAttribute("aria-disabled", "true");
		await expect(page.locator('[aria-label="Choose a customer."]')).toBeVisible();

		// Navigate away. The composer never held a meaningful draft (only an empty
		// line was added), so no autosave write is flushed on unload.
		await gotoApp(page, "/invoices");
		await expect(
			page.getByRole("heading", { level: 1, name: "Invoices" }),
		).toBeVisible();

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});
});
