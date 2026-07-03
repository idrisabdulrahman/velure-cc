import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
	action,
	internalAction,
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";
import { requireAuthUser } from "./auth";
import { env } from "./env";
import { RESEND_FREE_TIER_DAILY_LIMIT } from "./nigeria";
import { resolveOverdueReminderDecision } from "./reminderPolicy";
import { requireWorkspaceForRead, requireWritableInvoice } from "./rls";

type AuthCtx = Parameters<typeof requireAuthUser>[0];

const reminderStageValidator = v.union(
	v.literal("none"),
	v.literal("before_due"),
	v.literal("due_date"),
	v.literal("overdue_1"),
	v.literal("overdue_2"),
	v.literal("overdue_3"),
	v.literal("escalated"),
);

type ReminderStage =
	| "none"
	| "before_due"
	| "due_date"
	| "overdue_1"
	| "overdue_2"
	| "overdue_3"
	| "escalated";

type ReminderBatchResult = {
	date: string;
	scannedCount: number;
	queuedCount: number;
	escalatedCount: number;
};

type ReminderSendResult = {
	sent: number;
	skipped: number;
	reason?: string;
};

function defaultRule(ownerId: string) {
	const now = Date.now();
	return {
		ownerId,
		enabled: true,
		daysBeforeDue: 3,
		onDueDate: true,
		overdueCadenceDays: 3,
		maxOverdueReminders: 3,
		escalateAfterCount: 3,
		businessSignature: "Velure Finance Team",
		createdAt: now,
		updatedAt: now,
	};
}

async function requireViewer(ctx: AuthCtx) {
	return await requireAuthUser(ctx);
}

function startOfDay(value: string) {
	return new Date(`${value}T00:00:00.000Z`).getTime();
}

function buildReminderSubject(invoiceNumber: string) {
	const base = `Reminder: ${invoiceNumber}`;
	return base.length <= 60 ? base : `${base.slice(0, 57).trimEnd()}...`;
}

