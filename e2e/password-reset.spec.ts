import { expect, test } from "@playwright/test";

/* Password reset, driven through the real browser against a running app.
 *
 * Regression guard for the "Reset password isn't enabled" banner: the server
 * config used to omit `emailAndPassword.sendResetPassword`, so Better Auth
 * answered `/request-password-reset` with 400 and the page rendered the raw
 * error. This spec proves the fixed path end to end:
 *
 *   1. the "forgot" form reaches the endpoint and reports "sent", not the error;
 *   2. a `?mode=reset&token=` link opens the reset form (the second defect: the
 *      old `redirectTo` dropped `mode=reset`, so the emailed link landed on
 *      sign-in);
 *   3. the reset form enforces the server's 12-character minimum **and says so
 *      on screen** - the button used to stay disabled with no explanation, which
 *      read as a broken control;
 *   4. a mismatched confirmation is called out.
 *
 * It is non-mutating. It submits an address that cannot exist, so Better Auth
 * sends no email (its user lookup returns nothing) - no real mail leaves the
 * app, per AGENTS section 9. No account is created and no password is changed.
 */

const NONEXISTENT_EMAIL = "reset-verify-nonexistent@example.com";

test.describe("password reset", () => {
	test("the forgot form reaches the server and does not show the disabled error", async ({
		page,
	}) => {
		await page.goto("/auth", { waitUntil: "domcontentloaded" });

		await page.getByRole("button", { name: "Forgot password?" }).click();
		await expect(
			page.getByRole("heading", { name: "Reset your password" }),
		).toBeVisible();

		await page.locator("#email").fill(NONEXISTENT_EMAIL);

		const [response] = await Promise.all([
			page.waitForResponse((candidate) =>
				candidate.url().includes("/api/auth/request-password-reset"),
			),
			page.getByRole("button", { name: "Send reset email" }).click(),
		]);

		// The exact defect: the endpoint refused with this. A 429 is the
		// reset-email rate limit (5/hour/IP) doing its job after repeated runs,
		// not the disabled-endpoint bug, so assert the regression marker itself.
		expect(
			[200, 429],
			`unexpected status ${response.status()}`,
		).toContain(response.status());
		const body = await response.text();
		expect(body).not.toContain("isn't enabled");

		await expect(page.getByText("Reset password isn't enabled")).toHaveCount(0);
		if (response.status() === 200) {
			await expect(
				page.getByText("Password reset email sent. Check your inbox."),
			).toBeVisible();
		}
	});

	test("a reset link opens the reset form, and the 12-character minimum is enforced", async ({
		page,
	}) => {
		// The shape the mailer produces after the redirectTo fix.
		await page.goto("/auth?mode=reset&token=playwright-token", {
			waitUntil: "domcontentloaded",
		});

		await expect(
			page.getByRole("heading", { name: "Choose a new password" }),
		).toBeVisible();

		// The sign-in form must not be what the link shows.
		await expect(
			page.getByRole("heading", { name: "Sign in to Invoicly" }),
		).toHaveCount(0);

		const submit = page.getByRole("button", { name: "Update password" });
		await expect(submit).toBeVisible();

		// The requirement is on screen, not just enforced. Below the server's
		// minPasswordLength (12) the form stays disabled, but the reason is
		// visible and links to the field, so the disabled button no longer reads
		// as broken.
		await page.locator("#password").fill("elevenchArs");
		await page.locator("#confirmPassword").fill("elevenchArs");
		await expect(submit).toBeDisabled();
		await expect(page.locator("#password-description")).toHaveText(
			"Use at least 12 characters (11/12).",
		);
		await expect(page.locator("#password")).toHaveAttribute(
			"aria-describedby",
			"password-description",
		);

		// A mismatched confirmation is explained too.
		await page.locator("#password").fill("twelvechArs1");
		await page.locator("#confirmPassword").fill("twelvechArs2");
		await expect(submit).toBeDisabled();
		await expect(page.locator("#confirm-password-description")).toHaveText(
			"Passwords do not match.",
		);

		await page.locator("#password").fill("twelvechArs1");
		await page.locator("#confirmPassword").fill("twelvechArs1");
		await expect(submit).toBeEnabled();
		await expect(page.locator("#password-description")).toHaveText(
			"At least 12 characters.",
		);
	});
});
