import type { AuthPool } from "#/server/auth-database";
import type { Supabase, WorkspaceRole } from "#/server/data/workspaces";

/**
 * WP-E — workspace membership: the accountant read-only seat.
 *
 * Two paths live here, each with a different trust boundary:
 *
 * 1. Listing members. `workspace_members` is readable by any member through
 *    RLS (`workspace_members_select`, migration A9), but the invitee's *email*
 *    lives in `better_auth."user"`, which PostgREST cannot reach — the schema
 *    is revoked from anon/authenticated/service_role (migration A8.12). So the
 *    directory is read over the server's own Postgres connection. The caller
 *    passes a `workspace_id` it resolved from the verified session
 *    (`getWorkspaceContext`), never from the request body (`AGENTS.md` §8).
 *
 * 2. Adding a member. RLS only lets a user insert their OWN membership
 *    (`workspace_members_self_insert`); adding a different user is
 *    deliberately server-side only, exactly as the A9 migration comment
 *    states. The insert therefore goes through the service-role client, which
 *    bypasses RLS, so the `workspace_id` filter below is the tenancy boundary
 *    and is always the session-resolved workspace.
 *
 * No new table and no new dependency: `workspace_members.invited_by` already
 * exists.
 */

export type WorkspaceMember = {
	userId: string;
	email: string | null;
	role: WorkspaceRole;
	invitedBy: string | null;
	createdAt: string;
};

export type AddWorkspaceMemberResult = "added" | "already_member";

/** `better_auth."user"` is only reachable through the direct pool. */
type DirectoryQueryable = Pick<AuthPool, "query">;

/**
 * Resolve a Better Auth user id from an email. Case-insensitive and
 * whitespace-trimmed because Better Auth stores the address as entered;
 * `null` means no account exists yet.
 */
export async function findUserIdByEmail(
	queryable: DirectoryQueryable,
	email: string,
): Promise<string | null> {
	const normalized = email.trim().toLowerCase();
	if (!normalized) return null;
	const { rows } = await queryable.query(
		'select "id" from better_auth."user" where lower("email") = $1 limit 1',
		[normalized],
	);
	const id = (rows?.[0] as { id?: unknown } | undefined)?.id;
	return typeof id === "string" && id ? id : null;
}

/**
 * List one workspace's members with role and email, oldest first. The email
 * comes from the `better_auth` identity row; a member whose identity row is
 * gone (or not yet linked) shows as `null` rather than failing the read.
 */
export async function listWorkspaceMembers(
	queryable: DirectoryQueryable,
	workspaceId: string,
): Promise<WorkspaceMember[]> {
	const { rows } = await queryable.query(
		`select m.user_id, m.role, m.invited_by, m.created_at, u."email" as email
		 from public.workspace_members as m
		 left join better_auth."user" as u on u."id" = m.user_id
		 where m.workspace_id = $1
		 order by m.created_at asc`,
		[workspaceId],
	);
	const list = (rows ?? []) as Array<Record<string, unknown>>;
	return list.map((row) => ({
		userId: String(row.user_id),
		email: typeof row.email === "string" ? row.email : null,
		role: row.role as WorkspaceRole,
		invitedBy: typeof row.invited_by === "string" ? row.invited_by : null,
		createdAt:
			row.created_at instanceof Date
				? row.created_at.toISOString()
				: String(row.created_at ?? ""),
	}));
}

/**
 * Insert a `viewer` membership with the service-role client. A duplicate
 * `(workspace_id, user_id)` (unique constraint, SQLSTATE 23505) is the normal
 * "already a member" case, not an error. `workspaceId` and `invitedBy` are the
 * caller's session-resolved values; `userId` is the resolved invitee.
 */
export async function addWorkspaceMember(
	admin: Supabase,
	input: {
		workspaceId: string;
		userId: string;
		role: "viewer";
		invitedBy: string;
	},
): Promise<AddWorkspaceMemberResult> {
	const { error } = await admin.from("workspace_members").insert({
		workspace_id: input.workspaceId,
		user_id: input.userId,
		role: input.role,
		invited_by: input.invitedBy,
	});
	if (error) {
		if (error.code === "23505") return "already_member";
		throw error;
	}
	return "added";
}