function escapeHtml(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function buyerEmailForInvoice(invoice: Doc<"invoices">) {
	return invoice.compliance?.buyer?.email?.trim().toLowerCase() ?? "";
}

function assertValidReminderRule(rule: {
	daysBeforeDue: number;
	overdueCadenceDays: number;
	maxOverdueReminders: number;
	escalateAfterCount: number;
	businessSignature?: string;
}) {
	if (!Number.isInteger(rule.daysBeforeDue) || rule.daysBeforeDue < 0) {
		throw new Error("First reminder must be 0 or more days before due.");
	}
	if (
		!Number.isInteger(rule.overdueCadenceDays) ||
		rule.overdueCadenceDays < 1
	) {
		throw new Error("Overdue gap must be at least 1 day.");
	}
	if (
		!Number.isInteger(rule.maxOverdueReminders) ||
		rule.maxOverdueReminders < 0 ||
		rule.maxOverdueReminders > 3
	) {
		throw new Error("Overdue email limit must be between 0 and 3.");
	}
	if (
		!Number.isInteger(rule.escalateAfterCount) ||
		rule.escalateAfterCount < 0 ||
		rule.escalateAfterCount > rule.maxOverdueReminders
	) {
		throw new Error("Review threshold must be between 0 and the email limit.");
	}
	if ((rule.businessSignature?.trim().length ?? 0) > 80) {
		throw new Error("Reminder email signature must be 80 characters or less.");
	}
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : "Unknown error";
}

async function recordJobRun(
	ctx: { runMutation: (fn: any, args: any) => Promise<unknown> },
	args: {
		workspaceId?: Id<"workspaces">;
		jobName: string;
		status: "success" | "failure";
		startedAt: number;
		result?: unknown;
		error?: string;
	},
) {
	const completedAt = Date.now();
	await ctx.runMutation(internal.jobRuns.recordInternal, {
		workspaceId: args.workspaceId,
		jobName: args.jobName,
		status: args.status,
		durationMs: completedAt - args.startedAt,
		retries: 0,
		error: args.error,
		resultJson:
			args.result === undefined ? undefined : JSON.stringify(args.result),
		startedAt: args.startedAt,
		completedAt,
	});
}

function determineStage(
	dueDate: string,
	now: number,
	rule: {
		daysBeforeDue: number;
		onDueDate: boolean;
		overdueCadenceDays: number;
	},
) {
	const dueAt = startOfDay(dueDate);
	const diffDays = Math.floor((dueAt - now) / (1000 * 60 * 60 * 24));

	if (diffDays === rule.daysBeforeDue) return "before_due" as const;
	if (diffDays === 0 && rule.onDueDate) return "due_date" as const;
	if (diffDays < 0) {
		const overdueDays = Math.abs(diffDays);
		if (overdueDays >= rule.overdueCadenceDays * 3) return "overdue_3" as const;
		if (overdueDays >= rule.overdueCadenceDays * 2) return "overdue_2" as const;
		if (overdueDays >= rule.overdueCadenceDays) return "overdue_1" as const;
	}

	return "none" as const;
}

async function queueReminderEventForInvoice(
	ctx: Pick<MutationCtx, "db">,
	args: {
		ownerId: string;
		invoiceId: Id<"invoices">;
		stage: ReminderStage;
		channel: "email" | "slack" | "internal";
		meta?: string;
	},
) {
	const invoice = await ctx.db.get(args.invoiceId);
	if (!invoice) {
		throw new Error("Invoice not found.");
	}

	if (args.channel === "email") {
		if (invoice.status === "paid" || invoice.status === "canceled") {
			return { skipped: true, reason: "Invoice is already closed." };
		}
		if (invoice.reminder?.paused) {
			return { skipped: true, reason: "Invoice reminders are paused." };
		}
		if (!buyerEmailForInvoice(invoice)) {
			return { skipped: true, reason: "Buyer email is missing." };
		}
	}

	const existing = await ctx.db
		.query("reminder_events")
		.withIndex("by_invoiceId", (q) => q.eq("invoiceId", args.invoiceId))
		.collect();

	if (
		existing.some(
			(event: Doc<"reminder_events">) =>
				event.stage === args.stage &&
				event.channel === args.channel &&
				event.status !== "failed",
		)
	) {
		return { skipped: true };
	}

	const timestamp = Date.now();
	const eventId = await ctx.db.insert("reminder_events", {
		ownerId: args.ownerId,
		invoiceId: args.invoiceId,
		stage: args.stage,
		channel: args.channel,
		scheduledFor: timestamp,
		status: "queued",
		meta: args.meta,
		createdAt: timestamp,
		updatedAt: timestamp,
	});

	await ctx.db.patch(args.invoiceId, {
		reminder: {
			...(invoice.reminder ?? {
				enabled: true,
				paused: false,
				stage: "none",
				escalationStatus: "idle",
			}),
			stage: args.stage,
			escalationStatus:
				args.stage === "escalated"
					? "manual_review"
					: (invoice.reminder?.escalationStatus ?? "idle"),
			lastReminderAt: timestamp,
		},
		updatedAt: timestamp,
	});

	return { eventId };
}

export const getReminderSettings = query({
	args: {},
	handler: async (ctx) => {
		const viewer = await requireViewer(ctx);
		const rule = await ctx.db
			.query("reminder_rules")
			.withIndex("by_ownerId", (q) => q.eq("ownerId", viewer._id))
			.first();

		return rule ?? defaultRule(viewer._id);
	},
});

export const saveReminderSettings = mutation({
	args: {
		enabled: v.boolean(),
		daysBeforeDue: v.number(),
		onDueDate: v.boolean(),
		overdueCadenceDays: v.number(),
		maxOverdueReminders: v.number(),
		escalateAfterCount: v.number(),
		businessSignature: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const viewer = await requireViewer(ctx);
		assertValidReminderRule(args);
		const existing = await ctx.db
			.query("reminder_rules")
			.withIndex("by_ownerId", (q) => q.eq("ownerId", viewer._id))
			.first();
		const now = Date.now();

		if (existing) {
			await ctx.db.patch(existing._id, { ...args, updatedAt: now });
			return existing._id;
		}

		return await ctx.db.insert("reminder_rules", {
			ownerId: viewer._id,
			...args,
			createdAt: now,
			updatedAt: now,
		});
	},
});

function isReminderInvoiceOverdue(invoice: Doc<"invoices">) {
	if (invoice.status === "paid" || invoice.status === "canceled") return false;
	const dueDate = new Date(`${invoice.dueDate}T00:00:00`);
	if (Number.isNaN(dueDate.getTime())) return invoice.status === "overdue";
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	return invoice.status === "overdue" || dueDate < today;
}

function isInReminderWindow(invoice: Doc<"invoices">, daysBeforeDue: number) {
	if (invoice.status === "paid" || invoice.status === "canceled") return false;
	if (invoice.reminder?.paused) return false;
	if (!invoice.lifecycle?.sentAt) return false;
	const dueDate = new Date(`${invoice.dueDate}T00:00:00`);
	if (Number.isNaN(dueDate.getTime())) return false;
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const daysUntilDue = Math.ceil(
		(dueDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
	);
	return daysUntilDue <= daysBeforeDue;
}

export const getCollectionOverview = query({
	args: {
		daysBeforeDue: v.optional(v.number()),
		limit: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) {
			return {
				stats: {
					actionableCount: 0,
					overdueCount: 0,
					missingEmailCount: 0,
					pausedOrManualCount: 0,
				},
				invoices: [],
			};
		}

		const daysBeforeDue = Math.max(0, Math.floor(args.daysBeforeDue ?? 3));
		const limit = Math.min(Math.max(Math.floor(args.limit ?? 100), 10), 200);
		const invoices = await ctx.db
			.query("invoices")
			.withIndex("by_workspaceId", (q) =>
				q.eq("workspaceId", scope.workspaceId),
			)
			.order("desc")
			.collect();
		const stats = {
			actionableCount: 0,
			overdueCount: 0,
			missingEmailCount: 0,
			pausedOrManualCount: 0,
		};
		const activeInvoices = [];

		for (const invoice of invoices) {
			const isActiveInvoice =
				invoice.status !== "paid" && invoice.status !== "canceled";
			const missingBuyerEmail =
				isActiveInvoice && !buyerEmailForInvoice(invoice);
			const pausedOrManual =
				invoice.reminder?.paused ||
				invoice.reminder?.escalationStatus === "manual_review";

			if (isReminderInvoiceOverdue(invoice)) {
				stats.overdueCount += 1;
			}
			if (missingBuyerEmail) {
				stats.missingEmailCount += 1;
			}
			if (pausedOrManual) {
				stats.pausedOrManualCount += 1;
			}
			if (
				isInReminderWindow(invoice, daysBeforeDue) &&
				!missingBuyerEmail &&
				!pausedOrManual
			) {
				stats.actionableCount += 1;
			}

			if (isActiveInvoice && activeInvoices.length < limit) {
				activeInvoices.push({
					id: invoice._id,
					invoiceNumber: invoice.invoiceNumber,
					customerName: invoice.customerName,
					dueDate: invoice.dueDate,
					status: invoice.status,
					reminder: invoice.reminder,
					lifecycle: invoice.lifecycle,
					compliance: invoice.compliance,
				});
			}
		}

		return { stats, invoices: activeInvoices };
	},
});

export const getInvoiceTimeline = query({
	args: { invoiceId: v.id("invoices") },
	handler: async (ctx, args) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) {
			throw new Error("Invoice not found.");
		}

		const invoice = await ctx.db.get(args.invoiceId);
		if (!invoice || invoice.workspaceId !== scope.workspaceId) {
			throw new Error("Invoice not found.");
		}

		return await ctx.db
			.query("reminder_events")
			.withIndex("by_invoiceId", (q) => q.eq("invoiceId", args.invoiceId))
			.order("desc")
			.collect();
	},
});

