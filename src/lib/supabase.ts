import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "#/env";
import type { Database } from "#/types/database.types";

let browserClient: SupabaseClient<Database> | null = null;

export function getBrowserSupabaseClient() {
	if (browserClient) return browserClient;

	const url = env.VITE_SUPABASE_URL;
	const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY;
	if (!url || !publishableKey) {
		throw new Error("Missing public Supabase configuration.");
	}

	browserClient = createClient<Database>(url, publishableKey, {
		auth: {
			autoRefreshToken: false,
			detectSessionInUrl: false,
			persistSession: false,
		},
	});
	return browserClient;
}
