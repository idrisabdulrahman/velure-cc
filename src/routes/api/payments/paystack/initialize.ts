import { createFileRoute } from "@tanstack/react-router";
import { ensurePaystackTransferCharge } from "#/server/data/payments";
import {
	consumeFixedWindowRateLimit,
	getClientIp,
	safeErrorDetails,
} from "#/server/http-security";
import { getSupabaseAdminClient } from "#/server/supabase";

export async function handle({ request }: { request: Request }) {
	let payload: { token?: unknown };
	try {
		payload = (await request.json()) as { token?: unknown };
	} catch {
		return Response.json(
			{ ok: false, error: "Invalid request body." },
			{ status: 400 },
		);
	}
	const token =
		typeof payload.token === "string" ? payload.token.trim() : undefined;
	if (!token) {
		return Response.json(
			{ ok: false, error: "Invoice token is required." },
			{ status: 400 },
		);
	}

	let allowed: boolean;
	try {
		const client = getSupabaseAdminClient();
		const tokenAllowed = await consumeFixedWindowRateLimit(
			client,
			"payment-token",
			token,
			5,
			600,
		);
		const ip = getClientIp(request);
		const ipAllowed =
			tokenAllowed && ip
				? await consumeFixedWindowRateLimit(client, "payment-ip", ip, 30, 600)
				: true;
		allowed = tokenAllowed && ipAllowed;
	} catch (error) {
		console.error(
			"Public payment rate-limit check failed",
			safeErrorDetails(error),
		);
		return Response.json(
			{
				ok: false,
				error: "Payment initialization is temporarily unavailable.",
			},
			{ status: 503 },
		);
	}

	if (!allowed) {
		return Response.json(
			{ ok: false, error: "Too many payment attempts. Try again later." },
			{ status: 429, headers: { "Retry-After": "600" } },
		);
	}

	try {
		const charge = await ensurePaystackTransferCharge(token);
		return Response.json({ ok: true, charge });
	} catch (error) {
		console.error(
			"Public payment initialization failed",
			safeErrorDetails(error),
		);
		return Response.json(
			{ ok: false, error: "Could not prepare transfer account." },
			{ status: 400 },
		);
	}
}

export const handlers = { POST: handle };

export const Route = createFileRoute("/api/payments/paystack/initialize")({
	server: {
		handlers,
	},
});
