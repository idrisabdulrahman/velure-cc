import type { CanonicalInvoice } from "#/features/einvoicing/canonical-invoice";
import {
	createMockProviderAdapter,
	type ProviderAdapter,
} from "#/features/einvoicing/provider-adapter";
import type { CanonicalInvoiceValidation } from "#/features/einvoicing/validate-canonical-invoice";
import { recordInvoiceAudit } from "#/server/data/audit";
import { loadWorkspaceInvoiceSubmissionSnapshot } from "#/server/data/einvoice-validation";
import { getSupabaseAdminClient } from "#/server/supabase";
import type { Json } from "#/types/database.types";
import type { Supabase } from "./workspaces";
import { getWorkspaceContext } from "./workspaces";

const MAX_ATTEMPTS = 5;
const LEASE_MS = 60_000;
const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 30 * 60_000;
const MOCK_PROVIDER: ProviderAdapter = createMockProviderAdapter();

export type SubmissionResult = {
	status:
		| "queued"
		| "processing"
		| "completed"
		| "rejected"
		| "dead_letter"
		| "not_found"
		| "invalid";
	message: string;
	nextAttemptAt?: string;
	attemptCount?: number;
	issues?: readonly unknown[];
};

export function submissionBackoffMs(attemptNumber: number): number {
	if (!Number.isInteger(attemptNumber) || attemptNumber < 1) {
		throw new RangeError("attemptNumber must be a positive integer");
	}
	return Math.min(BASE_BACKOFF_MS * 2 ** (attemptNumber - 1), MAX_BACKOFF_MS);
}

function safeResponse(
	status: SubmissionResult["status"],
	attemptCount: number,
	nextAttemptAt?: string,
): SubmissionResult {
	const messages: Record<SubmissionResult["status"], string> = {
		queued:
			"Submission is queued for a sandbox retry. The invoice has not been sent.",
		processing:
			"Sandbox submission is processing. The invoice has not been sent.",
		completed:
			"Mock sandbox submission was accepted. The invoice has not been sent or delivered.",
		rejected:
			"Mock sandbox submission was rejected. The invoice has not been sent.",
		dead_letter:
			"Sandbox submission needs manual review. The invoice has not been sent.",
		not_found: "Invoice was not found in the active workspace.",
		invalid:
			"Invoice needs corrections before a sandbox submission can be queued.",
	};
	return {
		status,
		message: messages[status],
		attemptCount,
		...(nextAttemptAt ? { nextAttemptAt } : {}),
	};
}

type QueueRow = {
	id: string;
	workspace_id: string;
	invoice_id: string;
	idempotency_key: string;
	status: SubmissionResult["status"];
	attempt_count: number;
	max_attempts: number;
	next_attempt_at: string;
	lease_expires_at: string | null;
	created_by: string;
	submission_snapshot: Json;
};

type SubmissionSnapshot = {
	provider: "mock";
	environment: "sandbox";
	invoice: CanonicalInvoice;
	validation: CanonicalInvoiceValidation;
};

type ProcessingOptions = Readonly<{
	admin: Supabase;
	auditClient: Supabase;
	userId: string;
	workspaceId: string;
	row: QueueRow;
	options: {
		adapter?: ProviderAdapter;
		now?: () => Date;
		afterAdapterCall?: () => void;
		audit?: typeof recordInvoiceAudit;
		systemActor?: boolean;
	};
}>;

