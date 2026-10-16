import { useQueryClient, useQuery as useTanQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
	ensureWorkspaceForUser,
	getWorkspaceContext,
	listWorkspaces,
	setActiveWorkspace,
} from "#/server/data/workspaces";
import { authClient } from "./auth-client";
import { useSupabaseSession } from "./supabase-session";

/**
 * Unified auth hook that consolidates multiple auth signals into one
 * This resolves race conditions between:
 * - Better Auth useSession()
 * - Better Auth client.getSession()
 * - Supabase session bridge readiness
 */
export function useUnifiedAuth() {
	// Better Auth session from hook
	const { data: betterAuthSession, isPending: betterAuthPending } =
		authClient.useSession();

	// Consolidate session data - Better Auth hook is the source of truth
	const session = useMemo(() => {
		// Use Better Auth session if available
		if (betterAuthSession?.user) {
			return {
				user: betterAuthSession.user,
				session: betterAuthSession.session,
			};
		}
		return null;
	}, [betterAuthSession]);

	// Determine loading state
	const isPending = betterAuthPending;

	// Determine authentication state
	const isAuthenticated = useMemo(() => {
		return Boolean(session?.user);
	}, [session]);

	return {
		data: session,
		isPending,
		isAuthenticated,
		isConvexAuthenticated: isAuthenticated,
	};
}

/**
 * Hook for Dashboard gate logic with workspace data.
 *
 * A10: when the Supabase session bridge is available (minted JWT), workspaces
 * and the workspace context are read through the RLS-enforced module —
 * PostgREST carries the user's JWT and RLS decides. A bridge failure leaves
 * the dashboard unavailable; it must never fall back to a second data plane.
 */
export function useDashboardAuth() {
	const authState = useUnifiedAuth();
	const userId = authState.data?.user?.id;

	// Minted Supabase session (null when the bridge is unavailable).
	const {
		client: supabaseClient,
		velureUserId,
		isPending: sessionPending,
	} = useSupabaseSession(authState.isAuthenticated ? userId : null);

	const canReadSupabase = Boolean(
		supabaseClient && velureUserId && authState.isAuthenticated,
	); // RLS-enforced reads through the typed module. `enabled` guarantees both
	// are non-null when the query runs; narrow to satisfy the type checker.
	const readWorkspaces = () =>
		supabaseClient && velureUserId
			? listWorkspaces(supabaseClient, velureUserId)
			: Promise.resolve([]);
	const readContext = () =>
		supabaseClient && velureUserId
			? getWorkspaceContext(supabaseClient, velureUserId)
			: Promise.resolve(null);
	const supabaseWorkspaces = useTanQuery({
		queryKey: ["supabase-workspaces", velureUserId ?? "none"],
		queryFn: readWorkspaces,
		enabled: canReadSupabase,
	});
	const supabaseContext = useTanQuery({
		queryKey: ["supabase-workspace-context", velureUserId ?? "none"],
		queryFn: readContext,
		enabled: canReadSupabase,
	});

	const workspaces = supabaseWorkspaces.data ?? [];
	const workspaceContext = supabaseContext.data ?? null;

	return {
		...authState,
		workspaces,
		workspaceContext,
		workspaceQueriesPending:
			canReadSupabase &&
			(supabaseWorkspaces.isPending || supabaseContext.isPending),
		isPending:
			authState.isPending || (authState.isAuthenticated && sessionPending),
		canUseSupabase: canReadSupabase,
	};
}

/**
 * Workspace mutations. When the Supabase session bridge is live, writes go
 * through the RLS-enforced module (RLS with-check rejects a forged target).
 */
export function useWorkspaceActions() {
	const authState = useUnifiedAuth();
	const userId = authState.data?.user?.id;
	const {
		client: supabaseClient,
		velureUserId,
		error: sessionError,
	} = useSupabaseSession(authState.isAuthenticated ? userId : null);
	const queryClient = useQueryClient();

	const invalidateWorkspaces = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: ["supabase-workspaces"] });
		queryClient.invalidateQueries({
			queryKey: ["supabase-workspace-context"],
		});
	}, [queryClient]);

	const setActive = useCallback(
		async ({ workspaceId }: { workspaceId: string }) => {
			if (!supabaseClient || !velureUserId)
				throw new Error(
					sessionError instanceof Error
						? sessionError.message
						: "Supabase session unavailable.",
				);
			await setActiveWorkspace(supabaseClient, velureUserId, workspaceId);
			invalidateWorkspaces();
			return { ok: true as const };
		},
		[invalidateWorkspaces, sessionError, supabaseClient, velureUserId],
	);

	const ensure = useCallback(
		async ({ businessName }: { businessName?: string }) => {
			if (!supabaseClient || !velureUserId)
				throw new Error(
					sessionError instanceof Error
						? sessionError.message
						: "Supabase session unavailable.",
				);
			const ctx = await ensureWorkspaceForUser(supabaseClient, velureUserId, {
				businessName,
			});
			invalidateWorkspaces();
			return ctx;
		},
		[invalidateWorkspaces, sessionError, supabaseClient, velureUserId],
	);

	return { setActive, ensure };
}
