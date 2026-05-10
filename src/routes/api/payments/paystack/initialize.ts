import { createFileRoute } from "@tanstack/react-router";
import { getInvoiceByToken } from "#/server/invoice-repository";

function invoiceAmount(invoice: NonNullable<Awaited<ReturnType<typeof getInvoiceByToken>>>) {
  if (invoice.compliance?.grandTotal !== undefined) {
    return invoice.compliance.grandTotal - (invoice.compliance.withholdingTaxAmount ?? 0);
  }

  return invoice.lineItems.reduce((sum, item) => sum + item.quantity * item.price, 0);
}

function originFromRequest(request: Request) {
  return process.env.SITE_URL || new URL(request.url).origin;
}

async function handle({ request }: { request: Request }) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    return Response.json(
      { ok: false, error: "PAYSTACK_SECRET_KEY is missing on the server." },
      { status: 500 },
    );
  }

  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim();
  if (!token) {
    return Response.json({ ok: false, error: "Invoice token is required." }, { status: 400 });
  }

  const invoice = await getInvoiceByToken(token);
  if (!invoice || invoice.status === "canceled") {
    return Response.json({ ok: false, error: "Invoice not found." }, { status: 404 });
  }

  if (invoice.status === "paid") {
    return Response.redirect(`${originFromRequest(request)}/i/${invoice.token}`, 302);
  }

  const email = invoice.compliance?.buyer.email?.trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return Response.json(
      { ok: false, error: "Invoice needs a valid client email before Paystack checkout." },
      { status: 400 },
    );
  }

  const amount = invoiceAmount(invoice);
  if (!Number.isFinite(amount) || amount <= 0) {
    return Response.json(
      { ok: false, error: "Invoice amount must be greater than zero." },
      { status: 400 },
    );
  }

  const origin = originFromRequest(request);
  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      amount: Math.round(amount * 100),
      currency: invoice.currency,
      reference: `velure-${invoice.invoiceNumber}-${Date.now()}`,
      callback_url: `${origin}/i/${invoice.token}?payment=paystack`,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        token: invoice.token,
        customerName: invoice.customerName,
      },
    }),
  });

  const payload = (await response.json().catch(() => null)) as {
    status?: boolean;
    message?: string;
    data?: { authorization_url?: string };
  } | null;

  const checkoutUrl = payload?.data?.authorization_url;
  if (!response.ok || !payload?.status || !checkoutUrl) {
    return Response.json(
      { ok: false, error: payload?.message ?? "Could not start Paystack checkout." },
      { status: 502 },
    );
  }

  return Response.redirect(checkoutUrl, 302);
}

export const Route = createFileRoute("/api/payments/paystack/initialize")({
  server: {
    handlers: {
      GET: handle,
    },
  },
});
