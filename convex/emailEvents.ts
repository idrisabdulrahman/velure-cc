import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { env } from "./env";
import { requireWorkspaceForRead } from "./rls";

const emailEventTypeValidator = v.union(
	v.literal("sent"),
	v.literal("delivered"),
	v.literal("delivery_delayed"),
	v.literal("bounced"),
	v.literal("complained"),
	v.literal("opened"),
	v.literal("clicked"),
	v.literal("failed"),
);

type EmailEventType =
	| "sent"
	| "delivered"
	| "delivery_delayed"
	| "bounced"
	| "complained"
	| "opened"
	| "clicked"
	| "failed";

export async function recordEmailEvent(
	ctx: { db: any },
	args: {
		workspaceId?: Id<"workspaces">;
		ownerId?: string;
		invoiceId?: Id<"invoices">;
		deliveryEventId?: Id<"invoice_delivery_events">;
		providerMessageId?: string;
		providerEventId?: string;
		eventType: EmailEventType;
		recipient?: string;
		subject?: string;
		error?: string;
		rawEvent?: string;
	},
) {
	const now = Date.now();
	return await ctx.db.insert("email_events", {
		workspaceId: args.workspaceId,
		ownerId: args.ownerId,
		invoiceId: args.invoiceId,
		deliveryEventId: args.deliveryEventId,
		provider: "resend",
		providerMessageId: args.providerMessageId,
		providerEventId: args.providerEventId,
		eventType: args.eventType,
		recipient: args.recipient,
		subject: args.subject,
		error: args.error,
		rawEvent: args.rawEvent,
		createdAt: now,
		updatedAt: now,
	});
}

export const recordInternal = internalMutation({
	args: {
		workspaceId: v.optional(v.id("workspaces")),
		ownerId: v.optional(v.string()),
		invoiceId: v.optional(v.id("invoices")),
		deliveryEventId: v.optional(v.id("invoice_delivery_events")),
		providerMessageId: v.optional(v.string()),
		providerEventId: v.optional(v.string()),
		eventType: emailEventTypeValidator,
		recipient: v.optional(v.string()),
		subject: v.optional(v.string()),
		error: v.optional(v.string()),
		rawEvent: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		return await recordEmailEvent(ctx, args);
	},
});

export const recordResendWebhookEvent = mutation({
	args: {
		internalSecret: v.string(),
		providerMessageId: v.optional(v.string()),
		providerEventId: v.optional(v.string()),
		eventType: emailEventTypeValidator,
		recipient: v.optional(v.string()),
		subject: v.optional(v.string()),
		error: v.optional(v.string()),
		rawEvent: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		if (
			!env.RESEND_WEBHOOK_SECRET ||
			args.internalSecret !== env.RESEND_WEBHOOK_SECRET
		) {
			throw new Error("Unauthorized Resend webhook.");
		}

		const delivery = args.providerMessageId
			? await ctx.db
					.query("invoice_delivery_events")
					.withIndex("by_providerMessageId", (q) =>
						q.eq("providerMessageId", args.providerMessageId),
					)
					.first()
			: null;

		const eventId = await recordEmailEvent(ctx, {
			workspaceId: delivery?.workspaceId,
			ownerId: delivery?.ownerId,
			invoiceId: delivery?.invoiceId,
			deliveryEventId: delivery?._id,
			providerMessageId: args.providerMessageId,
			providerEventId: args.providerEventId,
			eventType: args.eventType,
			recipient: args.recipient ?? delivery?.recipient,
			subject: args.subject,
			error: args.error,
			rawEvent: args.rawEvent,
		});

		return { ok: true, eventId, invoiceId: delivery?.invoiceId ?? null };
	},
});

export const listForInvoice = query({
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
			.query("email_events")
			.withIndex("by_invoiceId", (q) => q.eq("invoiceId", args.invoiceId))
			.order("desc")
			.collect();
	},
});
