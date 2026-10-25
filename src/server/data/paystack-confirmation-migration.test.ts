import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * WP8 fix round — the C2 forward-only guard vs. the atomic Paystack
 * confirmation RPC (audit finding: second/remainder payments rolled back
 * forever once 20261020000001 made `payment_reference` forward-only).
 *
 * 20260818143000 (frozen, already applied) set
 * `payment_reference = input_reference` UNCONDITIONALLY, so every
 * confirmation after the first tried to rewrite the invoice's payment
 * history — rejected by the C2 guard, rolling the whole confirmation back
 * while the money had already crossed at Paystack. The fix lives only in
 * the NEW migration 20261021000000 (`CREATE OR REPLACE`, same signature,
 * grants carried over); the frozen file is never edited.
 *
 * Following the repo's migration-test convention: source pins for the
 * preserved RPC behaviour, plus a two-payment walk-through of the exact
 * SET-clause expression against the forward-only rule.
 */

const MIGRATION_A10 = readFileSync(
	new URL(
		"../../../supabase/migrations/20260818143000_phase_a10_atomic_paystack_confirmation.sql",
		import.meta.url,
	),
	"utf8",
);

const MIGRATION_FIX = readFileSync(
	new URL(
		"../../../supabase/migrations/20261021000000_einvoice_fix_paystack_second_payment.sql",
		import.meta.url,
	),
	"utf8",
);

/** The live (uncommented) `payment_reference = …` SET expression. */
function referenceExpression(sql: string): string {
	const match = /^\s*payment_reference = (.+),$/m.exec(sql);
	if (!match) throw new Error("payment_reference SET clause not found");
	return match[1];
}

/** Mirror of the C2 forward-only column rule (20261020000001). */
function forwardOnlyBlocks(
	oldReference: string | null,
	newReference: string | null,
): boolean {
	return oldReference !== null && newReference !== oldReference;
}

/** Evaluate the two SET-expression shapes the migrations carry. */
function paymentReferenceAfter(
	expression: string,
	invoiceReference: string | null,
	inputReference: string,
): string | null {
	if (expression === "input_reference") return inputReference;
	if (expression === "coalesce(invoice.payment_reference, input_reference)") {
		return invoiceReference ?? inputReference;
	}
	throw new Error(`unexpected payment_reference expression: ${expression}`);
}

describe("confirm_paystack_payment second-payment fix (20261021000000)", () => {
	it("replaces the frozen RPC with an identical signature, keeping its grants", () => {
		const signature = (sql: string) =>
			/create or replace function public\.confirm_paystack_payment\(([^)]*)\) returns jsonb/
				.exec(sql)?.[1]
				?.replace(/\s+/g, " ")
				.trim();
		expect(signature(MIGRATION_FIX)).toBe(signature(MIGRATION_A10));
		expect(signature(MIGRATION_FIX)).toContain(
			"input_reference text, input_amount numeric",
		);
		// Same security surface: SECURITY DEFINER, service-role execute only.
		expect(MIGRATION_FIX).toContain("security definer");
		expect(MIGRATION_FIX).toContain(
			"revoke all on function public.confirm_paystack_payment(text, numeric, text, text, text, text, text, jsonb) from public, anon, authenticated;",
		);
		expect(MIGRATION_FIX).toContain(
			"grant execute on function public.confirm_paystack_payment(text, numeric, text, text, text, text, text, jsonb) to service_role;",
		);
	});

	it("keeps every other RPC behaviour: duplicate short-circuit, balance cap, accumulation, transaction + charge writes", () => {
		for (const pin of [
			// Idempotent webhook retries still short-circuit per reference.
			"'duplicate', true, 'reference', input_reference",
			// Row lock on the charge and on the invoice.
			"for update",
			// Money math stays integer-exact at the boundary: the RPC only
			// accumulates and caps; the callers deal in minor units.
			"round((coalesce(invoice.payment_amount, 0) + input_amount)::numeric, 2)",
			"if next_paid > total then raise exception 'Payment amount cannot exceed the invoice balance.'; end if;",
			// Each charge's own reference is still recorded per row, so the
			// second payment keeps its own transaction history.
			"insert into public.payment_transactions",
			"update public.payment_charges set status = 'succeeded'",
			// Partial vs full settlement branch and the lifecycle stamp.
			"'partially-paid'::public.invoice_status",
			"'paid'::public.invoice_status",
			"paymentReceivedAt",
		]) {
			expect(MIGRATION_FIX).toContain(pin);
		}
		// The total derivation (netPayable → grandTotal − WHT → line items).
		expect(MIGRATION_FIX).toContain("nullif(invoice.compliance->>'netPayable'");
	});

	it("keeps the FIRST payment reference: two-payment walk-through against the forward-only guard", () => {
		const frozen = referenceExpression(MIGRATION_A10);
		const fixed = referenceExpression(MIGRATION_FIX);
		expect(frozen).toBe("input_reference");
		expect(fixed).toBe("coalesce(invoice.payment_reference, input_reference)");

		// Payment 1 (ref-1) on an issued invoice: the reference was NULL, so
		// writing it is legal under the forward-only rule either way.
		const afterFirst = paymentReferenceAfter(fixed, null, "ref-1");
		expect(afterFirst).toBe("ref-1");
		expect(forwardOnlyBlocks(null, afterFirst)).toBe(false);

		// Payment 2 (ref-2, the remainder of a partial settlement): the
		// frozen body REWRITES the reference — the C2 guard
		// (20261020000001, forward-only `payment_reference`) raises
		// insufficient_privilege and the whole confirmation rolls back,
		// forever: the webhook retry repeats it verbatim while the money has
		// already crossed at Paystack.
		const frozenSecond = paymentReferenceAfter(frozen, afterFirst, "ref-2");
		expect(frozenSecond).toBe("ref-2");
		expect(forwardOnlyBlocks(afterFirst, frozenSecond)).toBe(true);

		// The fixed body keeps ref-1 (first reference wins, consistent with
		// forward-only history), so payment 2 lands: payment_amount
		// accumulates, status becomes paid once next_paid = total.
		const fixedSecond = paymentReferenceAfter(fixed, afterFirst, "ref-2");
		expect(fixedSecond).toBe("ref-1");
		expect(forwardOnlyBlocks(afterFirst, fixedSecond)).toBe(false);
	});

	it("never touches the frozen migration and ships a reversible down", () => {
		// The fix is additive: 20260818143000 stays byte-identical, defect
		// included, because it is already applied on every environment.
		expect(MIGRATION_A10).toContain("payment_reference = input_reference,");
		expect(MIGRATION_A10).not.toContain("coalesce(invoice.payment_reference");
		// Down restores the original (overwrite-latest) behaviour, and warns
		// that it can only be rolled back together with the C2 guard.
		expect(MIGRATION_FIX).toContain("-- down (reversible)");
		expect(MIGRATION_FIX).toContain(
			"--     payment_reference = input_reference,",
		);
		expect(MIGRATION_FIX).toContain("20261020000001");
	});
});
