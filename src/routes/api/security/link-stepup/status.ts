import { createFileRoute } from "@tanstack/react-router";
import { parse } from "cookie";
import {
	buildClearLinkStepUpCookie,
	getAuthSessionFromRequest,
	LINK_STEP_UP_COOKIE_NAME,
	verifyLinkStepUpToken,
} from "#/server/security-stepup";

async function handle({ request }: { request: Request }) {
	const session = await getAuthSessionFromRequest(request);

	if (!session?.user) {
		return Response.json({ ok: false, authorized: false }, { status: 200 });
	}

	const cookieHeader = request.headers.get("cookie") ?? "";
	const cookies = parse(cookieHeader);

	const authorized = await verifyLinkStepUpToken(
		cookies[LINK_STEP_UP_COOKIE_NAME],
		{
			userId: session.user.id,
			sessionId: session.session.id,
		},
	);

	if (!authorized) {
		return Response.json(
			{ ok: true, authorized: false },
			{
				headers: {
					"set-cookie": buildClearLinkStepUpCookie(request),
				},
			},
		);
	}

	return Response.json({ ok: true, authorized: true });
}

export const Route = createFileRoute("/api/security/link-stepup/status")({
	server: {
		handlers: {
			GET: handle,
		},
	},
});
