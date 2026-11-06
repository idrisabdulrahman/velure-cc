import { createFileRoute } from "@tanstack/react-router";
import {
	confirmPaymentClaim,
	rejectPaymentClaim,
} from "#/server/data/payment-claims";
import { getInvoiceUserContext } from "#/server/invoice-repository";
import { withRequestObservability } from "#/server/observability";

/**
 * WP-A seller action on a buyer claim. Session-scoped: the user-scoped Supabase
 * client carries RLS, so only a workspace member with a write role can confirm
 * or reject. Confirming settles through the existing `recordPayment` path.
 */
export const handle = withRequestObservability(
	async (
		_requestId: string,
		{ request, params }: { request: Request; params: { id: string } },
	) => {
		const context = await getInvoiceUserContext(request);
		if (!context)
			return Response.json(
				{ ok: false, error: "Not signed in." },
				{ status: 401 },
			);

		let payload: { action?: unknown };
		try {
			payload = (await request.json()) as typeof payload;
		} catch {
			return Response.json(
				{ ok: false, error: "Invalid request body." },
				{ status: 400 },
			);
		}
		const action = payload.action;
		if (action !== "confirm" && action !== "reject")
			return Response.json(
				{ ok: false, error: "Unknown action." },
				{ status: 400 },
			);

		try {
			const result =
				action === "confirm"
					? await confirmPaymentClaim(context.client, context.userId, params.id)
					: await rejectPaymentClaim(context.client, context.userId, params.id);
			return Response.json(result);
		} catch (error) {
			if (
				error instanceof Error &&
				error.message === "Payment claim not found."
			)
				return Response.json(
					{ ok: false, error: "Payment claim not found." },
					{ status: 404 },
				);
			// Anything else falls through to the observability wrapper's generic
			// 500 and a correlated server-error log line.
			throw error;
		}
	},
);

export const handlers = { POST: handle };

export const Route = createFileRoute("/api/invoice/claims/$id")({
	server: { handlers },
});
