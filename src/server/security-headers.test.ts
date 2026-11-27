import { describe, expect, it } from "vitest";
import { applySecurityHeaders, SECURITY_HEADERS } from "./security-headers";

describe("app-level security headers", () => {
	it("adds the framing, referrer and sniffing floor", () => {
		const headers = new Headers({ "content-type": "text/html" });

		applySecurityHeaders(headers);

		expect(headers.get("x-content-type-options")).toBe("nosniff");
		expect(headers.get("referrer-policy")).toBe(
			"strict-origin-when-cross-origin",
		);
		expect(headers.get("x-frame-options")).toBe("DENY");
		expect(headers.get("content-security-policy")).toBe(
			"frame-ancestors 'none'",
		);
	});

	it("never overwrites a header the route already set", () => {
		const headers = new Headers({
			"referrer-policy": "no-referrer",
			"x-frame-options": "SAMEORIGIN",
		});

		applySecurityHeaders(headers);

		expect(headers.get("referrer-policy")).toBe("no-referrer");
		expect(headers.get("x-frame-options")).toBe("SAMEORIGIN");
	});

	it("does not own HSTS (the Cloudflare edge sets it)", () => {
		const lower = Object.keys(SECURITY_HEADERS).map((key) => key.toLowerCase());

		expect(lower).not.toContain("strict-transport-security");
	});
});
