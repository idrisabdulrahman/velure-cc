import { recordInvoiceAudit } from "./data/audit";
import type { InvoiceAuditWriter } from "./data/audit-client";
import { autosaveDraft, type InvoiceInput } from "./data/invoices";
import type { Supabase } from "./data/workspaces";
import { formatErrorMessage } from "./error-message";
import { getSupabaseAdminClient } from "./supabase";

/**
 * T1 — recurring draft generation.
 *
 * Recurring schedules store a customer *name* but no customer id or email, so
 * an automatic generation cannot finalize, issue, or send anything: leaving
 * Draft requires a linked customer record (B2 gate, `customer-gate.ts`). The
 * generator therefore creates an ordinary *draft* through `autosaveDraft`
 * (which allocates the invoice number from the database), and the operator
 * completes the customer and issues it in the normal flow. `auto_send` is
 * deliberately not honoured yet — see `docs/DECISIONS.md`.
 *
 * Idempotency: one draft per `(schedule_id, period_key)`, where `period_key` is
 * the schedule's due `next_run_date`. The `recurring_invoice_runs` unique
 * constraint and a claim row make a re-run (a second tick, or a retry after a
 * crash) a no-op instead of a duplicate invoice.
 *
 * Tenancy: every write is scoped to `schedule.workspace_id` (never the owner's
 * *current* active workspace) and the audit row is written through the
 * server-only sink with that same workspace id, because the scheduler runs with
 * the service-role client where RLS is bypassed.
 */

export type RecurringGenerationSummary = {
	createdCount: number;
	skippedCount: number;
	failedCount: number;
	errors: string[];
};

export type RecurringGenerationOptions = Readonly<{
	/** Server client (service-role in production, a fake in tests). */
	admin?: Supabase;
	now?: Date;
	limit?: number;
	/** How long a failed period waits before it is retried. */
	retryAfterMs?: number;
	/** Test seam for the server-only audit sink. */
	writeAudit?: InvoiceAuditWriter;
}>;

const MAX_SCHEDULES_PER_TICK = 50;
const DEFAULT_RETRY_AFTER_MS = 60 * 60 * 1000;

type RecurringScheduleRow = {
	id: string;
	workspace_id: string;
	owner_id: string;
	status: "active" | "paused" | "ended";
	frequency: "monthly" | "quarterly";
	interval: number;
	start_date: string;
	next_run_date: string;
	end_date: string | null;
	auto_send: boolean;
	customer_name: string;
	logo_url: string | null;
	currency: string;
	invoice_size: "A4" | "LETTER" | null;
	date_format: "iso" | "us" | "ng" | null;
	payment_terms_days: number;
	template: string;
	payment_details: string | null;
	payment_link: string | null;
	payment_provider: "manual" | "paystack" | null;
	notes: string | null;
	line_items: Array<{
		id?: string;
		name?: string;
		quantity?: number;
		price?: number;
	}> | null;
	generated_count: number | null;
};

type RecurringRunRow = {
	id: string;
	status: "created" | "skipped" | "failed";
	updated_at: string;
};

function toIsoDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string): {
	year: number;
	month: number;
	day: number;
} {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) throw new Error(`Invalid date: ${value}`);
	return {
		year: Number(match[1]),
		month: Number(match[2]),
		day: Number(match[3]),
	};
}

/** Add calendar months, clamping the day to the target month's length. */
export function addCalendarMonths(isoDate: string, months: number): string {
	const { year, month, day } = parseIsoDate(isoDate);
	const target = new Date(Date.UTC(year, month - 1 + months, 1));
	const lastDay = new Date(
		Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
	).getUTCDate();
	target.setUTCDate(Math.min(day, lastDay));
	return toIsoDate(target);
}

export function addCalendarDays(isoDate: string, days: number): string {
	const { year, month, day } = parseIsoDate(isoDate);
	const target = new Date(Date.UTC(year, month - 1, day));
	target.setUTCDate(target.getUTCDate() + days);
	return toIsoDate(target);
}

/**
 * The next `next_run_date` after a period, preserving the schedule's cadence.
 * Quarterly is modelled as three monthly intervals, matching the schedule UI.
 */
export function advanceRecurringDate(
	isoDate: string,
	frequency: "monthly" | "quarterly",
	interval: number,
): string {
	const months = frequency === "quarterly" ? interval * 3 : interval;
	return addCalendarMonths(isoDate, months);
}

function iso(now: Date): string {
	return now.toISOString();
}

/**
 * Map a schedule row to the draft input. Only presentation data is copied; the
 * number, compliance snapshot and draft status are derived by `autosaveDraft`.
 */
export function buildRecurringInvoiceInput(
	schedule: RecurringScheduleRow,
	issueDate: string,
): InvoiceInput {
	const lineItems = (schedule.line_items ?? []).map((item, index) => ({
		id: item?.id?.trim() || `recurring-line-${index + 1}`,
		name: String(item?.name ?? ""),
		quantity: Number(item?.quantity ?? 0),
		price: Number(item?.price ?? 0),
	}));
	return {
		token: `pub-${crypto.randomUUID()}`,
		// Empty → the database allocator chooses the next number.
		invoiceNumber: "",
		customerName: schedule.customer_name,
		currency: schedule.currency,
		type: "recurring",
		invoiceSize: schedule.invoice_size ?? "A4",
		dateFormat: schedule.date_format ?? "ng",
		paymentTermsDays: schedule.payment_terms_days,
		template: schedule.template,
		logoUrl: schedule.logo_url ?? undefined,
		paymentDetails: schedule.payment_details ?? undefined,
		paymentLink: schedule.payment_link ?? undefined,
		paymentProvider: schedule.payment_provider ?? undefined,
		notes: schedule.notes ?? undefined,
		issueDate,
		dueDate: addCalendarDays(issueDate, schedule.payment_terms_days),
		lineItems,
	};
}

