import { describe, expect, it } from "vitest";
import {
	applyPaymentToSnapshot,
	canReuseCollectionSession,
	derivedPaymentStatus,
	getInvoicePaymentSnapshot,
	type InvoicePaymentState,
	invoiceAmount,
	payableInvoiceIssue,
	staleCollectionSessionReason,
} from "./paymentCollection";

function invoice(
	overrides: Partial<InvoicePaymentState> = {},
): InvoicePaymentState {
	return {
		status: "unpaid",
		updatedAt: Date.parse("2026-06-01T00:00:00.000Z"),
		deliveredAt: Date.parse("2026-06-01T00:00:00.000Z"),
		dueDate: "2026-06-30",
		paymentAmount: 0,
		lineItems: [{ quantity: 1, price: 100_000 }],
		...overrides,
	};
}

describe("payment collection rules", () => {
	it("rejects draft, paid, and canceled invoices as not payable", () => {
		expect(
			payableInvoiceIssue(
				invoice({ status: "draft", deliveredAt: undefined, updatedAt: 1 }),
			),
		).toBe("Draft invoices are not payable.");
		expect(payableInvoiceIssue(invoice({ paymentAmount: 100_000 }))).toBe(
			"Paid invoices are not payable.",
		);
		expect(payableInvoiceIssue(invoice({ status: "canceled" }))).toBe(
			"Canceled invoices are not payable.",
		);
	});

	it("allows sent, overdue, and partially paid invoices", () => {
		expect(payableInvoiceIssue(invoice())).toBeNull();
		expect(
			payableInvoiceIssue(invoice({ dueDate: "2026-05-01", paymentAmount: 0 })),
		).toBeNull();
		expect(payableInvoiceIssue(invoice({ paymentAmount: 40_000 }))).toBeNull();
	});

	it("derives invoice status from delivery, due date, and payment state", () => {
		const now = Date.parse("2026-06-15T12:00:00.000Z");

		expect(
			derivedPaymentStatus(
				invoice({ status: "draft", deliveredAt: undefined, updatedAt: now }),
				now,
			),
		).toBe("draft");
		expect(
			derivedPaymentStatus(
				invoice({ dueDate: "2026-06-01", paymentAmount: 0 }),
				now,
			),
		).toBe("overdue");
		expect(derivedPaymentStatus(invoice({ paymentAmount: 10_000 }), now)).toBe(
			"partially-paid",
		);
		expect(derivedPaymentStatus(invoice({ paymentAmount: 100_000 }), now)).toBe(
			"paid",
		);
	});

	it("uses compliance net payable before gross line-item totals", () => {
		expect(
			invoiceAmount(
				invoice({
					compliance: {
						netPayable: 87_500,
						grandTotal: 100_000,
						withholdingTaxAmount: 5_000,
					},
				}),
			),
		).toBe(87_500);
		expect(
			invoiceAmount(
				invoice({
					compliance: {
						grandTotal: 100_000,
						withholdingTaxAmount: 5_000,
					},
				}),
			),
		).toBe(95_000);
	});

	it("applies partial payments and then full settlement without overpayment", () => {
		const firstSnapshot = getInvoicePaymentSnapshot(invoice());
		const firstPayment = applyPaymentToSnapshot(firstSnapshot, 40_000);

		expect(firstPayment).toMatchObject({
			amount: 40_000,
			nextPaymentAmount: 40_000,
			remainingBalance: 60_000,
			isPaid: false,
			invoiceAuditAction: "invoice.partially_paid",
		});

		const finalSnapshot = getInvoicePaymentSnapshot(
			invoice({ paymentAmount: firstPayment.nextPaymentAmount }),
		);
		const finalPayment = applyPaymentToSnapshot(finalSnapshot, 60_000);

		expect(finalPayment).toMatchObject({
			nextPaymentAmount: 100_000,
			remainingBalance: 0,
			isPaid: true,
			invoiceAuditAction: "invoice.paid",
		});
		expect(() => applyPaymentToSnapshot(finalSnapshot, 60_000.01)).toThrow(
			"Payment amount cannot exceed the invoice balance.",
		);
		expect(() => applyPaymentToSnapshot(firstSnapshot, 0)).toThrow(
			"Payment amount must be greater than zero.",
		);
		expect(() => applyPaymentToSnapshot(firstSnapshot, -1)).toThrow(
			"Payment amount must be greater than zero.",
		);
	});

	it("reuses only active collection sessions matching balance and currency", () => {
		const now = Date.parse("2026-06-01T12:00:00.000Z");
		const session = {
			status: "pending",
			amount: 60_000,
			currency: "NGN",
			expiresAt: now + 60_000,
		};

		expect(
			canReuseCollectionSession(session, {
				amount: 60_000,
				currency: "NGN",
				now,
			}),
		).toBe(true);
		expect(
			canReuseCollectionSession(session, {
				amount: 50_000,
				currency: "NGN",
				now,
			}),
		).toBe(false);
		expect(
			staleCollectionSessionReason(session, {
				amount: 50_000,
				currency: "NGN",
				now,
			}),
		).toBe("balance_changed");
		expect(
			staleCollectionSessionReason(
				{ ...session, expiresAt: now - 1 },
				{ amount: 60_000, currency: "NGN", now },
			),
		).toBe("expired");
		expect(
			staleCollectionSessionReason(
				{ ...session, currency: "USD" },
				{ amount: 60_000, currency: "NGN", now },
			),
		).toBe("balance_changed");
		expect(
			staleCollectionSessionReason(
				{ ...session, status: "manual_review" },
				{ amount: 60_000, currency: "NGN", now },
			),
		).toBeNull();
	});
});
