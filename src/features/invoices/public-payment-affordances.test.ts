import { describe, expect, it } from "vitest";
import {
	getPublicPaymentAffordances,
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