async function findRun(
	admin: Supabase,
	scheduleId: string,
	periodKey: string,
): Promise<RecurringRunRow | null> {
	const { data, error } = await admin
		.from("recurring_invoice_runs")
		.select("id, status, updated_at")
		.eq("schedule_id", scheduleId)
		.eq("period_key", periodKey)
		.maybeSingle();
	if (error) throw error;
	return (data as unknown as RecurringRunRow) ?? null;
}

async function generateOne(
	admin: Supabase,
	schedule: RecurringScheduleRow,
	periodKey: string,
	now: Date,
	retryAfterMs: number,
	writeAudit: InvoiceAuditWriter | undefined,
): Promise<"created" | "skipped"> {
	const existing = await findRun(admin, schedule.id, periodKey);
	if (existing?.status === "created") return "skipped";
	if (existing?.status === "failed") {
		const lastAttempt = Date.parse(existing.updated_at);
		if (
			Number.isFinite(lastAttempt) &&
			now.getTime() - lastAttempt < retryAfterMs
		) {
			return "skipped";
		}
	}
	if (existing) {
		// Reclaim a stale failed attempt for this period.
		const { error } = await admin
			.from("recurring_invoice_runs")
			.delete()
			.eq("id", existing.id);
		if (error) throw error;
	}

	// Claim the period BEFORE creating the draft. The unique
	// (schedule_id, period_key) constraint is the backstop if two ticks race.
	const claim = await admin
		.from("recurring_invoice_runs")
		.insert({
			workspace_id: schedule.workspace_id,
			schedule_id: schedule.id,
			period_key: periodKey,
			status: "failed",
			error: "Generation in progress.",
			created_at: iso(now),
			updated_at: iso(now),
		})
		.select("id")
		.single();
	if (claim.error) throw claim.error;
	const claimId = (claim.data as { id: string }).id;

	try {
		const draft = await autosaveDraft(
			admin,
			schedule.owner_id,
			buildRecurringInvoiceInput(schedule, periodKey),
			{
				workspaceId: schedule.workspace_id,
				writer:
					writeAudit ??
					((client, userId, entry) =>
						recordInvoiceAudit(client, userId, entry, {
							workspaceId: schedule.workspace_id,
						})),
			},
		);

		const completedAt = new Date();
		const { error: ledgerError } = await admin
			.from("recurring_invoice_runs")
			.update({
				status: "created",
				invoice_id: draft.id,
				error: null,
				updated_at: iso(completedAt),
			})
			.eq("id", claimId);
		if (ledgerError) throw ledgerError;

		const nextRunDate = advanceRecurringDate(
			periodKey,
			schedule.frequency,
			schedule.interval,
		);
		const ended = Boolean(schedule.end_date && nextRunDate > schedule.end_date);
		const { error: scheduleError } = await admin
			.from("recurring_invoice_schedules")
			.update({
				...(ended
					? { status: "ended" as const }
					: { next_run_date: nextRunDate }),
				generated_count: (schedule.generated_count ?? 0) + 1,
				last_generated_at: iso(completedAt),
				last_generated_invoice_id: draft.id,
				last_generated_period: periodKey,
				updated_at: iso(completedAt),
			})
			.eq("id", schedule.id)
			.eq("workspace_id", schedule.workspace_id);
		if (scheduleError) throw scheduleError;

		return "created";
	} catch (error) {
		await admin
			.from("recurring_invoice_runs")
			.update({
				status: "failed",
				error: formatErrorMessage(error).slice(0, 500),
				updated_at: iso(new Date()),
			})
			.eq("id", claimId);
		throw error;
	}
}

/**
 * Generate drafts for every active schedule whose `next_run_date` is due.
 * Errors are isolated per schedule: one bad row never stops the others.
 */
export async function runRecurringGeneration(
	options: RecurringGenerationOptions = {},
): Promise<RecurringGenerationSummary> {
	const admin =
		options.admin ?? (getSupabaseAdminClient() as unknown as Supabase);
	const now = options.now ?? new Date();
	const limit = Math.min(
		Math.max(Math.floor(options.limit ?? MAX_SCHEDULES_PER_TICK), 1),
		200,
	);
	const retryAfterMs = options.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS;
	const today = toIsoDate(now);

	const summary: RecurringGenerationSummary = {
		createdCount: 0,
		skippedCount: 0,
		failedCount: 0,
		errors: [],
	};

	const { data, error } = await admin
		.from("recurring_invoice_schedules")
		.select("*")
		.eq("status", "active")
		.lte("next_run_date", today)
		.order("next_run_date", { ascending: true })
		.limit(limit);
	if (error) throw error;

	for (const row of data ?? []) {
		const schedule = row as unknown as RecurringScheduleRow;
		const periodKey = schedule.next_run_date;
		try {
			const outcome = await generateOne(
				admin,
				schedule,
				periodKey,
				now,
				retryAfterMs,
				options.writeAudit,
			);
			if (outcome === "created") summary.createdCount += 1;
			else summary.skippedCount += 1;
		} catch (error) {
			summary.failedCount += 1;
			summary.errors.push(`${schedule.id}: ${formatErrorMessage(error)}`);
		}
	}

	return summary;
}
