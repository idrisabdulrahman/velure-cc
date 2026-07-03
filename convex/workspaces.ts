import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

export type WorkspaceRole = "owner" | "member" | "viewer";

export type WorkspaceScope = {
	userId: string;
	workspaceId: Id<"workspaces">;
	role: WorkspaceRole;
};

type AnyCtx = {
	db: any;
};

type EnsureWorkspaceOptions = {
	businessName?: string;
	createIfMissing?: boolean;
};

const DEFAULT_WORKSPACE_NAME = "Velure Workspace";

export function normalizeWorkspaceName(value?: string) {
	const normalized = value?.trim().replace(/\s+/g, " ");
	if (!normalized) return DEFAULT_WORKSPACE_NAME;
	return normalized.slice(0, 120);
}

function workspaceDefaults(userId: string, name: string) {
	const now = Date.now();
	return {
		ownerId: userId,
		name,
		legalName: name,
		email: "",
		phone: "",
		address: "",
		website: "",
		taxId: "",
		rcNumber: "",
		countryCode: "NG" as const,
		baseCurrency: "NGN",
		sellerTaxStatus: "vat_registered" as const,
		taxRuleSetVersion: "ng-nrs-2026.1",
		atrs: {
			environment: "sandbox" as const,
			credentialsConfigured: false,
		},
		reminderSignature: "Velure Finance Team",
		remindersEnabled: true,
		logoUrl: "",
		paymentDetails: "",
		defaultPaymentLink: "",
		defaultPaymentTermsDays: 14,
		invoiceNumberMode: "prefix" as const,
		invoiceNumberPrefix: "INV",
		nextInvoiceSequence: 1,
		createdAt: now,
		updatedAt: now,
	};
}

async function findOwnedWorkspace(ctx: AnyCtx, userId: string) {
	return await ctx.db
		.query("workspaces")
		.withIndex("by_ownerId", (q: any) => q.eq("ownerId", userId))
		.first();
}

async function getMembershipForWorkspace(
	ctx: AnyCtx,
	userId: string,
	workspaceId: Id<"workspaces">,
) {
	return await ctx.db
		.query("workspaceMembers")
		.withIndex("by_workspaceId_and_userId", (q: any) =>
			q.eq("workspaceId", workspaceId).eq("userId", userId),
		)
		.first();
}

async function getActiveWorkspaceId(ctx: AnyCtx, userId: string) {
	const active = await ctx.db
		.query("active_workspaces")
		.withIndex("by_userId", (q: any) => q.eq("userId", userId))
		.first();

	return active?.workspaceId as Id<"workspaces"> | undefined;
}

export async function setActiveWorkspaceForUser(
	ctx: AnyCtx,
	userId: string,
	workspaceId: Id<"workspaces">,
) {
	const now = Date.now();
	const existing = await ctx.db
		.query("active_workspaces")
		.withIndex("by_userId", (q: any) => q.eq("userId", userId))
		.first();

	if (existing) {
		await ctx.db.patch(existing._id, { workspaceId, updatedAt: now });
		return existing._id;
	}

	return await ctx.db.insert("active_workspaces", {
		userId,
		workspaceId,
		createdAt: now,
		updatedAt: now,
	});
}

async function findSingleMembership(ctx: AnyCtx, userId: string) {
	const memberships = await ctx.db
		.query("workspaceMembers")
		.withIndex("by_userId", (q: any) => q.eq("userId", userId))
		.collect();

	return memberships.length === 1 ? memberships[0] : null;
}

async function ensureOwnerMembership(
	ctx: AnyCtx,
	workspace: any,
	userId: string,
) {
	const existing = await getMembershipForWorkspace(ctx, userId, workspace._id);

	if (existing) {
		return {
			workspaceId: existing.workspaceId,
			role: existing.role as WorkspaceRole,
		};
	}

	const now = Date.now();
	await ctx.db.insert("workspaceMembers", {
		workspaceId: workspace._id,
		userId,
		role: "owner",
		createdAt: now,
		updatedAt: now,
	});

	return { workspaceId: workspace._id, role: "owner" as const };
}

