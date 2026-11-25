import { createHash } from "node:crypto";
import { Resend } from "resend";
import { formatMoney } from "#/features/invoices/format";
import { logEmailDeliveryFailure } from "./email-delivery";
import { getServerEnv } from "./env";
import { getMemberDirectoryPool } from "./member-directory";
import { getSupabaseAdminClient } from "./supabase";

/**
 * Seller payment notifications.
 *
 * A buyer paying is the one money event the seller must hear about without
 * opening the app, so every buyer-initiated payment emails the workspace
 * owner:
 *
 *  - `notifySellerPaymentSettled` — an automatic provider (Bachs) webhook
 *    settled the invoice. The invoice is already paid; the email is the
 *    receipt.
 *  - `notifySellerPaymentClaimed` — the buyer tapped "I've paid" on the public
 *    page. Nothing is settled yet; the email asks the seller to confirm.
 *
 * Server-only: it holds the Resend SDK, the service-role client and the
 * Better Auth identity pool, so it is reachable only from `src/routes/api/**`
 * handlers (same boundary as `public-invoice-repository`). It never throws:
 * a notification failure must never fail the payment or the claim, so every
 * error is logged and swallowed (`AGENTS.md` §8: no PII in logs).
 */

/**
 * The workspace owner's email. `better_auth."user"` is not exposed through
 * PostgREST, so this read uses the server's own Postgres pool (the same
 * lifecycle `#/lib/auth` owns). A workspace whose owner identity row is gone
 * resolves to `null`, and the caller simply sends nothing.
 */
async function resolveSellerEmail(workspaceId: string): Promise<string | null> {
	const { rows } = await getMemberDirectoryPool().query(
		`select u."email" as email
		   from public.workspaces w
		   join better_auth."user" u on u."id" = w."owner_id"
		  where w."id" = $1
		  limit 1`,
		[workspaceId],
	);
	const email = (rows?.[0] as { email?: unknown } | undefined)?.email;
	return typeof email === "string" && email.trim() ? email.trim() : null;
}

function escapeHtml(value: string) {
	return value.replace(
		/[&<>"']/g,
		(char) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				char
			] ?? char,
	);
}

type SellerEmail = {
	to: string;
	subject: string;
	text: string;
	html: string;
	/** Stable key so a provider retry cannot send the same notice twice. */
	idempotencyKey: string;
	tag: string;
};

async function sendSellerEmail(message: SellerEmail) {
	const apiKey = getServerEnv("RESEND_API_KEY");
	const from = getServerEnv("RESEND_FROM_EMAIL");
	if (!apiKey || !from) {
		console.error(
			`Cannot send a ${message.tag} email: RESEND_API_KEY or RESEND_FROM_EMAIL is missing.`,
		);
		return;
	}
	const result = await new Resend(apiKey).emails.send(
		{
			from,
			to: message.to,
			subject: message.subject,
			text: message.text,
			html: message.html,
			tags: [{ name: "source", value: message.tag }],
		},
		{ idempotencyKey: message.idempotencyKey },
	);
	if (result.error) throw result.error;
}

function idempotencyKey(scope: string, value: string) {
	return createHash("sha256").update(`${scope}:${value}`).digest("hex");
}

/** The in-app list, since a single invoice has no standalone dashboard route. */
function invoicesUrl() {
	return `${getServerEnv("SITE_URL") ?? ""}/invoices`;
}

function notice(input: {
	invoiceNumber: string;
	customerName: string;
	amount: number;
	currency: string;
}) {
	return {
		number: escapeHtml(input.invoiceNumber),
		customer: escapeHtml(input.customerName),
		amount: escapeHtml(
			formatMoney(input.amount, input.currency, { currencyDisplay: "code" }),
		),
	};
}

export type PaymentNotification = {
	workspaceId: string;
	invoiceNumber: string;
	customerName: string;
	amount: number;
	currency: string;
};

