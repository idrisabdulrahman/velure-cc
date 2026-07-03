export const NIGERIA_VAT_RATE = 7.5;
export const NIGERIA_AUTHORITY_LABEL = "Nigeria Revenue Service (NRS)";
export const NIGERIA_TAX_RULE_SET_VERSION = "ng-2026-q1";
export const NIGERIA_FOREIGN_CURRENCY_WARNING =
	"Foreign currency invoices must be settled through a CBN-licensed financial institution. Confirm with your accountant before issuing.";
export const RESEND_FREE_TIER_DAILY_LIMIT = 100;

const TIN_REGEX = /^\d{10}$/;
const RC_REGEX = /^RC-\d{7}$/i;
const LOCAL_PHONE_REGEX = /^0\d{10}$/;
const E164_PHONE_REGEX = /^\+234\d{10}$/;

export type SellerTaxStatus =
	| "vat_registered"
	| "below_threshold_not_charging_vat"
	| "statutorily_exempt";

export type LegacyWithholdingTaxPreset =
	| "none"
	| "contracts_supplies"
	| "consultancy_company"
	| "consultancy_individual"
	| "rent_interest";

export type WithholdingCategory =
	| "none"
	| "goods_materials"
	| "general_services"
	| "professional_fees"
	| "major_construction"
	| "other_construction"
	| "telecom_colocation"
	| "brokerage"
	| "rent_hire_lease";

export type WithholdingRecipientEntityType = "corporate" | "non_corporate";
export type WithholdingRecipientResidency = "resident" | "non_resident";

export type WithholdingSnapshot = {
	mode: "rule_based" | "legacy_manual";
	category: WithholdingCategory;
	recipientEntityType: WithholdingRecipientEntityType;
	recipientResidency: WithholdingRecipientResidency;
	rate: number;
	amount: number;
	ruleVersion: string;
	manualOverride: boolean;
	overrideNote?: string;
	legacyPreset?: LegacyWithholdingTaxPreset;
};

export function defaultTaxTreatmentForSellerTaxStatus(
	status?: SellerTaxStatus,
) {
	if (status === "vat_registered") return "exclusive_rate" as const;
	if (status === "statutorily_exempt") return "exempt" as const;
	return "none" as const;
}

export function defaultWithholdingSelection(): WithholdingSnapshot {
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

export function resolveWithholdingRate(input: {
	category: WithholdingCategory;
	recipientResidency: WithholdingRecipientResidency;
	manualOverride?: boolean;
	rate?: number;
}) {
	if (input.manualOverride && typeof input.rate === "number") {
		return input.rate;
	}

	switch (input.category) {
		case "none":
			return 0;
		case "goods_materials":
			return input.recipientResidency === "resident" ? 2 : 0;
		case "general_services":
		case "major_construction":
		case "telecom_colocation":
			return input.recipientResidency === "resident" ? 2 : 5;
		case "professional_fees":
		case "other_construction":
		case "brokerage":
			return input.recipientResidency === "resident" ? 5 : 10;
		case "rent_hire_lease":
			return 10;
		default:
			return 0;
	}
}

export function withholdingLabelForCategory(category: WithholdingCategory) {
	switch (category) {
		case "goods_materials":
			return "Goods / Materials";
		case "general_services":
			return "General Services";
		case "professional_fees":
			return "Professional Fees";
		case "major_construction":
			return "Major Construction";
		case "other_construction":
			return "Other Construction";
		case "telecom_colocation":
			return "Telecom Co-location";
		case "brokerage":
			return "Brokerage";
		case "rent_hire_lease":
			return "Rent / Hire / Lease";
		default:
			return "WHT";
	}
}

export function legacyWithholdingSelectionFromPreset(
	preset?: LegacyWithholdingTaxPreset,
): WithholdingSnapshot {
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
	withholding: Pick<WithholdingSnapshot, "legacyPreset" | "mode" | "category">,
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

export function assertValidTin(value?: string) {
	if (!value) return;
	if (!TIN_REGEX.test(value.trim())) {
		throw new Error("TIN must be exactly 10 numeric digits.");
	}
}

export function assertValidRcNumber(value?: string) {
	if (!value) return;
	if (!RC_REGEX.test(value.trim())) {
		throw new Error("CAC RC Number must use the format RC-1234567.");
	}
}

export function normalizeNigeriaPhone(value?: string) {
	const normalized = value?.trim().replace(/\s+/g, "");
	if (!normalized) return undefined;
	if (E164_PHONE_REGEX.test(normalized)) return normalized;
	if (LOCAL_PHONE_REGEX.test(normalized)) {
		return `+234${normalized.slice(1)}`;
	}
	return value?.trim() || undefined;
}

export function formatInvoiceNumber(year: number, sequence: number) {
	return `INV-${year}-${String(sequence).padStart(6, "0")}`;
}
