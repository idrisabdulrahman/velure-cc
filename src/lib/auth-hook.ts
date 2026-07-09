import { useQuery } from "convex/react";
import { useMemo } from "react";
import { authClient } from "./auth-client";
import { auth } from "./auth";
import { api } from "../../convex/_generated/api";

/**
 * Unified auth hook that consolidates multiple auth signals into one
 * This resolves race conditions between:
 * - Better Auth useSession()
 * - Better Auth client.getSession()
 * - Convex useConvexAuth()
 */
export function useUnifiedAuth() {
  // Better Auth session from hook
  const { data: betterAuthSession, isPending: betterAuthPending } = authClient.useSession();
  
  // Convex auth state
  const { isLoading: convexIsLoading, isAuthenticated: convexIsAuthenticated } = auth.useConvexAuth();

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
 * Hook for Dashboard gate logic with workspace data
 */
export function useDashboardAuth() {
  const authState = useUnifiedAuth();
  
  // Only fetch workspace data when authenticated
  const workspaces = useQuery(
    api.account.listWorkspaces,
    authState.isAuthenticated ? {} : "skip",
  );
  
  const workspaceContext = useQuery(
    api.account.getWorkspaceContext,
    authState.isAuthenticated ? {} : "skip",
  );

  return {
    ...authState,
    workspaces: workspaces ?? [],
    workspaceContext,
  };
}
