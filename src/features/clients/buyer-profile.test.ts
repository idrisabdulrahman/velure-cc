import { describe, expect, it } from "vitest";
import {
	DEFAULT_BUYER_TYPE,
	normalizeBuyerType,
	validateBuyerProfile,
} from "./buyer-profile";

/**
 * B2 — buyer profile validation rules (SPEC §3.1 P3/P4, §5.B row B2).
 * TIN rules are FORMAT checks shared with B1, never legal verification.
 */

const validB2b = {
	name: "Acme Limited",
	email: "billing@acme.test",
	billingAddress: "12 Wetheral Road, Apapa, Lagos",
	taxId: "8129473650",
	buyerType: "b2b",
};

const validB2c = {
	name: "Ada Obi",
	email: "ada@example.test",
	billingAddress: "7 Marina Road, Lagos",
	taxId: undefined,
	buyerType: "b2c",
};

const codes = (result: ReturnType<typeof validateBuyerProfile>) =>
	result.issues.map((issue) => issue.code);

describe("validateBuyerProfile", () => {
	it("accepts a complete B2B buyer", () => {
		const result = validateBuyerProfile(validB2b);
		expect(result.valid).toBe(true);
		expect(result.complete).toBe(true);
		expect(result.status).toBe("complete");
		expect(result.issues).toEqual([]);
		expect(result.normalized.buyerType).toBe("b2b");
		expect(result.normalized.taxId).toBe("8129473650");
	});

	it("accepts a B2C buyer without a TIN", () => {
		const result = validateBuyerProfile(validB2c);
		expect(result.valid).toBe(true);
		expect(result.complete).toBe(true);
		expect(result.normalized.buyerType).toBe("b2c");
		expect(result.normalized.taxId).toBe("");
	});

	it("requires a TIN for B2B buyers (flag, not rejection)", () => {
		const result = validateBuyerProfile({ ...validB2b, taxId: "" });
		expect(codes(result)).toEqual(["tin_required"]);
		expect(result.complete).toBe(false);
		expect(result.status).toBe("needs_review");
		// A missing TIN is a completeness gap, not a format error: the server
		// write path flags it instead of rejecting the save.
		expect(result.valid).toBe(true);
	});

	it("validates a TIN that IS provided by a B2C buyer", () => {
		const bad = validateBuyerProfile({ ...validB2c, taxId: "12345" });
		expect(codes(bad)).toContain("tin_format");
		expect(bad.valid).toBe(false);
	});

	it.each([
		["walkthrough placeholder", "1234567890"],
		["all zeros", "0000000000"],
		["all ones", "1111111111"],
	])("rejects a placeholder TIN (%s)", (_label, taxId) => {
		const result = validateBuyerProfile({ ...validB2b, taxId });
		expect(codes(result)).toEqual(["tin_placeholder"]);
		expect(result.valid).toBe(false);
	});

	it("requires name and email and rejects a malformed email", () => {
		expect(codes(validateBuyerProfile({ ...validB2b, name: " " }))).toEqual([
			"name_required",
		]);
		expect(codes(validateBuyerProfile({ ...validB2b, email: "" }))).toEqual([
			"email_required",
		]);
		const badEmail = validateBuyerProfile({
			...validB2b,
			email: "not-an-email",
		});
		expect(codes(badEmail)).toEqual(["email_format"]);
		expect(badEmail.valid).toBe(false);
	});

	it("requires an address for both buyer types (flag, not rejection)", () => {
		for (const buyer of [validB2b, validB2c]) {
			const result = validateBuyerProfile({ ...buyer, billingAddress: "" });
			expect(codes(result)).toEqual(["address_required"]);
			expect(result.valid).toBe(true);
			expect(result.status).toBe("needs_review");
		}
	});

	it("rejects an address over the column cap", () => {
		const result = validateBuyerProfile({
			...validB2b,
			billingAddress: "a".repeat(301),
		});
		expect(codes(result)).toEqual(["address_too_long"]);
		expect(result.valid).toBe(false);
	});

	it("rejects an invalid buyer type and defaults blank to B2B", () => {
		const invalid = validateBuyerProfile({ ...validB2b, buyerType: "b2b2b" });
		expect(codes(invalid)).toEqual(["buyer_type_invalid"]);
		expect(invalid.valid).toBe(false);

		expect(normalizeBuyerType(undefined)).toBe(DEFAULT_BUYER_TYPE);
		expect(normalizeBuyerType("")).toBe(DEFAULT_BUYER_TYPE);
		expect(normalizeBuyerType(" B2C ")).toBe("b2c");
		expect(normalizeBuyerType("enterprise")).toBeNull();
	});

	it("normalizes email case and TIN whitespace", () => {
		const result = validateBuyerProfile({
			...validB2b,
			email: " Billing@Acme.TEST ",
			taxId: "8129 4736 50",
		});
		expect(result.valid).toBe(true);
		expect(result.normalized.email).toBe("billing@acme.test");
		expect(result.normalized.taxId).toBe("8129473650");
	});

	it("collects every issue at once", () => {
		const result = validateBuyerProfile({
			name: "",
			email: "nope",
			billingAddress: "",
			taxId: "",
			buyerType: "b2b",
		});
		expect(codes(result).sort()).toEqual([
			"address_required",
			"email_format",
			"name_required",
			"tin_required",
		]);
		expect(result.valid).toBe(false);
	});
});
