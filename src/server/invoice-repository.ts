import { createClient } from "@supabase/supabase-js";
import type { InvoiceRecord } from "#/features/invoices/types";
import { recordInvoiceAudit } from "#/server/data/audit";
import { getById, recordDeliveryEvent } from "#/server/data/invoices";
import { mintSupabaseAccessToken } from "#/server/supabase-session";
import type { Database } from "#/types/database.types";

export type Invoice = InvoiceRecord;

async function createUserContext(request: Request) {
	const minted = await mintSupabaseAccessToken(request);
	if (!minted) return null;
	const url = process.env.VITE_SUPABASE_URL;
	const key =
		process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
		process.env.SUPABASE_PUBLISHABLE_KEY;
	if (!url || !key)
		throw new Error("Supabase publishable configuration is missing.");
	return {
		userId: minted.velureUserId,
		client: createClient<Database>(url, key, {
			global: { headers: { Authorization: `Bearer ${minted.accessToken}` } },
			auth: {
				autoRefreshToken: false,
				detectSessionInUrl: false,
				persistSession: false,
			},
		}),
	};
}

export type InvoiceUserContext = NonNullable<
	Awaited<ReturnType<typeof createUserContext>>
>;

export function getInvoiceUserContext(request: Request) {
	return createUserContext(request);
}

export async function getAuthenticatedInvoiceById(
	id: string,
	context: InvoiceUserContext,
) {
	return (await getById(context.client, context.userId, id)) as Invoice | null;
}

export async function recordInvoiceDeliveryEvent(
	context: InvoiceUserContext,
	input: {
		invoiceId: string;
		recipient: string;
		status: "sent" | "failed";
		providerMessageId?: string;
		error?: string;
		publicUrl?: string;
	},
) {
	// Server-side path: inject the ONE audit service so the row is written
	// in-process (the default browser transport is a relative fetch, which
	// does not exist here). Actor and workspace come from the verified
	// session context above.
	return recordDeliveryEvent(
		context.client,
		context.userId,
		{
			...input,
			channel: "email",
			provider: "resend",
		},
		{ write: recordInvoiceAudit },
	);
}
