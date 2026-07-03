import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { recordAuditLog } from "./audit";
import { requireAuthUser } from "./auth";
import {
	ensureWorkspaceForUser,
	setActiveWorkspaceForUser,
} from "./workspaces";

const page = {
	cursor: null,
	numItems: 1_000,
};

async function deleteAuthModelByUserId(
	ctx: any,
	model: string,
	userId: string,
) {
	await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
		input: {
			model,
			where: [{ field: "userId", operator: "eq", value: userId }],
		},
		paginationOpts: page,
	});
}

async function deleteOwnerRows(ctx: any, table: string, ownerId: string) {
	const rows = await ctx.db
		.query(table)
		.withIndex("by_ownerId", (q: any) => q.eq("ownerId", ownerId))
		.collect();

	for (const row of rows) {
		await ctx.db.delete(row._id);
	}
}

async function deleteUserRows(ctx: any, table: string, userId: string) {
	const rows = await ctx.db
		.query(table)
		.withIndex("by_userId", (q: any) => q.eq("userId", userId))
		.collect();

	for (const row of rows) {
		await ctx.db.delete(row._id);
	}
}

async function deleteWorkspaceRows(
	ctx: any,
	table: string,
	workspaceId: string,
) {
	const rows = await ctx.db
		.query(table)
		.withIndex("by_workspaceId", (q: any) => q.eq("workspaceId", workspaceId))
		.collect();

	for (const row of rows) {
		await ctx.db.delete(row._id);
	}
}

export const listWorkspaces = query({
	args: {},
	handler: async (ctx) => {
		const viewer = await requireAuthUser(ctx);
		const memberships = await ctx.db
			.query("workspaceMembers")
			.withIndex("by_userId", (q) => q.eq("userId", viewer._id))
			.collect();
		const active = await ctx.db
			.query("active_workspaces")
			.withIndex("by_userId", (q) => q.eq("userId", viewer._id))
			.first();

		const rows = [];
		for (const membership of memberships) {
			const workspace = await ctx.db.get(membership.workspaceId);
			if (!workspace) continue;
			rows.push({
				id: workspace._id,
				name: workspace.name,
				legalName: workspace.legalName,
				email: workspace.email,
				role: membership.role,
				isActive: active?.workspaceId === workspace._id,
				updatedAt: workspace.updatedAt,
			});
		}

		return rows.sort((a, b) => Number(b.isActive) - Number(a.isActive));
	},
});

export const getWorkspaceContext = query({
	args: {},
	handler: async (ctx) => {
		const viewer = await requireAuthUser(ctx);
		const active = await ctx.db
			.query("active_workspaces")
			.withIndex("by_userId", (q) => q.eq("userId", viewer._id))
			.first();

		if (!active) return null;

		const membership = await ctx.db
			.query("workspaceMembers")
			.withIndex("by_workspaceId_and_userId", (q) =>
				q.eq("workspaceId", active.workspaceId).eq("userId", viewer._id),
			)
			.first();
		const workspace = await ctx.db.get(active.workspaceId);

		if (!membership || !workspace) return null;

		return {
			userId: viewer._id,
			workspaceId: workspace._id,
			role: membership.role,
			name: workspace.name,
			legalName: workspace.legalName,
			email: workspace.email,
			invoiceNumberMode: workspace.invoiceNumberMode ?? "prefix",
			invoiceNumberPrefix: workspace.invoiceNumberPrefix ?? "INV",
			nextInvoiceSequence: workspace.nextInvoiceSequence ?? 1,
		};
	},
});

export const ensureWorkspaceContext = mutation({
	args: { businessName: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const viewer = await requireAuthUser(ctx);
		const scope = await ensureWorkspaceForUser(ctx, viewer._id, {
			businessName: args.businessName,
		});
		const workspace = await ctx.db.get(scope.workspaceId);

		if (!workspace) {
			throw new Error("Workspace not found.");
		}

		return {
			userId: scope.userId,
			workspaceId: scope.workspaceId,
			role: scope.role,
			name: workspace.name,
			legalName: workspace.legalName,
			email: workspace.email,
			invoiceNumberMode: workspace.invoiceNumberMode ?? "prefix",
			invoiceNumberPrefix: workspace.invoiceNumberPrefix ?? "INV",
			nextInvoiceSequence: workspace.nextInvoiceSequence ?? 1,
		};
	},
});

