import { createFileRoute } from "@tanstack/react-router";
import { getInvoiceByToken } from "#/server/invoice-repository";
import { renderInvoicePdf } from "#/server/pdf";

async function handle({ params }: { params: { id: string } }) {
  try {
    const invoice = await getInvoiceByToken(params.id);

    if (!invoice) {
      return new Response("Invoice not found", { status: 404 });
    }

    const pdf = await renderInvoicePdf(invoice);

    // Using `as any` because TS strict DOM types do not always cleanly accept
    // the Node/Bun Uint8Array<ArrayBufferLike> type, despite full runtime support.
    return new Response(pdf as any, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoice.invoiceNumber}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("PDF download error:", error);
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
