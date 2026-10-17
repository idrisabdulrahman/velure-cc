import { describe, expect, it } from "vitest";
import type { SupplierProfileInput } from "./supplier-profile";
import {
	composeSupplierAddress,
	supplierProfileBanner,
	validateSupplierProfile,
	validateSupplierRcNumber,
	validateSupplierTin,
} from "./supplier-profile";

describe("validateSupplierTin (B1, SPEC 6.2 item 4)", () => {
	it.each([
		["plain 10-digit", "1234560000"],
		["digits with spaces are compacted", " 1234 5600 00 "],
		["leading/trailing whitespace tolerated", "\t2345678901\n"],
	])("accepts %s", (_label, value) => {
		const result = validateSupplierTin(value);
		expect(result.ok).toBe(true);
	});

	it.each([
		["empty", ""],
		["null", null],
		["undefined", undefined],
		["whitespace only", "   "],
	])("rejects %s as missing", (_label, value) => {
		const result = validateSupplierTin(value);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("tin_required");
	});

	it.each([
		["too short", "123456789"],
		["too long", "12345678901"],
		["letters", "123456789A"],
		["alphanumeric", "1234567890A"],
	])("rejects %s as a format problem", (_label, value) => {
		const result = validateSupplierTin(value);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("tin_format");
	});

	it.each([
		["the walkthrough placeholder", "1234567890"],
		["all zeros", "0000000000"],
		["all ones", "1111111111"],
		["all nines", "9999999999"],
		["ascending sequence", "0123456789"],
		["descending sequence", "9876543210"],
	])("rejects the placeholder class: %s", (_label, value) => {
		const result = validateSupplierTin(value);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("tin_placeholder");
	});
});

describe("validateSupplierRcNumber (B1 required CAC RC)", () => {
	it.each([
		["canonical form", "RC-1234567"],
		["canonical form is case-insensitive", "rc-1234567"],
		["missing hyphen is normalized", "RC1234567"],
		["surrounding whitespace tolerated", " RC-1234567 "],
	])("accepts and normalizes %s", (_label, value) => {
		const result = validateSupplierRcNumber(value);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.rcNumber).toBe("RC-1234567");
	});

	it("compacts internal whitespace (the migration backfill deliberately does not)", () => {
		// Intended validator/migration difference: the app normalises on save,
		// the one-time SQL backfill only trims ends and flags, so a stored
		// "RC 1234567" is flagged cac_rc_format there but accepted and
		// rewritten to RC-1234567 here on the next save.
		const result = validateSupplierRcNumber("RC 1234567");
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.rcNumber).toBe("RC-1234567");
	});

	it.each([
		["empty", ""],
		["null", null],
		["whitespace only", "   "],
	])("flags %s as missing", (_label, value) => {
		const result = validateSupplierRcNumber(value);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("cac_rc_required");
	});

	it.each([
		["too few digits", "RC-1234"],
		["too many digits", "RC-12345678"],
		["bare digits", "1234567"],
		["company suffix", "LTD-1234567"],
		["letters inside", "RC-123A567"],
	])("rejects %s as malformed", (_label, value) => {
		const result = validateSupplierRcNumber(value);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("cac_rc_format");
	});
});

