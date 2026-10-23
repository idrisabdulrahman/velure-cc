import { Resend } from "resend";
import { recordInvoiceAudit } from "./data/audit";
import { mapInvoice, rowToInvoiceDoc } from "./data/invoices";
import { getServerEnv } from "./env";
import { renderInvoicePdf } from "./pdf";
import { getSupabaseAdminClient } from "./supabase";

function escapeHtml(value: string) {
	return value.replace(
		/[&<>"']/g,
		(char) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				char
			] ?? char,
	);
}

export async function sendInvoiceWithResend(
	invoice: ReturnType<typeof mapInvoice>,
	to: string,
	source: "invoice_share" | "scheduled",
) {
	const key = getServerEnv("RESEND_API_KEY");
	if (!key) throw new Error("RESEND_API_KEY is missing on the server.");
	const publicUrl = `${getServerEnv("SITE_URL") ?? ""}/i/${invoice.token}`;
	const proforma = invoice.documentType === "proforma";
	const label = proforma ? "pro-forma invoice" : "invoice";
	const number = escapeHtml(invoice.invoiceNumber);
	const customer = escapeHtml(invoice.customerName);
	const pdf = await renderInvoicePdf(invoice as never);
	const result = await new Resend(key).emails.send({
		from: getServerEnv("RESEND_FROM_EMAIL") ?? "Velure <onboarding@resend.dev>",
		to,
		subject: `${proforma ? "Pro-forma" : "Invoice"} ${invoice.invoiceNumber}`,
		text: `Your ${label} ${invoice.invoiceNumber} for ${invoice.customerName} is attached as a PDF. View it online: ${publicUrl}`,
		html: `<div style="font-family:Arial,sans-serif;color:#111;line-height:1.5"><h2>${proforma ? "Pro-forma invoice" : "Invoice"} ${number}</h2><p>Hello,</p><p>Your ${label} for <strong>${customer}</strong> is attached.</p><p><a href="${escapeHtml(publicUrl)}">View ${label}</a></p></div>`,
		attachments: [
			{
				filename: `${invoice.invoiceNumber}.pdf`,
				content: Buffer.from(pdf),
				contentType: "application/pdf",
			},
		],
		tags: [
			{ name: "source", value: source },
			{ name: "invoice_id", value: invoice.id },
		],
	});
	if (result.error) throw result.error;
	return result.data?.id ?? null;
}

export async function dispatchScheduledInvoiceEmails(now = new Date()) {
	const client = getSupabaseAdminClient();
	const { data, error } = await client
		.from("invoices")
		.select("*")
		.eq("status", "scheduled")
		.lte("scheduled_at", now.toISOString())
		.is("deleted_at", null)
		.is("canceled_at", null)
		.limit(50);
	if (error) throw error;
	let sent = 0;
	for (const row of data ?? []) {
		const invoice = mapInvoice(rowToInvoiceDoc(row as never));
		const to = (
			invoice.compliance?.buyer as { email?: string } | undefined
		)?.email?.trim();
		if (!to || !invoice.scheduleVersion || !row.user_id) continue;
		const leaseVersion = crypto.randomUUID();
		const leaseUntil = new Date(now.getTime() + 5 * 60_000).toISOString();
		const { data: claimed } = await client
			.from("invoices")
			.update({ schedule_version: leaseVersion, scheduled_at: leaseUntil })
			.eq("id", invoice.id)
			.eq("schedule_version", invoice.scheduleVersion)
			.lte("scheduled_at", now.toISOString())
			.select("id")
			.maybeSingle();
		if (!claimed) continue;
		try {
			const providerMessageId = await sendInvoiceWithResend(
				invoice,
				to,
				"scheduled",
			);
			const timestamp = now.toISOString();
			await client
				.from("invoices")
				.update({
					status: "unpaid",
					scheduled_at: null,
					schedule_version: null,
					finalized_at: timestamp,
					delivered_at: timestamp,
					updated_at: timestamp,
					lifecycle: {
						...(invoice.lifecycle ?? {}),
						sentAt: now.getTime(),
						emailDeliveredAt: now.getTime(),
					},
				} as never)
				.eq("id", invoice.id)
				.eq("schedule_version", leaseVersion);
			await client.from("invoice_delivery_events").insert({
				workspace_id: String(row.workspace_id),
				owner_id: row.user_id,
				invoice_id: invoice.id,
				channel: "email",
				provider: "resend",
				provider_message_id: providerMessageId ?? "",
				recipient: to,
				status: "sent",
				sent_at: timestamp,
				public_url: `${getServerEnv("SITE_URL") ?? ""}/i/${invoice.token}`,
			} as never);
			// C3: the scheduled send is this invoice's first crossing into
			// issued (delivered_at + lifecycle.sentAt are set above), so it is
			// logged as an issuance through the ONE audit service. This is a
			// system job: the owner's active workspace may not match the row,
			// hence the server-only `workspaceId` option. Nested try/catch on
			// purpose — an audit failure must never fall into the reschedule
			// branch below, which would re-send an email that already went out.
			try {
				await recordInvoiceAudit(
					client,
					String(row.user_id),
					{
						action: "invoice.send",
						resourceId: invoice.id,
						actor: { type: "system", id: "invoice-mailer:scheduled" },
						before: { status: row.status, scheduledAt: row.scheduled_at },
						after: {
							status: "unpaid",
							deliveredAt: timestamp,
							providerMessageId: providerMessageId ?? null,
						},
						message: "Scheduled invoice email sent (system job).",
					},
					{ workspaceId: String(row.workspace_id) },
				);
			} catch {
				// The send itself succeeded; the DB triggers still refuse any
				// later mutation of this now-issued row, so losing only the
				// audit row is the least-bad outcome here.
			}
			sent++;
		} catch {
			await client
				.from("invoices")
				.update({ scheduled_at: now.toISOString() })
				.eq("id", invoice.id)
				.eq("schedule_version", leaseVersion);
		}
	}
	return { sent, scanned: data?.length ?? 0 };
}