async function processQueuedSubmission({
	admin,
	auditClient,
	userId,
	workspaceId,
	row: initialRow,
	options,
}: ProcessingOptions): Promise<SubmissionResult> {
	const now = options.now ?? (() => new Date());
	const audit = options.audit ?? recordInvoiceAudit;
	const auditEntry = (entry: Parameters<typeof recordInvoiceAudit>[2]) =>
		audit(
			auditClient,
			userId,
			{
				...entry,
				...(options.systemActor
					? {
							actor: {
								type: "system" as const,
								id: "invoice-submission-scheduler",
							},
						}
					: {}),
			},
			options.systemActor ? { workspaceId } : undefined,
		);
	let row = initialRow;
	if (["completed", "rejected", "dead_letter"].includes(row.status)) {
		return safeResponse(row.status, row.attempt_count, row.next_attempt_at);
	}
	const instant = now();
	if (
		row.status === "processing" &&
		row.lease_expires_at &&
		new Date(row.lease_expires_at) > instant
	) {
		return safeResponse("processing", row.attempt_count, row.next_attempt_at);
	}
	if (row.status === "queued" && new Date(row.next_attempt_at) > instant) {
		return safeResponse("queued", row.attempt_count, row.next_attempt_at);
	}
	if (row.status === "processing" && row.lease_expires_at) {
		const unfinished = await admin
			.from("invoice_submission_attempts")
			.select("*")
			.eq("workspace_id", workspaceId)
			.eq("submission_id", row.id)
			.eq("attempt_number", row.attempt_count)
			.eq("event_type", "started")
			.maybeSingle();
		if (unfinished.error) throw unfinished.error;
		if (unfinished.data) {
			const result = await admin
				.from("invoice_submission_attempts")
				.select("id")
				.eq("workspace_id", workspaceId)
				.eq("submission_id", row.id)
				.eq("attempt_number", row.attempt_count)
				.eq("event_type", "result")
				.maybeSingle();
			if (result.error) throw result.error;
			if (!result.data) {
				const interruptedAt = instant.toISOString();
				const interrupted = await admin
					.from("invoice_submission_attempts")
					.insert({
						workspace_id: workspaceId,
						submission_id: row.id,
						attempt_number: row.attempt_count,
						event_type: "result",
						outcome: "interrupted",
						request_snapshot: unfinished.data.request_snapshot,
						response_snapshot: null,
						error_code: "WORKER_LEASE_EXPIRED",
						started_at: unfinished.data.started_at,
						finished_at: interruptedAt,
					});
				if (interrupted.error) throw interrupted.error;
				await auditEntry({
					action: "invoice.send",
					resourceType: "einvoice_submission",
					resourceId: row.id,
					message:
						"Expired sandbox attempt recorded as interrupted before retry.",
					before: { status: "processing", attemptCount: row.attempt_count },
					after: { status: "interrupted", attemptCount: row.attempt_count },
				});
			}
		}
	}
	if (row.attempt_count >= row.max_attempts) {
		const dead = await admin
			.from("invoice_submission_queue")
			.update({
				status: "dead_letter",
				lease_expires_at: null,
				updated_at: instant.toISOString(),
			})
			.eq("id", row.id)
			.eq("workspace_id", workspaceId)
			.eq("attempt_count", row.attempt_count)
			.eq("status", row.status)
			.select("*")
			.maybeSingle();
		if (dead.error) throw dead.error;
		if (!dead.data) return safeResponse("processing", row.attempt_count);
		await auditEntry({
			action: "invoice.send",
			resourceType: "einvoice_submission",
			resourceId: row.id,
			message: "Mock submission moved to manual review.",
			before: { status: row.status },
			after: { status: "dead_letter", attemptCount: row.attempt_count },
		});
		return safeResponse("dead_letter", row.attempt_count);
	}
	const attemptNumber = row.attempt_count + 1;
	const leaseUntil = new Date(instant.getTime() + LEASE_MS).toISOString();
	const claim = await admin
		.from("invoice_submission_queue")
		.update({
			status: "processing",
			attempt_count: attemptNumber,
			lease_expires_at: leaseUntil,
			updated_at: instant.toISOString(),
		})
		.eq("id", row.id)
		.eq("workspace_id", workspaceId)
		.eq("attempt_count", row.attempt_count)
		.eq("status", row.status)
		.select("*")
		.maybeSingle();
	if (claim.error) throw claim.error;
	if (!claim.data)
		return safeResponse("processing", row.attempt_count, row.next_attempt_at);
	row = claim.data as unknown as QueueRow;
	const startedAt = instant.toISOString();
	const snapshot = row.submission_snapshot as unknown as SubmissionSnapshot;
	const attemptStart = await admin.from("invoice_submission_attempts").insert({
		workspace_id: workspaceId,
		submission_id: row.id,
		attempt_number: attemptNumber,
		event_type: "started",
		outcome: "started",
		request_snapshot: row.submission_snapshot,
		response_snapshot: null,
		error_code: null,
		started_at: startedAt,
		finished_at: null,
	});
	if (attemptStart.error) throw attemptStart.error;
	await auditEntry({
		action: "invoice.send",
		resourceType: "einvoice_submission",
		resourceId: row.id,
		message: "Mock sandbox submission attempt started.",
		before: { status: "queued", attemptCount: attemptNumber - 1 },
		after: { status: "processing", attemptCount: attemptNumber },
	});
	let responseSnapshot: Json | null = null;
	let outcome:
		| "accepted"
		| "rejected"
		| "timeout"
		| "duplicate"
		| "interrupted"
		| "error" = "error";
	let errorCode: string | null = null;
	try {
		const result = await (options.adapter ?? MOCK_PROVIDER).submit({
			invoice: snapshot.invoice,
			validation: snapshot.validation,
			idempotencyKey: row.idempotency_key,
		});
		responseSnapshot = result as unknown as Json;
		outcome = result.outcome;
	} catch {
		outcome = "interrupted";
		errorCode = "MOCK_PROVIDER_UNAVAILABLE";
	}
	if (outcome === "timeout") errorCode = "MOCK_PROVIDER_TIMEOUT";
	if (outcome === "duplicate") errorCode = "IDEMPOTENCY_KEY_REUSED";
	if (
		outcome === "rejected" &&
		responseSnapshot &&
		typeof responseSnapshot === "object" &&
		"rejectionCode" in responseSnapshot &&
		typeof responseSnapshot.rejectionCode === "string"
	) {
		errorCode = responseSnapshot.rejectionCode;
	}
	options.afterAdapterCall?.();
	const finishedAt = now().toISOString();
	const attemptInsert = await admin.from("invoice_submission_attempts").insert({
		workspace_id: workspaceId,
		submission_id: row.id,
		attempt_number: attemptNumber,
		event_type: "result",
		outcome,
		request_snapshot: row.submission_snapshot,
		response_snapshot: responseSnapshot,
		error_code: errorCode,
		started_at: startedAt,
		finished_at: finishedAt,
	});
	if (attemptInsert.error) throw attemptInsert.error;
	let nextStatus: QueueRow["status"];
	let nextAt: string | undefined;
	if (outcome === "accepted") nextStatus = "completed";
	else if (outcome === "rejected" || outcome === "duplicate")
		nextStatus = "rejected";
	else if (attemptNumber >= row.max_attempts) nextStatus = "dead_letter";
	else {
		nextStatus = "queued";
		nextAt = new Date(
			now().getTime() + submissionBackoffMs(attemptNumber),
		).toISOString();
	}
	const update = await admin
		.from("invoice_submission_queue")
		.update({
			status: nextStatus,
			next_attempt_at: nextAt ?? row.next_attempt_at,
			lease_expires_at: null,
			provider_reference:
				responseSnapshot &&
				typeof responseSnapshot === "object" &&
				"reference" in responseSnapshot
					? String(responseSnapshot.reference)
					: null,
			last_outcome: outcome,
			last_error_code: errorCode,
			updated_at: finishedAt,
		})
		.eq("id", row.id)
		.eq("workspace_id", workspaceId)
		.eq("status", "processing");
	if (update.error) throw update.error;
	await auditEntry({
		action: "invoice.send",
		resourceType: "einvoice_submission",
		resourceId: row.id,
		message:
			nextStatus === "dead_letter"
				? "Mock submission moved to manual review."
				: "Mock submission attempt recorded.",
		before: { status: "processing", attemptCount: attemptNumber - 1 },
		after: { status: nextStatus, attemptCount: attemptNumber, outcome },
	});
	return safeResponse(nextStatus, attemptNumber, nextAt);
}

