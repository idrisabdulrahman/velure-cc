import { expect, test } from "@playwright/test";

/* T8 — the public invoice page is the surface customers open from WhatsApp, so
 * it must be checked by looking at real layout, not by reading class names.
 *
 * This spec is read-only. It derives no writes: every POST to the public invoice
 * API (the page's own view-tracking call) is intercepted and fulfilled locally.
 *
 * Requires a real public invoice token, because a fabricated one renders
 * "Invoice not found". Provide it and run:
 *
 *   E2E_PUBLIC_TOKEN=pub-... pnpm test:e2e
 */

const TOKEN = process.env.E2E_PUBLIC_TOKEN;
const WIDTHS = [320, 375, 414, 768] as const;

test.skip(
	!TOKEN,
	"Set E2E_PUBLIC_TOKEN to a real public invoice token to run this spec.",
);

async function openInvoice(page: import("@playwright/test").Page) {
	let blockedWrites = 0;

	await page.route("**/api/invoice/public/**", async (route) => {
		if (route.request().method() === "POST") {
			blockedWrites += 1;
			await route.fulfill({ status: 204, body: "" });
			return;
		}
		await route.continue();
	});

	await page.goto(`/i/${TOKEN}`, { waitUntil: "networkidle" });

	return () => blockedWrites;
}

for (const width of WIDTHS) {
	test.describe(`public invoice at ${width}px`, () => {
		test.use({
			viewport: { width, height: 800 },
			isMobile: width < 768,
			hasTouch: width < 768,
		});

		test("fits the viewport with nothing clipped", async ({ page }) => {
			await openInvoice(page);

			const metrics = await page.evaluate(() => {
				const viewport = document.documentElement.clientWidth;
				const overflowing: Array<{ tag: string; overRight: number }> = [];

				for (const element of document.querySelectorAll("body *")) {
					const rect = element.getBoundingClientRect();
					if (rect.width === 0 && rect.height === 0) continue;
					const overRight = rect.right - viewport;
					if (overRight > 1) {
						overflowing.push({
							tag: element.tagName.toLowerCase(),
							overRight: Math.round(overRight),
						});
					}
				}

				return {
					docScrollWidth: document.documentElement.scrollWidth,
					bodyScrollWidth: document.body.scrollWidth,
					viewport,
					overflowing: overflowing.slice(0, 8),
				};
			});

			// The invoice paper is scaled to the stage. If the scale falls back to
			// "unmeasured", the paper keeps its natural width and both sides of the
			// invoice are clipped on a phone.
			expect(metrics.overflowing).toEqual([]);
			expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.viewport);
			expect(metrics.docScrollWidth).toBeLessThanOrEqual(metrics.viewport);
		});

		test("keeps share actions at touch size and links WhatsApp", async ({ page }) => {
			await openInvoice(page);

			const labels = [
				"Download invoice PDF",
				"Copy public invoice link",
				"Share invoice on WhatsApp",
			];

			for (const label of labels) {
				const target = page.getByLabel(label);
				await expect(target).toBeVisible();
				const box = await target.boundingBox();
				expect(box?.width).toBeGreaterThanOrEqual(44);
				expect(box?.height).toBeGreaterThanOrEqual(44);
			}

			await expect(page.getByLabel("Share invoice on WhatsApp")).toHaveAttribute(
				"href",
				/^https:\/\/wa\.me\/\?text=/,
			);
		});

		test("exposes the transfer account number for one-tap copying", async ({ page }) => {
			let writes = 0;

			await page.route("**/api/invoice/public/**", async (route) => {
				if (route.request().method() === "POST") {
					writes += 1;
					await route.fulfill({ status: 204, body: "" });
					return;
				}

				// Read the real invoice, then add a charge so the collection panel
				// renders its funded state. Nothing is created on the server.
				const response = await route.fetch();
				const body = await response.json();

				await route.fulfill({
					response,
					json: {
						...body,
						paymentContext: {
							...body.paymentContext,
							collectionAmount: 10000,
							charge: {
								reference: "e2e-fixture",
								status: "pending",
								amount: 10000,
								currency: body.invoice?.currency ?? "NGN",
								accountName: "E2E FIXTURE",
								accountNumber: "9012345678",
								bankName: "Wema Bank",
								expiresAt: Date.now() + 30 * 60 * 1000,
							},
						},
					},
				});
			});

			await page.goto(`/i/${TOKEN}`, { waitUntil: "networkidle" });

			const accountNumber = page.getByText("9012345678", { exact: true });

			await expect(accountNumber).toBeVisible();
			await expect(accountNumber).toHaveCSS("user-select", "all");

			const copy = page.getByLabel("Copy account number");

			await expect(copy).toBeVisible();
			const box = await copy.boundingBox();

			expect(box?.width).toBeGreaterThanOrEqual(32);
			expect(box?.height).toBeGreaterThanOrEqual(32);

			// The page's view tracking must never reach the server in tests.
			expect(writes).toBeGreaterThanOrEqual(1);
		});
	});
}