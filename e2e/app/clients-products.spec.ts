import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { collectPageErrors, gotoApp } from "./helpers";

/**
 * T-clients-products — the Clients and Products & Services surfaces, end to end.
 *
 * Covers the two directory screens and the forms that feed them:
 *   - /clients                  list chrome, search, filters, empty state
 *   - /clients/new              field inventory, label/placeholder wiring, validation
 *   - /statements/$clientId     an unknown client id is handled gracefully
 *   - /invoices/products        tabs, search, type/status filters, list/empty state
 *   - /invoices/products/new    field inventory, numeric + required validation
 *   - /invoices/products/$id    an unknown product id is handled gracefully
 *   - XSS                       HTML typed into either search stays literal text
 *
 * READ-ONLY against a real account (AGENTS section 13): this spec navigates,
 * filters, and drives the forms to their validation edges, then leaves. It never
 * clicks the final create/save, never submits a valid form, never deletes,
 * archives, favorites, or imports, and never sends mail or switches workspace.
 * Inline validation errors are provoked with `form.requestSubmit()`, which fires
 * the submit handler while the required fields are still invalid, so the handler
 * returns before any network write.
 *
 * The `app` project reuses the session saved by `e2e/auth.setup.ts`. Assertions
 * check structure and presence, never live record counts, so the suite is stable
 * as the account changes.
 *
 * NOTE on /statements/$clientId: it is a standalone route mounted under the root
 * (not `DashboardLayout`), so it deliberately has no Primary navigation. The
 * "shell intact" guarantee is therefore its own document chrome (Back to clients
 * / Print), which this spec asserts instead.
 */

test.setTimeout(180_000);

/** An unlikely search term no seeded record should match. */
const NO_MATCH_QUERY = "zzq-no-such-client-or-product-9f3c7a1b";

/** Deliberate markup: if a search rendered it as HTML, the img onerror would fire. */
const XSS_PAYLOAD = "<img src=x onerror=alert(1)>";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The Clients directory listbox. */
function clientList(page: Page) {
	return page.getByRole("listbox", { name: "Clients" });
}

/** Waits until the clients directory has settled on rows or an empty state. */
function clientsSettled(page: Page) {
	return page
		.getByRole("option")
		.first()
		.or(page.getByText(/No clients (found|match)\./).first());
}