export const getReminderScopeForViewer = internalQuery({
	args: {},
	handler: async (ctx) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) {
			throw new Error("Workspace not found.");
		}

		return scope;
	},
});

export const listReminderWorkspaces = internalQuery({
	args: { workspaceId: v.optional(v.id("workspaces")) },
	handler: async (ctx, args) => {
		if (args.workspaceId) {
			const workspace = await ctx.db.get(args.workspaceId);
			return workspace ? [workspace] : [];
		}

		return await ctx.db.query("workspaces").collect();
	},
});

export const getReminderSettingsForOwner = internalQuery({
	args: { ownerId: v.string() },
	handler: async (ctx, args) => {
		const rule = await ctx.db
			.query("reminder_rules")
			.withIndex("by_ownerId", (q) => q.eq("ownerId", args.ownerId))
			.first();

		return rule ?? defaultRule(args.ownerId);
	},
});

export const listReminderInvoicesForWorkspace = internalQuery({
	args: { workspaceId: v.id("workspaces") },
	handler: async (ctx, args) => {
		return await ctx.db
			.query("invoices")
			.withIndex("by_workspaceId", (q) => q.eq("workspaceId", args.workspaceId))
			.collect();
	},
});

export const getReminderPolicyCountsForInvoice = internalQuery({
	args: { invoiceId: v.id("invoices") },
	handler: async (ctx, args) => {
		const events = await ctx.db
			.query("reminder_events")
			.withIndex("by_invoiceId", (q) => q.eq("invoiceId", args.invoiceId))
			.collect();
		const overdueEmailCount = events.filter(
			(event) =>
				event.channel === "email" &&
				event.stage.startsWith("overdue_") &&
				event.status !== "failed",
		).length;
		const internalReviewQueued = events.some(
			(event) =>
				event.channel === "internal" &&
				event.stage === "escalated" &&
				event.status !== "failed",
		);

		return { overdueEmailCount, internalReviewQueued };
	},
});

