import { createFileRoute } from "@tanstack/react-router";
import { safeErrorDetails } from "#/server/http-security";
import { mintSupabaseAccessToken } from "#/server/supabase-session";

export async function handle({ request }: { request: Request }) {
	try {
		const minted = await mintSupabaseAccessToken(request);
		if (!minted) {
			return Response.json(
				{ ok: false, error: "No authenticated session." },
				{ status: 401 },
			);
		}
		return Response.json({
			ok: true,
			accessToken: minted.accessToken,
			expiresAt: minted.expiresAt,
			velureUserId: minted.velureUserId,
		});
	} catch (error) {
		console.error("Failed to mint Supabase session", safeErrorDetails(error));
		return Response.json(
			{ ok: false, error: "Failed to create application session." },
			{ status: 500 },
		);
	}
}

export const Route = createFileRoute("/api/auth/supabase-session")({
	server: {
		handlers: {
			POST: handle,
		},
	},
});
