import { createFileRoute } from "@tanstack/react-router";
import { dispatchDueInvoiceSubmissions } from "#/server/data/einvoice-submissions";
import { safeErrorDetails } from "#/server/http-security";

/** Internal cron trigger; deployers must wire it to a scheduler separately. */
export async function handleScheduledSubmissions({
	request,
}: {
	request: Request;
}) {
	const expected = process.env.INVOICE_SCHEDULER_SECRET;
	if (
		!expected ||
		request.headers.get("authorization") !== `Bearer ${expected}`
	) {
		return Response.json(
			{ ok: false, error: "Unauthorized." },
			{ status: 401 },
		);
	}
	try {
		return Response.json({
			ok: true,
			...(await dispatchDueInvoiceSubmissions()),
		});
	} catch (error) {
		console.error(
			"Mock e-invoice submission scheduler failed",
			safeErrorDetails(error),
		);
		return Response.json(
			{ ok: false, error: "Could not process the sandbox submission queue." },
			{ status: 500 },
		);
	}
}

export const Route = createFileRoute("/api/invoice/submissions/scheduled")({
	server: { handlers: { POST: handleScheduledSubmissions } },
});
