import { createFileRoute } from "@tanstack/react-router";
import { getServerConvexClient } from "#/server/convex";
import { api } from "#convex/_generated/api";

async function handle({ request }: { request: Request }) {
	const url = new URL(request.url);
	const token = url.searchParams.get("token")?.trim();
	if (!token) {
		return Response.json(
			{ ok: false, error: "Invoice token is required." },
			{ status: 400 },
		);
	}

	try {
		const convex = getServerConvexClient();
		const charge = await convex.action(
			api.payments.ensurePaystackTransferCharge,
			{
				token,
			},
		);
		return Response.json({ ok: true, charge });
	} catch (error) {
		return Response.json(
			{
				ok: false,
				error:
					error instanceof Error
						? error.message
						: "Could not create Paystack transfer account.",
			},
			{ status: 400 },
		);
	}
}

export const Route = createFileRoute("/api/payments/paystack/initialize")({
	server: {
		handlers: {
			GET: handle,
			POST: handle,
		},
	},
});
