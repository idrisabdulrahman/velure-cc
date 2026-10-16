import { resolveActiveWorkspaceId, type Supabase } from "./workspaces";

export type RecurringScheduleInput = {
	name: string;
	frequency: "monthly" | "quarterly";
	interval: number;
	startDate: string;
	endDate?: string;
	autoSend: boolean;
	customerName: string;
	currency: string;
	paymentTermsDays: number;
	paymentDetails?: string;
	notes?: string;
	lineItems: Array<{
		id: string;
		name: string;
		quantity: number;
		price: number;
	}>;
};

export type RecurringSchedule = RecurringScheduleInput & {
	_id: string;
	status: "active" | "paused" | "ended";
	nextRunDate: string;
	generatedCount: number;
	lastGeneratedPeriod?: string;
};

function validate(input: RecurringScheduleInput) {
	if (!input.name.trim() || !input.customerName.trim())
		throw new Error("Name and customer are required.");
	if (
		!Number.isInteger(input.interval) ||
		input.interval < 1 ||
		input.interval > 12
	)
		throw new Error("Billing interval must be between 1 and 12.");
	if (
		!Number.isInteger(input.paymentTermsDays) ||
		input.paymentTermsDays < 0 ||
		input.paymentTermsDays > 365
	)
		throw new Error("Payment terms must be between 0 and 365 days.");
	if (!input.lineItems.length)
		throw new Error("At least one invoice line item is required.");
	if (input.endDate && input.endDate < input.startDate)
		throw new Error("End date cannot be before start date.");
}

function mapRow(row: any): RecurringSchedule {
	return {
		_id: row.id,
		name: row.name,
		status: row.status,
		frequency: row.frequency,
		interval: row.interval,
		startDate: row.start_date,
		nextRunDate: row.next_run_date,
		endDate: row.end_date ?? undefined,
		autoSend: row.auto_send,
		customerName: row.customer_name,
		currency: row.currency,
		paymentTermsDays: row.payment_terms_days,
		paymentDetails: row.payment_details ?? undefined,
		notes: row.notes ?? undefined,
		lineItems: row.line_items ?? [],
		generatedCount: row.generated_count ?? 0,
		lastGeneratedPeriod: row.last_generated_period ?? undefined,
	};
}

async function workspace(client: Supabase, userId: string) {
	const id = await resolveActiveWorkspaceId(client, userId);
	if (!id) throw new Error("Workspace not found.");
	return id;
}

export async function listSchedules(
	client: Supabase,
	userId: string,
	status = "all",
) {
	const workspaceId = await workspace(client, userId);
	let query = client
		.from("recurring_invoice_schedules")
		.select("*")
		.eq("workspace_id", workspaceId)
		.order("next_run_date");
	if (status !== "all") query = query.eq("status", status as any);
	const { data, error } = await query;
	if (error) throw error;
	return (data ?? []).map(mapRow);
}

export async function createSchedule(
	client: Supabase,
	userId: string,
	input: RecurringScheduleInput,
) {
	validate(input);
	const workspaceId = await workspace(client, userId);
	const { data, error } = await client
		.from("recurring_invoice_schedules")
		.insert({
			workspace_id: workspaceId,
			owner_id: userId,
			name: input.name.trim(),
			status: "active",
			frequency: input.frequency,
			interval: input.interval,
			start_date: input.startDate,
			next_run_date: input.startDate,
			end_date: input.endDate ?? null,
			auto_send: input.autoSend,
			customer_name: input.customerName.trim(),
			currency: input.currency.toUpperCase(),
			payment_terms_days: input.paymentTermsDays,
			payment_details: input.paymentDetails ?? null,
			notes: input.notes ?? null,
			template: "default",
			line_items: input.lineItems,
		})
		.select("id")
		.single();
	if (error) throw error;
	return data.id;
}

export async function updateSchedule(
	client: Supabase,
	userId: string,
	scheduleId: string,
	input: RecurringScheduleInput,
) {
	validate(input);
	const workspaceId = await workspace(client, userId);
	const { error } = await client
		.from("recurring_invoice_schedules")
		.update({
			name: input.name.trim(),
			frequency: input.frequency,
			interval: input.interval,
			start_date: input.startDate,
			end_date: input.endDate ?? null,
			auto_send: input.autoSend,
			customer_name: input.customerName.trim(),
			currency: input.currency.toUpperCase(),
			payment_terms_days: input.paymentTermsDays,
			payment_details: input.paymentDetails ?? null,
			notes: input.notes ?? null,
			line_items: input.lineItems,
		})
		.eq("id", scheduleId)
		.eq("workspace_id", workspaceId);
	if (error) throw error;
	return { ok: true };
}

export async function deleteSchedule(
	client: Supabase,
	userId: string,
	scheduleId: string,
) {
	const workspaceId = await workspace(client, userId);
	const { data: row, error: readError } = await client
		.from("recurring_invoice_schedules")
		.select("generated_count")
		.eq("id", scheduleId)
		.eq("workspace_id", workspaceId)
		.single();
	if (readError) throw readError;
	if ((row.generated_count ?? 0) > 0) {
		const { error } = await client
			.from("recurring_invoice_schedules")
			.update({ status: "ended" })
			.eq("id", scheduleId)
			.eq("workspace_id", workspaceId);
		if (error) throw error;
		return { ok: true, deleted: false, ended: true };
	}
	const { error } = await client
		.from("recurring_invoice_schedules")
		.delete()
		.eq("id", scheduleId)
		.eq("workspace_id", workspaceId);
	if (error) throw error;
	return { ok: true, deleted: true, ended: false };
}

export async function setScheduleStatus(
	client: Supabase,
	userId: string,
	scheduleId: string,
	status: "active" | "paused" | "ended",
) {
	const workspaceId = await workspace(client, userId);
	const { error } = await client
		.from("recurring_invoice_schedules")
		.update({ status })
		.eq("id", scheduleId)
		.eq("workspace_id", workspaceId);
	if (error) throw error;
	return { ok: true };
}
