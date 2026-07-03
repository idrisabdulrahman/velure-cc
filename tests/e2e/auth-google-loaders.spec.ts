import { expect, test } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const executablePath =
	process.env.E2E_CHROMIUM_EXECUTABLE ?? "/usr/bin/chromium-browser";

test.use({
	baseURL,
	launchOptions: {
		executablePath,
		args: ["--no-sandbox", "--disable-setuid-sandbox"],
	},
});

test.describe("auth Google sign-in surface", () => {
	test("shows Google only on sign in and keeps sign up email-only", async ({
		page,
	}) => {
		await page.goto("/auth");

		await expect(
			page.getByRole("button", { name: "Continue with Google" }),
		).toBeVisible();
		await expect(
			page.getByText(
				"Google sign-in only works after you link Google from Security.",
			),
		).toBeVisible();
		await expect(page.getByLabel("Email")).toBeVisible();
		await expect(page.getByLabel("Password")).toBeVisible();

		await page.getByRole("button", { name: "Sign up" }).click();

		await expect(
			page.getByRole("button", { name: "Continue with Google" }),
		).toHaveCount(0);
		await expect(page.getByLabel("Business name")).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Create account" }),
		).toBeVisible();
	});

	test("explains failed Google sign-in callback without exposing internals", async ({
		page,
	}) => {
		await page.goto("/auth?google=failed");

		await expect(
			page.getByText(
				"Google sign-in is only available after you link Google from Security.",
			),
		).toBeVisible();
		await expect(page.getByText("Account identifier")).toHaveCount(0);
		await expect(page.getByText("Reveal ID")).toHaveCount(0);
	});
});

test.describe("protected settings routes", () => {
	test("asks unauthenticated users to sign in without rendering account internals", async ({
		page,
	}) => {
		await page.goto("/settings/security");

		await expect(
			page.getByRole("heading", { name: "Authentication required" }),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Go to sign in" }),
		).toHaveAttribute("href", "/auth");
		await expect(page.getByText("Account identifier")).toHaveCount(0);
		await expect(page.getByText("Reveal ID")).toHaveCount(0);
	});
});