/** Authenticated workspace enqueue + one bounded mock attempt. Never mutates invoice status/lifecycle. */
export async function queueInvoiceSubmission(
	client: Supabase,
	userId: string,
	invoiceId: string,
	options: Readonly<{
		adapter?: ProviderAdapter;
		now?: () => Date;
		afterAdapterCall?: () => void;
		adminClient?: Supabase;
		audit?: typeof recordInvoiceAudit;
	}> = {},
): Promise<SubmissionResult> {
	const context = await getWorkspaceContext(client, userId);
	if (!context || !["owner", "member"].includes(context.role))
		return safeResponse("not_found", 0);
	const loaded = await loadWorkspaceInvoiceSubmissionSnapshot(
		client,
		userId,
		invoiceId,
	);
	if (!loaded.canonical || loaded.workspaceId !== context.workspaceId) {
		return loaded.validation.issues[0]?.code === "invoice_not_found"
			? safeResponse("not_found", 0)
			: { ...safeResponse("invalid", 0), issues: loaded.validation.issues };
	}
	if (!loaded.validation.valid)
		return { ...safeResponse("invalid", 0), issues: loaded.validation.issues };
	const admin =
		options.adminClient ?? (getSupabaseAdminClient() as unknown as Supabase);
	const audit = options.audit ?? recordInvoiceAudit;
	const submissionSnapshot: SubmissionSnapshot = {
		provider: "mock",
		environment: "sandbox",
		invoice: loaded.canonical,
		validation: loaded.validation,
	};
	const existingResult = await admin
		.from("invoice_submission_queue")
		.select("*")
		.eq("workspace_id", context.workspaceId)
		.eq("invoice_id", invoiceId)
		.maybeSingle();
	if (existingResult.error) throw existingResult.error;
	let row = existingResult.data as unknown as QueueRow | null;
	if (!row) {
		const inserted = await admin
			.from("invoice_submission_queue")
			.insert({
				workspace_id: context.workspaceId,
				invoice_id: invoiceId,
				submission_snapshot: submissionSnapshot as unknown as Json,
				created_by: userId,
				max_attempts: MAX_ATTEMPTS,
				provider: "mock",
				status: "queued",
			})
			.select("*")
			.single();
		if (inserted.error) {
			// A concurrent enqueue can only replay the row created for this same workspace+invoice.
			if (inserted.error.code !== "23505") throw inserted.error;
			const replay = await admin
				.from("invoice_submission_queue")
				.select("*")
				.eq("workspace_id", context.workspaceId)
				.eq("invoice_id", invoiceId)
				.maybeSingle();
			if (replay.error || !replay.data)
				throw (
					replay.error ??
					new Error(
						"Submission queue row was not found after duplicate enqueue.",
					)
				);
			row = replay.data as unknown as QueueRow;
		} else row = inserted.data as unknown as QueueRow;
		await audit(client, userId, {
			action: "invoice.send",
			resourceType: "einvoice_submission",
			resourceId: row.id,
			message: "Queued mock sandbox invoice submission.",
			after: { status: "queued", attemptCount: 0 },
		});
	}
	return processQueuedSubmission({
		admin,
		auditClient: client,
		userId,
		workspaceId: context.workspaceId,
		row,
		options,
	});
}

