import { Resend } from "resend";
import { getServerEnv } from "../env";
import { getById as getInvoiceById } from "./invoices";
import { resolveActiveWorkspaceId, type Supabase } from "./workspaces";

const RESEND_FREE_TIER_DAILY_LIMIT = 100;

/**
 * A10 — reminders domain, ported to Supabase.
 *
 * RLS-pure: every function takes a USER-scoped Supabase client (the one
 * holding the OIDC-minted JWT) and never sends a user id for authorization.
 * RLS decides. Reminder tables are owner-scoped (owner_id = current user);
 * invoices resolve through workspace membership.
 *
 * Port of convex/reminders.ts (the UI-facing surface):
 * getReminderSettings, saveReminderSettings, getCollectionOverview,
 * getInvoiceTimeline, pauseInvoiceReminders, resumeInvoiceReminders,
 * markManualException, queueReminderEvent, markReminderEventStatus.
 * Return shapes match the Convex surface so call sites compile unchanged.
 *
 * Daily batch scans and queued email delivery are also RLS-scoped here;
 * Slack dispatch and cron bookkeeping remain separate infrastructure work.
 */

export type ReminderStage =
	| "none"
	| "before_due"
	| "due_date"
	| "overdue_1"
	| "overdue_2"
	| "overdue_3"
	| "escalated";

export type ReminderChannel = "email" | "slack" | "internal";

export type ReminderEventStatus = "queued" | "sent" | "skipped" | "failed";

export type ReminderRule = {
	_id: string;
	ownerId: string;
	enabled: boolean;
	daysBeforeDue: number;
	onDueDate: boolean;
	overdueCadenceDays: number;
	maxOverdueReminders: number;
	escalateAfterCount: number;
	businessSignature?: string;
	createdAt: number;
	updatedAt: number;
};

export type ReminderEvent = {
	_id: string;
	ownerId: string;
	invoiceId: string;
	stage: ReminderStage;
	channel: ReminderChannel;
	scheduledFor: number;
	sentAt?: number;
	status: ReminderEventStatus;
	error?: string;
	meta?: string;
	createdAt: number;
	updatedAt: number;
};

export type CollectionCase = {
	_id: string;
	ownerId: string;
	invoiceId: string;
	status: "open" | "paused" | "resolved" | "manual_exception";
	lastActionAt: number;
	note?: string;
	escalationStatus: "idle" | "manual_review";
	createdAt: number;
	updatedAt: number;
};

export function defaultRule(ownerId: string): Omit<ReminderRule, "_id"> {
	const now = Date.now();
	return {
		ownerId,
		enabled: true,
		daysBeforeDue: 3,
		onDueDate: true,
		overdueCadenceDays: 3,
		maxOverdueReminders: 3,
		escalateAfterCount: 3,
		businessSignature: "Velure Finance Team",
		createdAt: now,
		updatedAt: now,
	};
}

function assertValidReminderRule(rule: {
	daysBeforeDue: number;
	overdueCadenceDays: number;
	maxOverdueReminders: number;
	escalateAfterCount: number;
	businessSignature?: string;
}) {
	if (!Number.isInteger(rule.daysBeforeDue) || rule.daysBeforeDue < 0) {
		throw new Error("First reminder must be 0 or more days before due.");
	}
	if (
		!Number.isInteger(rule.overdueCadenceDays) ||
		rule.overdueCadenceDays < 1
	) {
		throw new Error("Overdue gap must be at least 1 day.");
	}
	if (
		!Number.isInteger(rule.maxOverdueReminders) ||
		rule.maxOverdueReminders < 0 ||
		rule.maxOverdueReminders > 3
	) {
		throw new Error("Overdue email limit must be between 0 and 3.");
	}
	if (
		!Number.isInteger(rule.escalateAfterCount) ||
		rule.escalateAfterCount < 0 ||
		rule.escalateAfterCount > rule.maxOverdueReminders
	) {
		throw new Error("Review threshold must be between 0 and the email limit.");
	}
	if ((rule.businessSignature?.trim().length ?? 0) > 80) {
		throw new Error("Reminder email signature must be 80 characters or less.");
	}
}

