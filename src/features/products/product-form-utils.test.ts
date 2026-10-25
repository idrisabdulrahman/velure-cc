import { describe, expect, it } from "vitest";
import { type FormState, validateProductForm } from "./product-form-utils";

const validState: FormState = {
	type: "service",
	name: "Design work",
	description: "",
	sku: "",
	unitName: "hour",
	defaultUnitPrice: "100",
	defaultTaxId: "",
	defaultVatCategory: "standard",
	defaultClassificationCode: "SVC-01",
	isActive: true,
};

describe("product classification fields", () => {
	it("requires a VAT category and goods/service code", () => {
		const result = validateProductForm(
			{
				...validState,
				defaultVatCategory: "",
				defaultClassificationCode: "  ",
			},
			true,
		);

		expect(result.isValid).toBe(false);
		expect(result.visibleVatCategoryError).toBe("VAT category is required");
		expect(result.visibleClassificationCodeError).toBe(
			"Goods/service code is required",
		);
	});

	it("accepts a complete product classification", () => {
		expect(validateProductForm(validState, true).isValid).toBe(true);
	});
});
