import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthLogger, redactEmails } from "./auth-logger";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("redactEmails", () => {
	it("replaces an email-shaped token", () => {
		expect(redactEmails("user@example.com")).toBe("[redacted-email]");
	});

	it("redacts emails embedded in a sentence", () => {
		expect(
			redactEmails(
				"Credential account not found for ada.lovelace+work@velure.ng",
			),
		).toBe("Credential account not found for [redacted-email]");
	});

	it("redacts several emails at once", () => {
		expect(redactEmails("a@b.co and c.d@e.fgh")).toBe(
			"[redacted-email] and [redacted-email]",
		);
	});

	it("leaves text without an email untouched", () => {
		expect(redactEmails("sign-in failed: invalid password")).toBe(
			"sign-in failed: invalid password",
		);
	});

	it("does not touch a bare host or a plain word", () => {
		expect(redactEmails("pooler.supabase.com refused")).toBe(
			"pooler.supabase.com refused",
		);
	});
});

describe("createAuthLogger", () => {
	it("stays at warn so info/debug noise is suppressed", () => {
		expect(createAuthLogger().level).toBe("warn");
	});

	it("routes each level to the matching console method", () => {
		const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
		const info = vi.spyOn(console, "info").mockImplementation(() => {});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const logger = createAuthLogger();

		logger.log("debug", "d");
		logger.log("info", "i");
		logger.log("warn", "w");
		logger.log("error", "e");

		expect(debug).toHaveBeenCalledWith("d");
		expect(info).toHaveBeenCalledWith("i");
		expect(warn).toHaveBeenCalledWith("w");
		expect(error).toHaveBeenCalledWith("e");
	});

	it("redacts an email in the message", () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		createAuthLogger().log("error", "failed for user@example.com");

		expect(error).toHaveBeenCalledWith("failed for [redacted-email]");
	});

	it("redacts emails nested in the log arguments", () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		createAuthLogger().log("error", "hook failed", {
			user: { email: "ada@velure.ng", id: "usr_1" },
		});

		expect(error).toHaveBeenCalledWith("hook failed", {
			user: { email: "[redacted-email]", id: "usr_1" },
		});
	});

	it("redacts emails inside an Error argument", () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		createAuthLogger().log("error", "boom", new Error("no row for a@b.co"));

		expect(error).toHaveBeenCalledWith("boom", {
			name: "Error",
			message: "no row for [redacted-email]",
			stack: expect.any(String),
		});
	});

	it("does not recurse without bound", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		let nested: Record<string, unknown> = { email: "deep@velure.ng" };
		for (let i = 0; i < 10; i += 1) nested = { level: nested };

		expect(() => createAuthLogger().log("error", "deep", nested)).not.toThrow();
	});
});