function epoch(value?: string | null): number | undefined {
	if (!value) return undefined;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? undefined : ms;
}

function iso(value: number): string {
	return new Date(value).toISOString();
}

type ReminderRuleRow = {
	id: string;
	owner_id: string;
	enabled: boolean;
	days_before_due: number;
	on_due_date: boolean;
	overdue_cadence_days: number;
	max_overdue_reminders: number;
	escalate_after_count: number;
	business_signature: string | null;
	created_at: string;
	updated_at: string;
};

function toReminderRule(row: ReminderRuleRow): ReminderRule {
	return {
		_id: row.id,
		ownerId: row.owner_id,
		enabled: row.enabled,
		daysBeforeDue: row.days_before_due,
		onDueDate: row.on_due_date,
		overdueCadenceDays: row.overdue_cadence_days,
		maxOverdueReminders: row.max_overdue_reminders,
		escalateAfterCount: row.escalate_after_count,
		businessSignature: row.business_signature ?? undefined,
		createdAt: epoch(row.created_at) ?? 0,
		updatedAt: epoch(row.updated_at) ?? 0,
	};
}

type ReminderEventRow = {
	id: string;
	owner_id: string;
	invoice_id: string;
	stage: ReminderStage;
	channel: ReminderChannel;
	scheduled_for: string;
	sent_at: string | null;
	status: ReminderEventStatus;
	error: string | null;
	meta: unknown;
	created_at: string;
	updated_at: string;
};

function toReminderEvent(row: ReminderEventRow): ReminderEvent {
	return {
		_id: row.id,
		ownerId: row.owner_id,
		invoiceId: row.invoice_id,
		stage: row.stage,
		channel: row.channel,
		scheduledFor: epoch(row.scheduled_for) ?? 0,
		sentAt: epoch(row.sent_at),
		status: row.status,
		error: row.error ?? undefined,
		meta:
			typeof row.meta === "string"
				? (row.meta as string)
				: row.meta !== null
					? JSON.stringify(row.meta)
					: undefined,
		createdAt: epoch(row.created_at) ?? 0,
		updatedAt: epoch(row.updated_at) ?? 0,
	};
}

function buyerEmailForInvoice(invoice: { compliance?: unknown }) {
	const compliance = (invoice.compliance ?? {}) as {
		buyer?: { email?: string };
	};
	return compliance.buyer?.email?.trim().toLowerCase() ?? "";
}

function isReminderInvoiceOverdue(invoice: {
	status?: string;
	dueDate?: string;
}) {
	if (invoice.status === "paid" || invoice.status === "canceled") return false;
	const dueDate = new Date(`${invoice.dueDate}T00:00:00`);
	if (Number.isNaN(dueDate.getTime())) return invoice.status === "overdue";
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	return invoice.status === "overdue" || dueDate < today;
}