export const queueReminderEventInternal = internalMutation({
	args: {
		ownerId: v.string(),
		invoiceId: v.id("invoices"),
		stage: reminderStageValidator,
		channel: v.union(
			v.literal("email"),
			v.literal("slack"),
			v.literal("internal"),
		),
		meta: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		return await queueReminderEventForInvoice(ctx, args);
	},
});

export const markReminderEventStatusInternal = internalMutation({
	args: {
		eventId: v.id("reminder_events"),
		status: v.union(
			v.literal("queued"),
			v.literal("sent"),
			v.literal("skipped"),
			v.literal("failed"),
		),
		error: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const event = await ctx.db.get(args.eventId);
		if (!event) {
			throw new Error("Reminder event not found.");
		}

		await ctx.db.patch(args.eventId, {
			status: args.status,
			error: args.error,
			sentAt: args.status === "sent" ? Date.now() : event.sentAt,
			updatedAt: Date.now(),
		});

		return { ok: true };
	},
});

export const recordReminderRunInternal = internalMutation({
	args: {
		ownerId: v.string(),
		runDate: v.string(),
		status: v.union(
			v.literal("queued"),
			v.literal("completed"),
			v.literal("failed"),
		),
		scannedCount: v.number(),
		queuedCount: v.number(),
		sentCount: v.number(),
		escalatedCount: v.number(),
		notes: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const timestamp = Date.now();
		return await ctx.db.insert("reminder_runs", {
			...args,
			createdAt: timestamp,
			updatedAt: timestamp,
		});
	},
});

export const listQueuedReminderEmailWorkItems = internalQuery({
	args: { workspaceId: v.optional(v.id("workspaces")) },
	handler: async (ctx, args) => {
		const events = await ctx.db.query("reminder_events").collect();
		const workItems = [];

		for (const event of events) {
			if (event.channel !== "email" || event.status !== "queued") continue;

			const invoice = await ctx.db.get(event.invoiceId);
			if (!invoice) continue;
			if (args.workspaceId && invoice.workspaceId !== args.workspaceId)
				continue;

			workItems.push({ event, invoice });
		}

		return workItems;
	},
});

export const listQueuedReminderSlackWorkItems = internalQuery({
	args: { workspaceId: v.optional(v.id("workspaces")) },
	handler: async (ctx, args) => {
		const events = await ctx.db.query("reminder_events").collect();
		const workItems = [];

		for (const event of events) {
			if (event.channel !== "slack" || event.status !== "queued") continue;

			const invoice = await ctx.db.get(event.invoiceId);
			if (!invoice) continue;
			if (args.workspaceId && invoice.workspaceId !== args.workspaceId)
				continue;

			workItems.push({ event, invoice });
		}

		return workItems;
	},
});

export const countEmailReminderEventsSentSince = internalQuery({
	args: {
		since: v.number(),
		workspaceId: v.optional(v.id("workspaces")),
	},
	handler: async (ctx, args) => {
		const events = await ctx.db.query("reminder_events").collect();
		let count = 0;

		for (const event of events) {
			if (event.channel !== "email" || event.status !== "sent" || !event.sentAt)
				continue;
			if (event.sentAt < args.since) continue;

			const invoice = await ctx.db.get(event.invoiceId);
			if (!invoice) continue;
			if (args.workspaceId && invoice.workspaceId !== args.workspaceId)
				continue;
			count += 1;
		}

		return count;
	},
});

export const getSlackWebhookForOwner = internalQuery({
	args: { ownerId: v.string() },
	handler: async (ctx, args) => {
		const connection = await ctx.db
			.query("integration_connections")
			.withIndex("by_ownerId_and_provider", (q) =>
				q.eq("ownerId", args.ownerId).eq("provider", "slack"),
			)
			.first();

		return connection?.webhookUrl ?? null;
	},
});

