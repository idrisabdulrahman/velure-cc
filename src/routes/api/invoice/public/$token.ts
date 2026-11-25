import { createFileRoute } from "@tanstack/react-router";
import { withRequestObservability } from "#/server/observability";
import {
	getPublicInvoicePage,
	recordPublicInvoiceView,
} from "#/server/public-invoice-repository";

// Both handlers run through `withRequestObservability` (WP-H): a failure yields
// one correlated server-error log line and a generic 500, never a stack trace or
// SQL in the body (`AGENTS.md` §8).
const get = withRequestObservability(
	async (_requestId: string, { params }: { params: { token: string } }) => {
		const result = await getPublicInvoicePage(params.token);
		return result
			? Response.json(result, { headers: { "Cache-Control": "no-store" } })
			: Response.json({ error: "Invoice not found." }, { status: 404 });
	},
);

const post = withRequestObservability(
	async (_requestId: string, { params }: { params: { token: string } }) => {
		const result = await recordPublicInvoiceView(params.token);
		return Response.json(result, { status: result.ok ? 200 : 404 });
	},
);

export const Route = createFileRoute("/api/invoice/public/$token")({
	server: { handlers: { GET: get, POST: post } },
});