function isInReminderWindow(
	invoice: {
		status?: string;
		dueDate?: string;
		reminder?: { paused?: boolean };
		lifecycle?: { sentAt?: number };
	},
	daysBeforeDue: number,
) {
	if (invoice.status === "paid" || invoice.status === "canceled") return false;
	if (invoice.reminder?.paused) return false;
	if (!invoice.lifecycle?.sentAt) return false;
	const dueDate = new Date(`${invoice.dueDate}T00:00:00`);
	if (Number.isNaN(dueDate.getTime())) return false;
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const daysUntilDue = Math.ceil(
		(dueDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
	);
	return daysUntilDue <= daysBeforeDue;
}

async function currentRule(client: Supabase) {
	const { data, error } = await client
		.from("reminder_rules")
		.select("*")
		.limit(1)
		.maybeSingle();
	if (error) throw error;
	if (!data) return null;
	return toReminderRule(data as unknown as ReminderRuleRow);
}

export async function getReminderSettings(
	client: Supabase,
	userId: string,
): Promise<ReminderRule> {
	const rule = await currentRule(client);
	if (rule) return rule;
	return { ...defaultRule(userId), _id: "" };
}
export async function saveReminderSettings(
	client: Supabase,
	userId: string,
	args: {
		enabled: boolean;
		daysBeforeDue: number;
		onDueDate: boolean;
		overdueCadenceDays: number;
		maxOverdueReminders: number;
		escalateAfterCount: number;
		businessSignature?: string;
	},
): Promise<string> {
	assertValidReminderRule(args);
	const now = Date.now();
	const existing = await currentRule(client);

	if (existing) {
		const { error } = await client
			.from("reminder_rules")
			.update({
				enabled: args.enabled,
				days_before_due: args.daysBeforeDue,
				on_due_date: args.onDueDate,
				overdue_cadence_days: args.overdueCadenceDays,
				max_overdue_reminders: args.maxOverdueReminders,
				escalate_after_count: args.escalateAfterCount,
				business_signature: args.businessSignature ?? null,
				updated_at: iso(now),
			})
			.eq("id", existing._id);
		if (error) throw error;
		return existing._id;
	}

	const { data, error } = await client
		.from("reminder_rules")
		.insert({
			owner_id: userId,
			enabled: args.enabled,
			days_before_due: args.daysBeforeDue,
			on_due_date: args.onDueDate,
			overdue_cadence_days: args.overdueCadenceDays,
			max_overdue_reminders: args.maxOverdueReminders,
			escalate_after_count: args.escalateAfterCount,
			business_signature: args.businessSignature ?? null,
			created_at: iso(now),
			updated_at: iso(now),
		})
		.select("id")
		.single();
	if (error) throw error;
	return data.id;
}

export async function getCollectionOverview(
	client: Supabase,
	userId: string,
	args: { daysBeforeDue?: number; limit?: number } = {},
) {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) {
		return {
			stats: {
				actionableCount: 0,
				overdueCount: 0,
				missingEmailCount: 0,
				pausedOrManualCount: 0,
			},
			invoices: [],
		};
	}

	const daysBeforeDue = Math.max(0, Math.floor(args.daysBeforeDue ?? 3));
	const limit = Math.min(Math.max(Math.floor(args.limit ?? 100), 10), 200);

	const { data, error } = await client
		.from("invoices")
		.select(
			"id, invoice_number, customer_name, due_date, status, reminder, lifecycle, compliance, workspace_id",
		)
		.eq("workspace_id", workspaceId)
		.order("created_at", { ascending: false });
	if (error) throw error;

	const stats = {
		actionableCount: 0,
		overdueCount: 0,
		missingEmailCount: 0,
		pausedOrManualCount: 0,
	};
	const activeInvoices: Array<{
		id: string;
		invoiceNumber: string;
		customerName: string;
		dueDate: string | null;
		status: string;
		reminder: unknown;
		lifecycle: unknown;
		compliance: unknown;
	}> = [];

	for (const row of data ?? []) {
		const invoice = {
			status: row.status,
			dueDate: row.due_date,
			reminder: (row.reminder ?? undefined) as
				| { paused?: boolean; escalationStatus?: string }
				| undefined,
			lifecycle: (row.lifecycle ?? undefined) as
				| { sentAt?: number }
				| undefined,
			compliance: row.compliance ?? undefined,
		};
		const isActiveInvoice =
			invoice.status !== "paid" && invoice.status !== "canceled";
		const missingBuyerEmail = isActiveInvoice && !buyerEmailForInvoice(invoice);
		const pausedOrManual =
			invoice.reminder?.paused ||
			invoice.reminder?.escalationStatus === "manual_review";

		if (isReminderInvoiceOverdue(invoice)) stats.overdueCount += 1;
		if (missingBuyerEmail) stats.missingEmailCount += 1;
		if (pausedOrManual) stats.pausedOrManualCount += 1;
		if (
			isInReminderWindow(invoice, daysBeforeDue) &&
			!missingBuyerEmail &&
			!pausedOrManual
		) {
			stats.actionableCount += 1;
		}

		if (isActiveInvoice && activeInvoices.length < limit) {
			activeInvoices.push({
				id: row.id,
				invoiceNumber: row.invoice_number,
				customerName: row.customer_name,
				dueDate: row.due_date,
				status: row.status,
				reminder: row.reminder,
				lifecycle: row.lifecycle,
				compliance: row.compliance,
			});
		}
	}

	return { stats, invoices: activeInvoices };
}

