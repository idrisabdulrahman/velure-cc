import type { Doc } from "./_generated/dataModel";

export type PaymentCapabilities = {
	automaticBankTransfer: boolean;
	provider: "paystack" | null;
};

export const PAYSTACK_PWT_COUNTRIES = ["NG"] as const;

export function getPaymentCapabilities(
	workspace: Pick<Doc<"workspaces">, "countryCode"> | null | undefined,
): PaymentCapabilities {
	const countryCode = workspace?.countryCode?.toUpperCase();
	const supportsPaystackPwt = PAYSTACK_PWT_COUNTRIES.includes(
		countryCode as (typeof PAYSTACK_PWT_COUNTRIES)[number],
	);

	return {
		automaticBankTransfer: supportsPaystackPwt,
		provider: supportsPaystackPwt ? "paystack" : null,
	};
}
