import { describe, expect, it } from "vitest";
import { formatCurrencyForPDF } from "./pdf-format";

describe("formatCurrencyForPDF", () => {
	it("uses the NGN code instead of the Naira glyph for PDF-safe output", () => {
		const formatted = formatCurrencyForPDF({
			amount: 20000,
			currency: "NGN",
			locale: "en-NG",
			currencyDisplay: "symbol",
		});

		expect(formatted).toBe("NGN 20,000.00");
		expect(formatted).not.toContain("₦");
	});

	it("preserves negative NGN amounts without the Naira glyph", () => {
		const formatted = formatCurrencyForPDF({
			amount: -10200,
			currency: "NGN",
			locale: "en-NG",
			currencyDisplay: "symbol",
		});

		expect(formatted).toBe("-NGN 10,200.00");
		expect(formatted).not.toContain("₦");
	});

	it("keeps non-NGN symbol formatting unchanged", () => {
		expect(
			formatCurrencyForPDF({
				amount: 1200,
				currency: "USD",
				locale: "en-US",
				currencyDisplay: "symbol",
			}),
		).toBe("$1,200.00");
	});
});
