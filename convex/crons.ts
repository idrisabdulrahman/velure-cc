import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
	"queue invoice reminders",
	{ hours: 1 },
	internal.reminders.runReminderBatchInternal,
	{},
);
crons.interval(
	"send queued reminder emails",
	{ minutes: 15 },
	internal.reminders.sendQueuedEmailsInternal,
	{},
);
crons.interval(
	"send Slack escalations",
	{ minutes: 30 },
	internal.reminders.sendSlackEscalationsInternal,
	{},
);
crons.interval(
	"generate recurring invoices",
	{ hours: 1 },
	internal.recurring.runRecurringGenerationInternal,
	{},
);
crons.interval(
	"refresh invoice statuses",
	{ hours: 24 },
	internal.invoices.runInvoiceStatusRefreshInternal,
	{},
);

export default crons;