async function createDefaultWorkspace(
	ctx: AnyCtx,
	userId: string,
	businessName?: string,
) {
	const name = normalizeWorkspaceName(businessName);
	const defaults = workspaceDefaults(userId, name);
	const workspaceId = await ctx.db.insert("workspaces", defaults);

	await ctx.db.insert("workspaceMembers", {
		workspaceId,
		userId,
		role: "owner",
		createdAt: defaults.createdAt,
		updatedAt: defaults.updatedAt,
	});

	await setActiveWorkspaceForUser(ctx, userId, workspaceId);

	return { workspaceId, role: "owner" as const };
}

export async function resolveWorkspaceForUser(
	ctx: AnyCtx,
	userId: string,
	options: EnsureWorkspaceOptions = {},
): Promise<Omit<WorkspaceScope, "userId"> | null> {
	const activeWorkspaceId = await getActiveWorkspaceId(ctx, userId);
	if (activeWorkspaceId) {
		const [workspace, membership] = await Promise.all([
			ctx.db.get(activeWorkspaceId),
			getMembershipForWorkspace(ctx, userId, activeWorkspaceId),
		]);

		if (workspace && membership) {
			return {
				workspaceId: membership.workspaceId,
				role: membership.role as WorkspaceRole,
			};
		}
	}

	const singleMembership = await findSingleMembership(ctx, userId);
	if (singleMembership) {
		const workspace = await ctx.db.get(singleMembership.workspaceId);
		if (workspace) {
			await setActiveWorkspaceForUser(
				ctx,
				userId,
				singleMembership.workspaceId,
			);
			return {
				workspaceId: singleMembership.workspaceId,
				role: singleMembership.role as WorkspaceRole,
			};
		}
	}

	const ownedWorkspace = await findOwnedWorkspace(ctx, userId);
	if (ownedWorkspace) {
		const ownerMembership = await ensureOwnerMembership(
			ctx,
			ownedWorkspace,
			userId,
		);
		await setActiveWorkspaceForUser(ctx, userId, ownerMembership.workspaceId);
		return ownerMembership;
	}

	if (options.createIfMissing === false) return null;

	return await createDefaultWorkspace(ctx, userId, options.businessName);
}

export async function getWorkspaceForUserReadOnly(
	ctx: AnyCtx,
	userId: string,
): Promise<Omit<WorkspaceScope, "userId"> | null> {
	const activeWorkspaceId = await getActiveWorkspaceId(ctx, userId);
	if (activeWorkspaceId) {
		const [workspace, membership] = await Promise.all([
			ctx.db.get(activeWorkspaceId),
			getMembershipForWorkspace(ctx, userId, activeWorkspaceId),
		]);

		if (workspace && membership) {
			return {
				workspaceId: membership.workspaceId,
				role: membership.role as WorkspaceRole,
			};
		}
	}

	const singleMembership = await findSingleMembership(ctx, userId);
	if (singleMembership) {
		const workspace = await ctx.db.get(singleMembership.workspaceId);
		if (workspace) {
			return {
				workspaceId: singleMembership.workspaceId,
				role: singleMembership.role as WorkspaceRole,
			};
		}
	}

	const ownedWorkspace = await findOwnedWorkspace(ctx, userId);
	if (ownedWorkspace) {
		const membership = await getMembershipForWorkspace(
			ctx,
			userId,
			ownedWorkspace._id,
		);
		return {
			workspaceId: ownedWorkspace._id,
			role: (membership?.role as WorkspaceRole | undefined) ?? "owner",
		};
	}

	return null;
}

export async function ensureWorkspaceForUser(
	ctx: AnyCtx,
	userId: string,
	options: EnsureWorkspaceOptions = {},
): Promise<WorkspaceScope> {
	const resolved = await resolveWorkspaceForUser(ctx, userId, {
		...options,
		createIfMissing: true,
	});

	if (!resolved) {
		throw new Error("Workspace not found.");
	}

	return { userId, ...resolved };
}

export const ensureWorkspaceForAuth = internalMutation({
	args: {
		userId: v.string(),
		businessName: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		return await ensureWorkspaceForUser(ctx, args.userId, {
			businessName: args.businessName,
		});
	},
});
