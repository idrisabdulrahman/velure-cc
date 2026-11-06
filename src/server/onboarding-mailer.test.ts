import { describe, expect, it, vi } from "vitest";
import { sendOnboardingEmail } from "./onboarding-mailer";

const send = vi
	.fn()
	.mockResolvedValue({ data: { id: "email-1" }, error: null });
vi.mock("resend", () => ({
	Resend: class {
		emails = { send };
	},
}));
vi.mock("./env", () => ({
	getServerEnv: (name: string) =>
		({
			RESEND_API_KEY: "key",
			RESEND_FROM_EMAIL: "Invoicly <billing@example.com>",
			SITE_URL: "https://invoicly.cv",
		})[name],
}));

describe("onboarding mailer", () => {
	it("sends a stable welcome message", async () => {
		await sendOnboardingEmail({
			id: "user-1",
			name: "Ada",
			email: "ada@example.com",
		});
		expect(send).toHaveBeenCalledWith(
			expect.objectContaining({
				subject: "Welcome to Invoicly",
				to: "ada@example.com",
			}),
			expect.objectContaining({
				idempotencyKey: expect.stringMatching(/^onboarding-/),
			}),
		);
	});
});
