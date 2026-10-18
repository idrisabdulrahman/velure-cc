import type { InvoiceAuditEntry } from "./audit";
import type { Supabase } from "./workspaces";

/**
 * G1 — browser-safe transport for the ONE invoice audit service
 * (`src/server/data/audit.ts`, which is server-only).
 *
 * The lifecycle functions in this directory run in the browser against the
 * caller's user-scoped RLS client (A10 "RLS-pure" data layer), but the
 * audit row itself must be written on the server: anon/authenticated hold
 * no INSERT grant on `invoice_audit_log`, and the service-role key must
 * never reach a client bundle. So the default transport here POSTs the
 * entry to `POST /api/invoice/audit`, whose handler derives the actor and
 * the workspace from the verified session (nothing in this payload — no
 * actor id, no workspace id — is trusted) and calls the server service.
 *
 * Server-side callers pass an explicit `write` instead of relying on the
 * default: a relative fetch only exists in the browser, so on the server
 * the default fails closed (Node rejects the unparsable URL). The invoice
 * send route injects `#/server/data/audit`'s `recordInvoiceAudit` through
 * `src/server/invoice-repository.ts`.
 *
 * Fail-closed: a non-2xx response throws, so lifecycle call sites see the
 * audit failure exactly like any other write failure.
 */

/** Signature of an audit write sink; the server service matches it. */
export type InvoiceAuditWriter = (
	client: Supabase,
	userId: string,
	entry: InvoiceAuditEntry,
) => Promise<void>;

const INVOICE_AUDIT_ENDPOINT = "/api/invoice/audit";

async function postInvoiceAuditEntry(
	_client: Supabase,
	_userId: string,
	entry: InvoiceAuditEntry,
): Promise<void> {
	// `actor` is deliberately not forwarded: the server derives the actor
	// from the verified session and strips unknown fields anyway.
	const { actor: _ignoredActor, ...payload } = entry;
	const response = await fetch(INVOICE_AUDIT_ENDPOINT, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(payload),
	});
	if (!response.ok) {
		throw new Error(`Invoice audit write failed (${response.status}).`);
	}
}

/**
 * Record one append-only audit event for the caller's active workspace.
 *
 * Same contract as the server service (`./audit`), but the write travels
 * through the server endpoint by default, so no service-role material is
 * ever loaded in the browser. See the module doc.
 */
export async function recordInvoiceAudit(
	client: Supabase,
	userId: string,
	entry: InvoiceAuditEntry,
	write: InvoiceAuditWriter = postInvoiceAuditEntry,
): Promise<void> {
	await write(client, userId, entry);
}