/** Waits until the product catalog has settled on rows or an empty state. */
function productsSettled(page: Page) {
	return page
		.locator("table tbody tr")
		.first()
		.or(
			page.getByText(/No products (yet\.|match)|Couldn't load products/).first(),
		);
}

/** Fires the form's submit event without clicking a (disabled) submit button. */
async function requestSubmit(page: Page) {
	await page.locator("form").first().evaluate((form) => {
		(form as HTMLFormElement).requestSubmit();
	});
}

test.describe("clients", () => {
	test("/clients renders its directory chrome, search, filters and New client", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/clients");

		await expect(
			page.getByRole("heading", { level: 1, name: "Clients" }),
		).toBeVisible();
		await expect(
			page.getByText("Contact details, billing defaults and account status"),
		).toBeVisible();

		// Search control, addressed the way a screen reader finds it.
		await expect(
			page.getByRole("textbox", { name: "Search clients" }),
		).toBeVisible();

		// The directory region, the listbox, and the always-present footer.
		const directory = page.getByRole("region", { name: "Client directory" });
		await expect(directory).toBeVisible();

		// Status / list filters (All / Starred / Has balance), scoped to the
		// directory so the detail panel's "Starred client" toggle cannot collide.
		await expect(directory.getByRole("button", { name: /^All \d/ })).toBeVisible();
		await expect(
			directory.getByRole("button", { name: /^Starred \d/ }),
		).toBeVisible();
		await expect(
			directory.getByRole("button", { name: /^Has balance \d/ }),
		).toBeVisible();

		await expect(clientList(page)).toBeVisible();
		await expect(page.getByText(/Showing \d+ of \d+ clients?/)).toBeVisible();

		// The list or the empty state renders, deterministically.
		await expect(clientsSettled(page)).toBeVisible({ timeout: 30_000 });

		// A "New client" affordance is always offered.
		await expect(
			page.getByRole("link", { name: "New client" }).first(),
		).toBeVisible();

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("/clients search shows the empty state for a miss and clears back", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/clients");

		const search = page.getByRole("textbox", { name: "Search clients" });
		await expect(clientsSettled(page)).toBeVisible({ timeout: 30_000 });

		const before = await clientList(page).getByRole("option").count();

		await search.fill(NO_MATCH_QUERY);
		await expect(page.getByText(/No clients (found|match)\./)).toBeVisible({
			timeout: 30_000,
		});
		await expect(clientList(page).getByRole("option")).toHaveCount(0);

		// Clearing restores the directory to its pre-search size.
		await search.fill("");
		await expect(search).toHaveValue("");
		await expect(clientList(page).getByRole("option")).toHaveCount(before, {
			timeout: 30_000,
		});

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("/clients/new enumerates fields and enforces required + email validation", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/clients/new");

		await expect(
			page.getByRole("heading", { level: 1, name: "New client" }),
		).toBeVisible();
		await expect(page.getByText("Add billing and contact details.")).toBeVisible();

		// Labels (this form's local Field does not wire htmlFor, so assert text).
		// Scoped to the form so the Preview panel's mirrored "Client name" and
		// "Company" paragraphs cannot collide with the labels.
		const form = page.locator("form").first();
		for (const label of [
			"Client name *",
			"Company",
			"Email",
			"Phone",
			"Website",
			"TIN",
			"Buyer Type",
			"Currency",
			"Payment Terms",
			"Billing Address",
			"Internal Notes",
			"Contact person",
		]) {
			await expect(
				form.getByText(label, { exact: true }),
				`label "${label}" should render`,
			).toBeVisible();
		}

		// Text controls, addressed by placeholder.
		for (const placeholder of [
			"Client name",
			"Company",
			"Email",
			"+234 801 234 5678",
			"Website",
			"10-12 digit TIN",
			"Billing Address",
			"Internal Notes",
			"Full name",
			"Role",
			"Contact email",
			"Contact phone",
		]) {
			await expect(
				page.getByPlaceholder(placeholder, { exact: true }),
				`field "${placeholder}" should render`,
			).toBeVisible();
		}

		// The three selects (Buyer Type / Currency / Payment Terms).
		expect(await page.getByRole("combobox").count()).toBeGreaterThanOrEqual(3);

		// Footer affordances.
		await expect(page.getByRole("button", { name: "Import" })).toBeVisible();
		await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
		const submit = page.getByRole("button", { name: "Create client" });
		await expect(submit).toBeVisible();
		await expect(page.getByText("* Required fields")).toBeVisible();

		// Empty required fields: the submit is disabled and cannot be clicked.
		await expect(submit).toBeDisabled();

		// An invalid email surfaces its inline error and keeps submit disabled.
		await page.getByPlaceholder("Email", { exact: true }).fill("not-an-email");
		await expect(page.getByText("Please enter a valid email")).toBeVisible();
		await expect(submit).toBeDisabled();

		// Both required fields satisfied -> submit becomes enabled (never clicked).
		await page
			.getByPlaceholder("Client name", { exact: true })
			.fill("E2E Probe (do not save)");
		await page
			.getByPlaceholder("Email", { exact: true })
			.fill("e2e.probe@example.com");
		await expect(submit).toBeEnabled();

		// Clear the name and force the submit handler: the required-field inline
		// error appears, and the handler returns before any write (name invalid).
		await page.getByPlaceholder("Client name", { exact: true }).fill("");
		await requestSubmit(page);
		await expect(page.getByText("Client name is required")).toBeVisible();
		await expect(submit).toBeDisabled();

		// Nothing was created: we are still on the form.
		await expect(page).toHaveURL(/\/clients\/new$/);

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("/statements/<unknown id> degrades gracefully without the dashboard shell", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		const unknownId = randomUUID();

		// Standalone route: navigate directly, not through the shell helper.
		await page.goto(`/statements/${unknownId}`, {
			waitUntil: "domcontentloaded",
		});

		// It resolves to a graceful empty state (or a friendly error callout),
		// never an unhandled crash.
		await expect(
			page.getByText(/Statement (unavailable|failed to load)/),
		).toBeVisible({ timeout: 30_000 });

		// The page's own chrome is intact and it is a standalone document.
		await expect(
			page.getByRole("button", { name: "Print statement" }),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: /Back to clients/ }).first(),
		).toBeVisible();
		// Not mounted under DashboardLayout.
		await expect(
			page.getByRole("navigation", { name: "Primary" }),
		).toHaveCount(0);

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});
});

test.describe("products", () => {
	test("/invoices/products renders its catalog chrome, search, filters and New Product", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/invoices/products");

		await expect(
			page.getByRole("heading", { level: 1, name: "Products & Services" }),
		).toBeVisible();
		await expect(
			page.getByText("Manage your product catalog and view sales analytics."),
		).toBeVisible();

		// Tabs.
		await expect(page.getByRole("tab", { name: /Catalog/ })).toBeVisible();
		await expect(page.getByRole("tab", { name: /Analytics/ })).toBeVisible();

		// Search + type/status filters.
		await expect(
			page.getByRole("textbox", { name: "Search products" }),
		).toBeVisible();
		await expect(page.getByRole("combobox", { name: "Type" })).toBeVisible();
		await expect(page.getByRole("combobox", { name: "Status" })).toBeVisible();

		// Catalog panel plus a settled list or empty state.
		await expect(
			page.getByRole("heading", { name: "Product catalog" }),
		).toBeVisible();
		await expect(productsSettled(page)).toBeVisible({ timeout: 30_000 });

		await expect(
			page.getByRole("button", { name: /New Product/ }).first(),
		).toBeVisible();

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("/invoices/products/new enumerates fields and enforces price + required boundaries", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		await gotoApp(page, "/invoices/products/new");

		await expect(
			page.getByRole("heading", { level: 1, name: "New product" }),
		).toBeVisible();
		await expect(
			page.getByText("Add a product or service to your catalog."),
		).toBeVisible();

		// Labels (this form wires htmlFor, so the accessible name is usable).
		const form = page.locator("form").first();
		for (const label of [
			"Product type",
			"Unit name",
			"Product name *",
			"Description",
			"SKU",
			"Default unit price *",
			"Default tax ID",
			"VAT category *",
			"Goods/service code *",
		]) {
			await expect(
				form.getByText(label, { exact: true }),
				`label "${label}" should render`,
			).toBeVisible();
		}

		// Named controls.
		await expect(page.getByRole("combobox", { name: "Product type" })).toBeVisible();
		await expect(page.getByRole("combobox", { name: "Unit name" })).toBeVisible();
		await expect(page.getByRole("combobox", { name: "VAT category *" })).toBeVisible();
		await expect(
			page.getByPlaceholder("e.g. Battery, Website Design"),
		).toBeVisible();
		await expect(page.getByPlaceholder("Optional description")).toBeVisible();
		await expect(page.getByPlaceholder("Optional SKU")).toBeVisible();
		await expect(page.getByPlaceholder("0.00")).toBeVisible();
		await expect(page.getByPlaceholder("Optional tax ID")).toBeVisible();
		await expect(
			page.getByPlaceholder("Enter the applicable code"),
		).toBeVisible();

		const submit = page.getByRole("button", { name: "Create product" });
		await expect(submit).toBeVisible();
		await expect(page.getByText("* Required fields")).toBeVisible();

		// Empty required fields -> submit disabled.
		await expect(submit).toBeDisabled();

		// Numeric boundary: a negative unit price is rejected inline.
		const price = page.getByPlaceholder("0.00");
		await price.fill("-5");
		await expect(
			page.getByText("Unit price must be non-negative"),
		).toBeVisible();
		await expect(submit).toBeDisabled();

		// Non-numeric price is rejected with its own message.
		await price.fill("abc");
		await expect(
			page.getByText("Unit price must be a valid number"),
		).toBeVisible();

		// Name + valid price alone are not enough: VAT category and the
		// goods/service code are also required. Force submit to reveal them.
		await page.getByPlaceholder("e.g. Battery, Website Design").fill("E2E Probe");
		await price.fill("1500");
		await requestSubmit(page);
		await expect(page.getByText("VAT category is required")).toBeVisible();
		await expect(page.getByText("Goods/service code is required")).toBeVisible();
		await expect(submit).toBeDisabled();

		// Nothing was created: still on the form.
		await expect(page).toHaveURL(/\/invoices\/products\/new$/);

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});

	test("/invoices/products/<unknown id> shows a graceful not-found state", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);
		const unknownId = randomUUID();

		await gotoApp(page, `/invoices/products/${unknownId}`);

		await expect(page.getByText("Product not found")).toBeVisible({
			timeout: 30_000,
		});
		await expect(
			page.getByRole("button", { name: "Back to products" }),
		).toBeVisible();

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});
});

