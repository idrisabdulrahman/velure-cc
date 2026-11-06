import { createFileRoute } from "@tanstack/react-router";
import { getClientIp } from "#/server/http-security";
import { withRequestObservability } from "#/server/observability";
import { submitPublicQuoteAcceptance } from "#/server/public-invoice-repository";

/**
 * WP-D buyer "Accept quote" endpoint. Token-scoped and rate-limited: it
 * resolves the quote from the bearer token only and creates exactly one
 * payable invoice through `submitPublicQuoteAcceptance`. A repeat accept is a
 * no-op that returns the existing invoice. See the repository function for the
 * trust boundary.
 */
export const handle = withRequestObservability(
	async (_requestId: string, { request }: { request: Request }) => {
		let payload: { token?: unknown };
		try {
			payload = (await request.json()) as typeof payload;
		} catch {
			return Response.json(
				{ ok: false, error: "Invalid request body." },
				{ status: 400 },
			);
		}

		const token = typeof payload.token === "string" ? payload.token.trim() : "";
		if (!token)
			return Response.json(
				{ ok: false, error: "Invoice token is required." },
				{ status: 400 },
			);

		const result = await submitPublicQuoteAcceptance(token, {
			clientIp: getClientIp(request),
		});
		if (result.ok)
			return Response.json({
				ok: true,
				invoiceId: result.invoiceId,
				alreadyAccepted: result.alreadyAccepted,
			});

		switch (result.reason) {
			case "rate_limited":
				return Response.json(
					{ ok: false, error: "Too many attempts. Try again later." },
					{ status: 429, headers: { "Retry-After": "600" } },
				);
			case "not_found":
				return Response.json(
					{ ok: false, error: "Invoice not found." },
					{ status: 404 },
				);
			case "not_quote":
				return Response.json(
					{ ok: false, error: "This document is not a quote." },
					{ status: 409 },
				);
			default:
				return Response.json(
					{ ok: false, error: "This quote can no longer be accepted." },
					{ status: 409 },
				);
		}
	},
);

export const handlers = { POST: handle };

export const Route = createFileRoute("/api/invoice/public/quote-accept")({
	server: { handlers },
});
