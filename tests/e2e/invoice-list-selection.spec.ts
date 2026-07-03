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
	const email = `velure.e2e.selection.${stamp}@example.test`;

	let signedUp = false;
	let lastError = "";
	for (const [attemptIndex, delayMs] of [0, ...retryDelaysMs].entries()) {
		if (attemptIndex > 0) await wait(delayMs);

		const response = (await authFetch(page, "/api/auth/sign-up/email", {
			name: "Velure Selection Smoke",
			businessName: "Velure Selection Workspace",
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

async function seedInvoices(page: Page, invoiceNumbers: string[]) {
	const rows = [
		"Invoice No,Customer,Description,Qty,Unit Price (NGN),Due Date",
		`${invoiceNumbers[0]},Alpha Studio,Brand system,1,45000,2026-08-14`,
		`${invoiceNumbers[1]},Beta Foods,Monthly billing,1,62000,2026-08-21`,
		`${invoiceNumbers[2]},Carat Works,Retainer support,1,78000,2026-08-28`,
	];

	await page.locator('input[type="file"]').setInputFiles({
		name: "invoice-selection.csv",
		mimeType: "text/csv",
		buffer: Buffer.from(rows.join("\n")),
	});

	for (const invoiceNumber of invoiceNumbers) {
		await expect(page.getByText(invoiceNumber)).toBeVisible({ timeout: 30_000 });
	}
}

async function tabToCheckbox(page: Page, label: string) {
	for (let attempt = 0; attempt < 12; attempt += 1) {
		await page.keyboard.press("Tab");
		const activeLabel = await page.evaluate(() =>
			document.activeElement?.getAttribute("aria-label"),
		);
		if (activeLabel === label) return;
	}

	throw new Error(`Could not tab to checkbox: ${label}`);
}

test.describe("invoice list row selection", () => {
	test("keeps checkbox selection isolated from row editing", async ({ page }) => {
		test.setTimeout(120_000);
		const prefix = `SEL${Date.now().toString(36).toUpperCase().slice(-6)}`;
		const invoiceNumbers = [
			`${prefix}-2026-0001`,
			`${prefix}-2026-0002`,
			`${prefix}-2026-0003`,
		];
		const [firstNumber, secondNumber, thirdNumber] = invoiceNumbers;

		await signUpFreshWorkspaceUser(page);
		await seedInvoices(page, invoiceNumbers);

		const headerCheckbox = page.getByRole("checkbox", {
			name: "Select all visible invoices",
		});
		const firstCheckbox = page.getByRole("checkbox", {
			name: `Select invoice ${firstNumber}`,
		});
		const secondCheckbox = page.getByRole("checkbox", {
			name: `Select invoice ${secondNumber}`,
		});
		const thirdCheckbox = page.getByRole("checkbox", {
			name: `Select invoice ${thirdNumber}`,
		});

		await firstCheckbox.click();
		await expect(firstCheckbox).toHaveAttribute("aria-checked", "true");
		await expect(secondCheckbox).toHaveAttribute("aria-checked", "false");
		await expect(thirdCheckbox).toHaveAttribute("aria-checked", "false");
		await expect(page.getByText("1 selected")).toBeVisible();

		await firstCheckbox.click();
		await expect(firstCheckbox).toHaveAttribute("aria-checked", "false");
		await expect(page.getByText("1 selected")).toHaveCount(0);

		await firstCheckbox.click();
		await thirdCheckbox.click();
		await expect(firstCheckbox).toHaveAttribute("aria-checked", "true");
		await expect(secondCheckbox).toHaveAttribute("aria-checked", "false");
		await expect(thirdCheckbox).toHaveAttribute("aria-checked", "true");
		await expect(page.getByText("2 selected")).toBeVisible();
		await expect(headerCheckbox).toHaveAttribute("aria-checked", "mixed");

		await expect(
			page.getByRole("heading", { name: `Edit ${secondNumber}` }),
		).toHaveCount(0);
		await secondCheckbox.click();
		await expect(
			page.getByRole("heading", { name: `Edit ${secondNumber}` }),
		).toHaveCount(0);
		await expect(page.getByText("3 selected")).toBeVisible();

		await page.getByText(firstNumber).click();
		await expect(
			page.getByRole("heading", { name: `Edit ${firstNumber}` }),
		).toBeVisible();
		await expect(page.getByText("3 selected")).toBeVisible();
		await page.keyboard.press("Escape");

		await headerCheckbox.click();
		await expect(page.getByText("3 selected")).toHaveCount(0);
		await expect(firstCheckbox).toHaveAttribute("aria-checked", "false");
		await expect(secondCheckbox).toHaveAttribute("aria-checked", "false");
		await expect(thirdCheckbox).toHaveAttribute("aria-checked", "false");

		await headerCheckbox.click();
		await expect(page.getByText("3 selected")).toBeVisible();
		await expect(headerCheckbox).toHaveAttribute("aria-checked", "true");

		await headerCheckbox.click();
		await expect(page.getByText("3 selected")).toHaveCount(0);
		await expect(headerCheckbox).toHaveAttribute("aria-checked", "false");

		await headerCheckbox.focus();
		await tabToCheckbox(page, `Select invoice ${thirdNumber}`);
		await page.keyboard.press("Space");
		await expect(thirdCheckbox).toHaveAttribute("aria-checked", "true");
		await expect(
			page.getByRole("heading", { name: `Edit ${thirdNumber}` }),
		).toHaveCount(0);
	});
});
