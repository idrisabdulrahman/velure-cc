import { createFileRoute } from "@tanstack/react-router";
import { safeErrorDetails } from "#/server/http-security";
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

function escapeHtml(value: string) {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function retryToken(params: { id: string }) {
	try {
		return decodeURIComponent(params.id);
	} catch {
		return params.id;
	}
}

/**
 * A rendering failure must never be papered over with a different document
 * (the old plain-text writer did exactly that). Instead the customer gets a
 * clear, retryable error: nothing is downloaded, and the same URL is offered
 * again. The invoice itself is untouched.
 */
function renderErrorResponse(params: { id: string }) {
	const retryHref = `/api/invoice/download/${encodeURIComponent(retryToken(params))}`;
	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Could not prepare the PDF</title>
</head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f5f6f8;color:#111319;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;padding:24px;">
<main style="max-width:420px;text-align:center;background:#ffffff;border:1px solid #D7DCE6;border-radius:14px;padding:28px 24px;">
<h1 style="margin:0 0 8px;font-size:18px;">Could not prepare the PDF</h1>
<p style="margin:0 0 20px;font-size:14px;color:#817d72;line-height:1.5;">Something went wrong while building this invoice's PDF. The invoice is safe — please try again.</p>
<a href="${escapeHtml(retryHref)}" style="display:inline-block;background:#111319;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:9px;">Try again</a>
</main>
</body>
</html>`;

	return new Response(html, {
		status: 503,
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			"Cache-Control": "no-store",
		},
	});
}

export async function handle({ params }: { params: { id: string } }) {
	let invoiceId: string | undefined;
	try {
		const token = decodeURIComponent(params.id);
		const invoice = await getInvoiceByToken(token);

		if (!invoice) {
			return new Response("Invoice not found", { status: 404 });
		}
		invoiceId = invoice.id;

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
			invoiceId,
			...safeErrorDetails(error),
		});
		return renderErrorResponse(params);
	}
}

export const Route = createFileRoute("/api/invoice/download/$id")({
	server: {
		handlers: {
			GET: handle,
		},
	},
});
