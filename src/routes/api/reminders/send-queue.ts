import { createFileRoute } from "@tanstack/react-router";
import { sendQueuedEmails } from "#/server/data/reminders";
import { getServerEnv } from "#/server/env";
import { safeErrorDetails } from "#/server/http-security";
import { getInvoiceUserContext } from "#/server/invoice-repository";

/**
 * POST /api/reminders/send-queue — deliver queued reminder emails.
 *
 * The Resend secret can only live server-side, so the Send-queue button calls
 * here instead of invoking the data function directly (client bundles never
 * see the key). Auth + tenancy come from the JWT-minted user context; the
 * data function still scopes every row by owner/workspace.
 */
async function handleSendQueue(request: Request) {
	const resendApiKey = getServerEnv("RESEND_API_KEY");
	if (!resendApiKey) {
		return Response.json(
			{ ok: false, error: "Email delivery is temporarily unavailable." },
			{ status: 503 },
		);
	}

	const context = await getInvoiceUserContext(request);
	if (!context) {
		return Response.json(
			{ ok: false, error: "Authentication required." },
			{ status: 401 },
		);
	}

	try {
		const result = await sendQueuedEmails(context.client, context.userId);
		return Response.json({
			ok: true,
			sent: result.sent,
			skipped: result.skipped,
			reason: result.reason ?? null,
		});
	} catch (error) {
		console.error("Reminder queue send failed", safeErrorDetails(error));
		return Response.json(
			{ ok: false, error: "Could not send the reminder queue." },
			{ status: 500 },
		);
	}
}

export const Route = createFileRoute("/api/reminders/send-queue")({
	server: {
		handlers: {
			POST: ({ request }) => handleSendQueue(request),
		},
	},
});
