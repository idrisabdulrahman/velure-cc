import type {
	InvoiceWithholdingSnapshot,
	LegacyWithholdingTaxPreset,
	SellerTaxStatus,
	TaxTreatment,
	WithholdingCategory,
	WithholdingRecipientEntityType,
	WithholdingRecipientResidency,
} from "./types";

export const NIGERIA_VAT_RATE = 7.5;
export const NIGERIA_DEFAULT_CURRENCY = "NGN";
export const NIGERIA_AUTHORITY_LABEL = "Nigeria Revenue Service (NRS)";
export const NIGERIA_TAX_RULE_SET_VERSION = "ng-2026-q1";
export const NIGERIA_FOREIGN_CURRENCY_WARNING =
	"Foreign currency invoices must be settled through a CBN-licensed financial institution. Confirm with your accountant before issuing.";
export const RESEND_FREE_TIER_DAILY_LIMIT = 100;

export const NIGERIA_TIN_REGEX = /^\d{10}$/;
export const NIGERIA_RC_REGEX = /^RC-\d{7}$/i;
const NIGERIA_LOCAL_PHONE_REGEX = /^0\d{10}$/;
const NIGERIA_E164_PHONE_REGEX = /^\+234\d{10}$/;

export const SELLER_TAX_STATUS_OPTIONS: Array<{
	value: SellerTaxStatus;
	label: string;
	description: string;
}> = [
	{
		value: "vat_registered",
		label: "VAT registered",
		description: "Charge 7.5% VAT by default on domestic Nigeria invoices.",
	},
	{
		value: "below_threshold_not_charging_vat",
		label: "Below threshold",
		description:
			"Do not charge VAT by default because the workspace is below threshold.",
	},
	{
		value: "statutorily_exempt",
		label: "Statutorily exempt",
		description: "Mark domestic invoices exempt by default.",
	},
];

export const WITHHOLDING_CATEGORY_OPTIONS: Array<{
	value: WithholdingCategory;
	label: string;
	description: string;
}> = [
	{
		value: "none",
		label: "No WHT",
		description: "Do not deduct withholding tax.",
	},
	{
		value: "goods_materials",
		label: "Goods / materials",
		description:
			"Supply of goods or materials other than by the manufacturer or producer.",
	},
	{
		value: "general_services",
		label: "General services",
		description: "Services other than specifically listed categories.",
	},
	{
		value: "professional_fees",
		label: "Professional fees",
		description:
			"Commission, consultancy, technical, management, and professional fees.",
	},
	{
		value: "major_construction",
		label: "Major construction",
		description: "Construction of roads, bridges, buildings, and power plants.",
	},
	{
		value: "other_construction",
		label: "Other construction",
		description: "Any other form of construction and related activities.",
	},
	{
		value: "telecom_colocation",
		label: "Telecom co-location",
		description: "Co-location and telecommunication tower services.",
	},
	{
		value: "brokerage",
		label: "Brokerage",
		description: "Brokerage fees.",
	},
	{
		value: "rent_hire_lease",
		label: "Rent / hire / lease",
		description: "Rent, hire, or lease transactions.",
	},
];

export const WITHHOLDING_ENTITY_TYPE_OPTIONS: Array<{
	value: WithholdingRecipientEntityType;
	label: string;
}> = [
	{ value: "corporate", label: "Corporate" },
	{ value: "non_corporate", label: "Non-corporate" },
];

export const WITHHOLDING_RESIDENCY_OPTIONS: Array<{
	value: WithholdingRecipientResidency;
	label: string;
}> = [
	{ value: "resident", label: "Resident" },
	{ value: "non_resident", label: "Non-resident" },
];

export function defaultTaxTreatmentForSellerTaxStatus(
	sellerTaxStatus?: SellerTaxStatus,
): TaxTreatment {
	if (sellerTaxStatus === "vat_registered") return "exclusive_rate";
	if (sellerTaxStatus === "statutorily_exempt") return "exempt";
	return "none";
}

export function defaultWithholdingSelection(): InvoiceWithholdingSnapshot {
	return {
		mode: "rule_based",
		category: "none",
		recipientEntityType: "corporate",
		recipientResidency: "resident",
		rate: 0,
		amount: 0,
		ruleVersion: NIGERIA_TAX_RULE_SET_VERSION,
		manualOverride: false,
	};
}

function rateFromRule(
	category: WithholdingCategory,
	recipientResidency: WithholdingRecipientResidency,
): number {
	switch (category) {
		case "none":
			return 0;
		case "goods_materials":
			return recipientResidency === "resident" ? 2 : 0;
		case "general_services":
		case "major_construction":
		case "telecom_colocation":
			return recipientResidency === "resident" ? 2 : 5;
		case "professional_fees":
		case "other_construction":
		case "brokerage":
			return recipientResidency === "resident" ? 5 : 10;
		case "rent_hire_lease":
			return 10;
		default:
			return 0;
	}
}

