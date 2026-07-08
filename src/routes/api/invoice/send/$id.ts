import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { Resend } from "resend";
import { getServerConvexClient } from "#/server/convex";
import { getServerEnv } from "#/server/env";
import {
	getAuthenticatedInvoiceById,
	recordInvoiceDeliveryEvent,
} from "#/server/invoice-repository";
import { renderInvoicePdf } from "#/server/pdf";
import { api } from "../../../../../convex/_generated/api";

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
	sessionToken: string,
	input: {
		invoiceId: string;
		recipient: string;
		error: string;
		publicUrl?: string;
	},
) {
	await recordInvoiceDeliveryEvent(sessionToken, {
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

function providerErrorMessage(error: unknown) {
	if (isProviderTimeout(error)) {
		return "Email provider timed out. The invoice was not confirmed as sent; retry in a moment or use the share/download options.";
	}

	return errorMessage(error, "Failed to send email.");
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
			{ ok: false, error: "RESEND_API_KEY is missing on the server." },
			{ status: 500 },
		);
	}

	const convexSiteUrl =
		process.env.VITE_CONVEX_SITE_URL ?? process.env.CONVEX_SITE_URL;
	const betterAuthCookie = request.headers.get("x-better-auth-cookie");
	if (!betterAuthCookie || !convexSiteUrl) {
		return Response.json(
			{ ok: false, error: "Authentication required." },
			{ status: 401 },
		);
	}

	const tokenResp = await fetch(
		`${convexSiteUrl}/api/auth/convex/token`,
		{
			method: "GET",
			headers: { "Better-Auth-Cookie": betterAuthCookie },
			redirect: "manual",
		},
	);
	const tokenData = (await tokenResp.json()) as { token?: string };
	const authToken = tokenData?.token;
	if (!authToken) {
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

	const invoice = await getAuthenticatedInvoiceById(params.id, authToken);
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

	let pdfBytes: Uint8Array;
	try {
		pdfBytes = await renderInvoicePdf(invoice);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Failed to render invoice PDF.";
		await recordDeliveryFailure(authToken, {
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
				from: sanitizeFromAddress(getServerEnv("RESEND_FROM")),
				to,
				subject: `Invoice ${invoice.invoiceNumber}`,
				text: `Invoice ${invoice.invoiceNumber} for ${invoice.customerName} is attached as a PDF. You can also view it online: ${publicUrl}`,
				html: `
        <div style="font-family: Arial, sans-serif; color: #111; line-height: 1.5;">
          <h2 style="margin: 0 0 12px;">Invoice ${safeInvoiceNumber}</h2>
          <p style="margin: 0 0 12px;">Hi,</p>
          <p style="margin: 0 0 12px;">
            Your invoice for <strong>${safeCustomerName}</strong> is attached as a PDF.
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
		await recordDeliveryFailure(authToken, {
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

	await recordInvoiceDeliveryEvent(authToken, {
		invoiceId: invoice.id,
		recipient: to,
		status: "sent",
		providerMessageId: result.data?.id ?? undefined,
		publicUrl,
	}).catch((error: unknown) => {
		console.error("Failed to record invoice email delivery event", error);
	});

	getServerConvexClient()
		.action(api.payments.ensurePaystackTransferCharge, {
			token: invoice.token,
		})
		.catch((error: unknown) => {
			console.error("Failed to prepare Paystack transfer charge", error);
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
		console.error("Invoice email send failed", error);
		return Response.json(
			{
				ok: false,
				error: errorMessage(error, "Failed to send invoice email."),
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
