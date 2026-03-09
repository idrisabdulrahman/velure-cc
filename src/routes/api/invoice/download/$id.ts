import { createFileRoute } from "@tanstack/react-router";
import { getInvoiceById } from "#/server/invoice-repository";
import { renderInvoicePdf } from "#/server/pdf";

async function handle({
	params,
	request,
}: {
	params: { id: string };
	request: Request;
}) {
	try {
		const url = new URL(request.url);
		const preview = url.searchParams.get("preview") === "true";
		const invoice = await getInvoiceById(params.id);

		if (!invoice) {
			return new Response("Invoice not found", { status: 404 });
		}

		const pdf = await renderInvoicePdf(invoice);

		return new Response(pdf, {
			headers: {
				"Content-Type": "application/pdf",
				"Content-Disposition": `${preview ? "inline" : "attachment"}; filename="${invoice.invoiceNumber}.pdf"`,
				"Cache-Control": "no-store",
			},
		});
	} catch (error) {
		return new Response(
			error instanceof Error ? error.message : "Failed to generate PDF",
			{ status: 500 },
		);
	}
}

export const Route = createFileRoute("/api/invoice/download/$id")({
	server: {
		handlers: {
			GET: handle,
		},
	},
});
