import { createFileRoute } from "@tanstack/react-router";
import {
	getPublicInvoicePage,
	recordPublicInvoiceView,
} from "#/server/public-invoice-repository";

async function get({ params }: { params: { token: string } }) {
	const result = await getPublicInvoicePage(params.token);
	return result
		? Response.json(result, { headers: { "Cache-Control": "no-store" } })
		: Response.json({ error: "Invoice not found." }, { status: 404 });
}

async function post({ params }: { params: { token: string } }) {
	const result = await recordPublicInvoiceView(params.token);
	return Response.json(result, { status: result.ok ? 200 : 404 });
}

export const Route = createFileRoute("/api/invoice/public/$token")({
	server: { handlers: { GET: get, POST: post } },
});
