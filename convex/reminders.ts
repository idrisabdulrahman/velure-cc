import { action, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { requireAuthUser } from "./auth";
import { env } from "./env";
import { RESEND_FREE_TIER_DAILY_LIMIT } from "./nigeria";
import { requireWritableInvoice, requireWorkspaceForRead } from "./rls";

const reminderStageValidator = v.union(
  v.literal("none"),
  v.literal("before_due"),
  v.literal("due_date"),
  v.literal("overdue_1"),
  v.literal("overdue_2"),
  v.literal("overdue_3"),
  v.literal("escalated"),
);

function defaultRule(ownerId: string) {
  const now = Date.now();
  return {
    ownerId,
    enabled: true,
    daysBeforeDue: 3,
    onDueDate: true,
    overdueCadenceDays: 3,
    maxOverdueReminders: 3,
    escalateAfterCount: 2,
    businessSignature: "Velure Finance Team",
    createdAt: now,
    updatedAt: now,
  };
}

async function requireViewer(ctx: any) {
  return await requireAuthUser(ctx);
}

function startOfDay(value: string) {
  return new Date(`${value}T00:00:00.000Z`).getTime();
}

function buildReminderSubject(invoiceNumber: string) {
  const base = `Reminder: ${invoiceNumber}`;
  return base.length <= 60 ? base : base.slice(0, 57).trimEnd() + "...";
}

function determineStage(dueDate: string, now: number, rule: ReturnType<typeof defaultRule>) {
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

export const pauseInvoiceReminders = mutation({
  args: {
    invoiceId: v.id("invoices"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { scope, invoice } = await requireWritableInvoice(ctx, args.invoiceId);

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
    const { scope, invoice } = await requireWritableInvoice(ctx, args.invoiceId);

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
    channel: v.union(v.literal("email"), v.literal("slack"), v.literal("internal")),
    meta: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { scope, invoice } = await requireWritableInvoice(ctx, args.invoiceId);

    const existing = await ctx.db
      .query("reminder_events")
      .withIndex("by_invoiceId", (q) => q.eq("invoiceId", args.invoiceId))
      .collect();

    if (existing.some((event) => event.stage === args.stage && event.status !== "failed")) {
      return { skipped: true };
    }

    const now = Date.now();
    const eventId = await ctx.db.insert("reminder_events", {
      ownerId: scope.userId,
      invoiceId: args.invoiceId,
      stage: args.stage,
      channel: args.channel,
      scheduledFor: now,
      status: "queued",
      meta: args.meta,
      createdAt: now,
      updatedAt: now,
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
        lastReminderAt: now,
      },
      updatedAt: now,
    });

    return { eventId };
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

export const runReminderBatch = action({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const today = args.date ?? new Date().toISOString().slice(0, 10);
    const invoices = await ctx.runQuery(api.invoices.list, {
      status: "all",
      q: "",
    });
    const rule = await ctx.runQuery(api.reminders.getReminderSettings, {});

    let queuedCount = 0;
    for (const invoice of invoices) {
      if (!rule.enabled || invoice.reminder?.paused) continue;
      if (invoice.status === "paid" || invoice.status === "canceled") continue;

      const stage = determineStage(invoice.dueDate, startOfDay(today), {
        ownerId: "viewer",
        enabled: rule.enabled,
        daysBeforeDue: rule.daysBeforeDue,
        onDueDate: rule.onDueDate,
        overdueCadenceDays: rule.overdueCadenceDays,
        maxOverdueReminders: rule.maxOverdueReminders,
        escalateAfterCount: rule.escalateAfterCount,
        businessSignature: rule.businessSignature ?? "Velure Finance Team",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      if (stage === "none") continue;

      const result = await ctx.runMutation(api.reminders.queueReminderEvent, {
        invoiceId: invoice.id,
        stage,
        channel: "email",
      });

      if (!("skipped" in result)) {
        queuedCount += 1;
      }

      if (stage === "overdue_2" || stage === "overdue_3") {
        await ctx.runMutation(api.reminders.queueReminderEvent, {
          invoiceId: invoice.id,
          stage,
          channel: "slack",
          meta: "Queued overdue escalation for Slack",
        });
      }
    }

    return { date: today, queuedCount };
  },
});

export const sendQueuedEmails = action({
  args: {},
  handler: async (ctx): Promise<{ sent: number; skipped?: number; reason?: string }> => {
    const invoices: any[] = await ctx.runQuery(api.invoices.list, {
      status: "all",
      q: "",
    });
    const eventsByInvoice = new Map<string, any[]>();
    const allEventsByInvoice = new Map<string, any[]>();

    for (const invoice of invoices) {
      const events: any[] = await ctx.runQuery(api.reminders.getInvoiceTimeline, {
        invoiceId: invoice.id,
      });
      allEventsByInvoice.set(invoice.id, events);
      eventsByInvoice.set(
        invoice.id,
        events.filter((event: any) => event.status === "queued"),
      );
    }

    if (!env.RESEND_API_KEY) {
      return { sent: 0, skipped: invoices.length, reason: "RESEND_API_KEY missing" };
    }

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    let sentToday = 0;
    for (const invoice of invoices) {
      const events = allEventsByInvoice.get(invoice.id) ?? [];
      sentToday += events.filter(
        (event) => event.sentAt && event.sentAt >= todayStart.getTime(),
      ).length;
    }
    const remainingCapacity = Math.max(0, RESEND_FREE_TIER_DAILY_LIMIT - sentToday);

    let sent = 0;
    let skipped = 0;
    for (const invoice of invoices) {
      const queued = eventsByInvoice.get(invoice.id) ?? [];
      const recipient = invoice.compliance?.buyer?.email;
      if (!recipient) {
        for (const event of queued) {
          await ctx.runMutation(api.reminders.markReminderEventStatus, {
            eventId: event._id,
            status: "failed",
            error: "Buyer email is missing on this invoice.",
          });
        }
        skipped += queued.length;
        continue;
      }

      for (const event of queued) {
        if (sent >= remainingCapacity) {
          await ctx.runMutation(api.reminders.markReminderEventStatus, {
            eventId: event._id,
            status: "failed",
            error: "Resend free-tier daily limit reached.",
          });
          skipped += 1;
          continue;
        }

        const publicLink = `${env.SITE_URL ?? ""}/i/${invoice.token}`;
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
            text: `Invoice ${invoice.invoiceNumber} for ${invoice.customerName} is currently ${invoice.status}. View it here: ${publicLink}`,
            html: `<p>Invoice <strong>${invoice.invoiceNumber}</strong> for ${invoice.customerName} is currently ${invoice.status}.</p><p>View it here: <a href="${publicLink}">${publicLink}</a></p>`,
          }),
        });
        await ctx.runMutation(api.reminders.markReminderEventStatus, {
          eventId: event._id,
          status: response.ok ? "sent" : "failed",
          error: response.ok ? undefined : `Resend returned ${response.status}`,
        });
        sent += 1;
      }
    }

    return {
      sent,
      skipped,
      reason:
        remainingCapacity <= 5
          ? `Approaching the Resend free-tier limit of ${RESEND_FREE_TIER_DAILY_LIMIT} emails/day.`
          : undefined,
    };
  },
});

export const sendSlackEscalations = action({
  args: {},
  handler: async (ctx): Promise<{ sent: number; skipped: number }> => {
    const invoices: any[] = await ctx.runQuery(api.invoices.list, {
      status: "all",
      q: "",
    });
    const connection: any = await ctx.runQuery(api.integrations.getConnectionSecret, {
      provider: "slack",
    });
    const webhookUrl = connection?.webhookUrl ?? env.SLACK_WEBHOOK_URL;

    if (!webhookUrl) {
      return { sent: 0, skipped: invoices.length };
    }

    let sent = 0;
    let skipped = 0;

    for (const invoice of invoices) {
      const events: any[] = await ctx.runQuery(api.reminders.getInvoiceTimeline, {
        invoiceId: invoice.id,
      });
      const queued = events.filter(
        (event) => event.channel === "slack" && event.status === "queued",
      );

      if (queued.length === 0) {
        skipped += 1;
        continue;
      }

      for (const event of queued) {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: `Velure collections escalation: ${invoice.invoiceNumber} for ${invoice.customerName} is ${invoice.status}. Due ${invoice.dueDate}. Public link: /i/${invoice.token}`,
          }),
        });

        await ctx.runMutation(api.reminders.markReminderEventStatus, {
          eventId: event._id,
          status: response.ok ? "sent" : "failed",
          error: response.ok ? undefined : `Slack returned ${response.status}`,
        });
        if (response.ok) {
          sent += 1;
        }
      }
    }

    return { sent, skipped };
  },
});
