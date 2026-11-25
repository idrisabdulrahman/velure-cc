import { afterEach, describe, expect, it, vi } from "vitest";
import { sendVerificationEmail } from "./verification-mailer";

/**
 * The verification mailer is the only delivery layer Better Auth needs: it
 * receives the already-built URL. These checks pin the properties that matter
 * for sign-up to keep working when Resend does not:
 *
 *   - the provider receives the URL and an escaped display name;
 *   - a failure is swallowed and logged without the recipient address, so the
 *     account created moments earlier is not reported as a failed sign-up;
 *   - the logged reason carries the Resend `statusCode`, because an invalid key
 *     (400) and the test-sender recipient restriction (403) are both reported
 *     as `name: "validation_error"`.
 */

const savedResendKey = process.env.RESEND_API_KEY;
const savedResendFrom = process.env.RESEND_FROM_EMAIL;

function stubResend(handler: () => Promise<Response>) {
	const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
		handler(),
	);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	// Restore whatever the process had before this file ran; the third test
	// removes them deliberately.
	process.env.RESEND_API_KEY = savedResendKey ?? "";
	process.env.RESEND_FROM_EMAIL = savedResendFrom ?? "";
	if (savedResendKey === undefined) delete process.env.RESEND_API_KEY;
	if (savedResendFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
});

describe("verification mailer", () => {
	it("delivers the verification URL with the name escaped in HTML", async () => {
		process.env.RESEND_API_KEY = "test-resend-key";
		process.env.RESEND_FROM_EMAIL = "Invoicly <no-reply@example.com>";

		const fetchMock = stubResend(async () => Response.json({ id: "email_1" }));

		await sendVerificationEmail({
			user: { email: "person@example.com", name: "<b>Ada</b>" },
			url: "https://app.test/api/auth/verify-email?token=abc&callbackURL=%2Fverify-email",
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] ?? [];
		expect(String(url)).toContain("api.resend.com");

		const body = JSON.parse(String(init?.body)) as {
			to: string;
			html: string;
			text: string;
		};
		expect(body.to).toBe("person@example.com");
		expect(body.html).toContain("&lt;b&gt;Ada&lt;/b&gt;");
		expect(body.html).not.toContain("<b>Ada</b>");
		expect(body.html).toContain(
			"https://app.test/api/auth/verify-email?token=abc",
		);
		expect(body.text).toContain(
			"https://app.test/api/auth/verify-email?token=abc",
		);
	});

	it("never throws when the provider is unreachable", async () => {
		process.env.RESEND_API_KEY = "test-resend-key";
		process.env.RESEND_FROM_EMAIL = "Invoicly <no-reply@example.com>";
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		stubResend(async () => {
			throw new Error("network down for person@example.com");
		});

		await expect(
			sendVerificationEmail({
				user: { email: "person@example.com", name: "Ada" },
				url: "https://app.test/verify",
			}),
		).resolves.toBeUndefined();

		expect(errorSpy).toHaveBeenCalled();
		for (const call of errorSpy.mock.calls) {
			expect(call.map(String).join(" ")).not.toContain("person@example.com");
		}
	});

	it("stays silent (aside from a log line) when Resend is not configured", async () => {
		delete process.env.RESEND_API_KEY;
		delete process.env.RESEND_FROM_EMAIL;
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const fetchMock = stubResend(async () => Response.json({ id: "email_1" }));

		await expect(
			sendVerificationEmail({
				user: { email: "person@example.com", name: "Ada" },
				url: "https://app.test/verify",
			}),
		).resolves.toBeUndefined();

		expect(fetchMock).not.toHaveBeenCalled();
		expect(errorSpy).toHaveBeenCalledTimes(1);
	});
});

describe("delivery-failure diagnostics", () => {
	function loggedLine(errorSpy: { mock: { calls: unknown[][] } }) {
		return errorSpy.mock.calls
			.map((call) => call.map(String).join(" "))
			.join("\n");
	}

	function stubRejection(status: number, body: Record<string, unknown>) {
		process.env.RESEND_API_KEY = "test-resend-key";
		process.env.RESEND_FROM_EMAIL = "Invoicly <onboarding@resend.dev>";
		return stubResend(async () => Response.json(body, { status }));
	}

	it("records the 403 test-sender restriction without the owner address", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		stubRejection(403, {
			statusCode: 403,
			name: "validation_error",
			message:
				"You can only send testing emails to your own email address (owner@example.com). To send emails to other recipients, please verify a domain at resend.com/domains.",
		});

		await sendVerificationEmail({
			user: { email: "person@example.com", name: "Ada" },
			url: "https://app.test/verify",
		});

		const line = loggedLine(errorSpy);
		expect(line).toContain("email-verification");
		expect(line).toContain('"statusCode":403');
		expect(line).toContain("validation_error");
		expect(line).toContain("verify a domain");
		// The account owner's address is the one Resend quotes back.
		expect(line).not.toContain("owner@example.com");
		expect(line).toContain("[redacted-address]");
		// Never the recipient either.
		expect(line).not.toContain("person@example.com");
	});

	it("distinguishes an invalid key from the recipient restriction", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		stubRejection(400, {
			statusCode: 400,
			name: "validation_error",
			message: "API key is invalid",
		});

		await sendVerificationEmail({
			user: { email: "person@example.com", name: "Ada" },
			url: "https://app.test/verify",
		});

		const line = loggedLine(errorSpy);
		// Same provider name as the 403 above; only the status code separates
		// "the key is dead" from "the sender is not allowed to write here".
		expect(line).toContain('"statusCode":400');
		expect(line).toContain("API key is invalid");
	});

	it("reports a transport failure with a null status code", async () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		process.env.RESEND_API_KEY = "test-resend-key";
		process.env.RESEND_FROM_EMAIL = "Invoicly <onboarding@resend.dev>";
		stubResend(async () => {
			throw new Error("socket hang up");
		});

		await sendVerificationEmail({
			user: { email: "person@example.com", name: "Ada" },
			url: "https://app.test/verify",
		});

		expect(loggedLine(errorSpy)).toContain('"statusCode":null');
	});
});
