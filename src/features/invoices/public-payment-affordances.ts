import type { InvoiceStatus } from "./types";

/**
 * Public customer page payment affordances.
 *
 * A draft (and its `scheduled` alias, which prints as a draft) has not been
 * issued, so its page must show no way to pay: no online collection panel, no
 * bank-transfer instructions, no "I've paid" action. The page used to render
 * the collection panel for any non-paid status, so a draft showed "Draft
 * invoices are not payable." *and* a bank-transfer block with the seller's
 * details and an "I've paid" button — conflicting instructions.
 *
 * Single source of truth for both the public page and its tests.
 */
export function isDraftPublicStatus(status: InvoiceStatus): boolean {
	return status === "draft" || status === "scheduled";
}

export type PublicPaymentAffordances = {
	isDraft: boolean;
	/** Online (Paystack) collection panel for a funded transfer session. */
	showCollectionPanel: boolean;
	/** "Pay by transfer" button that opens a new collection session. */
	canUsePaystackTransfer: boolean;
	/** Bank-transfer instructions and the "I've paid" action. */
	canClaimPayment: boolean;
};

export function getPublicPaymentAffordances(input: {
	status: InvoiceStatus;
	balance: number;
	/** `paymentContext.capabilities.automaticBankTransfer`. */
	automaticBankTransfer?: boolean;
	/** `paymentContext.payable`; `false` means no online collection. */
	payable?: boolean;
}): PublicPaymentAffordances {
	const isDraft = isDraftPublicStatus(input.status);
	const settled = input.status === "paid";
	const onlineCollection = Boolean(input.automaticBankTransfer);
	return {
		isDraft,
		canUsePaystackTransfer:
			!isDraft && onlineCollection && input.payable !== false && !settled,
		showCollectionPanel: !isDraft && onlineCollection && !settled,
		canClaimPayment:
			!isDraft && !settled && input.status !== "canceled" && input.balance > 0,
	};
}

/** Shown in place of the payment affordances on a draft's customer page. */
export const PUBLIC_DRAFT_PAYMENT_NOTICE =
	"This invoice is a draft and is not payable yet.";

/**
 * The single prominent figure on the customer page, with its label. A draft is
 * not payable, so it must never read "Amount due" against a zero balance — it
 * shows the draft's total instead. A settled document shows what was paid.
 */
export function getPublicPrimaryAmount(input: {
	status: InvoiceStatus;
	total: number;
	balance: number;
	paymentAmount: number;
}): { label: string; value: number } {
	if (input.status === "paid") {
		return { label: "Amount paid", value: input.paymentAmount };
	}
	if (isDraftPublicStatus(input.status)) {
		return { label: "Draft total", value: input.total };
	}
	return { label: "Amount due", value: input.balance };
}
