import { createFileRoute } from "@tanstack/react-router";
import { mintSupabaseAccessToken } from "#/server/supabase-session";

export const Route = createFileRoute("/api/auth/supabase-session")({
	server: {
		handlers: {
			POST: async ({ request }) => {
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
					return Response.json(
						{
							ok: false,
							error:
								error instanceof Error
									? error.message
									: "Failed to mint Supabase session.",
						},
						{ status: 500 },
					);
				}
			},
		},
	},
});