/** Server scheduler batch. It trusts only the immutable validated queue snapshot and DB-owned tenant references. */
export async function dispatchDueInvoiceSubmissions(
	options: Readonly<{
		now?: () => Date;
		batchSize?: number;
		adminClient?: Supabase;
		adapter?: ProviderAdapter;
		audit?: typeof recordInvoiceAudit;
	}> = {},
): Promise<{
	processed: number;
	queued: number;
	completed: number;
	rejected: number;
	manualReview: number;
	skipped: number;
}> {
	const admin =
		options.adminClient ?? (getSupabaseAdminClient() as unknown as Supabase);
	const now = options.now ?? (() => new Date());
	const batchSize = Math.max(1, Math.min(50, options.batchSize ?? 25));
	const timestamp = now().toISOString();
	const [queuedResult, expiredResult] = await Promise.all([
		admin
			.from("invoice_submission_queue")
			.select("*")
			.eq("status", "queued")
			.lte("next_attempt_at", timestamp)
			.order("next_attempt_at", { ascending: true })
			.limit(batchSize),
		admin
			.from("invoice_submission_queue")
			.select("*")
			.eq("status", "processing")
			.lte("lease_expires_at", timestamp)
			.order("lease_expires_at", { ascending: true })
			.limit(batchSize),
	]);
	if (queuedResult.error) throw queuedResult.error;
	if (expiredResult.error) throw expiredResult.error;
	const rows = [
		...(queuedResult.data ?? []),
		...(expiredResult.data ?? []),
	].slice(0, batchSize) as unknown as QueueRow[];
	const counts = {
		processed: 0,
		queued: 0,
		completed: 0,
		rejected: 0,
		manualReview: 0,
		skipped: 0,
	};
	for (const row of rows) {
		const [membership, invoiceResult] = await Promise.all([
			admin
				.from("workspace_members")
				.select("role")
				.eq("workspace_id", row.workspace_id)
				.eq("user_id", row.created_by)
				.maybeSingle(),
			admin
				.from("invoices")
				.select("id")
				.eq("workspace_id", row.workspace_id)
				.eq("id", row.invoice_id)
				.is("deleted_at", null)
				.maybeSingle(),
		]);
		if (membership.error) throw membership.error;
		if (invoiceResult.error) throw invoiceResult.error;
		if (
			!membership.data ||
			!["owner", "member"].includes(membership.data.role) ||
			!invoiceResult.data
		) {
			counts.skipped += 1;
			continue;
		}
		const snapshot = row.submission_snapshot as unknown as SubmissionSnapshot;
		if (
			snapshot.provider !== "mock" ||
			snapshot.environment !== "sandbox" ||
			!snapshot.validation?.valid ||
			!snapshot.invoice?.id ||
			snapshot.invoice.id !== row.invoice_id
		) {
			counts.skipped += 1;
			continue;
		}
		const result = await processQueuedSubmission({
			admin,
			auditClient: admin,
			userId: row.created_by,
			workspaceId: row.workspace_id,
			row,
			options: { ...options, systemActor: true },
		});
		if (result.status === "processing") counts.skipped += 1;
		else if (result.status === "queued") {
			counts.queued += 1;
			counts.processed += 1;
		} else if (result.status === "completed") {
			counts.completed += 1;
			counts.processed += 1;
		} else if (result.status === "rejected") {
			counts.rejected += 1;
			counts.processed += 1;
		} else if (result.status === "dead_letter") {
			counts.manualReview += 1;
			counts.processed += 1;
		} else counts.skipped += 1;
	}
	return counts;
}
