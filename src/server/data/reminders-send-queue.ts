import { Resend } from "resend";
import { getServerEnv } from "../env";
import { getSupabaseAdminClient } from "../supabase";
import { getById as getInvoiceById } from "./invoices";
import { buyerEmailForInvoice, markReminderEventStatus } from "./reminders";
import { resolveActiveWorkspaceId, type Supabase } from "./workspaces";

/**
 * Server-only reminder email delivery.
 *
 * This module is the ONE place that spends the shared Resend account quota, so
 * it is kept out of every browser-reachable module (it imports the service-role
 * client and the Resend SDK). `src/server/data/reminders.ts` stays browser-safe
 * for the settings/collections UI; the queued drain is reached only from the
 * server API route (`src/routes/api/reminders/send-queue.ts`) and the scheduler
 * sweep (`src/server/reminder-sweep.ts`). See `audit-browser-boundary.test.ts`.
 *
 * The public signature stays `(client, userId)`: `client` is the caller's
 * session-scoped client (tenancy for the queued-event listing, the invoice
 * reads and every status write) and `userId` is the verified owner. An optional
 * third `options` is a test seam only.
 */

const RESEND_FREE_TIER_DAILY_LIMIT = 100;

/**
 * Count today's sent reminder EMAILS across **every** owner.
 *
 * Resend's free tier is 100 emails/day for the whole platform, not per
 * workspace, so a per-owner count lets each workspace believe it owns all 100
 * and the shared account can be pushed past the real cap. This reads
 * cross-tenant on the service-role client deliberately (AGENTS.md §8:
 * server-only, justified and logged): it is a `head: true` count of a single
 * column for rows a platform-shared service already sent, no row data escapes
 * the query, and no tenant identifier is ever taken from the request. The
 * `channel = "email"` filter keeps internal audit events out of the quota,
 * mirroring Resend's own accounting (only email sends consume quota).
 */
async function countAccountEmailsSentToday(
	client: Supabase,
	now: Date,
): Promise<number> {
	const startOfUtcDay = new Date(now);
	startOfUtcDay.setUTCHours(0, 0, 0, 0);
	const { count, error } = await client
		.from("reminder_events")
		.select("id", { count: "exact", head: true })
		.eq("channel", "email")
		.eq("status", "sent")
		.gte("sent_at", startOfUtcDay.toISOString());
	if (error) throw error;
	return count ?? 0;
}

/**
 * An account-capable client for the shared-quota count, falling back to the
 * caller's client when the service-role key is absent (local/dev/tests), where
 * the caller's own client is the only one available. Never used for tenancy.
 */
function accountQuotaClient(fallback: Supabase): Supabase {
	try {
		return getSupabaseAdminClient() as unknown as Supabase;
	} catch {
		return fallback;
	}
}

export async function sendQueuedEmails(
	client: Supabase,
	userId: string,
	options: { quotaClient?: Supabase; now?: Date } = {},
) {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId)
		return { sent: 0, skipped: 0, reason: "No active workspace." };
	const { data: events, error } = await client
		.from("reminder_events")
		.select("*")
		.eq("owner_id", userId)
		.eq("channel", "email")
		.eq("status", "queued")
		.order("created_at");
	if (error) throw error;
	const resendKey = getServerEnv("RESEND_API_KEY");
	if (!resendKey)
		return {
			sent: 0,
			skipped: events?.length ?? 0,
			reason: "RESEND_API_KEY missing",
		};
	const resend = new Resend(resendKey);
	// The daily cap is per shared Resend account, so the count spans every
	// owner and runs on an account-capable client. The queued-event listing
	// above and every write below stay on the caller's client — tenancy for
	// reads/writes is unchanged.
	const quotaClient = options.quotaClient ?? accountQuotaClient(client);
	const sentToday = await countAccountEmailsSentToday(
		quotaClient,
		options.now ?? new Date(),
	);
	const remainingCapacity = Math.max(
		0,
		RESEND_FREE_TIER_DAILY_LIMIT - sentToday,
	);
	let sent = 0;
	let skipped = 0;
	for (const event of events ?? []) {
		const invoice = await getInvoiceById(client, userId, event.invoice_id);
		const recipient = invoice ? buyerEmailForInvoice(invoice) : "";
		if (!invoice || !recipient || sent >= remainingCapacity) {
			skipped++;
			await markReminderEventStatus(client, {
				eventId: event.id,
				status: "failed",
				error: !recipient
					? "Buyer email is missing on this invoice."
					: "Daily email sending limit reached for the account; this reminder will send after 00:00 UTC.",
			});
			continue;
		}
		const result = await resend.emails.send({
			from:
				getServerEnv("RESEND_FROM_EMAIL") ?? "Invoicly <onboarding@resend.dev>",
			to: recipient,
			subject: `Reminder: ${invoice.invoiceNumber}`,
			text: `Invoice ${invoice.invoiceNumber} for ${invoice.customerName} is currently ${invoice.status}. View it here: ${getServerEnv("SITE_URL") ?? ""}/i/${invoice.token}`,
		});
		await markReminderEventStatus(client, {
			eventId: event.id,
			status: result.error ? "failed" : "sent",
			error: result.error?.message,
		});
		if (result.error) skipped++;
		else sent++;
	}
	return { sent, skipped };
}
