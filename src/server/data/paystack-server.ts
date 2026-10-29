/**
 * G1 boundary split — SERVER-ONLY Paystack machinery.
 *
 * `ensurePaystackTransferCharge` and `confirmPaystackWebhookPayment` are the
 * only payments paths that hold the service-role client, so they live in
 * this server-only module instead of `./payments` (which the browser
 * imports for `recordPayment` / the public payer-page reads). Keeping the
 * service-role key out of every browser-reachable module is asserted by
 * `src/server/data/audit-browser-boundary.test.ts`.
 *
 * Callers are API routes only:
 *   - POST /api/payments/paystack/initialize, POST /api/invoice/send/$id
 *   - POST /api/payments/paystack/webhook
 * No UI module imports this file.
 */

import type { Json } from "#/types/database.types";
import { getSupabaseAdminClient } from "../supabase";
import { koboToNaira, nairaToKobo } from "./money";
import {
	canReuseCollectionSession,
	collectionAmountForInvoice,
	getInvoicePaymentSnapshot,
	getPaymentCapabilities,
	invoiceByToken,
	type PaymentChargeRow,
	payableInvoiceIssue,
	publicCharge,
	rawRowToInvoiceState,
	toPaymentCharge,
} from "./payments";
import type { Supabase } from "./workspaces";

/**
 * F11 — a single, structured, greppable payment-anomaly event.
 *
 * Every money path that ends in a rejection, an unusable provider reply, or a
 * recovery decision emits exactly one `payment_anomaly` line. It carries no
 * secret and no card data — only the reference, ids, reason and amount — so it
 * is safe to ship to a log sink. A durable external alert sink (Sentry, etc.)
 * is out of scope for this module; see PAYSTACK_TEST_REPORT.md (F11).
 */
export type PaymentAnomalyType =
	| "business_rejection"
	| "verification_non_success"
	| "reconciliation_credited"
	| "reconciliation_error";

export function logPaymentAnomaly(anomaly: {
	type: PaymentAnomalyType;
	reference: string;
	reason?: string;
	invoiceId?: string;
	workspaceId?: string;
	amountKobo?: number;
	currency?: string;
}): void {
	console.warn(
		"payment_anomaly",
		JSON.stringify({
			event: "payment_anomaly",
			at: new Date().toISOString(),
			...anomaly,
		}),
	);
}

/**
 * F8 — resolve the reusable pending charge for an invoice, or `null`.
 *
 * A pending charge is reused only while it still matches the invoice's
 * CURRENT collection amount and currency (user-confirmed policy: expire stale,
 * issue fresh). A mismatched or expired pending charge is marked `expired`
 * first so the one-pending-per-invoice index frees up for the fresh charge and
 * the payer never sees a stale amount.
 */
async function findReusableCharge(
	client: Supabase,
	invoiceId: string,
	amount: number,
	currency: string,
	now: number,
): Promise<PaymentChargeRow | null> {
	const { data, error } = await client
		.from("payment_charges")
		.select("*")
		.eq("invoice_id", invoiceId)
		.eq("status", "pending")
		.order("created_at", { ascending: false })
		.limit(1)
		.maybeSingle();
	if (error) throw error;
	if (!data) return null;
	const charge = data as unknown as PaymentChargeRow;
	const reusable = canReuseCollectionSession(
		{
			status: charge.status,
			expiresAt: Date.parse(charge.expires_at),
			amount: Number(charge.amount),
			currency: charge.currency,
		},
		{ amount, currency, now },
	);
	if (reusable) return charge;
	const { error: expireError } = await client
		.from("payment_charges")
		.update({ status: "expired", updated_at: new Date(now).toISOString() })
		.eq("id", charge.id);
	if (expireError) throw expireError;
	return null;
}

