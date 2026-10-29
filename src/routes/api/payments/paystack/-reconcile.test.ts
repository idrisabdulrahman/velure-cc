import { afterEach, describe, expect, it, vi } from "vitest";
import { reconcilePendingPaystackCharges } from "#/server/data/paystack-server";
import { handleReconcilePayments } from "./reconcile";

vi.mock("#/server/data/paystack-server", () => ({
	reconcilePendingPaystackCharges: vi.fn(),
}));

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

function post(authorization?: string) {
	const headers: Record<string, string> = {};
	if (authorization) headers.authorization = authorization;
	return handleReconcilePayments({
		request: new Request("http://localhost/api/payments/paystack/reconcile", {
			method: "POST",
			headers,
		}),
	});
}

describe("Paystack reconciliation route", () => {
	it("fails closed when the scheduler secret is not configured", async () => {
		vi.stubEnv("INVOICE_SCHEDULER_SECRET", "");
		expect((await post("Bearer anything")).status).toBe(401);
		expect(reconcilePendingPaystackCharges).not.toHaveBeenCalled();
	});

	it("rejects a wrong or missing bearer token", async () => {
		vi.stubEnv("INVOICE_SCHEDULER_SECRET", "s3cret");
		expect((await post("Bearer wrong")).status).toBe(401);
		expect((await post()).status).toBe(401);
		expect(reconcilePendingPaystackCharges).not.toHaveBeenCalled();
	});

	it("runs reconciliation for the scheduler and returns the summary", async () => {
		vi.stubEnv("INVOICE_SCHEDULER_SECRET", "s3cret");
		vi.mocked(reconcilePendingPaystackCharges).mockResolvedValueOnce({
			checked: 2,
			credited: 1,
			duplicates: 0,
			unchanged: 1,
			errors: 0,
		});

		const response = await post("Bearer s3cret");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			ok: true,
			checked: 2,
			credited: 1,
			duplicates: 0,
			unchanged: 1,
			errors: 0,
		});
		expect(reconcilePendingPaystackCharges).toHaveBeenCalledTimes(1);
	});

	it("returns 500 so the scheduler retries when reconciliation throws", async () => {
		vi.stubEnv("INVOICE_SCHEDULER_SECRET", "s3cret");
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.mocked(reconcilePendingPaystackCharges).mockRejectedValueOnce(
			new Error("database unavailable"),
		);

		const response = await post("Bearer s3cret");

		expect(response.status).toBe(500);
		expect(error).toHaveBeenCalled();
	});
});
