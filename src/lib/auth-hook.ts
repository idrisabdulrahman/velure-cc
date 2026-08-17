import { useQueryClient, useQuery as useTanQuery } from "@tanstack/react-query";
import {
	useConvexAuth,
	useQuery as useConvexQuery,
	useMutation,
} from "convex/react";
import { useCallback, useMemo } from "react";
import {
	ensureWorkspaceForUser,
	getWorkspaceContext,
	listWorkspaces,
	setActiveWorkspace,
} from "#/server/data/workspaces";
import { api } from "../../convex/_generated/api";
import { authClient } from "./auth-client";
import { useSupabaseSession } from "./supabase-session";

/**
 * Unified auth hook that consolidates multiple auth signals into one
 * This resolves race conditions between:
 * - Better Auth useSession()
 * - Better Auth client.getSession()
 * - Convex useConvexAuth()
 */
export function useUnifiedAuth() {
	// Better Auth session from hook
	const { data: betterAuthSession, isPending: betterAuthPending } =
		authClient.useSession();

	// Convex auth state
	const { isLoading: convexIsLoading, isAuthenticated: convexIsAuthenticated } =
		useConvexAuth();

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
	const isPending = useMemo(() => {
		return betterAuthPending || convexIsLoading;
	}, [betterAuthPending, convexIsLoading]);

	// Determine authentication state
	const isAuthenticated = useMemo(() => {
		return Boolean(session?.user);
	}, [session]);

	return {
		data: session,
		isPending,
		isAuthenticated,
		isConvexAuthenticated: convexIsAuthenticated,
	};
}

/**
 * Hook for Dashboard gate logic with workspace data.
 *
 * A10: when the Supabase session bridge is available (minted JWT), workspaces
 * and the workspace context are read through the RLS-enforced module —
 * PostgREST carries the user's JWT and RLS decides. The Convex fallback is
 * kept so the app runs in environments where the bridge is not configured;
 * once a domain is fully cut over, the fallback is deleted.
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
		canReadSupabase && supabaseClient && velureUserId
			? listWorkspaces(supabaseClient, velureUserId)
			: Promise.resolve([]);
	const readContext = () =>
		canReadSupabase && supabaseClient && velureUserId
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

	// Convex fallback (bridge not configured / mint failed).
	const convexWorkspaces = useConvexQuery(
		api.account.listWorkspaces,
		authState.isAuthenticated && !canReadSupabase ? {} : "skip",
	);
	const convexContext = useConvexQuery(
		api.account.getWorkspaceContext,
		authState.isAuthenticated && !canReadSupabase ? {} : "skip",
	);

	const workspaces = canReadSupabase
		? (supabaseWorkspaces.data ?? [])
		: (convexWorkspaces ?? []);

	const workspaceContext = canReadSupabase
		? (supabaseContext.data ?? null)
		: (convexContext ?? null);

	return {
		...authState,
		workspaces,
		workspaceContext,
		isPending: authState.isPending || sessionPending,
		canUseSupabase: canReadSupabase,
	};
}

/**
 * Workspace mutations. When the Supabase session bridge is live, writes go
 * through the RLS-enforced module (RLS with-check rejects a forged target);
 * otherwise they fall back to the Convex mutation so the app keeps working
 * in environments without the bridge.
 */
export function useWorkspaceActions() {
	const authState = useUnifiedAuth();
	const userId = authState.data?.user?.id;
	const { client: supabaseClient, velureUserId } = useSupabaseSession(
		authState.isAuthenticated ? userId : null,
	);
	const queryClient = useQueryClient();
	const convexSetActive = useMutation(api.account.setActiveWorkspace);
	const convexEnsure = useMutation(api.account.ensureWorkspaceContext);

	const invalidateWorkspaces = useCallback(() => {
		queryClient.invalidateQueries({ queryKey: ["supabase-workspaces"] });
		queryClient.invalidateQueries({
			queryKey: ["supabase-workspace-context"],
		});
	}, [queryClient]);

	const setActive = useCallback(
		async ({ workspaceId }: { workspaceId: string }) => {
			if (supabaseClient && velureUserId) {
				await setActiveWorkspace(supabaseClient, velureUserId, workspaceId);
				invalidateWorkspaces();
				return { ok: true as const };
			}
			return convexSetActive({ workspaceId: workspaceId as never });
		},
		[convexSetActive, invalidateWorkspaces, supabaseClient, velureUserId],
	);

	const ensure = useCallback(
		async ({ businessName }: { businessName?: string }) => {
			if (supabaseClient && velureUserId) {
				const ctx = await ensureWorkspaceForUser(supabaseClient, velureUserId, {
					businessName,
				});
				invalidateWorkspaces();
				return ctx;
			}
			return convexEnsure({ businessName });
		},
		[convexEnsure, invalidateWorkspaces, supabaseClient, velureUserId],
	);

	return { setActive, ensure };
}
