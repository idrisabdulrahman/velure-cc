import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, query } from "./_generated/server";
import {
	type AuditAction,
	type AuditResult,
	auditActionValidator,
	auditResultValidator,
} from "./auditActions";
import { requireWorkspaceForRead } from "./rls";

export async function recordAuditLog(
	ctx: Pick<MutationCtx, "db">,
	args: {
		workspaceId?: Id<"workspaces">;
		actorId?: string;
		actorType?: "user" | "system";
		action: AuditAction;
		resourceType: string;
		resourceId?: string;
		result?: AuditResult;
		message?: string;
		metadata?: unknown;
	},
) {
	return await ctx.db.insert("audit_logs", {
		workspaceId: args.workspaceId,
		actorId: args.actorId,
		actorType: args.actorType ?? "user",
		action: args.action,
		resourceType: args.resourceType,
		resourceId: args.resourceId,
		result: args.result ?? "success",
		message: args.message,
		metadata:
			args.metadata === undefined ? undefined : JSON.stringify(args.metadata),
		createdAt: Date.now(),
	});
}

export const logInternal = internalMutation({
	args: {
		workspaceId: v.optional(v.id("workspaces")),
		actorId: v.optional(v.string()),
		actorType: v.optional(v.union(v.literal("user"), v.literal("system"))),
		action: auditActionValidator,
		resourceType: v.string(),
		resourceId: v.optional(v.string()),
		result: v.optional(auditResultValidator),
		message: v.optional(v.string()),
		metadata: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		return await recordAuditLog(ctx, {
			...args,
			metadata: args.metadata,
		});
	},
});

export const listRecent = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) return [];

		const rows = await ctx.db
			.query("audit_logs")
			.withIndex("by_workspaceId", (q) =>
				q.eq("workspaceId", scope.workspaceId),
			)
			.order("desc")
			.take(Math.min(args.limit ?? 50, 100));

		return rows;
	},
});
