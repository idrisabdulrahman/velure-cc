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

export function parseBachsPayment(event: unknown) {
	if (!event || typeof event !== "object") return null;
	const { type, organization_id, account, data } = event as {
		type?: string;
		organization_id?: string;
		account?: string;
		data?: {
			checkout_id?: string;
			status?: string;
			mode?: string;
			payment_status?: string;
			charge?: {
				id?: string;
				amount?: string;
				currency?: string;
				status?: string;
			};
		};
	};
	// The event carries the account as top-level `organization_id` (per
	// docs.bachs.io webhook payloads); `account` is kept as a defensive
	// fallback for alternate envelope shapes.
	const orgAccount = organization_id ?? account;
	const charge = data?.charge;
	if (
		type !== "checkout.completed" ||
		typeof orgAccount !== "string" ||
		!orgAccount.startsWith("acct_") ||
		data?.status !== "completed" ||
		data.mode !== "payment" ||
		data.payment_status !== "paid" ||
		typeof data.checkout_id !== "string" ||
		!data.checkout_id.startsWith("chk_") ||
		charge?.status !== "succeeded" ||
		charge.currency !== "NGN" ||
		typeof charge.id !== "string" ||
		!charge.id.startsWith("ch_") ||
		typeof charge.amount !== "string" ||
		!/^\d{1,12}(\.\d{1,2})?$/.test(charge.amount) ||
		Number(charge.amount) <= 0
	)
		return null;
	return {
		input_reference: data.checkout_id,
		input_account: orgAccount,
		input_provider_payment_id: charge.id,
		input_amount: Number(charge.amount),
		input_currency: "NGN",
		input_event_type: type,
		input_provider_status: charge.status,
	};
}