export async function getInvoiceTimeline(
	client: Supabase,
	userId: string,
	invoiceId: string,
): Promise<ReminderEvent[]> {
	const invoice = await getInvoiceById(client, userId, invoiceId);
	if (!invoice) throw new Error("Invoice not found.");

	const { data, error } = await client
		.from("reminder_events")
		.select("*")
		.eq("invoice_id", invoiceId)
		.order("created_at", { ascending: false });
	if (error) throw error;
	return (data ?? []).map((row) =>
		toReminderEvent(row as unknown as ReminderEventRow),
	);
}

async function upsertCollectionCase(
	client: Supabase,
	userId: string,
	invoiceId: string,
	patch: {
		status: CollectionCase["status"];
		note?: string;
		escalationStatus: "idle" | "manual_review";
	},
	now: number,
) {
	const { data: existing } = await client
		.from("collections_cases")
		.select("id")
		.eq("invoice_id", invoiceId)
		.maybeSingle();

	if (existing) {
		const { error } = await client
			.from("collections_cases")
			.update({
				status: patch.status,
				note: patch.note ?? null,
				escalation_status: patch.escalationStatus,
				last_action_at: iso(now),
				updated_at: iso(now),
			})
			.eq("id", existing.id);
		if (error) throw error;
	} else {
		const { error } = await client.from("collections_cases").insert({
			owner_id: userId,
			invoice_id: invoiceId,
			status: patch.status,
			note: patch.note ?? null,
			escalation_status: patch.escalationStatus,
			last_action_at: iso(now),
			created_at: iso(now),
			updated_at: iso(now),
		});
		if (error) throw error;
	}
}

async function insertInternalEvent(
	client: Supabase,
	userId: string,
	invoiceId: string,
	meta: string,
	now: number,
) {
	const { error } = await client.from("reminder_events").insert({
		owner_id: userId,
		invoice_id: invoiceId,
		stage: "none",
		channel: "internal",
		scheduled_for: iso(now),
		sent_at: iso(now),
		status: "sent",
		meta,
		created_at: iso(now),
		updated_at: iso(now),
	});
	if (error) throw error;
}

async function patchInvoiceReminder(
	client: Supabase,
	invoiceId: string,
	reminder: Record<string, unknown>,
	now: number,
) {
	const { error } = await client
		.from("invoices")
		.update({ reminder: reminder as never, updated_at: iso(now) })
		.eq("id", invoiceId);
	if (error) throw error;
}

export async function pauseInvoiceReminders(
	client: Supabase,
	userId: string,
	args: { invoiceId: string; note?: string },
): Promise<{ ok: true }> {
	const invoice = await getInvoiceById(client, userId, args.invoiceId);
	if (!invoice) throw new Error("Invoice not found.");

	const now = Date.now();
	const baseReminder = (invoice.reminder as Record<string, unknown> | null) ?? {
		enabled: true,
		paused: false,
		stage: "none",
		escalationStatus: "idle",
	};
	await patchInvoiceReminder(
		client,
		args.invoiceId,
		{ ...baseReminder, paused: true },
		now,
	);
	await upsertCollectionCase(
		client,
		userId,
		args.invoiceId,
		{ status: "paused", note: args.note, escalationStatus: "idle" },
		now,
	);
	await insertInternalEvent(
		client,
		userId,
		args.invoiceId,
		"Paused reminder workflow",
		now,
	);
	return { ok: true };
}