export async function ensurePaystackTransferCharge(token: string) {
	const client = getSupabaseAdminClient();
	const row = await invoiceByToken(client, token);
	if (!row) throw new Error("Invoice not found.");
	const invoice = rawRowToInvoiceState(row);
	const snapshot = getInvoicePaymentSnapshot(invoice);
	const collectionAmount = collectionAmountForInvoice(invoice, snapshot);
	const issue = payableInvoiceIssue(invoice);
	if (issue) throw new Error(issue);
	const workspace = row.workspaces as { country_code: string | null } | null;
	const capabilities = getPaymentCapabilities(
		workspace ? { countryCode: workspace.country_code } : null,
	);
	if (!capabilities.automaticBankTransfer)
		throw new Error(
			"Automatic bank transfer is not available for this workspace.",
		);
	if (collectionAmount <= 0)
		throw new Error("Invoice has no collectible amount.");
	// F9 (user-confirmed policy): Paystack Pay-with-Transfer for a Nigerian
	// workspace settles in NGN only and the app has no FX handling, so refuse
	// any other invoice currency rather than forward one Paystack may reject
	// or settle unexpectedly.
	const currency = String(row.currency ?? "").toUpperCase();
	if (currency !== "NGN")
		throw new Error("Only NGN invoices can be paid by Paystack transfer.");
	// F8: reuse a pending virtual account only while it still matches the
	// current amount and currency; a stale one is expired here so a fresh,
	// correct charge is created below.
	const reusable = await findReusableCharge(
		client,
		String(row.id),
		collectionAmount,
		currency,
		Date.now(),
	);
	if (reusable) return publicCharge(toPaymentCharge(reusable));
	const email = row.customer_id
		? (
				await client
					.from("clients")
					.select("email")
					.eq("id", String(row.customer_id))
					.maybeSingle()
			).data?.email
		: undefined;
	if (!email || !/^\S+@\S+\.\S+$/.test(email))
		throw new Error(
			"Invoice needs a valid client email before Paystack transfer.",
		);
	const secret = process.env.PAYSTACK_SECRET_KEY;
	if (!secret) throw new Error("PAYSTACK_SECRET_KEY is not configured.");
	const now = Date.now();
	const expiresAt = new Date(now + 8 * 60 * 60 * 1000);
	// F12: persist the FINAL provider reference before the provider call so a
	// webhook that races the response (or a failed post-provider DB update)
	// can never leave a paid reference unmatched. The previous `claim-...`
	// placeholder only became the real reference after the network call.
	const reference = `velure-${String(row.id).replace(/[^a-zA-Z0-9]/g, "")}-${now}`;
	const { data: claim, error: claimError } = await client
		.from("payment_charges")
		.insert({
			workspace_id: String(row.workspace_id),
			invoice_id: String(row.id),
			provider: "paystack",
			reference,
			amount: collectionAmount,
			currency,
			status: "pending",
			expires_at: expiresAt.toISOString(),
		})
		.select("*")
		.single();
	if (claimError) {
		if (claimError.code !== "23505") throw claimError;
		// Lost the one-pending-per-invoice race: reuse the winner only if it
		// still matches the current amount/currency (F8).
		const winner = await findReusableCharge(
			client,
			String(row.id),
			collectionAmount,
			currency,
			Date.now(),
		);
		if (!winner) throw new Error("Could not claim Paystack transfer charge.");
		return publicCharge(toPaymentCharge(winner));
	}
	let response: Response;
	try {
		response = await fetch("https://api.paystack.co/charge", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${secret}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				email,
				amount: nairaToKobo(collectionAmount),
				currency,
				reference,
				bank_transfer: { account_expires_at: expiresAt.toISOString() },
				metadata: {
					invoiceId: row.id,
					token,
					invoiceNumber: row.invoice_number,
				},
			}),
		});
	} catch (error) {
		await client
			.from("payment_charges")
			.update({
				status: "failed",
				provider_message: "Paystack request failed.",
			})
			.eq("id", claim.id);
		throw error;
	}
	const payload = (await response.json().catch(() => null)) as {
		status?: boolean;
		message?: string;
		data?: {
			status?: string;
			reference?: string;
			bank?: { name?: string; slug?: string };
			account_name?: string;
			account_number?: string;
			amount?: number;
			currency?: string;
		};
	} | null;
	if (!response.ok || !payload?.status || !payload.data?.account_number) {
		await client
			.from("payment_charges")
			.update({
				status: "failed",
				provider_message:
					payload?.message ?? "Paystack charge creation failed.",
			})
			.eq("id", claim.id);
		throw new Error(
			payload?.message ?? "Could not create Paystack transfer account.",
		);
	}
	const { data: charge, error } = await client
		.from("payment_charges")
		.update({
			reference: payload.data.reference ?? reference,
			amount: collectionAmount,
			currency: payload.data.currency ?? currency,
			status: "pending",
			account_name: payload.data.account_name ?? null,
			account_number: payload.data.account_number,
			bank_name: payload.data.bank?.name ?? null,
			bank_slug: payload.data.bank?.slug ?? null,
			expires_at: expiresAt.toISOString(),
			provider_status: payload.data.status ?? null,
			provider_message: payload.message ?? null,
			raw_response: payload,
		})
		.eq("id", claim.id)
		.select("*")
		.single();
	if (error) throw error;
	return publicCharge(toPaymentCharge(charge as unknown as PaymentChargeRow));
}

