export function resolveOverdueReminderDecision(args: {
	stage: string;
	overdueEmailCount: number;
	internalReviewQueued: boolean;
	maxOverdueReminders: number;
	escalateAfterCount: number;
}) {
	const isOverdueStage = args.stage.startsWith("overdue_");
	if (!isOverdueStage) {
		return {
			queueEmail: true,
			queueInternalReviewBeforeEmail: false,
			queueInternalReviewAfterEmail: false,
		};
	}

	const overdueEmailCount = Math.max(0, args.overdueEmailCount);
	const maxOverdueReminders = Math.max(0, args.maxOverdueReminders);
	const escalateAfterCount = Math.max(0, args.escalateAfterCount);

	if (escalateAfterCount > 0 && overdueEmailCount >= escalateAfterCount) {
		return {
			queueEmail: false,
			queueInternalReviewBeforeEmail: !args.internalReviewQueued,
			queueInternalReviewAfterEmail: false,
		};
	}

	if (overdueEmailCount >= maxOverdueReminders) {
		return {
			queueEmail: false,
			queueInternalReviewBeforeEmail: false,
			queueInternalReviewAfterEmail: false,
		};
	}

	return {
		queueEmail: true,
		queueInternalReviewBeforeEmail: false,
		queueInternalReviewAfterEmail:
			escalateAfterCount > 0 &&
			overdueEmailCount + 1 >= escalateAfterCount &&
			!args.internalReviewQueued,
	};
}
