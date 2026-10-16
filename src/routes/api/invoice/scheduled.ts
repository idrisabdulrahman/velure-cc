import { createFileRoute } from "@tanstack/react-router";
import { dispatchScheduledInvoiceEmails } from "#/server/invoice-mailer";

export const Route = createFileRoute("/api/invoice/scheduled")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const expected = process.env.INVOICE_SCHEDULER_SECRET;
				if (
					!expected ||
					request.headers.get("authorization") !== `Bearer ${expected}`
				)
					return Response.json({ error: "Unauthorized" }, { status: 401 });
				return Response.json(await dispatchScheduledInvoiceEmails());
			},
		},
	},
});
