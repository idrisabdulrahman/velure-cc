import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "#/types/database.types";

let adminClient: SupabaseClient<Database> | null = null;

export function getSupabaseAdminClient() {
	if (adminClient) return adminClient;

	const url = process.env.VITE_SUPABASE_URL;
	const secretKey =
		process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
	if (!url) throw new Error("VITE_SUPABASE_URL is missing.");
	if (!secretKey) {
		throw new Error(
			"SUPABASE_SERVICE_ROLE_KEY (or legacy SUPABASE_SECRET_KEY) is missing.",
		);
	}

	adminClient = createClient<Database>(url, secretKey, {
		auth: {
			autoRefreshToken: false,
			detectSessionInUrl: false,
			persistSession: false,
		},
	});
	return adminClient;
}
