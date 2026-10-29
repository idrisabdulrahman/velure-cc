import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The Paystack webhook money-safety migration (20261028000000).
 *
 * Behaviour is executed for real against the test database by
 * `-webhook-db.integration.test.ts`; these pins guard the source shape the
 * repo freezes on: identical RPC signature/grants, the rejections returned as
 * structured results (not raised), the canceled-invoice guard, and a
 * reversible down that restores the previous body.
 */
const MIGRATION = readFileSync(
	new URL(
		"../../../supabase/migrations/20261028000000_einvoice_paystack_webhook_safety.sql",
		import.meta.url,
	),
	"utf8",
);

const PREVIOUS = readFileSync(
	new URL(
		"../../../supabase/migrations/20261021000000_einvoice_fix_paystack_second_payment.sql",
		import.meta.url,
	),
	"utf8",
);

function signature(sql: string) {
	return /create or replace function public\.confirm_paystack_payment\(([^)]*)\) returns jsonb/
		.exec(sql)?.[1]
		?.replace(/\s+/g, " ")
		.trim();
}

/** The migration's live SQL: comment lines (including the down) removed. */
const LIVE = MIGRATION.split("\n")
	.filter((line) => !line.trimStart().startsWith("--"))
	.join("\n");

describe("confirm_paystack_payment webhook-safety migration (20261028000000)", () => {
	it("keeps the frozen signature and the service-role-only grants", () => {
		expect(signature(MIGRATION)).toBe(signature(PREVIOUS));
		expect(MIGRATION).toContain("security definer");
		expect(MIGRATION).toContain(
			"revoke all on function public.confirm_paystack_payment(text, numeric, text, text, text, text, text, jsonb) from public, anon, authenticated;",
		);
		expect(MIGRATION).toContain(
			"grant execute on function public.confirm_paystack_payment(text, numeric, text, text, text, text, text, jsonb) to service_role;",
		);
	});

	it("returns structured rejections instead of raising, so the route can 200 them", () => {
		for (const reason of [
			"unknown_reference",
			"amount_currency_mismatch",
			"invoice_canceled",
			"exceeds_balance",
		]) {
			expect(MIGRATION).toContain(`'reason', '${reason}'`);
		}
		// No business rejection may raise anymore (checked on the live SQL only;
		// the reversible down comment restores the old raises deliberately).
		expect(LIVE).not.toMatch(/raise exception 'Unknown payment reference/);
		expect(LIVE).not.toMatch(
			/raise exception 'Payment amount or currency mismatch/,
		);
		expect(LIVE).not.toMatch(/raise exception 'Payment amount cannot exceed/);
	});

	it("refuses to settle a canceled invoice and flags anomalies for review", () => {
		expect(MIGRATION).toContain("invoice.canceled_at is not null");
		expect(MIGRATION).toContain("'manual_review'");
	});

	it("preserves the money/once-only guarantees and ships a reversible down", () => {
		expect(MIGRATION).toContain("for update");
		expect(MIGRATION).toContain("payment_transactions");
		expect(MIGRATION).toContain(
			"payment_reference = coalesce(invoice.payment_reference, input_reference)",
		);
		expect(MIGRATION).toContain("-- down (reversible)");
		expect(MIGRATION).toContain("--   if not found then raise exception");
	});
});