export function resolveWithholdingRate(input: {
	category: WithholdingCategory;
	recipientEntityType: WithholdingRecipientEntityType;
	recipientResidency: WithholdingRecipientResidency;
	manualOverride?: boolean;
	rate?: number;
}) {
	if (input.manualOverride && typeof input.rate === "number") {
		return input.rate;
	}

	return rateFromRule(input.category, input.recipientResidency);
}

export function withholdingLabelForCategory(category: WithholdingCategory) {
	return (
		WITHHOLDING_CATEGORY_OPTIONS.find((entry) => entry.value === category)
			?.label ?? "WHT"
	);
}

export function legacyWithholdingSelectionFromPreset(
	preset?: LegacyWithholdingTaxPreset,
): InvoiceWithholdingSnapshot {
	if (!preset || preset === "none") {
		return defaultWithholdingSelection();
	}

	if (preset === "consultancy_company") {
		return {
			mode: "legacy_manual",
			category: "professional_fees",
			recipientEntityType: "corporate",
			recipientResidency: "resident",
			rate: 10,
			amount: 0,
			ruleVersion: NIGERIA_TAX_RULE_SET_VERSION,
			manualOverride: true,
			overrideNote: "Migrated from legacy consultancy company WHT preset.",
			legacyPreset: preset,
		};
	}

	if (preset === "consultancy_individual") {
		return {
			mode: "legacy_manual",
			category: "professional_fees",
			recipientEntityType: "non_corporate",
			recipientResidency: "resident",
			rate: 5,
			amount: 0,
			ruleVersion: NIGERIA_TAX_RULE_SET_VERSION,
			manualOverride: true,
			overrideNote: "Migrated from legacy consultancy individual WHT preset.",
			legacyPreset: preset,
		};
	}

	if (preset === "rent_interest") {
		return {
			mode: "legacy_manual",
			category: "rent_hire_lease",
			recipientEntityType: "corporate",
			recipientResidency: "resident",
			rate: 10,
			amount: 0,
			ruleVersion: NIGERIA_TAX_RULE_SET_VERSION,
			manualOverride: true,
			overrideNote: "Migrated from legacy rent/interest WHT preset.",
			legacyPreset: preset,
		};
	}

	return {
		mode: "legacy_manual",
		category: "general_services",
		recipientEntityType: "corporate",
		recipientResidency: "resident",
		rate: 5,
		amount: 0,
		ruleVersion: NIGERIA_TAX_RULE_SET_VERSION,
		manualOverride: true,
		overrideNote: "Migrated from legacy contracts/supplies WHT preset.",
		legacyPreset: preset,
	};
}

export function legacyPresetFromWithholding(
	withholding: Pick<
		InvoiceWithholdingSnapshot,
		"legacyPreset" | "mode" | "category"
	>,
) {
	if (withholding.legacyPreset) return withholding.legacyPreset;
	if (withholding.mode === "legacy_manual") {
		if (withholding.category === "rent_hire_lease") return "rent_interest";
		if (withholding.category === "professional_fees")
			return "consultancy_company";
		if (withholding.category === "general_services")
			return "contracts_supplies";
	}
	return "none";
}

export function isValidNigeriaTin(value?: string | null) {
	return Boolean(value && NIGERIA_TIN_REGEX.test(value.trim()));
}

export function isValidRcNumber(value?: string | null) {
	return Boolean(value && NIGERIA_RC_REGEX.test(value.trim()));
}

export function normalizeNigeriaPhone(value?: string | null) {
	const normalized = value?.trim().replace(/\s+/g, "");
	if (!normalized) return undefined;

	if (NIGERIA_E164_PHONE_REGEX.test(normalized)) {
		return normalized;
	}

	if (NIGERIA_LOCAL_PHONE_REGEX.test(normalized)) {
		return `+234${normalized.slice(1)}`;
	}

	return value?.trim() || undefined;
}

export function formatNigerianDate(value: string | number | Date) {
	const date =
		value instanceof Date
			? value
			: typeof value === "number"
				? new Date(value)
				: new Date(value);

	if (Number.isNaN(date.getTime())) {
		return String(value);
	}

	const day = String(date.getDate()).padStart(2, "0");
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const year = date.getFullYear();
	return `${day}/${month}/${year}`;
}

export function buildSequentialInvoiceNumber(year: number, sequence: number) {
	return `INV-${year}-${String(sequence).padStart(6, "0")}`;
}
