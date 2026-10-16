import { afterEach, describe, expect, it } from "vitest";
import { getSupabaseAdminClient } from "./supabase";

const SECRET_VARS = [
	"SUPABASE_SERVICE_ROLE_KEY",
	"SUPABASE_SECRET_KEY",
] as const;

const original = new Map<string, string | undefined>([
	["VITE_SUPABASE_URL", process.env.VITE_SUPABASE_URL],
	...SECRET_VARS.map(
		(name) => [name, process.env[name]] as [string, string | undefined],
	),
]);

afterEach(() => {
	for (const [name, value] of original) {
		// Assigning undefined writes the string "undefined", which is truthy and
		// would leak a fake secret into later tests.
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

describe("Supabase admin client", () => {
	it("fails closed without the server-only secret", () => {
		process.env.VITE_SUPABASE_URL = "https://example.supabase.co";
		// Both names must go: the client prefers SUPABASE_SERVICE_ROLE_KEY and
		// falls back to the legacy SUPABASE_SECRET_KEY, so deleting one still
		// leaves a usable secret on any machine that defines the other.
		for (const name of SECRET_VARS) delete process.env[name];

		expect(() => getSupabaseAdminClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
	});

	it("accepts the service-role key under its current name", () => {
		process.env.VITE_SUPABASE_URL = "https://example.supabase.co";
		// Only the current name is present. Reading the legacy var alone would
		// reject a correctly-configured deployment.
		delete process.env.SUPABASE_SECRET_KEY;
		process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

		expect(() => getSupabaseAdminClient()).not.toThrow();
	});
});
