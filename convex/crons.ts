import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

const crons = cronJobs();

crons.interval("queue invoice reminders", { hours: 1 }, api.reminders.runReminderBatch, {});
crons.interval("send queued reminder emails", { minutes: 15 }, api.reminders.sendQueuedEmails, {});
crons.interval("send Slack escalations", { minutes: 30 }, api.reminders.sendSlackEscalations, {});

export default crons;
