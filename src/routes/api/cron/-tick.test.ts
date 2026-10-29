import { afterEach, describe, expect, it, vi } from "vitest";
import {
	runSchedulerTick,
	type SchedulerTickSummary,
} from "#/server/scheduler";
import { handleCronTick } from "./tick";

vi.mock("#/server/scheduler", () => ({
	runSchedulerTick: vi.fn(),
}));

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

function post(authorization?: string) {
	const headers: Record<string, string> = {};
	if (authorization) headers.authorization = authorization;
	return handleCronTick({
		request: new Request("http://localhost/api/cron/tick", {
			method: "POST",
			headers,
		}),
	});
}

const okSummary: SchedulerTickSummary = {
	ok: true,
	startedAt: "2026-10-29T09:00:00.000Z",
	completedAt: "2026-10-29T09:00:01.000Z",
	jobs: [{ name: "reminder_sweep", status: "success", durationMs: 10 }],
};

describe("POST /api/cron/tick", () => {
	it("fails closed when the scheduler secret is not configured", async () => {
		vi.stubEnv("INVOICE_SCHEDULER_SECRET", "");
		const response = await post("Bearer anything");
		expect(response.status).toBe(401);
		expect(runSchedulerTick).not.toHaveBeenCalled();
	});

	it("rejects a wrong or missing bearer token", async () => {
		vi.stubEnv("INVOICE_SCHEDULER_SECRET", "s3cret");
		expect((await post("Bearer wrong")).status).toBe(401);
		expect((await post()).status).toBe(401);
		expect((await post("s3cret")).status).toBe(401);
		expect(runSchedulerTick).not.toHaveBeenCalled();
	});

	it("runs the tick with the secret and returns 200 when every job passed", async () => {
		vi.stubEnv("INVOICE_SCHEDULER_SECRET", "s3cret");
		vi.mocked(runSchedulerTick).mockResolvedValue(okSummary);

		const response = await post("Bearer s3cret");

		expect(runSchedulerTick).toHaveBeenCalledTimes(1);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual(okSummary);
	});

	it("returns 500 with the per-job body when any job failed", async () => {
		vi.stubEnv("INVOICE_SCHEDULER_SECRET", "s3cret");
		const partial: SchedulerTickSummary = {
			...okSummary,
			ok: false,
			jobs: [
				{ name: "broken", status: "failure", durationMs: 5, error: "boom" },
				{ name: "healthy", status: "success", durationMs: 1 },
			],
		};
		vi.mocked(runSchedulerTick).mockResolvedValue(partial);

		const response = await post("Bearer s3cret");

		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toEqual(partial);
	});

	it("returns a generic 500 when the tick itself throws", async () => {
		vi.stubEnv("INVOICE_SCHEDULER_SECRET", "s3cret");
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.mocked(runSchedulerTick).mockRejectedValue(new Error("db down"));

		const response = await post("Bearer s3cret");

		expect(response.status).toBe(500);
		await expect(response.json()).resolves.toEqual({
			ok: false,
			error: "Scheduler tick failed.",
		});
	});
});