export async function resumeInvoiceReminders(
	client: Supabase,
	userId: string,
	args: { invoiceId: string },
): Promise<{ ok: true }> {
	const invoice = await getInvoiceById(client, userId, args.invoiceId);
	if (!invoice) throw new Error("Invoice not found.");

	const now = Date.now();
	const baseReminder = (invoice.reminder as Record<string, unknown> | null) ?? {
		enabled: true,
		paused: false,
		stage: "none",
		escalationStatus: "idle",
	};
	await patchInvoiceReminder(
		client,
		args.invoiceId,
		{ ...baseReminder, paused: false },
		now,
	);
	const { data: caseRow } = await client
		.from("collections_cases")
		.select("id")
		.eq("invoice_id", args.invoiceId)
		.maybeSingle();
	if (caseRow) {
		const { error } = await client
			.from("collections_cases")
			.update({
				status: "open",
				last_action_at: iso(now),
				updated_at: iso(now),
			})
			.eq("id", caseRow.id);
		if (error) throw error;
	}
	await insertInternalEvent(
		client,
		userId,
		args.invoiceId,
		"Resumed reminder workflow",
		now,
	);
	return { ok: true };
}

export async function markManualException(
	client: Supabase,
	userId: string,
	args: { invoiceId: string; note: string },
): Promise<{ ok: true }> {
	const invoice = await getInvoiceById(client, userId, args.invoiceId);
	if (!invoice) throw new Error("Invoice not found.");

	const now = Date.now();
	await upsertCollectionCase(
		client,
		userId,
		args.invoiceId,
		{
			status: "manual_exception",
			note: args.note,
			escalationStatus: "manual_review",
		},
		now,
	);
	return { ok: true };
}

export async function queueReminderEvent(
	client: Supabase,
	userId: string,
	args: {
		invoiceId: string;
		stage: ReminderStage;
		channel: ReminderChannel;
		meta?: string;
	},
): Promise<{ skipped?: boolean; reason?: string; eventId?: string }> {
	const invoice = await getInvoiceById(client, userId, args.invoiceId);
	if (!invoice) throw new Error("Invoice not found.");

	if (args.channel === "email") {
		if (invoice.status === "paid" || invoice.status === "canceled") {
			return { skipped: true, reason: "Invoice is already closed." };
		}
		if ((invoice.reminder as { paused?: boolean } | null)?.paused) {
			return { skipped: true, reason: "Invoice reminders are paused." };
		}
		if (!buyerEmailForInvoice(invoice)) {
			return { skipped: true, reason: "Buyer email is missing." };
		}
	}

	const { data: existing, error: listError } = await client
		.from("reminder_events")
		.select("stage, channel, status")
		.eq("invoice_id", args.invoiceId);
	if (listError) throw listError;
	if (
		(existing ?? []).some(
			(e) =>
				e.stage === args.stage &&
				e.channel === args.channel &&
				e.status !== "failed",
		)
	) {
		return { skipped: true };
	}

	const now = Date.now();
	const { data: inserted, error: insertError } = await client
		.from("reminder_events")
		.insert({
			owner_id: userId,
			invoice_id: args.invoiceId,
			stage: args.stage,
			channel: args.channel,
			scheduled_for: iso(now),
			status: "queued",
			meta: args.meta ?? null,
			created_at: iso(now),
			updated_at: iso(now),
		})
		.select("id")
		.single();
	if (insertError) throw insertError;

	const baseReminder = (invoice.reminder as Record<string, unknown> | null) ?? {
		enabled: true,
		paused: false,
		stage: "none",
		escalationStatus: "idle",
	};
	await patchInvoiceReminder(
		client,
		args.invoiceId,
		{
			...baseReminder,
			stage: args.stage,
			escalationStatus:
				args.stage === "escalated"
					? "manual_review"
					: (baseReminder.escalationStatus ?? "idle"),
			lastReminderAt: now,
		},
		now,
	);

	return { eventId: inserted.id };
}

