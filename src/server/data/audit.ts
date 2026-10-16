import { getSupabaseAdminClient } from "#/server/supabase";
import type { Database, Json } from "#/types/database.types";
import { resolveActiveWorkspaceId, type Supabase } from "./workspaces";

/**
 * G1 — the ONE append-only invoice audit service
 * (SPEC 5.G "Append-only audit log", 4.2 tamper-evidence).
 *
 * Every invoice lifecycle code path (create / edit / send / cancel /
 * export) calls `recordInvoiceAudit`, which writes who / what / when /
 * before-after into `public.invoice_audit_log`. The table has no update and
 * no application delete path (migration
 * `20261016000000_einvoice_g1_invoice_audit_log.sql`); this module exposes
 * exactly one write plus pure row/payload helpers — deliberately no update
 * or delete call exists here.
 *
 * Tenancy: the workspace id is always resolved server-side through the
 * caller's user-scoped RLS client (`resolveActiveWorkspaceId`) — never
 * taken from a request or the UI. The row itself is INSERTed with the
 * service-role client because audit writes are server-only: anon and
 * authenticated hold no INSERT grant or policy on the table, so a browser
 * session holding the publishable-key PostgREST client cannot forge
 * events. Reads stay member-scoped under RLS.
 *
 * Fail-closed: `recordInvoiceAudit` throws when the workspace cannot be
 * resolved or when the insert fails, and lifecycle call sites await it
 * without swallowing the error. Audit and mutation are NOT wrapped in one
 * SQL transaction — the A10 data layer is non-transactional throughout, and
 * rewriting every lifecycle op as an RPC is out of scope — so a mutation
 * can succeed while its audit insert fails (the caller then sees an
 * error).
 *
 * Payloads are sanitized before storage: public invoice tokens and common
 * secret-shaped keys are stripped, so share links never leak into the
 * audit trail.
 */

export const INVOICE_AUDIT_ACTIONS = [
	"invoice.create",
	"invoice.edit",
	"invoice.send",
	"invoice.cancel",
	"invoice.export",
] as const;

export type InvoiceAuditAction = (typeof INVOICE_AUDIT_ACTIONS)[number];

export type InvoiceAuditActor = { type: "user" | "system"; id: string };

export type InvoiceAuditEntry = {
	action: InvoiceAuditAction;
	/** Defaults to "invoice"; export batches pass "invoice_import"/"invoice_export". */
	resourceType?: string;
	resourceId?: string | null;
	before?: unknown;
	after?: unknown;
	message?: string;
	/** Defaults to the authenticated user; "system" for job/webhook actors. */
	actor?: InvoiceAuditActor;
};

type InvoiceAuditLogInsert =
	Database["public"]["Tables"]["invoice_audit_log"]["Insert"];

/**
 * Keys stripped from before/after payloads: the public invoice token is a
 * capability URL (anyone with it can view the invoice), and secret-shaped
 * keys must never reach the audit trail (AGENTS.md §8).
 */
const AUDIT_REDACTED_KEYS = new Set([
	"token",
	"tokenrevokedat",
	"password",
	"apikey",
	"secret",
	"authorization",
]);

const AUDIT_PAYLOAD_MAX_DEPTH = 6;

/** Deep-copy a payload into JSON-safe data with secret-shaped keys removed. */
export function sanitizeAuditPayload(value: unknown, depth = 0): Json | null {
	if (value === null || value === undefined) return null;
	if (depth > AUDIT_PAYLOAD_MAX_DEPTH) return null;
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeAuditPayload(item, depth + 1));
	}
	if (typeof value === "object") {
		const sanitized: Record<string, Json> = {};
		for (const [key, item] of Object.entries(value)) {
			if (AUDIT_REDACTED_KEYS.has(key.toLowerCase())) continue;
			sanitized[key] = sanitizeAuditPayload(item, depth + 1);
		}
		return sanitized;
	}
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === "boolean" || typeof value === "string") {
		return value;
	}
	// functions, symbols, bigint: not JSON, drop them.
	return null;
}

/** Pure row builder (unit-testable without any client). */
export function buildInvoiceAuditRow(args: {
	workspaceId: string;
	userId: string;
	entry: InvoiceAuditEntry;
}): InvoiceAuditLogInsert {
	const actor = args.entry.actor ?? { type: "user" as const, id: args.userId };
	return {
		workspace_id: args.workspaceId,
		actor_id: actor.id,
		actor_type: actor.type,
		action: args.entry.action,
		resource_type: args.entry.resourceType ?? "invoice",
		resource_id: args.entry.resourceId ?? null,
		before_payload: sanitizeAuditPayload(args.entry.before),
		after_payload: sanitizeAuditPayload(args.entry.after),
		message: args.entry.message ?? null,
	};
}

/**
 * Record one append-only audit event for the caller's active workspace.
 *
 * `client` must be the caller's user-scoped RLS client; the workspace is
 * resolved from it (server-side) and the row is written with the
 * service-role client. Throws — fail-closed — when the workspace is
 * missing or the insert fails.
 */
export async function recordInvoiceAudit(
	client: Supabase,
	userId: string,
	entry: InvoiceAuditEntry,
): Promise<void> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");
	const { error } = await getSupabaseAdminClient()
		.from("invoice_audit_log")
		.insert(buildInvoiceAuditRow({ workspaceId, userId, entry }));
	if (error) throw error;
}