export const pauseInvoiceReminders = mutation({
	args: {
		invoiceId: v.id("invoices"),
		note: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const { scope, invoice } = await requireWritableInvoice(
			ctx,
			args.invoiceId,
		);

		const now = Date.now();
		await ctx.db.patch(args.invoiceId, {
			reminder: {
				...(invoice.reminder ?? {
					enabled: true,
					paused: false,
					stage: "none",
					escalationStatus: "idle",
				}),
				paused: true,
			},
			updatedAt: now,
		});

		const existingCase = await ctx.db
			.query("collections_cases")
			.withIndex("by_invoiceId", (q) => q.eq("invoiceId", args.invoiceId))
			.first();

		if (existingCase) {
			await ctx.db.patch(existingCase._id, {
				status: "paused",
				note: args.note,
				lastActionAt: now,
				updatedAt: now,
			});
		} else {
			await ctx.db.insert("collections_cases", {
				ownerId: scope.userId,
				invoiceId: args.invoiceId,
				status: "paused",
				note: args.note,
				escalationStatus: "idle",
				lastActionAt: now,
				createdAt: now,
				updatedAt: now,
			});
		}

		await ctx.db.insert("reminder_events", {
			ownerId: scope.userId,
			invoiceId: args.invoiceId,
			stage: "none",
			channel: "internal",
			scheduledFor: now,
			sentAt: now,
			status: "sent",
			meta: "Paused reminder workflow",
			createdAt: now,
			updatedAt: now,
		});

		return { ok: true };
	},
});

export const resumeInvoiceReminders = mutation({
	args: { invoiceId: v.id("invoices") },
	handler: async (ctx, args) => {
		const { scope, invoice } = await requireWritableInvoice(
			ctx,
			args.invoiceId,
		);

		const now = Date.now();
		await ctx.db.patch(args.invoiceId, {
			reminder: {
				...(invoice.reminder ?? {
					enabled: true,
					paused: false,
					stage: "none",
					escalationStatus: "idle",
				}),
				paused: false,
			},
			updatedAt: now,
		});

		const caseRow = await ctx.db
			.query("collections_cases")
			.withIndex("by_invoiceId", (q) => q.eq("invoiceId", args.invoiceId))
			.first();

		if (caseRow) {
			await ctx.db.patch(caseRow._id, {
				status: "open",
				lastActionAt: now,
				updatedAt: now,
			});
		}

		await ctx.db.insert("reminder_events", {
			ownerId: scope.userId,
			invoiceId: args.invoiceId,
			stage: "none",
			channel: "internal",
			scheduledFor: now,
			sentAt: now,
			status: "sent",
			meta: "Resumed reminder workflow",
			createdAt: now,
			updatedAt: now,
		});

		return { ok: true };
	},
});

export const markManualException = mutation({
	args: {
		invoiceId: v.id("invoices"),
		note: v.string(),
	},
	handler: async (ctx, args) => {
		const { scope } = await requireWritableInvoice(ctx, args.invoiceId);

		const now = Date.now();
		const caseRow = await ctx.db
			.query("collections_cases")
			.withIndex("by_invoiceId", (q) => q.eq("invoiceId", args.invoiceId))
			.first();

		if (caseRow) {
			await ctx.db.patch(caseRow._id, {
				status: "manual_exception",
				note: args.note,
				escalationStatus: "manual_review",
				lastActionAt: now,
				updatedAt: now,
			});
		} else {
			await ctx.db.insert("collections_cases", {
				ownerId: scope.userId,
				invoiceId: args.invoiceId,
				status: "manual_exception",
				note: args.note,
				escalationStatus: "manual_review",
				lastActionAt: now,
				createdAt: now,
				updatedAt: now,
			});
		}

		return { ok: true };
	},
});

export const queueReminderEvent = mutation({
	args: {
		invoiceId: v.id("invoices"),
		stage: reminderStageValidator,
		channel: v.union(
			v.literal("email"),
			v.literal("slack"),
			v.literal("internal"),
		),
		meta: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const { scope } = await requireWritableInvoice(ctx, args.invoiceId);
		return await queueReminderEventForInvoice(ctx, {
			ownerId: scope.userId,
			invoiceId: args.invoiceId,
			stage: args.stage,
			channel: args.channel,
			meta: args.meta,
		});
	},
});

export const markReminderEventStatus = mutation({
	args: {
		eventId: v.id("reminder_events"),
		status: v.union(
			v.literal("queued"),
			v.literal("sent"),
			v.literal("skipped"),
			v.literal("failed"),
		),
		error: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const viewer = await requireViewer(ctx);
		const event = await ctx.db.get(args.eventId);
		if (!event || event.ownerId !== viewer._id) {
			throw new Error("Reminder event not found.");
		}

		await ctx.db.patch(args.eventId, {
			status: args.status,
			error: args.error,
			sentAt: args.status === "sent" ? Date.now() : event.sentAt,
			updatedAt: Date.now(),
		});

		return { ok: true };
	},
});

