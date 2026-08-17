import type { Id } from "./_generated/dataModel";
import { requireAuthUser } from "./auth";
import {
	getWorkspaceForUserReadOnly,
	setActiveWorkspaceForUser,
	type WorkspaceRole,
	type WorkspaceScope,
} from "./workspaces";

export { setActiveWorkspaceForUser };
export type { WorkspaceRole, WorkspaceScope };

type AnyCtx = {
	db: any;
};

const WRITE_ROLES = new Set<WorkspaceRole>(["owner", "member"]);

export async function requireWorkspace(ctx: AnyCtx): Promise<WorkspaceScope> {
	const viewer = await requireAuthUser(ctx as any);
	const scope = await getWorkspaceForUserReadOnly(ctx, viewer._id);
	if (!scope) {
		throw new Error("Workspace not found.");
	}
	return { userId: viewer._id, ...scope };
}

export async function requireWorkspaceForRead(
	ctx: AnyCtx,
): Promise<WorkspaceScope | null> {
	const viewer = await requireAuthUser(ctx as any);
	const scope = await getWorkspaceForUserReadOnly(ctx, viewer._id);
	return scope ? { userId: viewer._id, ...scope } : null;
}

export async function requireWritableWorkspace(
	ctx: AnyCtx,
): Promise<WorkspaceScope> {
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

export async function assertWritableWorkspaceMember(
	ctx: AnyCtx,
	workspaceId: Id<"workspaces">,
) {
	const scope = await requireWorkspaceMember(ctx, workspaceId);
	if (!WRITE_ROLES.has(scope.role)) {
		throw new Error("Workspace write access required.");
	}
	return scope;
}

export async function requireOwnedInvoice(
	ctx: AnyCtx,
	invoiceId: Id<"invoices">,
) {
	const scope = await requireWorkspace(ctx);
	const invoice = await ctx.db.get(invoiceId);

	if (!invoice || invoice.workspaceId !== scope.workspaceId) {
		throw new Error("Invoice not found.");
	}

	return { scope, invoice };
}

export async function requireWritableInvoice(
	ctx: AnyCtx,
	invoiceId: Id<"invoices">,
) {
	const { scope, invoice } = await requireOwnedInvoice(ctx, invoiceId);
	if (!WRITE_ROLES.has(scope.role)) {
		throw new Error("Workspace write access required.");
	}
	return { scope, invoice };
}

export async function requireWritableClient(
	ctx: AnyCtx,
	clientId: Id<"clients">,
) {
	const scope = await requireWritableWorkspace(ctx);
	const client = await ctx.db.get(clientId);

	if (!client || client.workspaceId !== scope.workspaceId) {
		throw new Error("Client not found.");
	}

	return { scope, client };
}

export function withWorkspaceQuery<TArgs, TResult>(
	handler: (
		ctx: AnyCtx,
		args: TArgs,
		scope: WorkspaceScope,
	) => Promise<TResult>,
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
	handler: (
		ctx: AnyCtx,
		args: TArgs,
		scope: WorkspaceScope,
	) => Promise<TResult>,
) {
	return async (ctx: AnyCtx, args: TArgs) => {
		const scope = await requireWritableWorkspace(ctx);
		return await handler(ctx, args, scope);
	};
}
