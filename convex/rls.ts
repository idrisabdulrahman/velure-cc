import type { Id } from "./_generated/dataModel";
import { requireAuthUser } from "./auth";

export type WorkspaceRole = "owner" | "member" | "viewer";

export type WorkspaceScope = {
  userId: string;
  workspaceId: Id<"workspaces">;
  role: WorkspaceRole;
};

type AnyCtx = {
  db: any;
};

const WRITE_ROLES = new Set<WorkspaceRole>(["owner", "member"]);

async function findMembership(ctx: AnyCtx, userId: string) {
  return await ctx.db
    .query("workspaceMembers")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .first();
}

async function findOwnedWorkspace(ctx: AnyCtx, userId: string) {
  return await ctx.db
    .query("workspaces")
    .withIndex("by_ownerId", (q: any) => q.eq("ownerId", userId))
    .first();
}

async function createDefaultWorkspace(ctx: AnyCtx, userId: string) {
  const now = Date.now();
  const workspaceId = await ctx.db.insert("workspaces", {
    ownerId: userId,
    name: "Velure Workspace",
    legalName: "Velure Workspace",
    email: "",
    phone: "",
    address: "",
    website: "",
    taxId: "",
    rcNumber: "",
    countryCode: "NG",
    baseCurrency: "NGN",
    sellerTaxStatus: "vat_registered",
    taxRuleSetVersion: "ng-nrs-2026.1",
    atrs: {
      environment: "sandbox",
      credentialsConfigured: false,
    },
    reminderSignature: "Velure Finance Team",
    remindersEnabled: true,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.db.insert("workspaceMembers", {
    workspaceId,
    userId,
    role: "owner",
    createdAt: now,
    updatedAt: now,
  });

  return { workspaceId, role: "owner" as const };
}

async function ensureOwnerMembership(ctx: AnyCtx, workspace: any, userId: string) {
  const existing = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspaceId_and_userId", (q: any) =>
      q.eq("workspaceId", workspace._id).eq("userId", userId),
    )
    .first();

  if (existing) {
    return { workspaceId: existing.workspaceId, role: existing.role as WorkspaceRole };
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

export async function requireWorkspace(ctx: AnyCtx): Promise<WorkspaceScope> {
  const viewer = await requireAuthUser(ctx as any);
  const membership = await findMembership(ctx, viewer._id);

  if (membership) {
    return {
      userId: viewer._id,
      workspaceId: membership.workspaceId,
      role: membership.role,
    };
  }

  const ownedWorkspace = await findOwnedWorkspace(ctx, viewer._id);
  if (ownedWorkspace) {
    const ownerMembership = await ensureOwnerMembership(ctx, ownedWorkspace, viewer._id);
    return { userId: viewer._id, ...ownerMembership };
  }

  const created = await createDefaultWorkspace(ctx, viewer._id);
  return { userId: viewer._id, ...created };
}

export async function requireWorkspaceForRead(ctx: AnyCtx): Promise<WorkspaceScope | null> {
  try {
    const viewer = await requireAuthUser(ctx as any);
    const membership = await findMembership(ctx, viewer._id);

    if (membership) {
      return {
        userId: viewer._id,
        workspaceId: membership.workspaceId,
        role: membership.role,
      };
    }

    const ownedWorkspace = await findOwnedWorkspace(ctx, viewer._id);
    if (!ownedWorkspace) return null;

    return {
      userId: viewer._id,
      workspaceId: ownedWorkspace._id,
      role: "owner",
    };
  } catch {
    return null;
  }
}

export async function requireWritableWorkspace(ctx: AnyCtx): Promise<WorkspaceScope> {
  const scope = await requireWorkspace(ctx);
  if (!WRITE_ROLES.has(scope.role)) {
    throw new Error("Workspace write access required.");
  }
  return scope;
}

export async function requireWorkspaceMember(
  ctx: AnyCtx,
  workspaceId: Id<"workspaces">,
): Promise<WorkspaceScope> {
  const viewer = await requireAuthUser(ctx as any);
  const membership = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspaceId_and_userId", (q: any) =>
      q.eq("workspaceId", workspaceId).eq("userId", viewer._id),
    )
    .first();

  if (!membership) {
    throw new Error("Workspace not found.");
  }

  return {
    userId: viewer._id,
    workspaceId,
    role: membership.role,
  };
}

export async function assertWritableWorkspaceMember(ctx: AnyCtx, workspaceId: Id<"workspaces">) {
  const scope = await requireWorkspaceMember(ctx, workspaceId);
  if (!WRITE_ROLES.has(scope.role)) {
    throw new Error("Workspace write access required.");
  }
  return scope;
}

export async function requireOwnedInvoice(ctx: AnyCtx, invoiceId: Id<"invoices">) {
  const scope = await requireWorkspace(ctx);
  const invoice = await ctx.db.get(invoiceId);

  if (!invoice || invoice.workspaceId !== scope.workspaceId) {
    throw new Error("Invoice not found.");
  }

  return { scope, invoice };
}

export async function requireWritableInvoice(ctx: AnyCtx, invoiceId: Id<"invoices">) {
  const { scope, invoice } = await requireOwnedInvoice(ctx, invoiceId);
  if (!WRITE_ROLES.has(scope.role)) {
    throw new Error("Workspace write access required.");
  }
  return { scope, invoice };
}

export async function requireWritableClient(ctx: AnyCtx, clientId: Id<"clients">) {
  const scope = await requireWritableWorkspace(ctx);
  const client = await ctx.db.get(clientId);

  if (!client || client.workspaceId !== scope.workspaceId) {
    throw new Error("Client not found.");
  }

  return { scope, client };
}

export function withWorkspaceQuery<TArgs, TResult>(
  handler: (ctx: AnyCtx, args: TArgs, scope: WorkspaceScope) => Promise<TResult>,
) {
  return async (ctx: AnyCtx, args: TArgs) => {
    const scope = await requireWorkspaceForRead(ctx);
    if (!scope) {
      throw new Error("Workspace not found.");
    }
    return await handler(ctx, args, scope);
  };
}

export function withWorkspaceMutation<TArgs, TResult>(
  handler: (ctx: AnyCtx, args: TArgs, scope: WorkspaceScope) => Promise<TResult>,
) {
  return async (ctx: AnyCtx, args: TArgs) => {
    const scope = await requireWritableWorkspace(ctx);
    return await handler(ctx, args, scope);
  };
}
