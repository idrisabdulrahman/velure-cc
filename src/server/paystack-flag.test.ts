import { afterEach, describe, expect, it, vi } from "vitest";
import { isPaystackCollectionEnabled } from "./paystack-flag";

afterEach(() => vi.unstubAllEnvs());

describe("isPaystackCollectionEnabled", () => {
	it("is off when the variable is not set", () => {
		expect(isPaystackCollectionEnabled({})).toBe(false);
	});

	it.each(["", "false", "0", "1", "yes", "on", "enabled", "truee"])(
		"is off for %j",
		(value) => {
			expect(
				isPaystackCollectionEnabled({ PAYSTACK_COLLECTION_ENABLED: value }),
			).toBe(false);
		},
	);

	it.each(["true", "TRUE", "True", "  true  "])("is on for %j", (value) => {
		expect(
			isPaystackCollectionEnabled({ PAYSTACK_COLLECTION_ENABLED: value }),
		).toBe(true);
	});

	it("reads process.env by default", () => {
		vi.stubEnv("PAYSTACK_COLLECTION_ENABLED", "");
		expect(isPaystackCollectionEnabled()).toBe(false);
		vi.stubEnv("PAYSTACK_COLLECTION_ENABLED", "true");
		expect(isPaystackCollectionEnabled()).toBe(true);
	});
});