export const setActiveWorkspace = mutation({
	args: { workspaceId: v.id("workspaces") },
	handler: async (ctx, args) => {
		const viewer = await requireAuthUser(ctx);
		const membership = await ctx.db
			.query("workspaceMembers")
			.withIndex("by_workspaceId_and_userId", (q) =>
				q.eq("workspaceId", args.workspaceId).eq("userId", viewer._id),
			)
			.first();

		if (!membership) {
			throw new Error("Workspace not found.");
		}

		await setActiveWorkspaceForUser(ctx, viewer._id, args.workspaceId);
		await recordAuditLog(ctx, {
			workspaceId: args.workspaceId,
			actorId: viewer._id,
			action: "workspace.selected",
			resourceType: "workspace",
			resourceId: String(args.workspaceId),
		});

		return { ok: true };
	},
});

export const deleteCurrentAccount = mutation({
	args: {},
	handler: async (ctx) => {
		const viewer = await requireAuthUser(ctx);
		const userId = viewer._id;

		const ownedWorkspaces = await ctx.db
			.query("workspaces")
			.withIndex("by_ownerId", (q) => q.eq("ownerId", userId))
			.collect();

		for (const workspace of ownedWorkspaces) {
			await deleteWorkspaceRows(ctx, "clients", workspace._id);
			await deleteWorkspaceRows(ctx, "products", workspace._id);
			await deleteWorkspaceRows(ctx, "invoices", workspace._id);
			await deleteWorkspaceRows(ctx, "audit_logs", workspace._id);
			await deleteWorkspaceRows(ctx, "email_events", workspace._id);
			await deleteWorkspaceRows(ctx, "invoice_delivery_events", workspace._id);
			await deleteWorkspaceRows(ctx, "payment_transactions", workspace._id);
			await deleteWorkspaceRows(ctx, "payment_charges", workspace._id);
			await deleteWorkspaceRows(ctx, "job_runs", workspace._id);
			await deleteWorkspaceRows(ctx, "workspaceMembers", workspace._id);
			await ctx.db.delete(workspace._id);
		}

		const externalMemberships = await ctx.db
			.query("workspaceMembers")
			.withIndex("by_userId", (q) => q.eq("userId", userId))
			.collect();

		for (const membership of externalMemberships) {
			await ctx.db.delete(membership._id);
		}

		await deleteOwnerRows(ctx, "tax_profiles", userId);
		await deleteOwnerRows(ctx, "invoice_exports", userId);
		await deleteOwnerRows(ctx, "reminder_rules", userId);
		await deleteOwnerRows(ctx, "reminder_runs", userId);
		await deleteOwnerRows(ctx, "reminder_events", userId);
		await deleteOwnerRows(ctx, "collections_cases", userId);
		await deleteOwnerRows(ctx, "integration_connections", userId);
		await deleteOwnerRows(ctx, "integration_sync_jobs", userId);
		await deleteOwnerRows(ctx, "integration_logs", userId);
		await deleteOwnerRows(ctx, "integration_webhooks", userId);
		await deleteUserRows(ctx, "active_workspaces", userId);

		await deleteAuthModelByUserId(ctx, "session", userId);
		await deleteAuthModelByUserId(ctx, "account", userId);
		await deleteAuthModelByUserId(ctx, "twoFactor", userId);
		await deleteAuthModelByUserId(ctx, "passkey", userId);
		await deleteAuthModelByUserId(ctx, "oauthApplication", userId);
		await deleteAuthModelByUserId(ctx, "oauthAccessToken", userId);
		await deleteAuthModelByUserId(ctx, "oauthConsent", userId);

		await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
			input: {
				model: "user",
				where: [{ field: "_id", operator: "eq", value: userId }],
			},
		});

		return { deleted: true };
	},
});