test.describe("search input safety", () => {
	test("HTML typed into the clients and products searches stays literal text", async ({
		page,
	}) => {
		const errors = collectPageErrors(page);

		let dialogSeen = false;
		page.on("dialog", async (dialog) => {
			dialogSeen = true;
			await dialog.dismiss();
		});

		// Clients search.
		await gotoApp(page, "/clients");
		const clientSearch = page.getByRole("textbox", { name: "Search clients" });
		await clientSearch.fill(XSS_PAYLOAD);
		await expect(clientSearch).toHaveValue(XSS_PAYLOAD);
		await expect(page.getByText(/No clients (found|match)\./)).toBeVisible({
			timeout: 30_000,
		});

		// Products search.
		await gotoApp(page, "/invoices/products");
		const productSearch = page.getByRole("textbox", {
			name: "Search products",
		});
		await productSearch.fill(XSS_PAYLOAD);
		await expect(productSearch).toHaveValue(XSS_PAYLOAD);
		await expect(
			page.getByText(/No products (yet\.|match)|Couldn't load products/),
		).toBeVisible({ timeout: 30_000 });

		// The payload was never parsed into markup, and no alert fired.
		expect(await page.locator('img[src="x"]').count()).toBe(0);
		expect(dialogSeen, "search must not execute injected markup").toBe(false);

		expect(errors, JSON.stringify(errors)).toEqual([]);
	});
});
