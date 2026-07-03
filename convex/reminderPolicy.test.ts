import { describe, expect, it } from "vitest";
import { resolveOverdueReminderDecision } from "./reminderPolicy";

describe("overdue reminder policy", () => {
	it("queues non-overdue reminders without applying overdue limits", () => {
		expect(
			resolveOverdueReminderDecision({
				stage: "before_due",
				overdueEmailCount: 3,
				internalReviewQueued: false,
				maxOverdueReminders: 0,
				escalateAfterCount: 0,
			}),
		).toMatchObject({
			queueEmail: true,
			queueInternalReviewBeforeEmail: false,
			queueInternalReviewAfterEmail: false,
		});
	});

	it("stops overdue email when the saved limit has already been reached", () => {
		expect(
			resolveOverdueReminderDecision({
				stage: "overdue_2",
				overdueEmailCount: 2,
				internalReviewQueued: false,
				maxOverdueReminders: 2,
				escalateAfterCount: 0,
			}),
		).toMatchObject({
			queueEmail: false,
			queueInternalReviewBeforeEmail: false,
			queueInternalReviewAfterEmail: false,
		});
	});

	it("moves to internal review after the threshold overdue email", () => {
		expect(
			resolveOverdueReminderDecision({
				stage: "overdue_3",
				overdueEmailCount: 2,
				internalReviewQueued: false,
				maxOverdueReminders: 3,
				escalateAfterCount: 3,
			}),
		).toMatchObject({
			queueEmail: true,
			queueInternalReviewBeforeEmail: false,
			queueInternalReviewAfterEmail: true,
		});
	});

	it("moves stale invoices to review without sending another overdue email", () => {
		expect(
			resolveOverdueReminderDecision({
				stage: "overdue_3",
				overdueEmailCount: 3,
				internalReviewQueued: false,
				maxOverdueReminders: 3,
				escalateAfterCount: 3,
			}),
		).toMatchObject({
			queueEmail: false,
			queueInternalReviewBeforeEmail: true,
			queueInternalReviewAfterEmail: false,
		});
	});
});
