import { expect, test, type Page } from "@playwright/test";
import { APP_ROUTES, gotoApp, PUBLIC_ROUTES } from "./helpers";

/**
 * T-a11y — accessibility + responsive sweep across every surface.
 *
 * For each authenticated route (yours, at 1280x800 and 375x812) and each public
 * route (signed out, 375x812) this spec measures the RENDERED page rather than
 * reading class names, and reports:
 *
 *   - horizontal overflow (documentElement.scrollWidth > clientWidth + 1)
 *   - the number of visible level-1 headings (exactly one is the goal)
 *   - every <img> without an alt attribute (empty alt is allowed)
 *   - every form control (and toggle widget such as role="switch") with no
 *     accessible name (label / aria-label / aria-labelledby / placeholder as
 *     last resort) — the /clients/new and /invoices filter fields are the known
 *     suspects
 *   - every <button> / link with no accessible name
 *   - the presence of a <main> and a <nav> landmark
 *
 * Plus focused checks: keyboard reachability + the command palette (Ctrl+K opens
 * it, focus lands inside, Escape closes), and `prefers-reduced-motion: reduce`.
 *
 * The HARD-FAIL set (asserted so the suite can go red): horizontal overflow,
 * images missing alt, unnamed buttons/links, missing main/nav. The SOFT set
 * (recorded and surfaced through a single documentation `test.fixme`, so the
 * suite stays green while the defects are reported): h1 counts and unnamed form
 * controls.
 *
 * READ-ONLY against a real account (AGENTS section 13): this spec navigates,
 * inspects, and presses keys. It never submits a form, never sends mail, never
 * pays, never changes a password, and never switches the active workspace.
 *
 * The `app` project reuses the session saved by `e2e/auth.setup.ts`, so the
 * default `page` is signed in. Signed-in users are redirected away from the
 * marketing pages, so PUBLIC_ROUTES are opened in a fresh signed-out context.
 */

test.setTimeout(360_000);

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

type Audit = {
	overflow: boolean;
	docScrollWidth: number;
	clientWidth: number;
	bodyScrollWidth: number;
	h1Count: number;
	h1Texts: string[];
	headingCount: number;
	imagesTotal: number;
	imagesMissingAlt: string[];
	controlsTotal: number;
	unnamedControls: string[];
	buttonsLinksTotal: number;
	unnamedButtonsLinks: string[];
	hasMain: boolean;
	hasNav: boolean;
};

/** Soft findings gathered across the sweep, surfaced by the documentation test. */
const softFindings: string[] = [];

/**
 * Measures one already-loaded page. All work happens in-page so a single round
 * trip per route keeps the sweep inside the time budget.
 */
