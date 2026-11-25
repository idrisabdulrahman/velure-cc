import type { Database } from "#/types/database.types";
import { getById as getInvoiceById } from "./invoices";
import { recordPayment } from "./payments";
import { resolveActiveWorkspaceId, type Supabase } from "./workspaces";

/**
 * WP-A — buyer payment claims (build_plan.md §3).
 *
 * A claim is **evidence, not settlement**: the buyer says "I've paid"; only
 * `recordPayment` changes invoice payment state. Every function here is
 * workspace-family (AGENTS.md §1):
 *
 *   - `listPaymentClaims` / `confirmPaymentClaim` / `rejectPaymentClaim` take a
 *     USER-scoped client and scope every query by the caller's resolved active
 *     workspace, so a member of workspace B can never read or resolve workspace
 *     A's claim even against a client with RLS off (AGENTS.md §8).
 *   - `insertPaymentClaim` takes the service-role admin client (the public
 *     submit has no session); the caller derives `workspaceId`/`invoiceId` from
 *     the public token, never from the request body. RLS stays on as defense in
 *     depth (AGENTS.md §8).
 *
 * Money stays in the same minor-unit representation as `invoices.payment_amount`
 * (`numeric(20, 4)`); no float (AGENTS.md §9).
 */

type PaymentClaimRow = Database["public"]["Tables"]["payment_claims"]["Row"];

export type PaymentClaimStatus = "claimed" | "confirmed" | "rejected";

export type PaymentClaim = {
	id: string;
	invoiceId: string;
	claimedAmount: number;
	claimReference: string | null;
	note: string | null;
	status: PaymentClaimStatus;
	claimedAt: number;
	// Set when a seller confirms *or* rejects the claim.
	resolvedAt: number | null;
	resolvedBy: string | null;
};

function epoch(value: string | null): number | null {
	if (!value) return null;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function toPaymentClaim(row: PaymentClaimRow): PaymentClaim {
	return {
		id: row.id,
		invoiceId: row.invoice_id,
		// numeric arrives as a number through PostgREST; coerce defensively.
		claimedAmount: Number(row.claimed_amount),
		claimReference: row.claim_reference ?? null,
		note: row.note ?? null,
		status: row.status as PaymentClaimStatus,
		claimedAt: epoch(row.claimed_at) ?? 0,
		resolvedAt: epoch(row.resolved_at),
		resolvedBy: row.resolved_by ?? null,
	};
}

/**
 * Public claim insert (service-role client). The caller supplies the workspace
 * and invoice ids it resolved from the bearer token. A repeat submit with the
 * same `(invoice_id, claim_reference)` is an idempotent no-op, reported as
 * `duplicate: true` (matches `payment_claims_invoice_reference_unique`).
 */
export async function insertPaymentClaim(
	client: Supabase,
	args: {
		workspaceId: string;
		invoiceId: string;
		amount: number;
		reference?: string;
		note?: string;
	},
): Promise<{ id: string | null; duplicate: boolean }> {
	const { data, error } = await client
		.from("payment_claims")
		.insert({
			workspace_id: args.workspaceId,
			invoice_id: args.invoiceId,
			claimed_amount: args.amount,
			claim_reference: args.reference ?? null,
			note: args.note ?? null,
			status: "claimed",
		})
		.select("id")
		.maybeSingle();
	if (error) {
		if ((error as { code?: string }).code === "23505")
			return { id: null, duplicate: true };
		throw error;
	}
	return { id: data ? (data as { id: string }).id : null, duplicate: false };
}

/**
 * Workspace-member read for one invoice. Access to the invoice is validated by
 * the caller's own session first (getInvoiceById resolves the active workspace),
 * so a member of another workspace gets `[]`, not a leaked claim list.
 */
export async function listPaymentClaims(
	client: Supabase,
	userId: string,
	invoiceId: string,
): Promise<PaymentClaim[]> {
	const invoice = await getInvoiceById(client, userId, invoiceId);
	if (!invoice) return [];
	const { data, error } = await client
		.from("payment_claims")
		.select("*")
		.eq("invoice_id", invoiceId)
		.order("claimed_at", { ascending: false });
	if (error) throw error;
	return ((data ?? []) as PaymentClaimRow[]).map(toPaymentClaim);
}

/**
 * Resolve one claim by id, scoped to the caller's active workspace.
 *
 * The `workspace_id` predicate is the app-layer tenancy gate: without it, a
 * service-role or RLS-off client could resolve another workspace's claim id
 * (the no-RLS fake in `payment-claims.test.ts` pins exactly this).
 */
async function getClaimById(
	client: Supabase,
	userId: string,
	claimId: string,
): Promise<PaymentClaim | null> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) return null;
	const { data, error } = await client
		.from("payment_claims")
		.select("*")
		.eq("id", claimId)
		.eq("workspace_id", workspaceId)
		.maybeSingle();
	if (error) throw error;
	return data ? toPaymentClaim(data as PaymentClaimRow) : null;
}

/**
 * Seller confirms a buyer claim: settle through the existing `recordPayment`
 * path (so the invoice state machine, audit row and duplicate short-circuit are
 * reused), then mark the claim confirmed. Confirming twice is a no-op because
 * the claim status guard returns before a second payment is attempted.
 */
export async function confirmPaymentClaim(
	client: Supabase,
	userId: string,
	claimId: string,
): Promise<{ ok: true; duplicate: boolean; invoiceId: string }> {
	const claim = await getClaimById(client, userId, claimId);
	if (!claim) throw new Error("Payment claim not found.");
	if (claim.status === "confirmed")
		return { ok: true, duplicate: true, invoiceId: claim.invoiceId };

	const result = await recordPayment(client, userId, {
		invoiceId: claim.invoiceId,
		amount: claim.claimedAmount,
		reference: claim.claimReference ?? undefined,
	});

	const now = new Date().toISOString();
	const { error } = await client
		.from("payment_claims")
		.update({
			status: "confirmed",
			resolved_at: now,
			resolved_by: userId,
			updated_at: now,
		})
		.eq("id", claimId);
	if (error) throw error;

	return {
		ok: true,
		duplicate: Boolean(result.duplicate),
		invoiceId: claim.invoiceId,
	};
}

/** Seller rejects a claim. Rejection is a status change, never a delete. */
export async function rejectPaymentClaim(
	client: Supabase,
	userId: string,
	claimId: string,
): Promise<{ ok: true; invoiceId: string }> {
	const claim = await getClaimById(client, userId, claimId);
	if (!claim) throw new Error("Payment claim not found.");
	const now = new Date().toISOString();
	const { error } = await client
		.from("payment_claims")
		.update({
			status: "rejected",
			resolved_at: now,
			resolved_by: userId,
			updated_at: now,
		})
		.eq("id", claimId);
	if (error) throw error;
	return { ok: true, invoiceId: claim.invoiceId };
}
