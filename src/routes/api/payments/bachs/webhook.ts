import { createFileRoute } from "@tanstack/react-router";
import { parseBachsPayment, verifyBachsWebhook } from "#/server/bachs-invoices";
import { readRequestText } from "#/server/http-security";
import { getSupabaseAdminClient } from "#/server/supabase";

export async function handle({ request }: { request: Request }) {
	const secret = process.env.BACHS_WEBHOOK_SECRET;
	if (!secret) return new Response(null, { status: 404 });
	let raw: string;
	try {
		raw = await readRequestText(request);
	} catch {
		return new Response(null, { status: 413 });
	}
	if (
		!verifyBachsWebhook(
			raw,
			request.headers.get("x-bachs-signature-v2"),
			secret,
		)
	)
		return new Response(null, { status: 401 });
	let event: unknown;
	try {
		event = JSON.parse(raw);
	} catch {
		return new Response(null, { status: 400 });
	}
	const payment = parseBachsPayment(event);
	if (!payment) return Response.json({ ignored: true });
	const { data, error } = await getSupabaseAdminClient().rpc(
		"confirm_bachs_payment",
		payment,
	);
	if (error) return new Response(null, { status: 503 });
	if (typeof data === "object" && data && !Array.isArray(data) && !data.ok)
		console.warn(
			"Bachs payment needs review",
			payment.input_reference,
			data.reason,
		);
	return Response.json({ received: true });
}

export const Route = createFileRoute("/api/payments/bachs/webhook")({
	server: { handlers: { POST: handle } },
});
