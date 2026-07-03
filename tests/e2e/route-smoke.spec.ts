import { expect, type Page, test } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const executablePath =
	process.env.E2E_CHROMIUM_EXECUTABLE ?? "/usr/bin/chromium-browser";
const testPassword = process.env.E2E_TEST_USER_PASSWORD ?? "VelureTest123!";
const retryDelaysMs = [400, 1_000, 2_000] as const;
test.use({
	baseURL,
	launchOptions: {
		executablePath,
		args: ["--no-sandbox", "--disable-setuid-sandbox"],
	},
});

const publicRoutes = [
	"/",
	"/features",
	"/pricing",
	"/privacy",
	"/terms",
	"/security",
	"/compliance",
	"/solutions/small-business",
	"/solutions/enterprise",
	"/auth",
];

const workspaceRoutes = [
	{ path: "/invoices", expectedText: "Invoices" },
	{ path: "/invoices/new", expectedText: "Invoice No." },
	{ path: "/invoices/products", expectedText: "Products" },
	{ path: "/invoices/products/new", expectedText: "New product" },
	{ path: "/clients", expectedText: "Clients" },
	{ path: "/clients/new", expectedText: "New client" },
	{ path: "/reports", expectedText: "Revenue" },
	{ path: "/settings", expectedText: "Workspace" },
	{ path: "/settings/compliance", expectedText: "Compliance" },
	{ path: "/settings/collections", expectedText: "Payment reminders" },
	{ path: "/settings/integrations", expectedText: "Integrations" },
	{ path: "/settings/recurring", expectedText: "Recurring" },
	{ path: "/settings/security", expectedText: "Security" },
];

const wait = (delayMs: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, delayMs);
	});

type AuthFetchResult = {
	ok: boolean;
	status: number;
	text: string;
};

async function authFetch(
	page: Page,
	path: "/api/auth/sign-up/email",
	data: Record<string, unknown>,
) {
	await page.goto("/auth", { waitUntil: "domcontentloaded" });
	return await page.evaluate(
		async ({ requestPath, requestData }) => {
			const response = await fetch(requestPath, {
				method: "POST",
				headers: { "content-type": "application/json" },
				credentials: "include",
				body: JSON.stringify(requestData),
			});

			return {
				ok: response.ok,
				status: response.status,
				text: await response.text(),
			};
		},
		{ requestPath: path, requestData: data },
	);
}

async function signUpFreshWorkspaceUser(page: Page) {
	const stamp = Date.now();
	const email = `velure.e2e.routes.${stamp}@example.test`;

	let signedUp = false;
	let lastError = "";
	for (const [attemptIndex, delayMs] of [0, ...retryDelaysMs].entries()) {
		if (attemptIndex > 0) await wait(delayMs);

		const response = (await authFetch(page, "/api/auth/sign-up/email", {
			name: "Velure Route Smoke",
			businessName: "Velure Route Smoke Workspace",
			email,
			password: testPassword,
			callbackURL: `${baseURL}/invoices`,
		})) as AuthFetchResult;

		if (response.ok) {
			signedUp = true;
			break;
		}

		lastError = `${response.status} ${response.text}`;
	}

	expect(signedUp, lastError).toBe(true);

	await page.goto("/auth?redirect=/invoices", {
		waitUntil: "domcontentloaded",
	});
	await page.getByLabel("Email").fill(email);
	await page.getByLabel("Password").fill(testPassword);
	await page.getByRole("button", { name: "Log in" }).click();
	await page.waitForFunction(
		() => window.location.pathname === "/invoices",
		undefined,
		{ timeout: 20_000 },
	);
	await expect(page.locator("body")).toContainText("Invoices", {
		timeout: 30_000,
	});
}

async function expectHealthyPage(page: Page, expectedText?: string) {
	await expect(
		page.getByRole("heading", { name: "Authentication required" }),
	).toHaveCount(0);
	await expect(page.getByText("404")).toHaveCount(0);
	await expect(page.getByText("Not Found")).toHaveCount(0);
	await expect(page.locator("body")).not.toContainText(
		/Could not find public function|Something went wrong|Failed to load/i,
	);

	if (expectedText) {
		await expect(page.locator("body")).toContainText(expectedText, {
			timeout: 30_000,
		});
	}
}

async function navigateWithinApp(page: Page, path: string) {
	const response = await page.goto(path, { waitUntil: "domcontentloaded" });
	expect(response?.status(), path).toBeLessThan(400);
}

test.describe("route smoke coverage", () => {
	test("renders concrete public routes", async ({ page }) => {
		for (const route of publicRoutes) {
			await test.step(route, async () => {
				const response = await page.goto(route);
				expect(response?.status(), route).toBeLessThan(400);
				await expectHealthyPage(page);
			});
		}
	});

	test("renders concrete authenticated workspace routes", async ({ page }) => {
		test.setTimeout(120_000);
		await signUpFreshWorkspaceUser(page);

		for (const route of workspaceRoutes) {
			await test.step(route.path, async () => {
				await navigateWithinApp(page, route.path);
				await expectHealthyPage(page, route.expectedText);
			});
		}

		await test.step("direct settings reload keeps session", async () => {
			await page.goto("/settings");
			await expectHealthyPage(page, "Workspace");
		});

		await test.step("sidebar products navigation renders catalog", async () => {
			await navigateWithinApp(page, "/reports");
			await page.getByRole("link", { name: /Products/ }).first().click();
			await expect(page).toHaveURL(/\/invoices\/products$/);
			await expectHealthyPage(page, "Products & Services");
		});
	});
});
