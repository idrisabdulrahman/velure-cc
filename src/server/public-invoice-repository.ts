import type { InvoiceRecord } from "#/features/invoices/types";
import { getSupabaseAdminClient } from "#/server/supabase";
import { mapPublicInvoice, rowToInvoiceDoc } from "./data/invoices";
import {
	getPublicPaymentContextForInvoice,
	listPublicInvoicePaymentsForInvoice,
} from "./data/payments";

export type Invoice = InvoiceRecord;

async function getInvoiceByTokenWithClient(
	client: ReturnType<typeof getSupabaseAdminClient>,
	token: string,
) {
	const { data, error } = await client.rpc("public_invoice_by_token", {
		input_token: token,
	});
	if (error) throw error;
	if (!data || typeof data !== "object" || Array.isArray(data)) return null;
	const raw = data as Record<string, unknown>;
	// Shape drift: hardened deployments wrap the row in
	// `{ countryCode, invoice }`, while older ones return the flat row.
	// Accept both so public links survive a pending migration.
	const nested = raw.invoice;
	const rpcRow =
		nested && typeof nested === "object" && !Array.isArray(nested)
			? (nested as Parameters<typeof rowToInvoiceDoc>[0])
			: (raw as Parameters<typeof rowToInvoiceDoc>[0]);
	if (!rpcRow || typeof rpcRow !== "object" || !("token" in rpcRow))
		return null;
	const invoice = mapPublicInvoice(
		rowToInvoiceDoc({
			...rpcRow,
			token_revoked_at: null,
			customer_id: null,
			internal_notes: null,
			deleted_at: null,
			reminder: null,
			sync: null,
		}),
	) as Invoice;
	return {
		invoice,
		countryCode: typeof raw.countryCode === "string" ? raw.countryCode : null,
	};
}

export async function getPublicInvoicePage(token: string) {
	const client = getSupabaseAdminClient();
	const result = await getInvoiceByTokenWithClient(client, token);
	if (!result) return null;
	const { invoice, countryCode } = result;

	const [paymentContext, paymentHistory] = await Promise.all([
		getPublicPaymentContextForInvoice(client, invoice, countryCode),
		listPublicInvoicePaymentsForInvoice(client, invoice.id),
	]);
	return { invoice, paymentContext, paymentHistory };
}

export async function getInvoiceByToken(token: string) {
	return (
		(await getInvoiceByTokenWithClient(getSupabaseAdminClient(), token))
			?.invoice ?? null
	);
}

export async function recordPublicInvoiceView(token: string) {
	const client = getSupabaseAdminClient();
	const result = await getInvoiceByTokenWithClient(client, token);
	if (!result) return { ok: false, alreadyTracked: false };
	const lifecycle = result.invoice.lifecycle ?? {};
	const alreadyTracked = Boolean(lifecycle.firstViewedAt);
	if (!alreadyTracked) {
		const now = Date.now();
		const { error } = await client
			.from("invoices")
			.update({
				lifecycle: { ...lifecycle, firstViewedAt: now },
				updated_at: new Date(now).toISOString(),
			})
			.eq("id", result.invoice.id);
		if (error) throw error;
	}
	return { ok: true, alreadyTracked };
}
