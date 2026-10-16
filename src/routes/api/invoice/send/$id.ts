import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { Resend } from "resend";
import { ensurePaystackTransferCharge } from "#/server/data/payments";
import { getServerEnv } from "#/server/env";
import { safeErrorDetails } from "#/server/http-security";
import {
	getAuthenticatedInvoiceById,
	getInvoiceUserContext,
	type InvoiceUserContext,
	recordInvoiceDeliveryEvent,
} from "#/server/invoice-repository";
import { renderInvoicePdf } from "#/server/pdf";

function isValidEmail(value: string) {
	return /^\S+@\S+\.\S+$/.test(value);
}

function sanitizeFromAddress(value: string | undefined) {
	if (!value) return "Velure <onboarding@resend.dev>";
	return value;
}

function escapeHtml(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function resendTagValue(value: string) {
	const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 256);
	return cleaned || "unknown";
}

function invoiceEmailIdempotencyKey(input: {
	invoiceId: string;
	recipient: string;
	updatedAt: number;
}) {
	const hash = createHash("sha256")
		.update(`${input.invoiceId}:${input.recipient}:${input.updatedAt}`)
		.digest("hex");
	return `invoice-email-${hash}`;
}

async function recordDeliveryFailure(
	context: InvoiceUserContext,
	input: {
		invoiceId: string;
		recipient: string;
		error: string;
		publicUrl?: string;
	},
) {
	await recordInvoiceDeliveryEvent(context, {
		invoiceId: input.invoiceId,
		recipient: input.recipient,
		status: "failed",
		error: input.error,
		publicUrl: input.publicUrl,
	}).catch(() => null);
}

function errorMessage(error: unknown, fallback: string) {
	return error instanceof Error ? error.message : fallback;
}

function isProviderTimeout(error: unknown) {
	const message = errorMessage(error, "").toLowerCase();
	const cause = error instanceof Error ? error.cause : undefined;
	const causeCode =
		typeof cause === "object" && cause && "code" in cause
			? String((cause as { code?: unknown }).code)
			: "";

	return (
		message.includes("fetch failed") ||
		message.includes("timed out") ||
		causeCode === "ETIMEDOUT" ||
		causeCode === "EAI_AGAIN" ||
		causeCode === "ECONNRESET"
	);
}

export function providerErrorMessage(error: unknown) {
	if (isProviderTimeout(error)) {
		return "Email provider timed out. The invoice was not confirmed as sent; retry in a moment or use the share/download options.";
	}

	return "Email could not be sent. Retry or use the share/download options.";
}

async function withProviderTimeout<T>(promise: Promise<T>, timeoutMs: number) {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => {
			reject(new Error("Email provider timed out."));
		}, timeoutMs);
	});

	try {
		return await Promise.race([promise, timeout]);
	} finally {
		if (timeoutId) clearTimeout(timeoutId);
	}
}

