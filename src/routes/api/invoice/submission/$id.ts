import { createFileRoute } from "@tanstack/react-router";
import type { MockScenario } from "#/features/einvoicing/provider-adapter";
import {
	getInvoiceSubmissionGuidance,
	queueInvoiceSubmission,
} from "#/server/data/einvoice-submissions";
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
		const body = await request.json().catch(() => ({}));
		const scenario =
			body && typeof body === "object" && "scenario" in body
				? body.scenario
				: undefined;
		if (
			scenario !== undefined &&
			!["success", "cleared", "rejection", "timeout", "duplicate"].includes(
				String(scenario),
			)
		) {
			return Response.json(
				{ ok: false, error: "Unsupported mock sandbox scenario." },
				{ status: 400 },
			);
		}
		const result = await queueInvoiceSubmission(
			context.client,
			context.userId,
			params.id,
			scenario ? { scenario: scenario as MockScenario } : undefined,
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

export async function handleGet({
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
		const result = await getInvoiceSubmissionGuidance(
			context.client,
			context.userId,
			params.id,
		);
		if (result.status === "not_found")
			return Response.json({ ok: false, ...result }, { status: 404 });
		return Response.json({ ok: true, ...result });
	} catch (error) {
		console.error(
			"Mock invoice submission status lookup failed",
			safeErrorDetails(error),
		);
		return Response.json(
			{ ok: false, error: "Could not load the sandbox submission status." },
			{ status: 500 },
		);
	}
}

export const Route = createFileRoute("/api/invoice/submission/$id")({
	server: { handlers: { GET: handleGet, POST: handleSubmit } },
});