export async function markReminderEventStatus(
	client: Supabase,
	args: { eventId: string; status: ReminderEventStatus; error?: string },
): Promise<{ ok: true }> {
	const { data: event, error: fetchError } = await client
		.from("reminder_events")
		.select("*")
		.eq("id", args.eventId)
		.maybeSingle();
	if (fetchError) throw fetchError;
	if (!event) throw new Error("Reminder event not found.");

	const now = Date.now();
	const { error } = await client
		.from("reminder_events")
		.update({
			status: args.status,
			error: args.error ?? null,
			sent_at: args.status === "sent" ? iso(now) : event.sent_at,
			updated_at: iso(now),
		})
		.eq("id", args.eventId);
	if (error) throw error;
	return { ok: true };
}

export async function runReminderBatch(
	client: Supabase,
	userId: string,
	args: { date?: string } = {},
) {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	const today = args.date ?? new Date().toISOString().slice(0, 10);
	if (!workspaceId)
		return { date: today, scannedCount: 0, queuedCount: 0, escalatedCount: 0 };
	const rule = (await currentRule(client)) ?? defaultRule(userId);
	const { data, error } = await client
		.from("invoices")
		.select("id, status, due_date, reminder, lifecycle, compliance")
		.eq("workspace_id", workspaceId);
	if (error) throw error;
	let queuedCount = 0;
	const escalatedCount = 0;
	for (const row of data ?? []) {
		const invoice = {
			id: row.id,
			status: row.status,
			dueDate: row.due_date ?? "",
			reminder: row.reminder as { paused?: boolean } | null,
			lifecycle: row.lifecycle as { sentAt?: number } | null,
			compliance: row.compliance,
		};
		if (
			!rule.enabled ||
			invoice.reminder?.paused ||
			invoice.status === "paid" ||
			invoice.status === "canceled" ||
			!invoice.lifecycle?.sentAt ||
			!buyerEmailForInvoice(invoice)
		)
			continue;
		const dueAt = Date.parse(`${invoice.dueDate}T00:00:00Z`);
		const diffDays = Math.floor(
			(dueAt - Date.parse(`${today}T00:00:00Z`)) / 86400000,
		);
		const stage: ReminderStage =
			diffDays === rule.daysBeforeDue
				? "before_due"
				: diffDays === 0 && rule.onDueDate
					? "due_date"
					: diffDays <= -rule.overdueCadenceDays * 3
						? "overdue_3"
						: diffDays <= -rule.overdueCadenceDays * 2
							? "overdue_2"
							: diffDays <= -rule.overdueCadenceDays
								? "overdue_1"
								: "none";
		if (stage === "none") continue;
		const result = await queueReminderEvent(client, userId, {
			invoiceId: invoice.id,
			stage,
			channel: "email",
		});
		if (result.eventId) queuedCount++;
	}
	return {
		date: today,
		scannedCount: data?.length ?? 0,
		queuedCount,
		escalatedCount,
	};
}

export async function sendQueuedEmails(client: Supabase, userId: string) {
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
	const today = new Date();
	today.setUTCHours(0, 0, 0, 0);
	const { count: sentToday, error: countError } = await client
		.from("reminder_events")
		.select("id", { count: "exact", head: true })
		.eq("owner_id", userId)
		.eq("channel", "email")
		.eq("status", "sent")
		.gte("sent_at", today.toISOString());
	if (countError) throw countError;
	const remainingCapacity = Math.max(
		0,
		RESEND_FREE_TIER_DAILY_LIMIT - (sentToday ?? 0),
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
					: "Resend free-tier daily limit reached.",
			});
			continue;
		}
		const result = await resend.emails.send({
			from:
				getServerEnv("RESEND_FROM_EMAIL") ?? "Velure <onboarding@resend.dev>",
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