async function sendInvoiceEmail({
	params,
	request,
}: {
	params: { id: string };
	request: Request;
}) {
	const resendApiKey = getServerEnv("RESEND_API_KEY");
	if (!resendApiKey) {
		return Response.json(
			{ ok: false, error: "Email delivery is temporarily unavailable." },
			{ status: 503 },
		);
	}

	const context = await getInvoiceUserContext(request);
	if (!context) {
		return Response.json(
			{ ok: false, error: "Authentication required." },
			{ status: 401 },
		);
	}

	let payload: { to?: string };
	try {
		payload = await request.json();
	} catch {
		return Response.json(
			{ ok: false, error: "Invalid request body." },
			{ status: 400 },
		);
	}

	const to = payload.to?.trim().toLowerCase();
	if (!to || !isValidEmail(to)) {
		return Response.json(
			{ ok: false, error: "A valid recipient email is required." },
			{ status: 400 },
		);
	}

	const invoice = await getAuthenticatedInvoiceById(params.id, context);
	if (!invoice) {
		return Response.json(
			{ ok: false, error: "Invoice not found." },
			{ status: 404 },
		);
	}

	const publicUrl = `${new URL(request.url).origin}/i/${invoice.token}`;
	const safeInvoiceNumber = escapeHtml(invoice.invoiceNumber);
	const safeCustomerName = escapeHtml(invoice.customerName);
	const safePublicUrl = escapeHtml(publicUrl);
	const isProforma = invoice.documentType === "proforma";
	const mailLabel = isProforma ? "pro-forma invoice" : "invoice";

	let pdfBytes: Uint8Array;
	try {
		pdfBytes = await renderInvoicePdf(invoice);
	} catch (error) {
		console.error("Invoice PDF rendering failed", safeErrorDetails(error));
		const message = "Could not prepare the invoice attachment.";
		await recordDeliveryFailure(context, {
			invoiceId: invoice.id,
			recipient: to,
			error: message,
			publicUrl,
		});
		return Response.json({ ok: false, error: message }, { status: 500 });
	}

	const resend = new Resend(resendApiKey);
	const idempotencyKey = invoiceEmailIdempotencyKey({
		invoiceId: invoice.id,
		recipient: to,
		updatedAt: invoice.updatedAt,
	});

	const result = await withProviderTimeout(
		resend.emails.send(
			{
				from: sanitizeFromAddress(getServerEnv("RESEND_FROM_EMAIL")),
				to,
				subject: `${isProforma ? "Pro-forma" : "Invoice"} ${invoice.invoiceNumber}`,
				text: `Your ${mailLabel} ${invoice.invoiceNumber} for ${invoice.customerName} is attached as a PDF. You can also view it online: ${publicUrl}`,
				html: `
        <div style="font-family: Arial, sans-serif; color: #111; line-height: 1.5;">
			  <h2 style="margin: 0 0 12px;">${isProforma ? "Pro-forma invoice" : "Invoice"} ${safeInvoiceNumber}</h2>
          <p style="margin: 0 0 12px;">Hi,</p>
          <p style="margin: 0 0 12px;">
			  Your ${mailLabel} for <strong>${safeCustomerName}</strong> is attached as a PDF.
          </p>
          <p style="margin: 0 0 12px;">
            You can also view it online: <a href="${safePublicUrl}">${safePublicUrl}</a>
          </p>
        </div>
      `,
				attachments: [
					{
						filename: `${invoice.invoiceNumber}.pdf`,
						content: Buffer.from(pdfBytes),
						contentType: "application/pdf",
					},
				],
				tags: [
					{ name: "source", value: "invoice_share" },
					{ name: "invoice_id", value: resendTagValue(invoice.id) },
					{
						name: "invoice_number",
						value: resendTagValue(invoice.invoiceNumber),
					},
				],
			},
			{ idempotencyKey },
		),
		15_000,
	).catch((error: unknown) => ({
		data: null,
		error: error instanceof Error ? error : new Error("Failed to send email."),
	}));

	if (result.error) {
		const message = providerErrorMessage(result.error);
		console.error(
			"Invoice email provider failed",
			safeErrorDetails(result.error),
		);
		await recordDeliveryFailure(context, {
			invoiceId: invoice.id,
			recipient: to,
			error: message,
			publicUrl,
		});
		return Response.json(
			{
				ok: false,
				error: message,
			},
			{ status: isProviderTimeout(result.error) ? 503 : 502 },
		);
	}

	await recordInvoiceDeliveryEvent(context, {
		invoiceId: invoice.id,
		recipient: to,
		status: "sent",
		providerMessageId: result.data?.id ?? undefined,
		publicUrl,
	}).catch((error: unknown) => {
		console.error(
			"Failed to record invoice email delivery event",
			safeErrorDetails(error),
		);
	});

	ensurePaystackTransferCharge(invoice.token).catch((error: unknown) => {
		console.error(
			"Failed to prepare Paystack transfer charge",
			safeErrorDetails(error),
		);
	});

	return Response.json({ ok: true, id: result.data?.id ?? null });
}

async function handle({
	params,
	request,
}: {
	params: { id: string };
	request: Request;
}) {
	try {
		return await sendInvoiceEmail({ params, request });
	} catch (error) {
		console.error("Invoice email send failed", safeErrorDetails(error));
		return Response.json(
			{
				ok: false,
				error: "Failed to send invoice email.",
			},
			{ status: 500 },
		);
	}
}

export const Route = createFileRoute("/api/invoice/send/$id")({
	server: {
		handlers: {
			POST: handle,
		},
	},
});
