import { describe, expect, it } from "vitest";
import { buildInvoicePaymentScore } from "./invoices";

describe("invoice payment score", () => {
	it("scores settled invoices by due-date performance without transaction matching", () => {
		const score = buildInvoicePaymentScore([
			{
				documentType: "standard",
				status: "paid",
				issueDate: "2026-06-01",
				dueDate: "2026-06-15",
				paidAt: Date.parse("2026-06-10T12:00:00Z"),
			},
			{
				documentType: "standard",
				status: "paid",
				issueDate: "2026-06-01",
				dueDate: "2026-06-10",
				paidAt: Date.parse("2026-06-20T12:00:00Z"),
			},
			{
				documentType: "standard",
				status: "unpaid",
				issueDate: "2026-06-01",
				dueDate: "2026-06-10",
			},
			{
				documentType: "proforma",
				status: "paid",
				issueDate: "2026-06-01",
				dueDate: "2026-06-10",
				paidAt: Date.parse("2026-06-02T12:00:00Z"),
			},
		]);

		expect(score).toEqual({
			score: 50,
			status: "fair",
			paidInvoiceCount: 2,
			onTimeCount: 1,
			averageDaysToPay: 15,
		});
	});
});
