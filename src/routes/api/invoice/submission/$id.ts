import { createFileRoute } from "@tanstack/react-router";
import { queueInvoiceSubmission } from "#/server/data/einvoice-submissions";
import { safeErrorDetails } from "#/server/http-security";
import { getInvoiceUserContext } from "#/server/invoice-repository";

export async function handleSubmit({
	request,
	params,
}: {
	request: Request;
	params: { id: string };
}) {
	const context = await getInvoiceUserContext(request);
	if (!context)
		return Response.json(
			{ ok: false, error: "Authentication required." },
			{ status: 401 },
		);
	if (!/^[0-9a-f-]{36}$/i.test(params.id))
		return Response.json(
			{ ok: false, error: "Invalid invoice id." },
			{ status: 400 },
		);
	try {
		const result = await queueInvoiceSubmission(
			context.client,
			context.userId,
			params.id,
		);
		if (result.status === "not_found")
			return Response.json({ ok: false, ...result }, { status: 404 });
		if (result.status === "invalid")
			return Response.json({ ok: false, ...result }, { status: 400 });
		return Response.json({ ok: true, ...result });
	} catch (error) {
		console.error(
			"Mock invoice submission queue failed",
			safeErrorDetails(error),
		);
		return Response.json(
			{ ok: false, error: "Could not queue the sandbox submission." },
			{ status: 500 },
		);
	}
}

export const Route = createFileRoute("/api/invoice/submission/$id")({
	server: { handlers: { POST: handleSubmit } },
});
