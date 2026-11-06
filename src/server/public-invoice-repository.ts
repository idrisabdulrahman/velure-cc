import type { InvoiceRecord } from "#/features/invoices/types";
import { consumeFixedWindowRateLimit } from "#/server/http-security";
import { emitActivation } from "#/server/observability";
import { getSupabaseAdminClient } from "#/server/supabase";
import { mapPublicInvoice, rowToInvoiceDoc } from "./data/invoices";
import { insertPaymentClaim } from "./data/payment-claims";
import {
	getPublicPaymentContextForInvoice,
	invoiceByToken,
	listPublicInvoicePaymentsForInvoice,
	payableInvoiceIssue,
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
	// The hardened RPC returns the camelCase invoice doc directly; legacy
	// deployments return the flat snake_case DB row. Detect and route each
	// shape through its mapper — feeding camel rows into rowToInvoiceDoc
	// yields an empty husk (every snake_case read is undefined).
	// Note: probe via a detached view so control-flow narrowing does not
	// collapse rpcRow (snake keys are required on InvoiceRow).
	const candidate = rpcRow as unknown as Record<string, unknown>;
	const isSnakeRow =
		typeof candidate.invoice_number === "string" ||
		Array.isArray(candidate.line_items);
	const doc = isSnakeRow
		? rowToInvoiceDoc({
				...rpcRow,
				token_revoked_at: null,
				customer_id: null,
				internal_notes: null,
				deleted_at: null,
				reminder: null,
				sync: null,
			})
		: {
				...candidate,
				tokenRevokedAt: undefined,
				customerId: undefined,
				internalNotes: undefined,
				deletedAt: undefined,
				reminder: undefined,
				sync: undefined,
			};
	const invoice = mapPublicInvoice(doc) as Invoice;
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
		const { data, error } = await client
			.from("invoices")
			.update({
				lifecycle: { ...lifecycle, firstViewedAt: now },
				updated_at: new Date(now).toISOString(),
			})
			.eq("id", result.invoice.id)
			// Read the workspace back in the same statement so the activation
			// log can name the tenant without an extra subrequest.
			.select("workspace_id")
			.maybeSingle();
		if (error) throw error;
		// WP-H: the first open of a public link is the "share opened" activation
		// signal. Emitted once (the `alreadyTracked` guard), with ids only — no
		// customer name, email or amount (`AGENTS.md` §8).
		emitActivation("invoice.share_opened", {
			invoiceId: result.invoice.id,
			workspaceId: (data as { workspace_id?: string } | null)?.workspace_id,
		});
	}
	return { ok: true, alreadyTracked };
}

export type PublicPaymentClaimResult =
	| { ok: true; duplicate: boolean }
	| {
			ok: false;
			reason: "not_found" | "rate_limited" | "amount_invalid" | "not_payable";
	  };

/**
 * Public "I've paid" submission (WP-A). Token-scoped and rate-limited. It
 * derives the workspace and invoice from the bearer token only — never from the
 * request body — and inserts an unverified claim; it never marks the invoice
 * Paid (only `recordPayment`, on seller confirmation, can do that).
 */
export async function submitPublicPaymentClaim(
	token: string,
	input: { amount: number; reference?: string; note?: string },
	options: { clientIp?: string | null } = {},
): Promise<PublicPaymentClaimResult> {
	const client = getSupabaseAdminClient();

	const tokenAllowed = await consumeFixedWindowRateLimit(
		client,
		"claim-token",
		token,
		5,
		600,
	);
	const ip = options.clientIp?.trim();
	const ipAllowed =
		tokenAllowed && ip
			? await consumeFixedWindowRateLimit(client, "claim-ip", ip, 20, 600)
			: true;
	if (!tokenAllowed || !ipAllowed) return { ok: false, reason: "rate_limited" };

	const row = await invoiceByToken(client, token);
	if (!row) return { ok: false, reason: "not_found" };
	const workspaceId =
		typeof row.workspace_id === "string" ? row.workspace_id : null;
	const invoiceId = typeof row.id === "string" ? row.id : null;
	if (!workspaceId || !invoiceId) return { ok: false, reason: "not_found" };

	const invoice = mapPublicInvoice(
		rowToInvoiceDoc({
			...row,
			token_revoked_at: null,
			customer_id: null,
			internal_notes: null,
			deleted_at: null,
			reminder: null,
			sync: null,
		} as unknown as Parameters<typeof rowToInvoiceDoc>[0]),
	) as Invoice;

	const notPayable = payableInvoiceIssue(invoice);
	if (notPayable) return { ok: false, reason: "not_payable" };
	if (
		!Number.isFinite(input.amount) ||
		input.amount <= 0 ||
		input.amount > invoice.balance
	)
		return { ok: false, reason: "amount_invalid" };

	const inserted = await insertPaymentClaim(client, {
		workspaceId,
		invoiceId,
		amount: input.amount,
		reference: input.reference,
		note: input.note,
	});
	emitActivation("payment.claim_submitted", {
		invoiceId,
		workspaceId,
		amount: input.amount,
		currency: invoice.currency,
		duplicate: inserted.duplicate,
	});
	return { ok: true, duplicate: inserted.duplicate };
}
