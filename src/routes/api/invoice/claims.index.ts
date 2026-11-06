import { createFileRoute } from "@tanstack/react-router";
import { listPaymentClaims } from "#/server/data/payment-claims";
import { getInvoiceUserContext } from "#/server/invoice-repository";
import { withRequestObservability } from "#/server/observability";

/**
 * WP-A seller read: the buyer payment claims for one invoice.
 *
 * Session-scoped and workspace-filtered by `listPaymentClaims`, which resolves
 * the invoice through the caller's own active workspace — a member of another
 * workspace gets `[]`, not another tenant's claims.
 */
export const handle = withRequestObservability(
	async (_requestId: string, { request }: { request: Request }) => {
		const context = await getInvoiceUserContext(request);
		if (!context)
			return Response.json(
				{ ok: false, error: "Not signed in." },
				{ status: 401 },
			);

		const invoiceId =
			new URL(request.url).searchParams.get("invoiceId")?.trim() ?? "";
		if (!invoiceId)
			return Response.json(
				{ ok: false, error: "Invoice is required." },
				{ status: 400 },
			);

		const claims = await listPaymentClaims(
			context.client,
			context.userId,
			invoiceId,
		);
		return Response.json({ ok: true, claims });
	},
);

export const handlers = { GET: handle };

export const Route = createFileRoute("/api/invoice/claims/")({
	server: { handlers },
});
