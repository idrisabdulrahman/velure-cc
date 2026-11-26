import { createHmac, timingSafeEqual } from "node:crypto";
import {
	getInvoicePaymentSnapshot,
	invoiceByToken,
	payableInvoiceIssue,
	rawRowToInvoiceState,
} from "./data/payments";
import { getSupabaseAdminClient } from "./supabase";

export function bachsSandboxConfig() {
	const {
		BACHS_API_KEY: key,
		BACHS_WEBHOOK_SECRET: secret,
		BACHS_SANDBOX_WORKSPACE_ID: workspace,
		BACHS_SANDBOX_ACCOUNT_ID: account,
		BACHS_SANDBOX_PRODUCT_ID: product,
		BACHS_SANDBOX_RETURN_ORIGIN: origin,
	} = process.env;
	if (
		!key?.startsWith("sk_sandbox_") ||
		!secret ||
		!workspace ||
		!account?.startsWith("acct_") ||
		!product?.startsWith("prod_") ||
		!origin
	)
		return null;
	return {
		key,
		secret,
		workspace,
		account,
		product,
		origin,
		api: "https://sandbox-api.bachs.io",
		checkout: "https://sandbox-checkout.bachs.io",
	};
}

export function bachsLiveConfig() {
	const {
		BACHS_LIVE_API_KEY: key,
		BACHS_LIVE_WEBHOOK_SECRET: secret,
		BACHS_LIVE_WORKSPACE_ID: workspace,
		BACHS_LIVE_ACCOUNT_ID: account,
		BACHS_LIVE_PRODUCT_ID: product,
		BACHS_LIVE_RETURN_ORIGIN: origin,
	} = process.env;
	if (
		!key?.startsWith("sk_live_") ||
		!secret ||
		!workspace ||
		!account?.startsWith("acct_") ||
		!product?.startsWith("prod_") ||
		!origin
	)
		return null;
	return {
		key,
		secret,
		workspace,
		account,
		product,
		origin,
		api: "https://api.bachs.io",
		checkout: "https://checkout.bachs.io",
	};
}

/**
 * Exactly one environment may be configured. A deployment that sets both the
 * sandbox and the live env set is a mixed configuration and fails closed, so
 * checkout sessions can never be created against the wrong Bachs environment.
 */
export function bachsConfig() {
	const sandbox = bachsSandboxConfig();
	const live = bachsLiveConfig();
	if (sandbox && live) return null;
	return sandbox ?? live;
}

export async function getBachsPayableInvoice(token: string) {
	const config = bachsConfig();
	if (!config) return null;
	const client = getSupabaseAdminClient();
	const row = await invoiceByToken(client, token);
	if (
		!row ||
		row.workspace_id !== config.workspace ||
		row.deleted_at ||
		row.currency !== "NGN" ||
		(row.document_type && row.document_type !== "standard")
	)
		return null;
	const invoice = rawRowToInvoiceState(row);
	if (payableInvoiceIssue(invoice)) return null;
	return {
		config,
		client,
		id: String(row.id),
		amount: getInvoicePaymentSnapshot(invoice).balance,
	};
}

/**
 * Guards against a checkout response pointing at the wrong environment,
 * a non-checkout reference, or an unusable expiry. Throws rather than
 * returning so a poisoned response can never reach the ledger.
 */
export function validateBachsCheckoutResponse(
	checkout: {
		checkout_id?: string;
		checkout_url?: string;
		expires_at?: string;
	},
	expectedOrigin: string,
	now = Date.now(),
): string {
	let url: URL;
	try {
		url = new URL(checkout.checkout_url ?? "");
	} catch {
		throw new Error("Unexpected Bachs checkout response");
	}
	if (
		url.origin !== expectedOrigin ||
		!checkout.checkout_id?.startsWith("chk_") ||
		!checkout.expires_at ||
		!Number.isFinite(Date.parse(checkout.expires_at)) ||
		Date.parse(checkout.expires_at) <= now
	) {
		throw new Error("Unexpected Bachs checkout response");
	}
	return url.href;
}

