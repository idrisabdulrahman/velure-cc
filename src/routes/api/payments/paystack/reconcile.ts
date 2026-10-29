import { createFileRoute } from "@tanstack/react-router";
import { reconcilePendingPaystackCharges } from "#/server/data/paystack-server";
import { safeErrorDetails } from "#/server/http-security";

/**
 * Internal scheduler trigger for Paystack missed-webhook recovery. Deployers
 * must wire it to a scheduler (cron) separately, exactly like the invoice
 * submission/email schedulers. Identity is the shared scheduler secret, not a
 * user session or a tenant-supplied id.
 */
export async function handleReconcilePayments({
	request,
}: {
	request: Request;
}) {
	const expected = process.env.INVOICE_SCHEDULER_SECRET;
	if (
		!expected ||
		request.headers.get("authorization") !== `Bearer ${expected}`
	) {
		return Response.json(
			{ ok: false, error: "Unauthorized." },
			{ status: 401 },
		);
	}
	try {
		return Response.json({
			ok: true,
			...(await reconcilePendingPaystackCharges()),
		});
	} catch (error) {
		console.error("Paystack reconciliation failed", safeErrorDetails(error));
		return Response.json(
			{ ok: false, error: "Could not reconcile Paystack charges." },
			{ status: 500 },
		);
	}
}

export const Route = createFileRoute("/api/payments/paystack/reconcile")({
	server: {
		handlers: {
			POST: handleReconcilePayments,
		},
	},
});
