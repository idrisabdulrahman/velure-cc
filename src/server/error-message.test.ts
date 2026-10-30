import { describe, expect, it } from "vitest";
import { formatErrorMessage } from "./error-message";

/**
 * Regression guard for the production defect where a Supabase plain-object error
 * logged as `[object Object]`, hiding a Cloudflare subrequest failure that
 * dropped the reminder-sweep cursor write.
 */
describe("formatErrorMessage", () => {
	it("returns the message of a real Error", () => {
		expect(formatErrorMessage(new Error("provider exploded"))).toBe(
			"provider exploded",
		);
	});

	it("serializes a PostgREST error object instead of [object Object]", () => {
		expect(
			formatErrorMessage({
				message: "Too many subrequests",
				code: "CF-50",
				details: "exceeded 50 subrequests",
				hint: "upgrade the plan",
			}),
		).toBe(
			"Too many subrequests | CF-50 | exceeded 50 subrequests | upgrade the plan",
		);
	});

	it("keeps only the fields that are present", () => {
		expect(formatErrorMessage({ code: "57014" })).toBe("57014");
		expect(formatErrorMessage({ message: "boom", hint: "retry" })).toBe(
			"boom | retry",
		);
	});

	it("falls back to JSON for an object with no known fields", () => {
		expect(formatErrorMessage({ status: 500, reason: "nope" })).toBe(
			'{"status":500,"reason":"nope"}',
		);
	});

	it("degrades safely for empty, primitive, circular and nullish input", () => {
		expect(formatErrorMessage({})).toBe("[object Object]");
		expect(formatErrorMessage("plain string")).toBe("plain string");
		expect(formatErrorMessage(42)).toBe("42");
		expect(formatErrorMessage(null)).toBe("null");
		expect(formatErrorMessage(undefined)).toBe("undefined");

		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(formatErrorMessage(circular)).toBe("[object Object]");
	});
});