export async function createBachsCheckout(token: string) {
	const invoice = await getBachsPayableInvoice(token);
	if (!invoice) return null;
	const { config, client, id, amount } = invoice;
	const now = new Date().toISOString();
	const { error: expireError } = await client
		.from("payment_charges")
		.update({ status: "expired" })
		.eq("provider", "bachs")
		.eq("invoice_id", id)
		.eq("status", "pending")
		.lt("expires_at", now);
	if (expireError) throw expireError;

	const { error: insertError } = await client.from("payment_charges").insert({
		provider: "bachs",
		reference: crypto.randomUUID(),
		workspace_id: config.workspace,
		invoice_id: id,
		status: "pending",
		amount,
		currency: "NGN",
		expires_at: new Date(Date.now() + 3600_000).toISOString(),
		raw_response: { account: config.account },
	});
	if (insertError && insertError.code !== "23505") throw insertError;
	const { data: charge, error: lookupError } = await client
		.from("payment_charges")
		.select("id,reference,amount,raw_response")
		.eq("provider", "bachs")
		.eq("invoice_id", id)
		.eq("status", "pending")
		.single();
	if (lookupError) throw lookupError;
	const saved = charge.raw_response as {
		account?: string;
		url?: string;
	} | null;
	if (Number(charge.amount) !== amount || saved?.account !== config.account)
		return null;
	if (saved.url) return saved.url;

	const returnUrl = new URL(`/i/${encodeURIComponent(token)}`, config.origin)
		.href;
	const response = await fetch(`${config.api}/v1/checkout-sessions`, {
		method: "POST",
		redirect: "manual",
		signal: AbortSignal.timeout(10_000),
		headers: {
			Authorization: `Bearer ${config.key}`,
			"Content-Type": "application/json",
			// X-Account-Id is a Connect sub-account header: Bachs rejects it
			// with 403 when it names the platform's own organization. This
			// checkout runs against the configured account itself, so the
			// key alone identifies the account. Reintroduce the header only
			// when a workspace maps to a connected account (acct_ != org).
			"Idempotency-Key": charge.id,
		},
		body: JSON.stringify({
			product_cart: [
				{
					product_id: config.product,
					quantity: 1,
					pricing: { price_type: "fixed", amount: amount.toFixed(2) },
				},
			],
			payment_method_types: ["NGN_BANK_TRANSFER"],
			success_url: returnUrl,
			cancel_url: returnUrl,
		}),
	});
	if (!response.ok) throw new Error(`Bachs checkout HTTP ${response.status}`);
	const checkout = (await response.json()) as {
		checkout_id?: string;
		checkout_url?: string;
		expires_at?: string;
	};
	const checkoutUrl = validateBachsCheckoutResponse(checkout, config.checkout);
	const { error } = await client
		.from("payment_charges")
		.update({
			reference: checkout.checkout_id,
			expires_at: checkout.expires_at,
			raw_response: { account: config.account, url: checkoutUrl },
		})
		.eq("id", charge.id)
		.eq("status", "pending");
	if (error) throw error;
	return checkoutUrl;
}

export function verifyBachsWebhook(
	raw: string,
	header: string | null,
	secret: string,
	now = Date.now(),
) {
	const parts = header?.split(",").map((part) => part.trim()) ?? [];
	const timestamp = parts.find((part) => /^t=\d{1,12}$/.test(part))?.slice(2);
	if (!timestamp || Math.abs(now / 1000 - Number(timestamp)) > 300)
		return false;
	const expected = createHmac("sha256", secret)
		.update(`${timestamp}.${raw}`)
		.digest();
	return parts.some(
		(part) =>
			/^v1=[0-9a-f]{64}$/i.test(part) &&
			timingSafeEqual(expected, Buffer.from(part.slice(3), "hex")),
	);
}

/** A settled Bachs collection, in the shape `confirm_bachs_payment` expects. */
export type BachsSettlement = {
	input_reference: string;
	input_account: string;
	input_provider_payment_id: string | null;
	input_amount: number;
	input_currency: "NGN";
	input_event_type: string;
	input_provider_status: string;
};

/**
 * A non-settling lifecycle event. `failed` is deliberately retryable (Bachs
 * keeps the checkout open), `expired` closes the checkout but a late bank
 * transfer may still settle it, and `manual_review` is never auto-applied.
 */
export type BachsLifecycle = {
	input_reference: string;
	input_account: string;
	input_provider_payment_id: string | null;
	input_event_type: string;
	input_provider_status: string;
	input_outcome: "failed" | "expired" | "manual_review";
	input_reason: string | null;
};

export type ParsedBachsEvent =
	| ({ kind: "settle" } & BachsSettlement)
	| ({ kind: "lifecycle" } & BachsLifecycle);

const DECIMAL_AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;

function isCheckoutId(value: unknown): value is string {
	return typeof value === "string" && value.startsWith("chk_");
}

function isChargeId(value: unknown): value is string {
	return typeof value === "string" && value.startsWith("ch_");
}

function parseAmount(value: unknown): number | null {
	if (typeof value !== "string" || !DECIMAL_AMOUNT.test(value)) return null;
	const amount = Number(value);
	return Number.isFinite(amount) && amount > 0 ? amount : null;
}

/**
 * The account a webhook belongs to. Bachs puts the connected account in the
 * top-level `account` on forwarded events and in `organization_id` on the
 * account's own events; prefer `account`, then fall back, so a connected
 * account can never be confused with the platform's organization.
 */
function eventAccount(
	account: unknown,
	organizationId: unknown,
): string | null {
	for (const candidate of [account, organizationId]) {
		if (typeof candidate === "string" && candidate.startsWith("acct_"))
			return candidate;
	}
	return null;
}

/**
 * Parses every Bachs event this app can act on. `collection.succeeded` is the
 * documented source of truth for fulfilment; `checkout.completed` stays as a
 * compatibility fallback. `collection.failed` / `checkout.expired` return a
 * lifecycle event so the ledger can record them without cancelling the order.
 */
