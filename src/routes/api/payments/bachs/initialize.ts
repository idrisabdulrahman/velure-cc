import { createFileRoute } from "@tanstack/react-router";
import { bachsConfig, createBachsCheckout } from "#/server/bachs-invoices";
import {
	consumeFixedWindowRateLimit,
	getClientIp,
	readRequestText,
} from "#/server/http-security";
import { getSupabaseAdminClient } from "#/server/supabase";

async function handle({ request }: { request: Request }) {
	if (!bachsConfig()) return new Response(null, { status: 404 });
	let token: unknown;
	try {
		token = JSON.parse(await readRequestText(request))?.token;
	} catch {
		return Response.json({ error: "Invalid request." }, { status: 400 });
	}
	if (typeof token !== "string" || !/^[A-Za-z0-9._~-]{1,128}$/.test(token))
		return new Response(null, { status: 400 });
	try {
		const client = getSupabaseAdminClient();
		const ip = getClientIp(request);
		if (
			(ip &&
				!(await consumeFixedWindowRateLimit(
					client,
					"payment-ip",
					ip,
					30,
					600,
				))) ||
			!(await consumeFixedWindowRateLimit(
				client,
				"payment-token",
				token,
				5,
				600,
			))
		) {
			return Response.json(
				{ error: "Too many payment attempts. Try again later." },
				{ status: 429 },
			);
		}
		const url = await createBachsCheckout(token);
		return url
			? Response.json({ url }, { headers: { "Cache-Control": "no-store" } })
			: Response.json(
					{ error: "Online checkout is unavailable for this invoice." },
					{ status: 409 },
				);
	} catch (error) {
		console.error(
			"Bachs checkout failed",
			error instanceof Error ? error.message : "database error",
		);
		return Response.json(
			{ error: "Could not open checkout. Try again later." },
			{ status: 503 },
		);
	}
}

export const Route = createFileRoute("/api/payments/bachs/initialize")({
	server: { handlers: { POST: handle } },
});
