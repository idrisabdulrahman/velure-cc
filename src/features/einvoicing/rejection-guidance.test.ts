import { describe, expect, it } from "vitest";
import { mapRejectionCodeToGuidance } from "./rejection-guidance";

describe("provider rejection guidance", () => {
	it("maps known codes to actionable invoice fixes", () => {
		expect(mapRejectionCodeToGuidance("BUYER_TIN_INVALID")).toEqual({
			code: "BUYER_TIN_INVALID",
			fix: "Check the buyer TIN and update the buyer record before retrying.",
		});
		expect(
			mapRejectionCodeToGuidance("LINE_CLASSIFICATION_MISSING")?.fix,
		).toContain("VAT category");
	});

	it("uses a safe plain-language fallback for unknown codes", () => {
		expect(mapRejectionCodeToGuidance("NEW_CODE")).toEqual({
			code: "NEW_CODE",
			fix: "Review the invoice details and contact your administrator before retrying.",
		});
		expect(mapRejectionCodeToGuidance(undefined)).toBeNull();
		expect(mapRejectionCodeToGuidance("secret buyer@email.test")).toEqual({
			code: "UNKNOWN_REJECTION",
			fix: "Review the invoice details and contact your administrator before retrying.",
		});
	});
});
