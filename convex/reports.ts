import { v } from "convex/values";
import { query } from "./_generated/server";
import { buildRevenueCashFlowReport } from "./revenueReporting";
import { requireWorkspaceForRead } from "./rls";

export const getRevenueCashFlow = query({
	args: {
		from: v.optional(v.string()),
		to: v.optional(v.string()),
		currency: v.optional(v.string()),
		limit: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const scope = await requireWorkspaceForRead(ctx);
		if (!scope) return null;

		const workspace = await ctx.db.get(scope.workspaceId);
		const invoices = await ctx.db
			.query("invoices")
			.withIndex("by_workspaceId", (q) =>
				q.eq("workspaceId", scope.workspaceId),
			)
			.collect();
		const payments = await ctx.db
			.query("payment_transactions")
			.withIndex("by_workspaceId", (q) =>
				q.eq("workspaceId", scope.workspaceId),
			)
			.collect();
		const products = await ctx.db
			.query("products")
			.withIndex("by_workspaceId", (q) =>
				q.eq("workspaceId", scope.workspaceId),
			)
			.collect();

		const report = buildRevenueCashFlowReport({
			invoices,
			payments: payments.map((payment) => ({
				...payment,
				invoiceId: String(payment.invoiceId),
			})),
			products,
			baseCurrency: args.currency ?? workspace?.baseCurrency ?? "NGN",
			window: {
				from: args.from,
				to: args.to,
			},
			limit: Math.min(Math.max(args.limit ?? 8, 1), 20),
		});

		return report;
	},
});
