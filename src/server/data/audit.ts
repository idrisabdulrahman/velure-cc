import { getSupabaseAdminClient } from "#/server/supabase";
import type { Database, Json } from "#/types/database.types";
import { resolveActiveWorkspaceId, type Supabase } from "./workspaces";

/**
 * G1 — the ONE append-only invoice audit service
 * (SPEC 5.G "Append-only audit log", 4.2 tamper-evidence).
 *
 * SERVER-ONLY. This module holds the service-role INSERT, so it must never
 * be imported by browser code — there is a runtime tripwire below, and
 * `audit-browser-boundary.test.ts` walks every browser-imported module to
 * prove no client-reachable code references `getSupabaseAdminClient`.
 *
 * Every invoice lifecycle code path (create / edit / send / cancel /
 * export) reaches this service through exactly one of two callers:
 *   1. browser-initiated mutations call the browser-safe transport
 *      (`./audit-client`), which POSTs the entry to
 *      POST /api/invoice/audit; that route derives actor and workspace
 *      from the verified session and then calls `recordInvoiceAudit`
 *      (src/routes/api/invoice/audit.ts);
 *   2. server-side callers (the invoice send route, via
 *      src/server/invoice-repository.ts) pass this function as the
 *      injected `write` so the row is written in-process.
 * No other module inserts into `invoice_audit_log`.
 *
 * Append-only is enforced in the database, not by convention: migrations
 * `20261016000000_einvoice_g1_invoice_audit_log.sql` (BEFORE UPDATE raise),
 * `20261017000000_einvoice_g1_invoice_audit_log_delete_guard.sql`
 * (BEFORE DELETE raise for direct deletes, `pg_trigger_depth()` passthrough
 * for the workspaces FK ON DELETE CASCADE) and
 * `20261018000000_einvoice_g1_invoice_audit_log_truncate_guard.sql`
 * (BEFORE TRUNCATE statement raise — row triggers never fire on TRUNCATE).
 * This module exposes exactly one write plus pure row/payload helpers —
 * deliberately no update or delete call exists here — so no application
 * code can rewrite or remove history, and neither can the service-role key
 * through the API.
 *
 * Tenancy: the workspace id is always resolved server-side through the
 * caller's user-scoped RLS client (`resolveActiveWorkspaceId`) — never
 * taken from a request or the UI. The row itself is INSERTed with the
 * service-role client because audit writes are server-only: anon and
 * authenticated hold no INSERT grant or policy on the table, so a browser
 * session holding the publishable-key PostgREST client cannot forge
 * events. Reads stay member-scoped under RLS.
 *
 * Identity: `userId` must be the verified session user handed over by a
 * server entry point (the audit route or a session-minted context). The
 * browser never calls this function directly, so no client-supplied actor
 * id can reach it.
 *
 * Fail-closed: `recordInvoiceAudit` throws when the workspace cannot be
 * resolved or when the insert fails, and callers await it without
 * swallowing the error. Audit and mutation are NOT wrapped in one SQL
 * transaction — the A10 data layer is non-transactional throughout, and
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
	// WP8/C3: hard deletes (draft cleanup) and blocked delete attempts on
	// issued invoices get their own action instead of overloading
	// invoice.edit; the DB CHECK grows in lockstep (migration
	// 20261020000002, whose down re-adds the old five-action set NOT VALID).
	"invoice.delete",
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
 * SERVER-ONLY (see the module doc): `client` must be the caller's
 * user-scoped RLS client minted from a verified session server-side, and
 * `userId` must be that session's user id. The workspace is resolved from
 * the client and the row is written with the service-role client. Throws —
 * fail-closed — when the workspace is missing or the insert fails.
 *
 * `options.workspaceId` is a SERVER-ONLY escape hatch for system jobs (the
 * scheduled-send dispatcher in src/server/invoice-mailer.ts) that act on a
 * row whose workspace is known from the database but whose owner's
 * `active_workspaces` row may point somewhere else — resolving through the
 * active workspace would file the event under the wrong tenant. Never pass
 * a client-supplied value: the browser transport (./audit-client and the
 * audit POST route) has no way to set it, so no request can steer tenancy.
 */
export async function recordInvoiceAudit(
	client: Supabase,
	userId: string,
	entry: InvoiceAuditEntry,
	options?: { workspaceId?: string },
): Promise<void> {
	if (typeof window !== "undefined") {
		// Tripwire: the service-role key cannot exist in a browser. Client
		// code must go through ./audit-client (POST /api/invoice/audit).
		throw new Error(
			"recordInvoiceAudit is server-only; browser callers must use ./audit-client.",
		);
	}
	const workspaceId =
		options?.workspaceId ?? (await resolveActiveWorkspaceId(client, userId));
	if (!workspaceId) throw new Error("No active workspace.");
	const { error } = await getSupabaseAdminClient()
		.from("invoice_audit_log")
		.insert(buildInvoiceAuditRow({ workspaceId, userId, entry }));
	if (error) throw error;
}