export const runReminderBatchInternal = internalAction({
	args: {
		date: v.optional(v.string()),
		workspaceId: v.optional(v.id("workspaces")),
	},
	handler: async (ctx, args): Promise<ReminderBatchResult> => {
		const startedAt = Date.now();
		try {
			const today = args.date ?? new Date().toISOString().slice(0, 10);
			const workspaces = await ctx.runQuery(
				internal.reminders.listReminderWorkspaces,
				{
					workspaceId: args.workspaceId,
				},
			);

			let queuedCount = 0;
			let scannedCount = 0;
			let escalatedCount = 0;

			for (const workspace of workspaces) {
				const ownerId = workspace.ownerId;
				const rule = await ctx.runQuery(
					internal.reminders.getReminderSettingsForOwner,
					{
						ownerId,
					},
				);
				const invoices = await ctx.runQuery(
					internal.reminders.listReminderInvoicesForWorkspace,
					{
						workspaceId: workspace._id,
					},
				);

				scannedCount += invoices.length;

				if (!rule.enabled) {
					await ctx.runMutation(internal.reminders.recordReminderRunInternal, {
						ownerId,
						runDate: today,
						status: "completed",
						scannedCount: invoices.length,
						queuedCount: 0,
						sentCount: 0,
						escalatedCount: 0,
						notes: "Reminder rule disabled.",
					});
					continue;
				}

				let workspaceQueuedCount = 0;
				let workspaceEscalatedCount = 0;

				for (const invoice of invoices) {
					if (invoice.reminder?.paused) continue;
					if (invoice.status === "paid" || invoice.status === "canceled")
						continue;
					if (!invoice.lifecycle?.sentAt) continue;
					if (!buyerEmailForInvoice(invoice)) continue;

					const stage = determineStage(
						invoice.dueDate,
						startOfDay(today),
						rule,
					);
					if (stage === "none") continue;

					const isOverdueStage = stage.startsWith("overdue_");
					const counts = isOverdueStage
						? await ctx.runQuery(
								internal.reminders.getReminderPolicyCountsForInvoice,
								{ invoiceId: invoice._id },
							)
						: { overdueEmailCount: 0, internalReviewQueued: false };
					const reminderDecision = resolveOverdueReminderDecision({
						stage,
						overdueEmailCount: counts.overdueEmailCount,
						internalReviewQueued: counts.internalReviewQueued,
						maxOverdueReminders: rule.maxOverdueReminders,
						escalateAfterCount: rule.escalateAfterCount,
					});
					if (reminderDecision.queueInternalReviewBeforeEmail) {
						const reviewResult = await ctx.runMutation(
							internal.reminders.queueReminderEventInternal,
							{
								ownerId,
								invoiceId: invoice._id,
								stage: "escalated",
								channel: "internal",
								meta: `Moved to internal review after ${rule.escalateAfterCount} overdue reminders.`,
							},
						);

						if (!("skipped" in reviewResult)) {
							queuedCount += 1;
							workspaceQueuedCount += 1;
							escalatedCount += 1;
							workspaceEscalatedCount += 1;
						}
					}
					if (!reminderDecision.queueEmail) continue;

					const emailResult = await ctx.runMutation(
						internal.reminders.queueReminderEventInternal,
						{
							ownerId,
							invoiceId: invoice._id,
							stage,
							channel: "email",
						},
					);

					if (!("skipped" in emailResult)) {
						queuedCount += 1;
						workspaceQueuedCount += 1;
					}

					if (reminderDecision.queueInternalReviewAfterEmail) {
						const reviewResult = await ctx.runMutation(
							internal.reminders.queueReminderEventInternal,
							{
								ownerId,
								invoiceId: invoice._id,
								stage: "escalated",
								channel: "internal",
								meta: `Moved to internal review after ${rule.escalateAfterCount} overdue reminders.`,
							},
						);

						if (!("skipped" in reviewResult)) {
							queuedCount += 1;
							workspaceQueuedCount += 1;
							escalatedCount += 1;
							workspaceEscalatedCount += 1;
						}
					}
				}

				await ctx.runMutation(internal.reminders.recordReminderRunInternal, {
					ownerId,
					runDate: today,
					status: "completed",
					scannedCount: invoices.length,
					queuedCount: workspaceQueuedCount,
					sentCount: 0,
					escalatedCount: workspaceEscalatedCount,
				});
			}

			const result = { date: today, scannedCount, queuedCount, escalatedCount };
			await recordJobRun(ctx, {
				workspaceId: args.workspaceId,
				jobName: "queue invoice reminders",
				status: "success",
				startedAt,
				result,
			});
			return result;
		} catch (error) {
			await recordJobRun(ctx, {
				workspaceId: args.workspaceId,
				jobName: "queue invoice reminders",
				status: "failure",
				startedAt,
				error: errorMessage(error),
			});
			throw error;
		}
	},
});

