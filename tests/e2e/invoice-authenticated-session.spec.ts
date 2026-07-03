import { mkdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const executablePath =
	process.env.E2E_CHROMIUM_EXECUTABLE ?? "/usr/bin/chromium-browser";
const testEmail =
	process.env.E2E_TEST_USER_EMAIL ??
	`velure.e2e.invoice.${Date.now()}@example.test`;
const testPassword = process.env.E2E_TEST_USER_PASSWORD ?? "VelureTest123!";
const testName = process.env.E2E_TEST_USER_NAME ?? "Velure E2E User";
const testBusinessName =
	process.env.E2E_TEST_BUSINESS_NAME ?? "Velure E2E Workspace";
const authStatePath =
	process.env.E2E_AUTH_STATE_PATH ??
	"test-results/.auth/velure-e2e-user.json";
const screenshotPath =
	process.env.E2E_INVOICE_SCREENSHOT_PATH ??
	"test-results/invoice-new-authenticated.png";
const retryDelaysMs = [400, 1_000, 2_000] as const;

test.use({
	baseURL,
	launchOptions: {
		executablePath,
		args: ["--no-sandbox", "--disable-setuid-sandbox"],
	},
});

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

async function signInWithForm(page: Page) {
	await page.goto("/auth?redirect=/invoices/new", {
		waitUntil: "domcontentloaded",
	});
	await page.getByLabel("Email").fill(testEmail);
	await page.getByLabel("Password").fill(testPassword);
	await page.getByRole("button", { name: "Log in" }).click();

	try {
		await page.waitForFunction(
			() => window.location.pathname === "/invoices/new",
			undefined,
			{ timeout: 20_000 },
		);
		return true;
	} catch {
		return false;
	}
}

async function signUpByApi(page: Page) {
	let lastError = "";
	for (const [attemptIndex, delayMs] of [0, ...retryDelaysMs].entries()) {
		if (attemptIndex > 0) await wait(delayMs);

		const response = (await authFetch(page, "/api/auth/sign-up/email", {
			name: testName,
			email: testEmail,
			password: testPassword,
			callbackURL: `${baseURL}/invoices/new`,
			businessName: testBusinessName,
		})) as AuthFetchResult;

		if (response.ok) {
			return;
		}

		lastError = `${response.status} ${response.text}`;
	}

	throw new Error(`Could not create e2e user ${testEmail}: ${lastError}`);
}

async function establishSession(page: Page) {
	if (!(await signInWithForm(page))) {
		await signUpByApi(page);
		expect(await signInWithForm(page)).toBe(true);
	}
}

test.describe("authenticated invoice creation session", () => {
	test("creates or reuses a test user and opens invoice creation", async ({
		page,
	}) => {
		test.setTimeout(90_000);

		console.log(`Using E2E test user: ${testEmail}`);

		await establishSession(page);

		await page.goto("/invoices/new", { waitUntil: "domcontentloaded" });

		await expect(
			page.getByRole("heading", { name: "Authentication required" }),
		).toHaveCount(0);
		await expect(page.getByText("Invoice No.")).toBeVisible({
			timeout: 30_000,
		});
		await expect(page.getByText("From")).toBeVisible();
		await expect(page.getByText("Payment Details")).toBeVisible();

		await page.reload({ waitUntil: "domcontentloaded" });
		await expect(page.getByText("Invoice No.")).toBeVisible({
			timeout: 30_000,
		});

		mkdirSync("test-results/.auth", { recursive: true });
		await page.context().storageState({ path: authStatePath });
		await page.screenshot({ path: screenshotPath, fullPage: true });
	});
});
