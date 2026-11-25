import { useQuery } from "@tanstack/react-query";
import { authClient } from "#/lib/auth-client";
import { useSupabaseSession } from "#/lib/supabase-session";
import {
	getWorkspaceContext,
	type WorkspaceRole,
} from "#/server/data/workspaces";

/**
 * WP-E — one place that answers "may this session change workspace data?".
 *
 * This is a UX affordance only: RLS is the enforcement boundary (an INSERT or
 * UPDATE from a viewer is refused by Postgres regardless of what the UI
 * renders). The helper exists so create/edit/delete/send/record/import
 * controls are hidden consistently, instead of each surface inventing its own
 * `role === "owner" || role === "member"` check.
 */
export function canMutateWorkspace(
	role: WorkspaceRole | null | undefined,
): boolean {
	return role === "owner" || role === "member";
}

export function isWorkspaceViewer(
	role: WorkspaceRole | null | undefined,
): boolean {
	return role === "viewer";
}

/**
 * The caller's role in the active workspace, read through the RLS-scoped
 * Supabase client. It reuses the exact React Query key
 * `useDashboardAuth` (the dashboard layout) populates, so the role costs no
 * extra request and stays in sync after a refetch. `null` means "not resolved
 * yet" — every gate treats that as "not a viewer", never as "allowed".
 */
export function useWorkspaceRole(): WorkspaceRole | null {
	const { data: session } = authClient.useSession();
	const userId = session?.user.id;
	const { client, velureUserId } = useSupabaseSession(userId);
	const { data } = useQuery({
		queryKey: ["supabase-workspace-context", velureUserId ?? "none"],
		queryFn: () => {
			if (!client || !velureUserId)
				throw new Error("Supabase session unavailable.");
			return getWorkspaceContext(client, velureUserId);
		},
		enabled: Boolean(client && velureUserId),
	});
	return data?.role ?? null;
}
