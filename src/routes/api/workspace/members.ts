import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
	addWorkspaceMember,
	findUserIdByEmail,
	listWorkspaceMembers,
} from "#/server/data/workspace-members";
import { getWorkspaceContext } from "#/server/data/workspaces";
import { getInvoiceUserContext } from "#/server/invoice-repository";
import { getMemberDirectoryPool } from "#/server/member-directory";
import {
	logServerEvent,
	withRequestObservability,
} from "#/server/observability";
import { getSupabaseAdminClient } from "#/server/supabase";

/**
 * WP-E — GET/POST /api/workspace/members, the accountant read-only seat.
 *
 * Identity is always the verified Better Auth session (`getInvoiceUserContext`
 * mints the RLS-scoped client); the active workspace and the caller's role are
 * resolved from that session through `getWorkspaceContext`. Nothing in the
 * request body is trusted for tenancy.
 *
 *   GET  — any member (viewer included) lists the members with role and email.
 *   POST — the owner invites a person as a read-only `viewer` by email.
 *
 * The write goes through the service-role client because RLS only lets a user
 * insert their OWN membership; the session-resolved `workspace_id` is the
 * tenancy boundary (`AGENTS.md` §8). A missing invitee account is a friendly
 * 422 rather than a 201 that silently does nothing, and a duplicate
 * membership is a 409 conflict rather than a 500.
 */

const UNKNOWN_INVITEE_MESSAGE =
	"We couldn't find an Invoicly account for that email. Ask them to create an account first, then invite them again.";

const inviteSchema = z.object({ email: z.email() });

export const handleGet = withRequestObservability(
	async (_requestId: string, { request }: { request: Request }) => {
		const context = await getInvoiceUserContext(request);
		if (!context) {
			return Response.json(
				{ ok: false, error: "Authentication required." },
				{ status: 401 },
			);
		}

		const workspace = await getWorkspaceContext(context.client, context.userId);
		if (!workspace) {
			return Response.json(
				{ ok: false, error: "No active workspace." },
				{ status: 403 },
			);
		}

		const members = await listWorkspaceMembers(
			getMemberDirectoryPool(),
			workspace.workspaceId,
		);
		return Response.json({ ok: true, role: workspace.role, members });
	},
);

export const handlePost = withRequestObservability(
	async (requestId: string, { request }: { request: Request }) => {
		const context = await getInvoiceUserContext(request);
		if (!context) {
			return Response.json(
				{ ok: false, error: "Authentication required." },
				{ status: 401 },
			);
		}

		const workspace = await getWorkspaceContext(context.client, context.userId);
		if (!workspace) {
			return Response.json(
				{ ok: false, error: "No active workspace." },
				{ status: 403 },
			);
		}
		// Only the owner may invite. A member or viewer is refused before the
		// invitee is resolved, so no directory lookup leaks for them.
		if (workspace.role !== "owner") {
			return Response.json(
				{ ok: false, error: "Only the workspace owner can invite members." },
				{ status: 403 },
			);
		}

		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return Response.json(
				{ ok: false, error: "Invalid request body." },
				{ status: 400 },
			);
		}

		const parsed = inviteSchema.safeParse(body);
		if (!parsed.success) {
			return Response.json(
				{ ok: false, error: "Enter a valid email address." },
				{ status: 400 },
			);
		}

		const email = parsed.data.email.trim().toLowerCase();
		const inviteeId = await findUserIdByEmail(getMemberDirectoryPool(), email);
		if (!inviteeId) {
			logServerEvent("info", "workspace_member.invite", {
				requestId,
				actor: context.userId,
				workspaceId: workspace.workspaceId,
				resource: "workspace_members",
				action: "invite",
				result: "invitee_not_found",
			});
			return Response.json(
				{
					ok: false,
					code: "invitee_not_found",
					error: UNKNOWN_INVITEE_MESSAGE,
				},
				{ status: 422 },
			);
		}

		const result = await addWorkspaceMember(getSupabaseAdminClient(), {
			workspaceId: workspace.workspaceId,
			userId: inviteeId,
			role: "viewer",
			invitedBy: context.userId,
		});
		if (result === "already_member") {
			logServerEvent("info", "workspace_member.invite", {
				requestId,
				actor: context.userId,
				workspaceId: workspace.workspaceId,
				resource: "workspace_members",
				action: "invite",
				result: "already_member",
			});
			return Response.json(
				{
					ok: false,
					code: "already_member",
					error: "That person is already a member of this workspace.",
				},
				{ status: 409 },
			);
		}

		// Actor, workspace, action and result only — never the invitee's email.
		logServerEvent("info", "workspace_member.invite", {
			requestId,
			actor: context.userId,
			workspaceId: workspace.workspaceId,
			resource: "workspace_members",
			action: "invite",
			result: "added",
			memberUserId: inviteeId,
		});
		return Response.json(
			{ ok: true, member: { userId: inviteeId, role: "viewer" as const } },
			{ status: 201 },
		);
	},
);

export const handlers = { GET: handleGet, POST: handlePost };

export const Route = createFileRoute("/api/workspace/members")({
	server: { handlers },
});
