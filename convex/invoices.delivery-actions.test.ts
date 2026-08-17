import { describe, expect, it } from "vitest";
import { canRunScheduledDelivery, parseFutureSchedule } from "./invoices";

describe("invoice delivery actions", () => {
	it("requires a valid future schedule", () => {
		const now = Date.parse("2026-08-13T12:00:00.000Z");
		expect(parseFutureSchedule("2026-08-14T09:00:00.000Z", now)).toBe(
			Date.parse("2026-08-14T09:00:00.000Z"),
		);
		expect(() => parseFutureSchedule(undefined, now)).toThrow(
			"scheduledAt is required",
		);
		expect(() => parseFutureSchedule("2026-08-13T11:59:59.000Z", now)).toThrow(
			"valid future date",
		);
	});

	it("rejects stale, canceled, and deleted scheduled jobs", () => {
		const scheduled = {
			scheduledAt: Date.now() + 60_000,
			scheduleVersion: "current",
		};
		expect(canRunScheduledDelivery(scheduled, "current")).toBe(true);
		expect(canRunScheduledDelivery(scheduled, "stale")).toBe(false);
		expect(
			canRunScheduledDelivery(
				{ ...scheduled, canceledAt: Date.now() },
				"current",
			),
		).toBe(false);
		expect(
			canRunScheduledDelivery(
				{ ...scheduled, deletedAt: Date.now() },
				"current",
			),
		).toBe(false);
	});
});
