import { afterEach, describe, expect, it, vi } from "vitest";
import { getSupabaseAdminClient } from "#/server/supabase";
import { ensurePaystackTransferCharge } from "./paystack-server";

vi.mock("#/server/supabase", () => ({
	getSupabaseAdminClient: vi.fn(),
}));

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllEnvs();
});

describe("ensurePaystackTransferCharge (collection flag)", () => {
	it.each(["", "false", "1"])(
		"refuses before any database read when the flag is %j",
		async (value) => {
			vi.stubEnv("PAYSTACK_COLLECTION_ENABLED", value);

			await expect(
				ensurePaystackTransferCharge("invoice-token"),
			).rejects.toThrow("Paystack collection is not enabled.");
			expect(getSupabaseAdminClient).not.toHaveBeenCalled();
		},
	);
});
