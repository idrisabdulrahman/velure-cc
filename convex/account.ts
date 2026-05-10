import { mutation } from "./_generated/server";
import { components } from "./_generated/api";
import { requireAuthUser } from "./auth";

const page = {
  cursor: null,
  numItems: 1_000,
};

async function deleteAuthModelByUserId(ctx: any, model: string, userId: string) {
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

async function deleteWorkspaceRows(ctx: any, table: string, workspaceId: string) {
  const rows = await ctx.db
    .query(table)
    .withIndex("by_workspaceId", (q: any) => q.eq("workspaceId", workspaceId))
    .collect();

  for (const row of rows) {
    await ctx.db.delete(row._id);
  }
}

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
