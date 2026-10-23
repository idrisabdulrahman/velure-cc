import { describe, expect, it } from "vitest";
import type { CanonicalInvoice } from "./canonical-invoice";
import {
	createMockProviderAdapter,
	type MockScenario,
} from "./provider-adapter";
import type { CanonicalInvoiceValidation } from "./validate-canonical-invoice";

function invoice(overrides: Partial<CanonicalInvoice> = {}): CanonicalInvoice {
	return {
		id: "invoice-1",
		number: "INV-2026-0001",
		documentType: "standard",
		issueDate: "2026-01-01",
		dueDate: "2026-01-15",
		currency: "NGN",
		seller: { legalName: "Seller" },
		buyer: { legalName: "Buyer" },
		lines: [],
		totals: { invoiceTotal: "0" },
		...overrides,
	};
}

const valid: CanonicalInvoiceValidation = { valid: true, issues: [] };
const invalid: CanonicalInvoiceValidation = {
	valid: false,
	issues: [
		{
			code: "buyer_tin_required",
			path: "buyer.identifiers",
			message: "Buyer TIN required.",
		},
	],
};

describe("mock provider adapter", () => {
	it("adapts the canonical invoice and WP12 validation result without claiming provider clearance", async () => {
		const adapter = createMockProviderAdapter();
		const result = await adapter.validate(invoice(), invalid);
		expect(result).toMatchObject({
			provider: "mock",
			environment: "sandbox",
			mock: true,
			operation: "validate",
			preSubmissionValid: false,
			issues: invalid.issues,
		});
		expect(JSON.stringify(result).toLowerCase()).not.toContain("cleared");
	});

	it.each<MockScenario>(["success", "rejection", "timeout", "duplicate"])(
		"returns deterministic %s submission results and replays by idempotency key",
		async (scenario) => {
			const adapter = createMockProviderAdapter({ scenario });
			const input = {
				invoice: invoice(),
				validation: valid,
				idempotencyKey: "key/one",
			};
			const first = await adapter.submit(input);
			const replay = await adapter.submit(input);
			expect(first).toEqual(replay);
			expect(first).toMatchObject({
				provider: "mock",
				environment: "sandbox",
				mock: true,
			});
			expect(first.outcome).toBe(
				scenario === "success"
					? "accepted"
					: scenario === "rejection"
						? "rejected"
						: scenario,
			);
			expect(first.reference).toContain("mock-");
		},
	);

	it("rejects a failed WP12 validation regardless of the selected success scenario", async () => {
		const adapter = createMockProviderAdapter({ scenario: "success" });
		const result = await adapter.submit({
			invoice: invoice(),
			validation: invalid,
			idempotencyKey: "invalid-invoice",
		});
		expect(result).toMatchObject({
			outcome: "rejected",
			rejectionCode: "LOCAL_VALIDATION_FAILED",
			issues: invalid.issues,
			mock: true,
		});
	});

	it("returns a deterministic duplicate conflict when a key is reused for another invoice", async () => {
		const adapter = createMockProviderAdapter();
		const first = await adapter.submit({
			invoice: invoice({ id: "invoice-first" }),
			validation: valid,
			idempotencyKey: "reused-key",
		});
		const replay = await adapter.submit({
			invoice: invoice({ id: "invoice-second" }),
			validation: valid,
			idempotencyKey: "reused-key",
		});
		const conflictReplay = await adapter.submit({
			invoice: invoice({ id: "invoice-second" }),
			validation: valid,
			idempotencyKey: "reused-key",
		});
		expect(replay).toMatchObject({
			outcome: "duplicate",
			rejectionCode: "IDEMPOTENCY_KEY_REUSED",
			reference: first.reference,
			mock: true,
			environment: "sandbox",
		});
		expect(replay).not.toEqual(first);
		expect(conflictReplay).toEqual(replay);
	});

	it("reports a mock-only status for known and unknown references", async () => {
		const adapter = createMockProviderAdapter({ scenario: "timeout" });
		const submitted = await adapter.submit({
			invoice: invoice(),
			validation: valid,
			idempotencyKey: "timeout-key",
		});
		expect(await adapter.getStatus(submitted.reference)).toMatchObject({
			status: "timeout",
			mock: true,
			environment: "sandbox",
		});
		expect(await adapter.getStatus("missing-reference")).toMatchObject({
			status: "unknown",
			mock: true,
		});
	});

	it("supports mock cancel and linked correction only without mutating the invoice", async () => {
		const adapter = createMockProviderAdapter();
		const source = invoice();
		const before = structuredClone(source);
		const submitted = await adapter.submit({
			invoice: source,
			validation: valid,
			idempotencyKey: "action-key",
		});
		const canceled = await adapter.cancel(submitted.reference);
		expect(canceled).toMatchObject({
			operation: "cancel",
			outcome: "accepted",
			mock: true,
		});
		expect(await adapter.getStatus(submitted.reference)).toMatchObject({
			status: "cancelled",
		});
		const correction = invoice({
			id: "credit-1",
			documentType: "credit_note",
			relatedDocuments: [{ relation: "corrects", documentId: source.id }],
		});
		expect(await adapter.credit(submitted.reference, correction)).toMatchObject(
			{
				operation: "credit",
				outcome: "accepted",
				correctionId: "credit-1",
				mock: true,
			},
		);
		expect(source).toEqual(before);
	});

	it("does not simulate cancellation or credit for unknown and unrelated documents", async () => {
		const adapter = createMockProviderAdapter();
		expect(await adapter.cancel("missing")).toMatchObject({
			outcome: "not_found",
			mock: true,
		});
		const submitted = await adapter.submit({
			invoice: invoice(),
			validation: valid,
			idempotencyKey: "credit-key",
		});
		expect(
			await adapter.credit(submitted.reference, invoice({ id: "unrelated" })),
		).toMatchObject({ outcome: "rejected", mock: true });
		expect(
			await adapter.credit(
				submitted.reference,
				invoice({
					id: "mislinked-credit",
					documentType: "credit_note",
					relatedDocuments: [
						{ relation: "corrects", documentId: "another-invoice" },
					],
				}),
			),
		).toMatchObject({ outcome: "rejected", mock: true });
	});
});