export type PaystackConfirmationResult = {
	ok: boolean;
	duplicate: boolean;
	reference: string;
	paid?: boolean;
	reason?: string;
};

export async function confirmPaystackWebhookPayment(args: {
	eventType: string;
	providerStatus: string;
	reference: string;
	amountKobo: number;
	currency: string;
	providerPaymentId?: string;
	customerEmail?: string;
	rawEvent?: unknown;
}): Promise<PaystackConfirmationResult> {
	const client = getSupabaseAdminClient();
	const { data, error } = await client.rpc("confirm_paystack_payment", {
		input_reference: args.reference,
		// The RPC compares against `numeric`; send the exact two-decimal
		// string so money never passes through binary floating point.
		// PostgREST casts the JSON string to numeric for the argument.
		input_amount: koboToNaira(args.amountKobo) as unknown as number,
		input_currency: args.currency,
		input_event_type: args.eventType,
		input_provider_status: args.providerStatus,
		input_provider_payment_id: args.providerPaymentId,
		input_customer_email: args.customerEmail,
		input_raw_event: args.rawEvent as Json | undefined,
	});
	if (error) throw error;
	return data as PaystackConfirmationResult;
}

/** Shape of `GET /transaction/verify/:reference` used by reconciliation. */
export type PaystackVerifiedTransaction = {
	status?: boolean;
	message?: string;
	data?: {
		status?: string;
		reference?: string;
		amount?: number;
		currency?: string;
		id?: number;
		customer?: { email?: string };
	};
};

