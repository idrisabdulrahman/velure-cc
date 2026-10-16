import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Database } from "#/types/database.types";

/**
 * A10 — browser-side Supabase session.
 *
 * The bridge route (`POST /api/auth/supabase-session`) verifies the Better
 * Auth session server-side and mints a Supabase JWT whose velure_user_id ==
 * the app user id. This hook mints once per user (cached for the token's
 * lifetime) and builds a USER-scoped Supabase client so every PostgREST call
 * goes through RLS.
 */

type MintedSession = {
	accessToken: string;
	expiresAt: number;
	velureUserId: string;
};

async function mintSession(): Promise<MintedSession> {
	const res = await fetch("/api/auth/supabase-session", {
		method: "POST",
		headers: { "content-type": "application/json" },
	});
	if (!res.ok) {
		let detail = `bridge returned ${res.status}`;
		try {
			const body = (await res.json()) as { error?: string };
			if (body.error) detail = body.error;
		} catch {
			/* non-JSON error body */
		}
		throw new Error(detail);
	}
	const body = (await res.json()) as {
		ok: boolean;
		accessToken: string;
		expiresAt: number;
		velureUserId: string;
	};
	if (!body.ok || !body.accessToken) {
		throw new Error("Bridge did not return a session.");
	}
	return body;
}

function buildUserScopedClient(accessToken: string): SupabaseClient<Database> {
	const url = import.meta.env.VITE_SUPABASE_URL;
	const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
	if (!url || !anonKey) {
		throw new Error(
			"Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY",
		);
	}
	return createClient<Database>(url, anonKey, {
		global: {
			headers: { Authorization: `Bearer ${accessToken}` },
		},
		auth: {
			autoRefreshToken: false,
			detectSessionInUrl: false,
			persistSession: false,
		},
	});
}

/**
 * Mint (and cache) the Supabase session for the given user. Disabled when no
 * user id is provided; the JWT is cached for its remaining lifetime, so the
 * bridge is hit at most once per sign-in.
 */
export function useSupabaseSession(userId: string | null | undefined) {
	const { data, error, isPending, isError } = useQuery({
		queryKey: ["supabase-session", userId ?? "none"],
		queryFn: mintSession,
		enabled: Boolean(userId),
		staleTime: 55 * 60 * 1000,
		retry: 1,
	});

	const client = useMemo(() => {
		if (!data?.accessToken) return null;
		try {
			return buildUserScopedClient(data.accessToken);
		} catch {
			return null;
		}
	}, [data?.accessToken]);
	const clientConfigError =
		data?.accessToken &&
		(!import.meta.env.VITE_SUPABASE_URL ||
			!import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
			? new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY")
			: null;

	return {
		client,
		velureUserId: data?.velureUserId ?? null,
		isPending,
		isError,
		error: error ?? clientConfigError,
	};
}