async function auditPage(page: Page): Promise<Audit> {
	// Fonts change metrics; wait for them so the overflow reading is stable.
	await page.evaluate(async () => {
		await document.fonts?.ready;
	});

	return page.evaluate(() => {
		const doc = document.documentElement;
		const clientWidth = doc.clientWidth;
		const docScrollWidth = doc.scrollWidth;
		const bodyScrollWidth = document.body.scrollWidth;

		const isRendered = (el: Element): boolean => {
			if (el.getAttribute("aria-hidden") === "true") return false;
			let node: Element | null = el;
			while (node && node !== doc) {
				const cs = getComputedStyle(node);
				if (
					cs.display === "none" ||
					cs.visibility === "hidden" ||
					cs.visibility === "collapse"
				) {
					return false;
				}
				if (node.hasAttribute("hidden")) return false;
				node = node.parentElement;
			}
			const rect = el.getBoundingClientRect();
			return rect.width > 0 || rect.height > 0;
		};

		const describe = (el: Element): string => {
			const tag = el.tagName.toLowerCase();
			const type = el.getAttribute("type")
				? `[type=${el.getAttribute("type")}]`
				: "";
			const id = el.id ? `#${el.id}` : "";
			const cls =
				typeof el.className === "string" && el.className.trim()
					? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}`
					: "";
			const name = el.getAttribute("name")
				? `[name=${el.getAttribute("name")}]`
				: "";
			const ph = el.getAttribute("placeholder")
				? `[placeholder="${el.getAttribute("placeholder")}"]`
				: "";
			return `${tag}${type}${id}${cls}${name}${ph}`;
		};

		const resolveIds = (ids: string): string => {
			return ids
				.split(/\s+/)
				.map((id) => document.getElementById(id)?.textContent ?? "")
				.join(" ")
				.trim();
		};

		// A pragmatic accessible-name computation: aria-label, aria-labelledby,
		// native <label> association, submit value, rendered text, a nested img
		// alt / svg title, then title. Placeholder is the documented last resort
		// for form controls only.
		const nameOf = (el: Element, allowPlaceholder: boolean): string => {
			const aria = el.getAttribute("aria-label");
			if (aria?.trim()) return aria.trim();

			const labelledby = el.getAttribute("aria-labelledby");
			if (labelledby) {
				const text = resolveIds(labelledby);
				if (text) return text;
			}

			const withLabels = el as HTMLElement & {
				labels?: NodeListOf<HTMLLabelElement> | null;
			};
			if (withLabels.labels && withLabels.labels.length > 0) {
				const text = Array.from(withLabels.labels)
					.map((label) => (label.textContent ?? "").trim())
					.join(" ")
					.trim();
				if (text) return text;
			}

			if (el.id) {
				const explicit = document.querySelector(
					`label[for="${CSS.escape(el.id)}"]`,
				);
				const text = (explicit?.textContent ?? "").trim();
				if (text) return text;
			}

			if (el.tagName.toLowerCase() === "input") {
				const type = (el.getAttribute("type") ?? "text").toLowerCase();
				if (type === "submit" || type === "button" || type === "reset") {
					const value = (el as HTMLInputElement).value;
					if (value?.trim()) return value.trim();
				}
			}

			// Prefer rendered text, but fall back to textContent: off-screen
			// content under `content-visibility: auto` reports an empty
			// `innerText` even though its text is the accessible name.
			const text = (
				(el as HTMLElement).innerText || el.textContent || ""
			).trim();
			if (text) return text;

			const img = el.querySelector("img[alt]");
			const imgAlt = (img?.getAttribute("alt") ?? "").trim();
			if (imgAlt) return imgAlt;

			const svgTitle = (el.querySelector("svg title")?.textContent ?? "").trim();
			if (svgTitle) return svgTitle;

			const title = el.getAttribute("title");
			if (title?.trim()) return title.trim();

			if (allowPlaceholder) {
				const placeholder = el.getAttribute("placeholder");
				if (placeholder?.trim()) return placeholder.trim();
			}

			return "";
		};

		const h1s = Array.from(document.querySelectorAll("h1")).filter(isRendered);
		const headings = Array.from(
			document.querySelectorAll("h1, h2, h3, h4, h5, h6, [role=heading]"),
		).filter(isRendered);

		const images = Array.from(document.querySelectorAll("img"));
		const imagesMissingAlt = images
			.filter((img) => !img.hasAttribute("alt"))
			.map(describe);

		// Interactive widgets whose name should come from a label: form controls
		// and toggle widgets. A control with no accessible name is a SOFT
		// finding (still operable; the impact is clarity for assistive tech), and
		// the /clients/new + /invoices filter fields are the known suspects.
		const WIDGET_ROLES = [
			"switch",
			"checkbox",
			"radio",
			"slider",
			"combobox",
			"listbox",
			"spinbutton",
			"textbox",
			"searchbox",
		];
		const WIDGET_SELECTOR = WIDGET_ROLES.map((r) => `[role=${r}]`).join(", ");

		const isWidget = (el: Element): boolean => {
			const role = el.getAttribute("role");
			return role !== null && WIDGET_ROLES.includes(role);
		};

		const controlEls = Array.from(
			document.querySelectorAll(
				`input, select, textarea, ${WIDGET_SELECTOR}`,
			),
		)
			.filter(
				(el) => (el.getAttribute("type") ?? "").toLowerCase() !== "hidden",
			)
			.filter(isRendered);
		const unnamedControls = controlEls
			.filter((el) => nameOf(el, true) === "")
			.map(describe);

		// Plain action buttons and links: an unnamed one is a HARD failure.
		// Toggle/widget roles are excluded here and covered as controls above.
		const interactive = Array.from(
			document.querySelectorAll(
				"a[href], button, input[type=submit], input[type=button], input[type=image]",
			),
		)
			.filter(isRendered)
			.filter((el) => !isWidget(el));
		const unnamedButtonsLinks = interactive
			.filter((el) => nameOf(el, false) === "")
			.map(describe);

		const hasMain =
			Array.from(document.querySelectorAll("main, [role=main]")).filter(
				isRendered,
			).length > 0;
		const hasNav =
			Array.from(document.querySelectorAll("nav, [role=navigation]")).filter(
				isRendered,
			).length > 0;

		return {
			overflow: docScrollWidth > clientWidth + 1,
			docScrollWidth,
			clientWidth,
			bodyScrollWidth,
			h1Count: h1s.length,
			h1Texts: h1s.map((h) => (h.textContent ?? "").trim().slice(0, 60)),
			headingCount: headings.length,
			imagesTotal: images.length,
			imagesMissingAlt,
			controlsTotal: controlEls.length,
			unnamedControls,
			buttonsLinksTotal: interactive.length,
			unnamedButtonsLinks,
			hasMain,
			hasNav,
		};
	});
}

/** Pushes every HARD failure for one audited route into `hard`. */
function collectHardFailures(
	route: string,
	viewport: string,
	audit: Audit,
	hard: string[],
): void {
	const where = `${route} @ ${viewport}`;

	if (audit.overflow) {
		hard.push(
			`${where}: horizontal overflow (scrollWidth ${audit.docScrollWidth} > clientWidth ${audit.clientWidth} + 1)`,
		);
	}
	for (const img of audit.imagesMissingAlt) {
		hard.push(`${where}: <img> without alt -> ${img}`);
	}
	for (const el of audit.unnamedButtonsLinks) {
		hard.push(`${where}: button/link without accessible name -> ${el}`);
	}
	if (!audit.hasMain) hard.push(`${where}: missing <main> landmark`);
	if (!audit.hasNav) hard.push(`${where}: missing <nav> landmark`);
}

/** Records the SOFT findings (h1 count, unnamed form controls) for a route. */
function collectSoftFindings(route: string, viewport: string, audit: Audit): void {
	const where = `${route} @ ${viewport}`;

	if (audit.h1Count !== 1) {
		const texts = audit.h1Texts.length
			? ` ["${audit.h1Texts.join('", "')}"]`
			: "";
		softFindings.push(
			`${where}: ${audit.h1Count} visible <h1> (expected exactly 1)${texts}`,
		);
	}
	for (const el of audit.unnamedControls) {
		softFindings.push(
			`${where}: form control without accessible name -> ${el}`,
		);
	}
}

function emitSummary(label: string, rows: Array<Audit & { path: string }>): void {
	const compact = rows.map((row) => ({
		route: row.path,
		overflow: row.overflow
			? `${row.docScrollWidth}>${row.clientWidth}`
			: false,
		h1: row.h1Count,
		imgs: `${row.imagesTotal}${row.imagesMissingAlt.length ? ` (${row.imagesMissingAlt.length} missing alt)` : ""}`,
		controls: `${row.controlsTotal}${row.unnamedControls.length ? ` (${row.unnamedControls.length} unnamed)` : ""}`,
		buttonsLinks: `${row.buttonsLinksTotal}${row.unnamedButtonsLinks.length ? ` (${row.unnamedButtonsLinks.length} unnamed)` : ""}`,
		main: row.hasMain,
		nav: row.hasNav,
	}));
	console.log(
		`\n[a11y summary] ${label}\n${JSON.stringify(compact, null, 2)}\n`,
	);
}

const DESKTOP = { label: "1280x800", width: 1280, height: 800 } as const;
const MOBILE = { label: "375x812", width: 375, height: 812 } as const;

for (const viewport of [DESKTOP, MOBILE]) {
	test.describe(`authenticated a11y + responsive @ ${viewport.label}`, () => {
		test.use({ viewport: { width: viewport.width, height: viewport.height } });

		test("every app route: overflow, heading, images, controls, landmarks", async ({
			page,
		}) => {
			const hard: string[] = [];
			const rows: Array<Audit & { path: string }> = [];

			for (const path of APP_ROUTES) {
				await gotoApp(page, path);
				// The heading is async on a few screens (settings panels render it
				// only after their data settles). Wait briefly so the h1 reading is
				// the real one; a screen with no heading at all just times out.
				await page
					.locator("h1")
					.first()
					.waitFor({ state: "visible", timeout: 8_000 })
					.catch(() => {});
				const audit = await auditPage(page);
				rows.push({ path, ...audit });
				collectHardFailures(path, viewport.label, audit, hard);
				collectSoftFindings(path, viewport.label, audit);
			}

			emitSummary(`authenticated @ ${viewport.label}`, rows);
			expect(
				hard,
				`Hard a11y/responsive failures:\n${hard.join("\n")}`,
			).toEqual([]);
		});
	});
}

test.describe("public a11y + responsive (signed out) @ 375x812", () => {
	test("each public route renders a heading, no overflow, images have alt", async ({
		browser,
	}) => {
		const hard: string[] = [];
		const rows: Array<Audit & { path: string }> = [];

		// Signed-in users are redirected away from marketing pages, so use a
		// fresh, storageState-free context.
		const context = await browser.newContext({
			viewport: { width: MOBILE.width, height: MOBILE.height },
		});

		try {
			const page = await context.newPage();

			for (const path of PUBLIC_ROUTES) {
				await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
				await page.waitForLoadState("load").catch(() => {});
				// The landing is a lazy route whose heading appears only after
				// hydration, so wait for a heading before measuring.
				await page
					.locator("h1, h2, h3, h4, h5, h6, [role=heading]")
					.first()
					.waitFor({ state: "visible", timeout: 20_000 })
					.catch(() => {});
				const audit = await auditPage(page);
				rows.push({ path, ...audit });

				const where = `${path} @ ${MOBILE.label}`;

				if (audit.overflow) {
					hard.push(
						`${where}: horizontal overflow (scrollWidth ${audit.docScrollWidth} > clientWidth ${audit.clientWidth} + 1)`,
					);
				}
				if (audit.headingCount === 0) {
					hard.push(`${where}: no heading rendered`);
				}
				for (const img of audit.imagesMissingAlt) {
					hard.push(`${where}: <img> without alt -> ${img}`);
				}
			}
		} finally {
			await context.close();
		}

		emitSummary("public @ 375x812", rows);
		expect(
			hard,
			`Hard public a11y/responsive failures:\n${hard.join("\n")}`,
		).toEqual([]);
	});
});

test.describe("keyboard + command palette", () => {
	test("Tab reaches interactive controls; Ctrl+K opens the palette with focus; Escape closes it", async ({
		page,
	}) => {
		await gotoApp(page, "/reports");

		// 1. Tab walks into the interactive chrome.
		const reached: string[] = [];
		for (let i = 0; i < 12; i += 1) {
			await page.keyboard.press("Tab");
			const info = await page.evaluate(() => {
				const el = document.activeElement as HTMLElement | null;
				if (!el) return null;
				const tag = el.tagName.toLowerCase();
				const role = el.getAttribute("role");
				const interactive =
					tag === "a" ||
					tag === "button" ||
					tag === "input" ||
					tag === "select" ||
					tag === "textarea" ||
					role === "button" ||
					role === "combobox" ||
					role === "link";
				const name =
					el.getAttribute("aria-label") ||
					(el.textContent ?? "").trim().slice(0, 24);
				return { tag, interactive, name };
			});
			if (info) reached.push(`${info.tag}${info.name ? `:${info.name}` : ""}`);
		}

		expect(
			reached.some((entry) =>
				/^(a|button|input|select|textarea)/.test(entry),
			),
			`Tab should reach interactive controls, saw: ${reached.join(", ")}`,
		).toBe(true);

		// 2. Ctrl+K opens the command palette and focus lands inside it.
		const dialog = page.getByRole("dialog");
		await page.keyboard.press("Control+k");
		await expect(dialog).toBeVisible();
		await expect(
			page.getByRole("combobox", { name: /^Search or jump to/ }),
			"focus should move into the palette input",
		).toBeFocused();

		// 3. Escape closes it.
		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
	});
});

test.describe("prefers-reduced-motion: reduce", () => {
	test.use({
		viewport: { width: 1280, height: 800 },
		reducedMotion: "reduce",
	});

	test("an app route and a public route still render without overflow", async ({
		page,
		browser,
	}) => {
		// App route via the signed-in default page.
		await gotoApp(page, "/invoices");
		const appAudit = await auditPage(page);
		expect(
			appAudit.overflow,
			`/invoices overflowed under reduced motion (${appAudit.docScrollWidth} > ${appAudit.clientWidth})`,
		).toBe(false);
		expect(appAudit.hasMain).toBe(true);
		expect(appAudit.headingCount).toBeGreaterThan(0);

		// Public route via a fresh signed-out context at phone width.
		const context = await browser.newContext({
			viewport: { width: MOBILE.width, height: MOBILE.height },
			reducedMotion: "reduce",
		});
		try {
			const publicPage = await context.newPage();
			await publicPage.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
			await publicPage.waitForLoadState("load").catch(() => {});
			await publicPage
				.locator("h1, h2, h3, h4, h5, h6, [role=heading]")
				.first()
				.waitFor({ state: "visible", timeout: 20_000 })
				.catch(() => {});
			const publicAudit = await auditPage(publicPage);
			expect(
				publicAudit.overflow,
				`/ overflowed under reduced motion (${publicAudit.docScrollWidth} > ${publicAudit.clientWidth})`,
			).toBe(false);
			expect(publicAudit.headingCount).toBeGreaterThan(0);
		} finally {
			await context.close();
		}
	});
});

test.describe("recorded soft findings", () => {
	test("soft a11y findings (h1 counts, unnamed form controls)", () => {
		// These are real but non-blocking defects. They are recorded here as a
		// `fixme` so the defect list is visible in the report without turning the
		// suite red, and without editing src/ (which this spec must not touch).
		const summary = softFindings.length
			? softFindings.map((f) => `  - ${f}`).join("\n")
			: "  (none recorded in this run)";

		console.log(`\n[soft a11y findings] ${softFindings.length} total\n${summary}\n`);

		test.info().annotations.push({
			type: "a11y-soft-findings",
			description: softFindings.length
				? softFindings.join(" | ")
				: "none recorded in this run",
		});

		test.fixme(
			true,
			`${softFindings.length} soft finding(s) recorded; see the console output and the a11y-soft-findings annotation.`,
		);
	});
});