export const runReminderBatch = action({
	args: { date: v.optional(v.string()) },
	handler: async (ctx, args): Promise<ReminderBatchResult> => {
		const scope: { workspaceId: Id<"workspaces"> } = await ctx.runQuery(
			internal.reminders.getReminderScopeForViewer,
			{},
		);
		return await ctx.runAction(internal.reminders.runReminderBatchInternal, {
			date: args.date,
			workspaceId: scope.workspaceId,
		});
	},
});

export const sendQueuedEmailsInternal = internalAction({
	args: { workspaceId: v.optional(v.id("workspaces")) },
	handler: async (ctx, args): Promise<ReminderSendResult> => {
		const startedAt = Date.now();
		try {
			const workItems = (await ctx.runQuery(
				internal.reminders.listQueuedReminderEmailWorkItems,
				{
					workspaceId: args.workspaceId,
				},
			)) as Array<{ event: Doc<"reminder_events">; invoice: Doc<"invoices"> }>;

			if (!env.RESEND_API_KEY) {
				const result = {
					sent: 0,
					skipped: workItems.length,
					reason: "RESEND_API_KEY missing",
				};
				await recordJobRun(ctx, {
					workspaceId: args.workspaceId,
					jobName: "send queued reminder emails",
					status: "success",
					startedAt,
					result,
				});
				return result;
			}

			const todayStart = new Date();
			todayStart.setUTCHours(0, 0, 0, 0);
			const sentToday = await ctx.runQuery(
				internal.reminders.countEmailReminderEventsSentSince,
				{
					since: todayStart.getTime(),
					workspaceId: args.workspaceId,
				},
			);
			const remainingCapacity = Math.max(
				0,
				RESEND_FREE_TIER_DAILY_LIMIT - sentToday,
			);

			let sent = 0;
			let skipped = 0;

			for (const { event, invoice } of workItems) {
				const recipient = buyerEmailForInvoice(invoice);
				if (!recipient) {
					await ctx.runMutation(
						internal.reminders.markReminderEventStatusInternal,
						{
							eventId: event._id,
							status: "failed",
							error: "Buyer email is missing on this invoice.",
						},
					);
					skipped += 1;
					continue;
				}

				if (sent >= remainingCapacity) {
					await ctx.runMutation(
						internal.reminders.markReminderEventStatusInternal,
						{
							eventId: event._id,
							status: "failed",
							error: "Resend free-tier daily limit reached.",
						},
					);
					skipped += 1;
					continue;
				}

				const publicLink = `${env.SITE_URL ?? ""}/i/${invoice.token}`;
				const safeInvoiceNumber = escapeHtml(invoice.invoiceNumber);
				const safeCustomerName = escapeHtml(invoice.customerName);
				const safeStatus = escapeHtml(invoice.status ?? "unpaid");
				const safePublicLink = escapeHtml(publicLink);
				const rule = await ctx.runQuery(
					internal.reminders.getReminderSettingsForOwner,
					{
						ownerId: event.ownerId,
					},
				);
				const signature =
					rule.businessSignature?.trim() || "Velure Finance Team";
				const safeSignature = escapeHtml(signature);
				const response = await fetch("https://api.resend.com/emails", {
					method: "POST",
					headers: {
						Authorization: `Bearer ${env.RESEND_API_KEY}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						from: env.RESEND_FROM ?? "Velure <onboarding@resend.dev>",
						to: [recipient],
						subject: buildReminderSubject(invoice.invoiceNumber),
						text: `Invoice ${invoice.invoiceNumber} for ${invoice.customerName} is currently ${invoice.status}. View it here: ${publicLink}\n\n${signature}`,
						html: `<p>Invoice <strong>${safeInvoiceNumber}</strong> for ${safeCustomerName} is currently ${safeStatus}.</p><p>View it here: <a href="${safePublicLink}">${safePublicLink}</a></p><p>${safeSignature}</p>`,
					}),
				});
				const payload = response.ok
					? ((await response.json().catch(() => null)) as {
							id?: string;
							data?: { id?: string };
						} | null)
					: null;
				const providerMessageId = payload?.id ?? payload?.data?.id;

				await ctx.runMutation(
					internal.reminders.markReminderEventStatusInternal,
					{
						eventId: event._id,
						status: response.ok ? "sent" : "failed",
						error: response.ok
							? undefined
							: `Resend returned ${response.status}`,
					},
				);

				if (response.ok) {
					await ctx.runMutation(internal.emailEvents.recordInternal, {
						workspaceId: invoice.workspaceId,
						ownerId: event.ownerId,
						invoiceId: invoice._id,
						providerMessageId,
						eventType: "sent",
						recipient,
						subject: buildReminderSubject(invoice.invoiceNumber),
					});
					await ctx.runMutation(internal.audit.logInternal, {
						workspaceId: invoice.workspaceId,
						actorId: event.ownerId,
						actorType: "system",
						action: "reminder.sent",
						resourceType: "invoice",
						resourceId: String(invoice._id),
						metadata: JSON.stringify({
							stage: event.stage,
							channel: "email",
							providerMessageId,
						}),
					});
					sent += 1;
				} else {
					skipped += 1;
				}
			}

			const result = {
				sent,
				skipped,
				reason:
					remainingCapacity <= 5
						? `Approaching the Resend free-tier limit of ${RESEND_FREE_TIER_DAILY_LIMIT} emails/day.`
						: undefined,
			};
			await recordJobRun(ctx, {
				workspaceId: args.workspaceId,
				jobName: "send queued reminder emails",
				status: "success",
				startedAt,
				result,
			});
			return result;
		} catch (error) {
			await recordJobRun(ctx, {
				workspaceId: args.workspaceId,
				jobName: "send queued reminder emails",
				status: "failure",
				startedAt,
				error: errorMessage(error),
			});
			throw error;
		}
	},
});

export const sendQueuedEmails = action({
	args: {},
	handler: async (ctx): Promise<ReminderSendResult> => {
		const scope: { workspaceId: Id<"workspaces"> } = await ctx.runQuery(
			internal.reminders.getReminderScopeForViewer,
			{},
		);
		return await ctx.runAction(internal.reminders.sendQueuedEmailsInternal, {
			workspaceId: scope.workspaceId,
		});
	},
});

export const sendSlackEscalationsInternal = internalAction({
	args: { workspaceId: v.optional(v.id("workspaces")) },
	handler: async (ctx, args): Promise<ReminderSendResult> => {
		const startedAt = Date.now();
		try {
			const workItems = (await ctx.runQuery(
				internal.reminders.listQueuedReminderSlackWorkItems,
				{
					workspaceId: args.workspaceId,
				},
			)) as Array<{ event: Doc<"reminder_events">; invoice: Doc<"invoices"> }>;

			let sent = 0;
			let skipped = 0;

			for (const { event, invoice } of workItems) {
				const webhookUrl =
					(await ctx.runQuery(internal.reminders.getSlackWebhookForOwner, {
						ownerId: event.ownerId,
					})) ?? env.SLACK_WEBHOOK_URL;

				if (!webhookUrl) {
					skipped += 1;
					continue;
				}

				const response = await fetch(webhookUrl, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						text: `Velure payment reminder review: ${invoice.invoiceNumber} for ${invoice.customerName} is ${invoice.status}. Due ${invoice.dueDate}. Public link: /i/${invoice.token}`,
					}),
				});

				await ctx.runMutation(
					internal.reminders.markReminderEventStatusInternal,
					{
						eventId: event._id,
						status: response.ok ? "sent" : "failed",
						error: response.ok
							? undefined
							: `Slack returned ${response.status}`,
					},
				);

				if (response.ok) {
					await ctx.runMutation(internal.audit.logInternal, {
						workspaceId: invoice.workspaceId,
						actorId: event.ownerId,
						actorType: "system",
						action: "reminder.sent",
						resourceType: "invoice",
						resourceId: String(invoice._id),
						metadata: JSON.stringify({
							stage: event.stage,
							channel: "slack",
						}),
					});
					sent += 1;
				} else {
					skipped += 1;
				}
			}

			const result = { sent, skipped };
			await recordJobRun(ctx, {
				workspaceId: args.workspaceId,
				jobName: "send Slack escalations",
				status: "success",
				startedAt,
				result,
			});
			return result;
		} catch (error) {
			await recordJobRun(ctx, {
				workspaceId: args.workspaceId,
				jobName: "send Slack escalations",
				status: "failure",
				startedAt,
				error: errorMessage(error),
			});
			throw error;
		}
	},
});

export const sendSlackEscalations = action({
	args: {},
	handler: async (ctx): Promise<ReminderSendResult> => {
		const scope: { workspaceId: Id<"workspaces"> } = await ctx.runQuery(
			internal.reminders.getReminderScopeForViewer,
			{},
		);
		return await ctx.runAction(
			internal.reminders.sendSlackEscalationsInternal,
			{
				workspaceId: scope.workspaceId,
			},
		);
	},
});
