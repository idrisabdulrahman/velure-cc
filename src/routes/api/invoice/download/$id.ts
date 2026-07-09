import { createFileRoute } from "@tanstack/react-router";
import { renderInvoicePdf } from "#/server/pdf";
import { getInvoiceByToken } from "#/server/public-invoice-repository";

function safePdfFileName(invoiceNumber: string) {
	const normalized =
		invoiceNumber
			.trim()
			.replace(/[\r\n"]/g, "")
			.replace(/[^A-Za-z0-9._-]+/g, "_")
			.replace(/^_+|_+$/g, "") || "invoice";

	return `${normalized}.pdf`;
}

async function handle({ params }: { params: { id: string } }) {
	try {
		const token = decodeURIComponent(params.id);
		const invoice = await getInvoiceByToken(token);

		if (!invoice) {
			return new Response("Invoice not found", { status: 404 });
		}

		const pdf = await renderInvoicePdf(invoice);
		const fileName = safePdfFileName(invoice.invoiceNumber);

		return new Response(Buffer.from(pdf), {
			headers: {
				"Content-Type": "application/pdf",
				"Content-Disposition": `attachment; filename="${fileName}"`,
				"Cache-Control": "no-store",
			},
		});
	} catch (error) {
		console.error("PDF download error:", {
			token: params.id,
			error,
		});
		return new Response("Failed to generate PDF", { status: 500 });
	}
}

export const Route = createFileRoute("/api/invoice/download/$id")({
	server: {
		handlers: {
			GET: handle,
		},
	},
});
