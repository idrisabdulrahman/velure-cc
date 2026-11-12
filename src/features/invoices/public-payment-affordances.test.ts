import { describe, expect, it } from "vitest";
import {
	getPublicPaymentAffordances,
	getPublicPrimaryAmount,
	isDraftPublicStatus,
	PUBLIC_DRAFT_PAYMENT_NOTICE,
} from "./public-payment-affordances";

/**
 * P0 fix: a draft's public page gave conflicting payment instructions (a
 * "Draft invoices are not payable." collection panel plus bank-transfer
 * details and an "I've paid" button). These are the exact decisions the
 * `/i/$token` page renders from, so hiding them here hides them on the page.
 */
describe("getPublicPaymentAffordances", () => {
	it("hides the collection panel, transfer button and 'I've paid' on a draft", () => {
		const affordances = getPublicPaymentAffordances({
			status: "draft",
			balance: 2000,
			automaticBankTransfer: true,
			payable: false,
		});

		expect(affordances).toEqual({
			isDraft: true,
			showCollectionPanel: false,
			canUsePaystackTransfer: false,
			canClaimPayment: false,
		});
	});

	it("treats scheduled as a draft, because it prints as one", () => {
		expect(isDraftPublicStatus("scheduled")).toBe(true);

		const affordances = getPublicPaymentAffordances({
			status: "scheduled",
			balance: 2000,
			automaticBankTransfer: true,
			payable: true,
		});

		expect(affordances.isDraft).toBe(true);
		expect(affordances.showCollectionPanel).toBe(false);
		expect(affordances.canUsePaystackTransfer).toBe(false);
		expect(affordances.canClaimPayment).toBe(false);
	});

	it("leaves an issued unpaid invoice's affordances unchanged", () => {
		const affordances = getPublicPaymentAffordances({
			status: "unpaid",
			balance: 2000,
			automaticBankTransfer: true,
			payable: true,
		});

		expect(affordances).toEqual({
			isDraft: false,
			showCollectionPanel: true,
			canUsePaystackTransfer: true,
			canClaimPayment: true,
		});
	});

	it("leaves overdue and partially-paid invoices unchanged", () => {
		for (const status of ["overdue", "partially-paid"] as const) {
			const affordances = getPublicPaymentAffordances({
				status,
				balance: 500,
				automaticBankTransfer: true,
				payable: true,
			});
			expect(affordances.showCollectionPanel).toBe(true);
			expect(affordances.canClaimPayment).toBe(true);
		}
	});

	it("still shows nothing once the invoice is paid", () => {
		const affordances = getPublicPaymentAffordances({
			status: "paid",
			balance: 0,
			automaticBankTransfer: true,
			payable: true,
		});

		expect(affordances.showCollectionPanel).toBe(false);
		expect(affordances.canUsePaystackTransfer).toBe(false);
		expect(affordances.canClaimPayment).toBe(false);
	});

	it("keeps the manual claim available when online collection is off", () => {
		const affordances = getPublicPaymentAffordances({
			status: "unpaid",
			balance: 2000,
			automaticBankTransfer: false,
		});

		expect(affordances.showCollectionPanel).toBe(false);
		expect(affordances.canClaimPayment).toBe(true);
	});

	it("names the draft state so the page can explain it", () => {
		expect(PUBLIC_DRAFT_PAYMENT_NOTICE).toBe(
			"This invoice is a draft and is not payable yet.",
		);
	});
});

/**
 * Issue #3 finding 4: a draft said "Amount due" next to a zero balance while
 * its own notice said it was not payable. The prominent figure must be the
 * draft's total instead.
 */
describe("getPublicPrimaryAmount", () => {
	it("shows the draft's total, not a zero amount due", () => {
		expect(
			getPublicPrimaryAmount({
				status: "draft",
				total: 155_000,
				balance: 0,
				paymentAmount: 0,
			}),
		).toEqual({ label: "Draft total", value: 155_000 });
	});

	it("treats a scheduled document as a draft", () => {
		expect(
			getPublicPrimaryAmount({
				status: "scheduled",
				total: 155_000,
				balance: 155_000,
				paymentAmount: 0,
			}),
		).toEqual({ label: "Draft total", value: 155_000 });
	});

	it("shows the open balance on an issued invoice", () => {
		expect(
			getPublicPrimaryAmount({
				status: "partially-paid",
				total: 155_000,
				balance: 100_000,
				paymentAmount: 55_000,
			}),
		).toEqual({ label: "Amount due", value: 100_000 });
	});

	it("shows what was paid once settled", () => {
		expect(
			getPublicPrimaryAmount({
				status: "paid",
				total: 155_000,
				balance: 0,
				paymentAmount: 155_000,
			}),
		).toEqual({ label: "Amount paid", value: 155_000 });
	});
});
