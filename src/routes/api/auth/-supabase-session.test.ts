import { afterEach, describe, expect, it, vi } from "vitest";
import { mintSupabaseAccessToken } from "#/server/supabase-session";
import { handle } from "./supabase-session";

vi.mock("#/server/supabase-session", () => ({
	mintSupabaseAccessToken: vi.fn(),
}));

afterEach(() => vi.clearAllMocks());

describe("Supabase session route", () => {
	it("redacts JWT bridge configuration errors", async () => {
		vi.mocked(mintSupabaseAccessToken).mockRejectedValue(
			new Error("SUPABASE_JWT_PRIVATE_JWK must include its Supabase key kid"),
		);
		const response = await handle({
			request: new Request("https://velure.example/api/auth/supabase-session", {
				method: "POST",
			}),
		});

		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toEqual({
			ok: false,
			error: "Failed to create application session.",
		});
	});
});
