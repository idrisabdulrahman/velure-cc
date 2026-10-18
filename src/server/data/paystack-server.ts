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

import { getSupabaseAdminClient } from "../supabase";
import {
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
	await client
		.from("payment_charges")
		.update({ status: "expired" })
		.eq("invoice_id", String(row.id))
		.eq("status", "pending")
		.lte("expires_at", new Date().toISOString());
	const { data: existing, error: existingError } = await client
		.from("payment_charges")
		.select("*")
		.eq("invoice_id", String(row.id))
		.eq("status", "pending")
		.gt("expires_at", new Date().toISOString())
		.order("created_at", { ascending: false })
		.limit(1)
		.maybeSingle();
	if (existingError) throw existingError;
	if (existing)
		return publicCharge(
			toPaymentCharge(existing as unknown as PaymentChargeRow),
		);
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
	const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
	const claimReference = `claim-${String(row.id).replace(/[^a-zA-Z0-9]/g, "")}-${Date.now()}`;
	const { data: claim, error: claimError } = await client
		.from("payment_charges")
		.insert({
			workspace_id: String(row.workspace_id),
			invoice_id: String(row.id),
			provider: "paystack",
			reference: claimReference,
			amount: collectionAmount,
			currency: String(row.currency),
			status: "pending",
			expires_at: expiresAt.toISOString(),
		})
		.select("*")
		.single();
	if (claimError) {
		if (claimError.code !== "23505") throw claimError;
		const { data: winner, error: winnerError } = await client
			.from("payment_charges")
			.select("*")
			.eq("invoice_id", String(row.id))
			.eq("status", "pending")
			.gt("expires_at", new Date().toISOString())
			.maybeSingle();
		if (winnerError) throw winnerError;
		if (!winner) throw new Error("Could not claim Paystack transfer charge.");
		return publicCharge(toPaymentCharge(winner as unknown as PaymentChargeRow));
	}
	const reference = `velure-${String(row.id).replace(/[^a-zA-Z0-9]/g, "")}-${Date.now()}`;
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
				amount: Math.round(collectionAmount * 100),
				currency: row.currency,
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
			currency: payload.data.currency ?? String(row.currency),
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

export async function confirmPaystackWebhookPayment(args: {
	eventType: string;
	providerStatus: string;
	reference: string;
	amount: number;
	currency: string;
	providerPaymentId?: string;
	customerEmail?: string;
	rawEvent?: string;
}) {
	const client = getSupabaseAdminClient();
	const { data, error } = await client.rpc("confirm_paystack_payment", {
		input_reference: args.reference,
		input_amount: args.amount,
		input_currency: args.currency,
		input_event_type: args.eventType,
		input_provider_status: args.providerStatus,
		input_provider_payment_id: args.providerPaymentId,
		input_customer_email: args.customerEmail,
		input_raw_event: args.rawEvent ? JSON.parse(args.rawEvent) : undefined,
	});
	if (error) throw error;
	return data;
}
