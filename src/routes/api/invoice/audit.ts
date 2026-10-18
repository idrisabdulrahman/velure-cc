import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { INVOICE_AUDIT_ACTIONS, recordInvoiceAudit } from "#/server/data/audit";
import {
	RequestBodyTooLargeError,
	readRequestText,
	safeErrorDetails,
} from "#/server/http-security";
import { getInvoiceUserContext } from "#/server/invoice-repository";

/**
 * G1 — the server entry point for browser-initiated invoice audit writes.
 *
 * The UI lifecycle functions (createDraft / save / updateStatus / …) run in
 * the browser against their own RLS client, then POST the audit entry here.
 * Trust boundary: nothing in the body is trusted for identity or tenancy.
 * The actor and the active workspace are derived server-side from the
 * verified Better Auth session (`getInvoiceUserContext` mints a
 * session-scoped RLS client); the schema strips unknown fields, so a forged
 * `actor`, `userId` or `workspace_id` is dropped. The row is inserted by
 * the ONE server service (`#/server/data/audit`) with the service-role
 * client — anon/authenticated hold no INSERT grant on the table.
 *
 * Fail-closed: 401 without a session, 400 for an invalid entry, 500 when
 * the write did not land (the caller's mutation then reports failure).
 */

const invoiceAuditEntrySchema = z.object({
	action: z.enum(INVOICE_AUDIT_ACTIONS),
	resourceType: z
		.string()
		.regex(/^[a-z][a-z0-9_]{0,31}$/)
		.optional(),
	resourceId: z.string().min(1).max(128).nullish(),
	before: z.unknown().optional(),
	after: z.unknown().optional(),
	message: z.string().max(500).optional(),
});

export async function handle({ request }: { request: Request }) {
	try {
		const context = await getInvoiceUserContext(request);
		if (!context) {
			return Response.json(
				{ ok: false, error: "Authentication required." },
				{ status: 401 },
			);
		}

		let raw: string;
		try {
			raw = await readRequestText(request);
		} catch (error) {
			if (error instanceof RequestBodyTooLargeError) {
				return Response.json(
					{ ok: false, error: "Audit entry is too large." },
					{ status: 413 },
				);
			}
			throw error;
		}

		let parsedBody: unknown;
		try {
			parsedBody = JSON.parse(raw);
		} catch {
			return Response.json(
				{ ok: false, error: "Invalid request body." },
				{ status: 400 },
			);
		}

		const parsed = invoiceAuditEntrySchema.safeParse(parsedBody);
		if (!parsed.success) {
			return Response.json(
				{ ok: false, error: "Invalid audit entry." },
				{ status: 400 },
			);
		}

		await recordInvoiceAudit(context.client, context.userId, parsed.data);
		return Response.json({ ok: true });
	} catch (error) {
		console.error("Invoice audit write failed", safeErrorDetails(error));
		return Response.json(
			{ ok: false, error: "Audit write failed." },
			{ status: 500 },
		);
	}
}

export const Route = createFileRoute("/api/invoice/audit")({
	server: {
		handlers: {
			POST: handle,
		},
	},
});
