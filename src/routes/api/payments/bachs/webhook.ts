import { createFileRoute } from "@tanstack/react-router";
import { parseBachsPayment, verifyBachsWebhook } from "#/server/bachs-invoices";
import {
	consumeFixedWindowRateLimit,
	getClientIp,
	readRequestText,
} from "#/server/http-security";
import { notifySellerPaymentSettled } from "#/server/payment-notifications";
import { getSupabaseAdminClient } from "#/server/supabase";

export async function handle({ request }: { request: Request }) {
	// Each Bachs environment signs with its own endpoint secret; a wrong secret
	// can never verify, so any mismatch fails closed below. A mixed
	// sandbox+live configuration fails closed too, matching bachsConfig().
	if (process.env.BACHS_WEBHOOK_SECRET && process.env.BACHS_LIVE_WEBHOOK_SECRET)
		return new Response(null, { status: 404 });
	const secret =
		process.env.BACHS_WEBHOOK_SECRET ?? process.env.BACHS_LIVE_WEBHOOK_SECRET;
	if (!secret) return new Response(null, { status: 404 });
	let raw: string;
	try {
		raw = await readRequestText(request);
	} catch {
		return new Response(null, { status: 413 });
	}
	// HMAC over up to 256 KB is real CPU on the free plan; bound garbage
	// floods before verification. 429 is retryable, so a legitimate
	// delivery throttled here is redelivered by Bachs.
	const ip = getClientIp(request);
	if (
		ip &&
		!(await consumeFixedWindowRateLimit(
			getSupabaseAdminClient(),
			"webhook-ip",
			ip,
			60,
			60,
		))
	)
		return new Response(null, { status: 429 });
	if (
		!verifyBachsWebhook(
			raw,
			request.headers.get("x-bachs-signature-v2"),
			secret,
		)
	)
		return new Response(null, { status: 401 });
	let event: ReturnType<typeof JSON.parse>;
	try {
		event = JSON.parse(raw);
	} catch {
		return new Response(null, { status: 400 });
	}
	const payment = parseBachsPayment(event);
	if (!payment) return Response.json({ ignored: true });
	// The raw event is signature-verified at this point; store it so
	// reconciliation and disputes have the provider's own record.
	const { data, error } = await getSupabaseAdminClient().rpc(
		"confirm_bachs_payment",
		{ ...payment, input_raw_event: event },
	);
	if (error) return new Response(null, { status: 503 });
	if (typeof data === "object" && data && !Array.isArray(data)) {
		const result = data as {
			ok?: boolean;
			duplicate?: boolean;
			paid?: boolean;
			reason?: string;
		};
		if (!result.ok) {
			console.warn(
				"Bachs payment needs review",
				payment.input_reference,
				result.reason,
			);
		} else if (!result.duplicate) {
			// Automatic settlement: the invoice is already paid, so tell the
			// seller a buyer paid. Awaited because floating I/O is cancelled
			// when the Worker returns its response; the notifier swallows its
			// own failures, so a mail problem cannot turn a settled payment
			// into a retryable webhook error.
			await notifySellerPaymentSettled({
				reference: payment.input_reference,
				amount: payment.input_amount,
				currency: payment.input_currency,
				paidInFull: result.paid === true,
			});
		}
	}
	return Response.json({ received: true });
}

export const Route = createFileRoute("/api/payments/bachs/webhook")({
	server: { handlers: { POST: handle } },
});
