import { describe, expect, it } from "vitest";
import { getPaymentCapabilities } from "./capabilities";

describe("payment capabilities", () => {
	it("enables Paystack Pay with Transfer for Nigerian workspaces", () => {
		expect(getPaymentCapabilities({ countryCode: "NG" })).toEqual({
			automaticBankTransfer: true,
			provider: "paystack",
		});
	});

	it("hides automatic bank transfer for unsupported countries", () => {
		expect(getPaymentCapabilities({ countryCode: "GH" })).toEqual({
			automaticBankTransfer: false,
			provider: null,
		});
	});
});