async function verifyPaystackTransaction(
	reference: string,
	secret: string,
): Promise<PaystackVerifiedTransaction | null> {
	try {
		const response = await fetch(
			`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
			{ method: "GET", headers: { Authorization: `Bearer ${secret}` } },
		);
		if (!response.ok) return null;
		return (await response
			.json()
			.catch(() => null)) as PaystackVerifiedTransaction | null;
	} catch {
		return null;
	}
}

/** Let a webhook land (and Paystack retry it) before recovering by verify. */
const RECONCILE_GRACE_MS = 15 * 60 * 1000;
/** Stop re-verifying a charge once it is this far past expiry. */
const RECONCILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type PaystackReconciliationSummary = {
	checked: number;
	credited: number;
	duplicates: number;
	unchanged: number;
	errors: number;
};

/**
 * F7 — missed-webhook recovery.
 *
 * Verifies Paystack charges that are past expiry and still `pending`/`expired`
 * with no settlement, and credits ONLY a confirmed success through the same
 * idempotent `confirm_paystack_payment` RPC the webhook uses. A non-success or
 * failed verification never touches charge state, so a pending slot is never
 * released early and no double-payment path is opened. Bounded to
 * `RECONCILE_MAX_AGE_MS` past expiry so a dead charge is not re-verified
 * forever.
 */
export async function reconcilePendingPaystackCharges(
	options: Readonly<{
		now?: () => Date;
		batchSize?: number;
		adminClient?: Supabase;
		secretKey?: string;
		verifyTransaction?: (
			reference: string,
		) => Promise<PaystackVerifiedTransaction | null>;
	}> = {},
): Promise<PaystackReconciliationSummary> {
	const summary: PaystackReconciliationSummary = {
		checked: 0,
		credited: 0,
		duplicates: 0,
		unchanged: 0,
		errors: 0,
	};
	const secret = options.secretKey ?? process.env.PAYSTACK_SECRET_KEY;
	// Fail closed: without a key nothing can be verified, so change nothing.
	if (!secret) return summary;
	const admin =
		options.adminClient ?? (getSupabaseAdminClient() as unknown as Supabase);
	const now = (options.now ?? (() => new Date()))().getTime();
	const verify =
		options.verifyTransaction ??
		((reference: string) => verifyPaystackTransaction(reference, secret));
	const batchSize = Math.max(1, Math.min(50, options.batchSize ?? 25));
	const { data, error } = await admin
		.from("payment_charges")
		.select("*")
		.eq("provider", "paystack")
		.in("status", ["pending", "expired"])
		.lt("expires_at", new Date(now - RECONCILE_GRACE_MS).toISOString())
		.gt("expires_at", new Date(now - RECONCILE_MAX_AGE_MS).toISOString())
		.order("expires_at", { ascending: true })
		.limit(batchSize);
	if (error) throw error;

	for (const row of (data ?? []) as unknown as PaymentChargeRow[]) {
		summary.checked += 1;
		const verified = await verify(row.reference);
		const verifiedData = verified?.status ? verified.data : undefined;
		if (verifiedData?.status !== "success") {
			// A non-success (or unverifiable) charge must NOT change state:
			// releasing the pending slot early risks a double payment.
			summary.unchanged += 1;
			logPaymentAnomaly({
				type: "verification_non_success",
				reference: row.reference,
				reason: verifiedData?.status ?? "unverifiable",
				invoiceId: row.invoice_id,
				workspaceId: row.workspace_id,
			});
			continue;
		}
		const amountKobo = Number(verifiedData.amount);
		if (
			!Number.isSafeInteger(amountKobo) ||
			amountKobo < 0 ||
			typeof verifiedData.currency !== "string" ||
			verifiedData.currency.length === 0
		) {
			summary.errors += 1;
			logPaymentAnomaly({
				type: "reconciliation_error",
				reference: row.reference,
				reason: "unusable_verify_payload",
				invoiceId: row.invoice_id,
				workspaceId: row.workspace_id,
			});
			continue;
		}
		try {
			const result = await confirmPaystackWebhookPayment({
				eventType: "charge.success",
				providerStatus: "success",
				reference: row.reference,
				amountKobo,
				currency: verifiedData.currency,
				providerPaymentId:
					typeof verifiedData.id === "number"
						? String(verifiedData.id)
						: undefined,
				customerEmail: verifiedData.customer?.email,
				rawEvent: verifiedData,
			});
			if (result.ok && result.duplicate) {
				summary.duplicates += 1;
			} else if (result.ok) {
				summary.credited += 1;
				logPaymentAnomaly({
					type: "reconciliation_credited",
					reference: row.reference,
					invoiceId: row.invoice_id,
					workspaceId: row.workspace_id,
					amountKobo,
					currency: verifiedData.currency,
				});
			} else {
				summary.unchanged += 1;
				logPaymentAnomaly({
					type: "business_rejection",
					reference: row.reference,
					reason: result.reason,
					invoiceId: row.invoice_id,
					workspaceId: row.workspace_id,
				});
			}
		} catch (caught) {
			summary.errors += 1;
			logPaymentAnomaly({
				type: "reconciliation_error",
				reference: row.reference,
				reason: caught instanceof Error ? caught.name : "UnknownError",
				invoiceId: row.invoice_id,
				workspaceId: row.workspace_id,
			});
		}
	}
	return summary;
}
