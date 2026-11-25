import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveInitialAuthMode, validateAuthSearch } from "#/lib/auth-search";

/**
 * WS1 — the `/auth` deep-link contract.
 *
 * The repo has no component-test harness (node test environment, no
 * testing-library), so the search-param → tab rules are pinned two ways: the
 * pure validators run directly, and the route/lazy source is asserted to
 * actually call them.
 */

const routeSource = readFileSync(
	fileURLToPath(new URL("./auth.tsx", import.meta.url)),
	"utf8",
);
const lazySource = readFileSync(
	fileURLToPath(new URL("./auth.lazy.tsx", import.meta.url)),
	"utf8",
);

describe("/auth search-param contract", () => {
	it("accepts the three real modes and collapses anything else", () => {
		expect(validateAuthSearch({ mode: "sign-in" })).toEqual({
			mode: "sign-in",
			token: undefined,
			redirect: undefined,
			google: undefined,
		});
		expect(validateAuthSearch({ mode: "sign-up" })).toEqual({
			mode: "sign-up",
			token: undefined,
			redirect: undefined,
			google: undefined,
		});
		expect(validateAuthSearch({ mode: "reset", token: "abc" })).toEqual({
			mode: "reset",
			token: "abc",
			redirect: undefined,
			google: undefined,
		});
		expect(validateAuthSearch({ mode: "admin" })).toEqual({
			mode: undefined,
			token: undefined,
			redirect: undefined,
			google: undefined,
		});
		expect(validateAuthSearch({})).toEqual({
			mode: undefined,
			token: undefined,
			redirect: undefined,
			google: undefined,
		});
	});

	it("keeps only string values for the other params", () => {
		expect(validateAuthSearch({ token: "abc" }).token).toBe("abc");
		expect(validateAuthSearch({ token: 42 }).token).toBeUndefined();
		expect(validateAuthSearch({ token: ["a", "b"] }).token).toBeUndefined();
		expect(validateAuthSearch({ redirect: "/clients" }).redirect).toBe(
			"/clients",
		);
		expect(validateAuthSearch({ google: "failed" }).google).toBe("failed");
	});

	it("opens reset only with its token, sign-up on ?mode=sign-up, sign-in otherwise", () => {
		expect(resolveInitialAuthMode("reset", "tok")).toBe("reset");
		expect(resolveInitialAuthMode("reset", null)).toBe("sign-in");
		expect(resolveInitialAuthMode("reset", undefined)).toBe("sign-in");
		expect(resolveInitialAuthMode("sign-up", null)).toBe("sign-up");
		expect(resolveInitialAuthMode("sign-in", null)).toBe("sign-in");
		expect(resolveInitialAuthMode(null, null)).toBe("sign-in");
		expect(resolveInitialAuthMode("bogus", "tok")).toBe("sign-in");
	});

	it("wires validateSearch to the shared validator", () => {
		expect(routeSource).toContain("validateSearch: validateAuthSearch");
	});

	it("opens the lazy page on the resolved mode and keeps the reset deep link live", () => {
		expect(lazySource).toContain(
			"resolveInitialAuthMode(search.mode, search.token)",
		);
		expect(lazySource).toContain(
			'if (search.mode === "reset" && search.token)',
		);
	});
});
