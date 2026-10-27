import { describe, expect, it } from "vitest";
import {
	type CorrectionSourceCandidate,
	isCorrectionSource,
} from "./correction-sources";

function invoice(
	overrides: CorrectionSourceCandidate = {},
): CorrectionSourceCandidate {
	return {
		documentType: "standard",
		status: "unpaid",
		paymentAmount: 0,
		...overrides,
	};
}

describe("correction source candidates", () => {
	it("accepts a delivered standard invoice", () => {
		expect(isCorrectionSource(invoice({ deliveredAt: 1 }))).toBe(true);
	});

	it("accepts a paid standard invoice even without a delivery stamp", () => {
		expect(isCorrectionSource(invoice({ paidAt: 2 }))).toBe(true);
		expect(
			isCorrectionSource(invoice({ paymentAmount: 500, status: "paid" })),
		).toBe(true);
	});

	it("accepts a standard invoice marked sent in its lifecycle", () => {
		expect(isCorrectionSource(invoice({ lifecycle: { sentAt: 3 } }))).toBe(
			true,
		);
	});

	it("rejects drafts, cancelled invoices, and invoices never issued", () => {
		expect(isCorrectionSource(invoice({ status: "draft" }))).toBe(false);
		expect(
			isCorrectionSource(invoice({ status: "canceled", deliveredAt: 1 })),
		).toBe(false);
		expect(isCorrectionSource(invoice())).toBe(false);
	});

	it("rejects corrections of corrections", () => {
		for (const documentType of ["credit_note", "debit_note"] as const) {
			expect(
				isCorrectionSource(invoice({ documentType, deliveredAt: 1 })),
			).toBe(false);
		}
	});
});
