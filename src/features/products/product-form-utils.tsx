import {
	cloneElement,
	isValidElement,
	type ReactElement,
	type ReactNode,
	useId,
} from "react";
import { Label } from "#/components/ui/label";
import type { VatCategory } from "#/features/invoices/types";

export type FormState = {
	type: "product" | "service";
	name: string;
	description: string;
	sku: string;
	unitName: string;
	defaultUnitPrice: string;
	defaultTaxId: string;
	defaultVatCategory: VatCategory | "";
	defaultClassificationCode: string;
	isActive: boolean;
};

export const VAT_CATEGORY_OPTIONS: Array<{
	value: VatCategory;
	label: string;
}> = [
	{ value: "standard", label: "Standard rated" },
	{ value: "zero_rated", label: "Zero rated" },
	{ value: "exempt", label: "Exempt" },
];

export const UNIT_OPTIONS = [
	{ value: "pcs", label: "Pieces (pcs)" },
	{ value: "unit", label: "Unit" },
	{ value: "project", label: "Project" },
	{ value: "hour", label: "Hour" },
	{ value: "day", label: "Day" },
	{ value: "month", label: "Month" },
	{ value: "kg", label: "Kilogram (kg)" },
	{ value: "litre", label: "Litre" },
];

export type ProductFormValidation = {
	nameError: string;
	unitPriceText: string;
	parsedUnitPrice: number;
	priceError: string;
	visibleNameError: string;
	visiblePriceError: string;
	vatCategoryError: string;
	classificationCodeError: string;
	visibleVatCategoryError: string;
	visibleClassificationCodeError: string;
	isValid: boolean;
};

export function validateProductForm(
	state: FormState,
	attemptedSubmit: boolean,
): ProductFormValidation {
	const nameError =
		state.name.trim().length === 0 ? "Product name is required" : "";
	const unitPriceText = state.defaultUnitPrice.trim();
	const parsedUnitPrice = Number(unitPriceText);
	const priceError =
		unitPriceText.length === 0
			? "Unit price is required"
			: !Number.isFinite(parsedUnitPrice)
				? "Unit price must be a valid number"
				: parsedUnitPrice < 0
					? "Unit price must be non-negative"
					: "";
	const visibleNameError = attemptedSubmit ? nameError : "";
	const visiblePriceError =
		attemptedSubmit || unitPriceText.length > 0 ? priceError : "";
	const vatCategoryError = state.defaultVatCategory
		? ""
		: "VAT category is required";
	const classificationCodeError = state.defaultClassificationCode.trim()
		? ""
		: "Goods/service code is required";
	const visibleVatCategoryError = attemptedSubmit ? vatCategoryError : "";
	const visibleClassificationCodeError = attemptedSubmit
		? classificationCodeError
		: "";
	const isValid =
		!nameError && !priceError && !vatCategoryError && !classificationCodeError;

	return {
		nameError,
		unitPriceText,
		parsedUnitPrice,
		priceError,
		visibleNameError,
		visiblePriceError,
		vatCategoryError,
		classificationCodeError,
		visibleVatCategoryError,
		visibleClassificationCodeError,
		isValid,
	};
}

export function Field({
	label,
	error,
	htmlFor,
	children,
}: {
	label: string;
	error?: string;
	htmlFor?: string;
	children: ReactNode;
}) {
	// When the caller does not supply an explicit id, generate one and attach it
	// to the control so the label is programmatically associated. Radix `Select`
	// children cannot receive an `id` this way, so those fields pass `htmlFor`
	// (with the id on `SelectTrigger`) instead.
	const generatedId = useId();
	const controlId = htmlFor ?? generatedId;
	const control =
		htmlFor || !isValidElement(children)
			? children
			: cloneElement(children as ReactElement<{ id?: string }>, {
					id: controlId,
				});

	return (
		<div className="space-y-1.5">
			<Label htmlFor={controlId} className="text-xs text-ink-3">
				{label}
			</Label>
			{control}
			{error ? <p className="text-xs text-danger">{error}</p> : null}
		</div>
	);
}
