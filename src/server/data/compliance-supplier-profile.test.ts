import { describe, expect, it } from "vitest";
import { buildSupplierProfileUpdate } from "./compliance";

const validRow = {
	tax_id: "1234560000",
	rc_number: "RC-1234567",
	address: "old free text",
	address_street: "12 Wetheral Road",
	address_lga: "Apapa",
	address_state: "Lagos",
	country_code: "NG",
};

describe("buildSupplierProfileUpdate (B1 server boundary)", () => {
	it("normalizes and stores a complete Nigeria profile", () => {
		const columns = buildSupplierProfileUpdate(validRow, {
			taxId: "1234560000",
			rcNumber: "RC1234567",
			addressStreet: "12 Wetheral Road",
			addressLga: "Apapa",
			addressState: "Lagos",
			countryCode: "NG",
		});
		expect(columns).toEqual({
			tax_id: "1234560000",
			rc_number: "RC-1234567",
			address: "12 Wetheral Road, Apapa, Lagos",
			address_street: "12 Wetheral Road",
			address_lga: "Apapa",
			address_state: "Lagos",
			country_code: "NG",
			supplier_profile_status: "complete",
			supplier_profile_issues: [],
		});
	});

	it.each([
		["walkthrough placeholder", "1234567890"],
		["all zeros", "0000000000"],
		["all ones", "1111111111"],
	])("rejects a placeholder TIN: %s", (_label, tin) => {
		expect(() => buildSupplierProfileUpdate(validRow, { taxId: tin })).toThrow(
			/placeholder/i,
		);
	});

	it("rejects a malformed TIN", () => {
		expect(() =>
			buildSupplierProfileUpdate(validRow, { taxId: "12345" }),
		).toThrow(/exactly 10 digits/);
	});

	it("rejects a malformed CAC RC number", () => {
		expect(() =>
			buildSupplierProfileUpdate(validRow, { rcNumber: "LTD-1234" }),
		).toThrow(/RC-1234567/);
	});

	it("requires the CAC RC number for Nigeria workspaces", () => {
		expect(() =>
			buildSupplierProfileUpdate(validRow, { rcNumber: "" }),
		).toThrow(/CAC RC number is required/);
	});

	it("requires the structured address parts", () => {
		expect(() =>
			buildSupplierProfileUpdate(validRow, { addressState: "" }),
		).toThrow(/State or region is required/);
		expect(() =>
			buildSupplierProfileUpdate(validRow, { addressStreet: "" }),
		).toThrow(/Street address is required/);
	});

	it("keeps stored registration details when an edit omits them", () => {
		const columns = buildSupplierProfileUpdate(validRow, {
			addressStreet: "12 Wetheral Road",
			addressLga: "Apapa",
			addressState: "Lagos",
		});
		expect(columns.tax_id).toBe("1234560000");
		expect(columns.rc_number).toBe("RC-1234567");
		expect(columns.supplier_profile_status).toBe("complete");
	});

	it("treats an empty LGA as an explicit clear, not as 'keep the stored value'", () => {
		// Regression (audit round 1): the settings form coerced a cleared LGA
		// to undefined, so the clear never persisted. Contract: undefined keeps
		// the stored value, "" clears it.
		const omitted = buildSupplierProfileUpdate(validRow, {});
		expect(omitted.address_lga).toBe("Apapa");

		const cleared = buildSupplierProfileUpdate(validRow, { addressLga: "" });
		expect(cleared.address_lga).toBeNull();
		expect(cleared.address).toBe("12 Wetheral Road, Lagos");
	});

	it("refuses to persist a stored placeholder that the edit leaves in place", () => {
		const legacyPlaceholderRow = { ...validRow, tax_id: "1234567890" };
		expect(() =>
			buildSupplierProfileUpdate(legacyPlaceholderRow, {
				addressStreet: "12 Wetheral Road",
				addressState: "Lagos",
			}),
		).toThrow(/placeholder/i);
	});

	it("flags a profile that is still missing required parts, never deletes", () => {
		const flaggedRow = {
			...validRow,
			tax_id: "",
			rc_number: "",
			address_street: null,
			address_state: null,
		};
		expect(() =>
			buildSupplierProfileUpdate(flaggedRow, {
				taxId: "",
				rcNumber: "",
				addressStreet: "",
				addressState: "",
			}),
		).toThrow();
		// The input row is never mutated by the flagging/validation path.
		expect(flaggedRow).toEqual({
			...validRow,
			tax_id: "",
			rc_number: "",
			address_street: null,
			address_state: null,
		});
	});

	it("does not apply Nigeria TIN/RC requirements outside Nigeria", () => {
		const columns = buildSupplierProfileUpdate(
			{ ...validRow, tax_id: "", rc_number: "", country_code: "GB" },
			{
				addressStreet: "10 Downing Street",
				addressLga: "",
				addressState: "London",
			},
		);
		expect(columns.supplier_profile_status).toBe("complete");
		expect(columns.country_code).toBe("GB");
		expect(columns.address).toBe("10 Downing Street, London");
	});

	it("only ever writes the whitelisted supplier profile columns", () => {
		const columns = buildSupplierProfileUpdate(validRow, {});
		expect(Object.keys(columns).sort()).toEqual([
			"address",
			"address_lga",
			"address_state",
			"address_street",
			"country_code",
			"rc_number",
			"supplier_profile_issues",
			"supplier_profile_status",
			"tax_id",
		]);
	});
});