describe("validateSupplierProfile structured address (B1)", () => {
	const validNg = {
		tin: "1234560000",
		rcNumber: "RC-1234567",
		address: {
			street: "12 Wetheral Road",
			lga: "Apapa",
			state: "Lagos",
			countryCode: "NG",
		},
	};

	it("passes with street, state and country for a Nigeria workspace", () => {
		const result = validateSupplierProfile(validNg);
		expect(result.valid).toBe(true);
		expect(result.status).toBe("complete");
		expect(result.issues).toEqual([]);
		expect(result.normalized.rcNumber).toBe("RC-1234567");
	});

	it.each([
		["missing street", { street: "" }, "address_street_required"],
		["missing state", { state: "" }, "address_state_required"],
		["missing country", { countryCode: "" }, "address_country_required"],
		[
			"malformed country",
			{ countryCode: "Nigeria" },
			"address_country_required",
		],
	])("requires the structured address field: %s", (_label, part, code) => {
		const result = validateSupplierProfile({
			...validNg,
			address: { ...validNg.address, ...part },
		});
		expect(result.valid).toBe(false);
		expect(result.status).toBe("needs_review");
		expect(result.issues.map((issue) => issue.code)).toContain(code);
	});

	it("keeps LGA optional", () => {
		const result = validateSupplierProfile({
			...validNg,
			address: { ...validNg.address, lga: "" },
		});
		expect(result.valid).toBe(true);
	});

	it("requires TIN and CAC RC for Nigeria workspaces", () => {
		const result = validateSupplierProfile({
			tin: "",
			rcNumber: "",
			address: validNg.address,
		});
		expect(result.issues.map((issue) => issue.code).sort()).toEqual([
			"cac_rc_required",
			"tin_required",
		]);
	});

	it("does not apply the Nigeria TIN/RC formats to other jurisdictions", () => {
		const result = validateSupplierProfile({
			tin: "",
			rcNumber: "",
			address: { ...validNg.address, countryCode: "GB" },
		});
		expect(result.valid).toBe(true);
		expect(result.issues).toEqual([]);
	});

	it("rejects placeholder TINs through the profile path too", () => {
		const result = validateSupplierProfile({
			...validNg,
			tin: "1234567890",
		});
		expect(result.valid).toBe(false);
		expect(result.issues.map((issue) => issue.code)).toEqual([
			"tin_placeholder",
		]);
	});

	it("composes a printable address from the structured parts", () => {
		expect(
			composeSupplierAddress({
				street: "12 Wetheral Road",
				lga: "Apapa",
				state: "Lagos",
			}),
		).toBe("12 Wetheral Road, Apapa, Lagos");
		expect(composeSupplierAddress({ street: "", lga: "", state: "" })).toBe("");
	});

	it("never emits address_not_structured (reserved for the migration backfill)", () => {
		// Intended validator/migration difference: address_not_structured is
		// produced only by the one-time SQL backfill, which can read the legacy
		// free-text `address` column. The app validator only sees the
		// structured columns, so it always names the missing part instead.
		const cases: SupplierProfileInput[] = [
			validNg,
			{ ...validNg, tin: "", rcNumber: "" },
			{ ...validNg, tin: "1234567890" },
			{ ...validNg, rcNumber: "LTD-1234" },
			{ ...validNg, address: { ...validNg.address, street: "" } },
			{ ...validNg, address: { ...validNg.address, state: "" } },
			{ ...validNg, address: { ...validNg.address, countryCode: "" } },
		];
		for (const input of cases) {
			const codes = validateSupplierProfile(input).issues.map(
				(issue) => issue.code,
			);
			expect(codes).not.toContain("address_not_structured");
		}
	});
});

describe("supplierProfileBanner (settings flag recomputed after save)", () => {
	const validNg: SupplierProfileInput = {
		tin: "1234560000",
		rcNumber: "RC-1234567",
		address: {
			street: "12 Wetheral Road",
			lga: "Apapa",
			state: "Lagos",
			countryCode: "NG",
		},
	};

	it("shows the stored flag when nothing has been saved this session", () => {
		const banner = supplierProfileBanner(
			{ status: "needs_review", issues: ["tin_placeholder", "tin_required"] },
			null,
		);
		expect(banner).toEqual({
			flagged: true,
			codes: ["tin_placeholder", "tin_required"],
		});
	});

	it("clears a stale stored flag once the profile has been re-saved", () => {
		// Regression (audit round 1): after a successful save the query cache
		// still held the pre-save needs_review flag, so the banner stayed up.
		// The just-saved validation supersedes it until the refetch lands.
		const banner = supplierProfileBanner(
			{ status: "needs_review", issues: ["tin_placeholder"] },
			validateSupplierProfile(validNg),
		);
		expect(banner).toEqual({ flagged: false, codes: [] });
	});

	it("keeps the banner hidden for a complete stored profile", () => {
		expect(
			supplierProfileBanner({ status: "complete", issues: [] }, null),
		).toEqual({ flagged: false, codes: [] });
	});

	it("still flags a saved profile that fails validation", () => {
		const banner = supplierProfileBanner(
			{ status: "complete", issues: [] },
			validateSupplierProfile({ ...validNg, tin: "1234567890" }),
		);
		expect(banner).toEqual({ flagged: true, codes: ["tin_placeholder"] });
	});
});
