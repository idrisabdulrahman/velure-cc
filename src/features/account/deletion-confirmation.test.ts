import { describe, expect, it } from "vitest";
import { canConfirmAccountDeletion } from "./deletion-confirmation";

describe("canConfirmAccountDeletion", () => {
	it("accepts an exact match of the business name", () => {
		expect(canConfirmAccountDeletion("Acme Ltd", "Acme Ltd")).toBe(true);
	});

	it("ignores surrounding whitespace and case", () => {
		expect(canConfirmAccountDeletion("  acme ltd  ", "Acme Ltd")).toBe(true);
	});

	it("rejects a partial or different value", () => {
		expect(canConfirmAccountDeletion("Acme", "Acme Ltd")).toBe(false);
		expect(canConfirmAccountDeletion("Acme Ltd.", "Acme Ltd")).toBe(false);
	});

	it("rejects the legacy DELETE keyword", () => {
		expect(canConfirmAccountDeletion("DELETE", "Acme Ltd")).toBe(false);
	});

	it("never matches while the keyword is empty or blank", () => {
		expect(canConfirmAccountDeletion("", "")).toBe(false);
		expect(canConfirmAccountDeletion("anything", "   ")).toBe(false);
	});
});
