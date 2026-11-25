import { createFileRoute } from "@tanstack/react-router";
import { getClientIp } from "#/server/http-security";
import { withRequestObservability } from "#/server/observability";
import { submitPublicPaymentClaim } from "#/server/public-invoice-repository";

/**
 * WP-A buyer "I've paid" endpoint. Token-scoped, rate-limited, and evidence
 * only: it records an unverified claim and never changes invoice payment state.
 * See `submitPublicPaymentClaim` for the trust boundary.
 */
export const handle = withRequestObservability(
	async (_requestId: string, { request }: { request: Request }) => {
		let payload: {
			token?: unknown;
			amount?: unknown;
			reference?: unknown;
			note?: unknown;
		};
		try {
			payload = (await request.json()) as typeof payload;
		} catch {
			return Response.json(
				{ ok: false, error: "Invalid request body." },
				{ status: 400 },
			);
		}

		const token = typeof payload.token === "string" ? payload.token.trim() : "";
		const amount = Number(payload.amount);
		const reference =
			typeof payload.reference === "string"
				? payload.reference.trim().slice(0, 120) || undefined
				: undefined;
		const note =
			typeof payload.note === "string"
				? payload.note.trim().slice(0, 500) || undefined
				: undefined;

		if (!token)
			return Response.json(
				{ ok: false, error: "Invoice token is required." },
				{ status: 400 },
			);
		// Amounts are major-unit numbers in this codebase (rounded to 2 places
		// by `recordPayment`), so accept any finite positive value and let the
		// repository check it against the outstanding balance.
		if (!Number.isFinite(amount) || amount <= 0)
			return Response.json(
				{ ok: false, error: "Enter the amount you paid." },
				{ status: 400 },
			);

		const result = await submitPublicPaymentClaim(
			token,
			{ amount, reference, note },
			{ clientIp: getClientIp(request) },
		);
		if (result.ok)
			return Response.json({ ok: true, duplicate: result.duplicate });

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
			case "not_payable":
				return Response.json(
					{ ok: false, error: "This invoice cannot receive payment." },
					{ status: 409 },
				);
			default:
				return Response.json(
					{
						ok: false,
						error: "Enter an amount within the outstanding balance.",
					},
					{ status: 422 },
				);
		}
	},
);

export const handlers = { POST: handle };

export const Route = createFileRoute("/api/invoice/public/claim")({
	server: { handlers },
});