export function parseBachsEvent(event: unknown): ParsedBachsEvent | null {
	if (!event || typeof event !== "object") return null;
	const { type, organization_id, account, data } = event as {
		type?: string;
		organization_id?: string;
		account?: string;
		data?: {
			checkout_id?: string;
			charge_id?: string | null;
			status?: string | null;
			mode?: string;
			payment_status?: string | null;
			amount?: string;
			currency?: string | null;
			reason?: string | null;
			charge?: {
				id?: string;
				amount?: string;
				currency?: string;
				status?: string;
			};
		};
	};
	const inputAccount = eventAccount(account, organization_id);
	if (!inputAccount || !data || typeof data !== "object") return null;

	if (type === "collection.succeeded") {
		const reference = data.checkout_id;
		const amount = parseAmount(data.amount);
		const status =
			typeof data.status === "string" ? data.status.toUpperCase() : "";
		const knownStatus =
			status === "SUCCEEDED" || status === "ACCEPTED" || status === "OVERPAID";
		if (
			!isCheckoutId(reference) ||
			amount === null ||
			!knownStatus ||
			(data.charge_id != null && !isChargeId(data.charge_id))
		)
			return null;
		const inputProviderPaymentId = isChargeId(data.charge_id)
			? data.charge_id
			: null;

		// A success in another currency can never match the NGN charge it
		// references, so park the collected money for a person rather than
		// silently dropping it.
		if (data.currency !== "NGN") {
			return {
				kind: "lifecycle",
				input_reference: reference,
				input_account: inputAccount,
				input_provider_payment_id: inputProviderPaymentId,
				input_event_type: type,
				input_provider_status: status,
				input_outcome: "manual_review",
				input_reason:
					typeof data.currency === "string" && data.currency.trim()
						? `currency_${data.currency.toLowerCase()}`
						: "currency_missing",
			};
		}

		if (status === "SUCCEEDED") {
			return {
				kind: "settle",
				input_reference: reference,
				input_account: inputAccount,
				input_provider_payment_id: inputProviderPaymentId,
				input_amount: amount,
				input_currency: "NGN",
				input_event_type: type,
				input_provider_status: status,
			};
		}
		// ACCEPTED / OVERPAID collected money on terms other than the exact
		// requested amount. Never auto-settle those; a person reconciles them.
		return {
			kind: "lifecycle",
			input_reference: reference,
			input_account: inputAccount,
			input_provider_payment_id: inputProviderPaymentId,
			input_event_type: type,
			input_provider_status: status,
			input_outcome: "manual_review",
			input_reason: `collection_${status.toLowerCase()}`,
		};
	}

	if (type === "collection.failed") {
		const reference = data.checkout_id;
		const status =
			typeof data.status === "string" ? data.status.toUpperCase() : "";
		if (!isCheckoutId(reference)) return null;
		if (status !== "FAILED" && status !== "EXPIRED") return null;
		return {
			kind: "lifecycle",
			input_reference: reference,
			input_account: inputAccount,
			input_provider_payment_id: isChargeId(data.charge_id)
				? data.charge_id
				: null,
			input_event_type: type,
			input_provider_status: status,
			// FAILED is explicitly not final: the checkout stays open. EXPIRED
			// closes this charge, but a late transfer can still settle it.
			input_outcome: status === "EXPIRED" ? "expired" : "failed",
			input_reason:
				typeof data.reason === "string" && data.reason.trim()
					? data.reason.trim().slice(0, 200)
					: null,
		};
	}

	if (type === "checkout.expired") {
		const reference = data.checkout_id;
		if (!isCheckoutId(reference)) return null;
		return {
			kind: "lifecycle",
			input_reference: reference,
			input_account: inputAccount,
			input_provider_payment_id: null,
			input_event_type: type,
			input_provider_status: "expired",
			input_outcome: "expired",
			input_reason: null,
		};
	}

	if (type === "checkout.completed") {
		const charge = data.charge;
		if (
			data.status !== "completed" ||
			data.mode !== "payment" ||
			data.payment_status !== "paid" ||
			!isCheckoutId(data.checkout_id) ||
			charge?.status !== "succeeded" ||
			charge.currency !== "NGN"
		)
			return null;
		const amount = parseAmount(charge.amount);
		if (!isChargeId(charge.id) || amount === null) return null;
		return {
			kind: "settle",
			input_reference: data.checkout_id,
			input_account: inputAccount,
			input_provider_payment_id: charge.id,
			input_amount: amount,
			input_currency: "NGN",
			input_event_type: type,
			input_provider_status: charge.status,
		};
	}

	return null;
}

/** Settlement-only projection, kept for callers that only handle payment. */
export function parseBachsPayment(event: unknown): BachsSettlement | null {
	const parsed = parseBachsEvent(event);
	if (parsed?.kind !== "settle") return null;
	const { kind: _kind, ...payment } = parsed;
	return payment;
}
