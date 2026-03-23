import { createFileRoute } from "@tanstack/react-router";
import { getInvoiceById } from "#/server/invoice-repository";
import { renderInvoicePdf } from "#/server/pdf";

async function handle({ params }: { params: { id: string } }) {
	const invoice = await getInvoiceById(params.id);

	if (!invoice) {
		return new Response("Invoice not found", { status: 404 });
	}

	const pdf = await renderInvoicePdf(invoice);

	return new Response(pdf.buffer as ArrayBuffer, {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `attachment; filename="${invoice.invoiceNumber}.pdf"`,
			"Cache-Control": "no-store",
		},
	});
}

export const Route = createFileRoute("/api/invoice/download/$id")({
	server: {
		handlers: {
			GET: handle,
		},
	},
});
