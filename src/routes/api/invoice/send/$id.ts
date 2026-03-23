import { createFileRoute } from "@tanstack/react-router";
import { getInvoiceById } from "#/server/invoice-repository";
import { renderInvoicePdf } from "#/server/pdf";
import { Resend } from "resend";

function isValidEmail(value: string) {
  return /^\S+@\S+\.\S+$/.test(value);
}

function sanitizeFromAddress(value: string | undefined) {
  if (!value) return "Velure <onboarding@resend.dev>";
  return value;
}

async function handle({ params, request }: { params: { id: string }; request: Request }) {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return Response.json(
      { ok: false, error: "RESEND_API_KEY is missing on the server." },
      { status: 500 },
    );
  }

  let payload: { to?: string };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const to = payload.to?.trim().toLowerCase();
  if (!to || !isValidEmail(to)) {
    return Response.json(
      { ok: false, error: "A valid recipient email is required." },
      { status: 400 },
    );
  }

  const invoice = await getInvoiceById(params.id);
  if (!invoice) {
    return Response.json({ ok: false, error: "Invoice not found." }, { status: 404 });
  }

  const publicUrl = `${new URL(request.url).origin}/i/${invoice.token}`;
  const pdfBytes = await renderInvoicePdf(invoice);

  const resend = new Resend(resendApiKey);

  const result = await resend.emails.send({
    from: sanitizeFromAddress(process.env.RESEND_FROM),
    to,
    subject: `Invoice ${invoice.invoiceNumber}`,
    html: `
      <div style="font-family: Arial, sans-serif; color: #111; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">Invoice ${invoice.invoiceNumber}</h2>
        <p style="margin: 0 0 12px;">Hi,</p>
        <p style="margin: 0 0 12px;">
          Your invoice for <strong>${invoice.customerName}</strong> is attached as a PDF.
        </p>
        <p style="margin: 0 0 12px;">
          You can also view it online: <a href="${publicUrl}">${publicUrl}</a>
        </p>
      </div>
    `,
    attachments: [
      {
        filename: `${invoice.invoiceNumber}.pdf`,
        content: Buffer.from(pdfBytes).toString("base64"),
      },
    ],
  });

  if (result.error) {
    return Response.json(
      { ok: false, error: result.error.message ?? "Failed to send email." },
      { status: 502 },
    );
  }

  return Response.json({ ok: true, id: result.data?.id ?? null });
}

export const Route = createFileRoute("/api/invoice/send/$id")({
  server: {
    handlers: {
      POST: handle,
    },
  },
});
