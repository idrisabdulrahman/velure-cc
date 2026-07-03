import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { requireWorkspaceForRead } from "./rls";

const jobStatusValidator = v.union(v.literal("success"), v.literal("failure"));

export const recordInternal = internalMutation({
	args: {
		workspaceId: v.optional(v.id("workspaces")),
		jobName: v.string(),
		status: jobStatusValidator,
		durationMs: v.number(),
		retries: v.number(),
		error: v.optional(v.string()),
		resultJson: v.optional(v.string()),
		startedAt: v.number(),
		completedAt: v.number(),
	},
	handler: async (ctx, args) => {
		return await ctx.db.insert("job_runs", {
			workspaceId: args.workspaceId,
			jobName: args.jobName,
			status: args.status,
			durationMs: args.durationMs,
			retries: args.retries,
			error: args.error,
			resultJson: args.resultJson,
			startedAt: args.startedAt,
			completedAt: args.completedAt,
			createdAt: args.completedAt,
		});
	},
});

export const listRecent = query({
	args: { limit: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const scope = await requireWorkspaceForRead(ctx);
		const limit = Math.min(args.limit ?? 50, 100);

		if (!scope) {
			return await ctx.db.query("job_runs").order("desc").take(limit);
		}

		const scoped = await ctx.db
			.query("job_runs")
			.withIndex("by_workspaceId", (q) =>
				q.eq("workspaceId", scope.workspaceId),
			)
			.order("desc")
			.take(limit);

		const global = await ctx.db
			.query("job_runs")
			.withIndex("by_workspaceId", (q) => q.eq("workspaceId", undefined))
			.order("desc")
			.take(limit);

		return [...scoped, ...global]
			.sort((a, b) => b.createdAt - a.createdAt)
			.slice(0, limit);
	},
});
