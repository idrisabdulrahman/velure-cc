import { describe, expect, it } from "vitest";
import { detectAuthRuntime, trustedIpHeaders } from "#/server/auth-runtime";

/**
 * The header chosen here decides whether the login rate limit exists at all:
 * better-auth drops the limit when no header yields a valid IP
 * (`rate-limiter/index.mjs`, `if (!ip) return;`). The first Workers deployment
 * trusted only `x-forwarded-for`, which Cloudflare does not send, so sign-in was
 * unlimited in production. These checks pin both hosts to a header that the
 * platform edge controls.
 */
describe("auth runtime detection", () => {
	it("treats the Workers user agent as Workers", () => {
		expect(detectAuthRuntime("Cloudflare-Workers")).toBe("workers");
	});

	it("treats anything else as Node", () => {
		expect(detectAuthRuntime("node")).toBe("node");
		expect(detectAuthRuntime("Mozilla/5.0")).toBe("node");
		expect(detectAuthRuntime(undefined)).toBe("node");
	});

	it("trusts the Cloudflare-injected header on Workers", () => {
		// Cloudflare strips client-supplied cf-connecting-ip, so the edge value
		// cannot be forged. No x-forwarded-for exists to fall back to.
		expect(trustedIpHeaders("workers")).toEqual(["cf-connecting-ip"]);
	});

	it("trusts only the proxy-replaced header on Node", () => {
		// Nothing validates cf-connecting-ip outside Cloudflare, so trusting it on
		// the VPS would let a client choose its own rate-limit key.
		expect(trustedIpHeaders("node")).toEqual(["x-forwarded-for"]);
	});
});
