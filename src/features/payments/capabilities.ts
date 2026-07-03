export type PaymentCapabilities = {
	automaticBankTransfer: boolean;
	provider: "paystack" | null;
};

export const PAYSTACK_PWT_COUNTRIES = ["NG"] as const;

type WorkspaceLike = {
	countryCode?: string | null;
};

export function getPaymentCapabilities(
	workspace: WorkspaceLike | null | undefined,
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
