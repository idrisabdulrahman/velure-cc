import { afterEach, describe, expect, it } from "vitest";
import { getSupabaseAdminClient } from "./supabase";

const originalUrl = process.env.VITE_SUPABASE_URL;
const originalSecret = process.env.SUPABASE_SECRET_KEY;

afterEach(() => {
	process.env.VITE_SUPABASE_URL = originalUrl;
	process.env.SUPABASE_SECRET_KEY = originalSecret;
});

describe("Supabase admin client", () => {
	it("fails closed without the server-only secret", () => {
		process.env.VITE_SUPABASE_URL = "https://example.supabase.co";
		delete process.env.SUPABASE_SECRET_KEY;

		expect(() => getSupabaseAdminClient()).toThrow(
			"SUPABASE_SECRET_KEY is missing.",
		);
	});
});