/**
 * Email the seller that a settled payment arrived. The invoice is already
 * paid / partially-paid by the time this runs.
 */
export async function notifySellerPaymentSettled(input: {
	reference: string;
	amount: number;
	currency: string;
	paidInFull: boolean;
}) {
	try {
		// The webhook knows only the provider reference; the invoice identity
		// and the tenant come from our own charge row (service-role read).
		const { data, error } = await getSupabaseAdminClient()
			.from("payment_charges")
			.select("workspace_id, invoices(invoice_number, customer_name)")
			.eq("provider", "bachs")
			.eq("reference", input.reference)
			.maybeSingle();
		if (error) throw error;
		const row = data as {
			workspace_id?: string;
			invoices?:
				| { invoice_number?: string; customer_name?: string }
				| { invoice_number?: string; customer_name?: string }[]
				| null;
		} | null;
		const invoice = Array.isArray(row?.invoices)
			? row?.invoices[0]
			: row?.invoices;
		const workspaceId = row?.workspace_id;
		if (!workspaceId || !invoice?.invoice_number) return;
		await deliverSettledNotice(
			{
				workspaceId,
				invoiceNumber: invoice.invoice_number,
				customerName: invoice.customer_name ?? "your customer",
				amount: input.amount,
				currency: input.currency,
			},
			input.paidInFull,
			input.reference,
		);
	} catch (error) {
		logEmailDeliveryFailure("payment-settled-notification", error);
	}
}

async function deliverSettledNotice(
	input: PaymentNotification,
	paidInFull: boolean,
	reference: string,
) {
	const to = await resolveSellerEmail(input.workspaceId);
	if (!to) return;
	const { number, customer, amount } = notice(input);
	const url = invoicesUrl();
	const state = paidInFull
		? "The invoice is now fully paid."
		: "The invoice is now partially paid.";
	await sendSellerEmail({
		to,
		subject: `Payment received — invoice ${input.invoiceNumber}`,
		text: `Good news: ${input.customerName} paid ${amount} towards invoice ${input.invoiceNumber}. ${state}\n\nView it: ${url}`,
		html: `<div style="font-family:Arial,sans-serif;color:#111;line-height:1.5"><h2>Payment received</h2><p><strong>${customer}</strong> paid <strong>${amount}</strong> towards invoice <strong>${number}</strong>.</p><p>${state}</p><p><a href="${escapeHtml(url)}">View invoices</a></p></div>`,
		idempotencyKey: idempotencyKey("payment-settled", reference),
		tag: "payment-received",
	});
}

/**
 * Email the seller that a buyer submitted an "I've paid" claim. The claim is
 * evidence only until the seller confirms it.
 */
export async function notifySellerPaymentClaimed(input: PaymentNotification) {
	try {
		const to = await resolveSellerEmail(input.workspaceId);
		if (!to) return;
		const { number, customer, amount } = notice(input);
		const url = invoicesUrl();
		await sendSellerEmail({
			to,
			subject: `Payment notice — invoice ${input.invoiceNumber}`,
			text: `${input.customerName} says they paid ${amount} towards invoice ${input.invoiceNumber}. Open the invoice to confirm the payment.\n\nReview it: ${url}`,
			html: `<div style="font-family:Arial,sans-serif;color:#111;line-height:1.5"><h2>Payment notice</h2><p><strong>${customer}</strong> says they paid <strong>${amount}</strong> towards invoice <strong>${number}</strong>.</p><p>Open the invoice to confirm the payment.</p><p><a href="${escapeHtml(url)}">Review invoices</a></p></div>`,
			idempotencyKey: idempotencyKey(
				"payment-claimed",
				`${input.workspaceId}:${input.invoiceNumber}:${input.amount}`,
			),
			tag: "payment-claimed",
		});
	} catch (error) {
		logEmailDeliveryFailure("payment-claim-notification", error);
	}
}
