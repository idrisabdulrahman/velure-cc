import { expect, test } from "@playwright/test";

/* T8 — authenticated surfaces, checked by measuring the rendered layout rather
 * than by reading class names.
 *
 * Gated on a real session, because these screens are behind auth:
 *
 *   E2E_EMAIL=... E2E_PASSWORD=... pnpm test:e2e
 *
 * The spec is read-only. It signs in through the auth API (so the browser
 * context gets the session cookie), opens pages, measures, and never submits a
 * form or mutates data. The invoice builder is left unsaved.
 */

const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

test.skip(
	!EMAIL || !PASSWORD,
	"Set E2E_EMAIL and E2E_PASSWORD to run the authenticated layout checks.",
);

async function signIn(page: import("@playwright/test").Page) {
	const response = await page.context().request.post("/api/auth/sign-in/email", {
		data: { email: EMAIL, password: PASSWORD },
	});

	expect(response.ok(), `sign-in failed: ${response.status()}`).toBe(true);
}

/** Signs in, then opens `path` with a session already in the cookie jar. */
async function openSignedIn(
	page: import("@playwright/test").Page,
	path: string,
) {
	await page.goto("/auth", { waitUntil: "domcontentloaded" });
	await signIn(page);
	await page.goto(path, { waitUntil: "networkidle" });
}

const PHONE_WIDTHS = [320, 375, 414] as const;

for (const width of PHONE_WIDTHS) {
	test.describe(`authenticated surfaces at ${width}px`, () => {
		test.use({
			viewport: { width, height: 800 },
			isMobile: true,
			hasTouch: true,
		});

		test("header offers a tappable search entry point", async ({ page }) => {
			await openSignedIn(page, "/invoices");

			// Before this fix the only search control was `hidden md:flex`, and the
			// palette opened on ⌘K — a key a phone does not have.
			const trigger = page.getByRole("button", { name: "Search or jump to" });

			await expect(trigger).toBeVisible();

			const box = await trigger.boundingBox();

			expect(box?.width).toBeGreaterThanOrEqual(32);
			expect(box?.height).toBeGreaterThanOrEqual(32);

			await trigger.click();

			const input = page.getByPlaceholder("Search or jump to…");

			await expect(input).toBeVisible();

			const dialog = await page.locator("[role=dialog]").boundingBox();
			const viewport = page.viewportSize();

			expect(dialog?.x ?? 0).toBeGreaterThanOrEqual(0);
			expect((dialog?.x ?? 0) + (dialog?.width ?? 0)).toBeLessThanOrEqual(
				viewport?.width ?? 0,
			);

			await page.keyboard.press("Escape");
		});

		test("builder document-type tabs are fully readable", async ({ page }) => {
			await openSignedIn(page, "/invoices/new");

			const labels = [
				"Standard invoice",
				"Credit note",
				"Debit note",
				"Pro-forma",
			];

			for (const label of labels) {
				const tab = page.getByRole("button", { name: label, exact: true });

				await expect(tab).toBeVisible();

				const metrics = await tab.evaluate((element) => {
					const rect = element.getBoundingClientRect();

					return {
						clipped: element.scrollWidth > element.clientWidth + 1,
						insideViewport:
							rect.left >= -1 &&
							rect.right <= document.documentElement.clientWidth + 1,
					};
				});

				// The strip used to be a single non-wrapping row, so the last tabs
				// were squeezed to "Pro form…" and pushed out of the paper.
				expect(metrics.clipped, `${label} is clipped`).toBe(false);
				expect(metrics.insideViewport, `${label} overflows`).toBe(true);
			}
		});

		test("ledger drops low-value columns and keeps data reachable", async ({
			page,
		}) => {
			await openSignedIn(page, "/invoices");

			const table = page.locator("table").first();

			await expect(table).toBeVisible();

			const headers = await table.evaluate((element) =>
				Array.from(element.querySelectorAll("thead th")).map((th) => ({
					text: (th.textContent ?? "").trim(),
					visible: th.getBoundingClientRect().width > 0,
				})),
			);

			const visible = headers.filter((h) => h.visible).map((h) => h.text);

			expect(visible).toContain("Invoice");
			expect(visible).toContain("Status");
			expect(visible).toContain("Amount");
			expect(visible).not.toContain("Issued");
			expect(visible).not.toContain("Type");

			// The table is still wider than a phone, so it must scroll rather than
			// clip: after scrolling, the amount column has to be fully on screen.
			const reachable = await table.evaluate((element) => {
				let scroller: HTMLElement | null = element.parentElement;

				while (scroller) {
					const style = getComputedStyle(scroller);

					if (style.overflowX === "auto" || style.overflowX === "scroll") {
						break;
					}

					scroller = scroller.parentElement;
				}

				if (!scroller) return false;

				scroller.scrollLeft = scroller.scrollWidth;

				const amount = Array.from(element.querySelectorAll("tbody tr td")).find(
					(cell) => /₦/.test(cell.textContent ?? ""),
				);

				if (!amount) return true;

				const rect = amount.getBoundingClientRect();

				return rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1;
			});

			expect(reachable).toBe(true);
		});
	});
}
