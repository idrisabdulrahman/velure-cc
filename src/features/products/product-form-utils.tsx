import { Label } from "#/components/ui/label";

export type FormState = {
	type: "product" | "service";
	name: string;
	description: string;
	sku: string;
	unitName: string;
	defaultUnitPrice: string;
	defaultTaxId: string;
	isActive: boolean;
};

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
	const isValid = !nameError && !priceError;

	return {
		nameError,
		unitPriceText,
		parsedUnitPrice,
		priceError,
		visibleNameError,
		visiblePriceError,
		isValid,
	};
}

export function Field({
	label,
	error,
	children,
}: {
	label: string;
	error?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="space-y-1.5">
			<Label className="text-xs text-[#8d938f]">{label}</Label>
			{children}
			{error ? <p className="text-xs text-[#c76f5b]">{error}</p> : null}
		</div>
	);
}
