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

/**
 * Versioned Nigeria tax rules. Rates are expressed as percentages and belong
 * to an explicit rule set with an effective window and the issuing authority.
 * Changing a rate means adding a new rule set and moving the current pointer
 * (`NIGERIA_TAX_RULE_SET_VERSION`) — never editing a row in place.
 */
export type NigeriaWithholdingRateTable = {
	resident: number;
	nonResident: number;
};

export type NigeriaTaxRuleSet = {
	id: string;
	label: string;
	authority: string;
	/** ISO date the rule set became the effective source of truth. */
	effectiveFrom: string;
	/** ISO date the rule set stopped being effective. Absent while current. */
	effectiveTo?: string;
	/** Standard VAT percentage for taxable supplies. */
	vatRate: number;
	withholdingRates: Record<WithholdingCategory, NigeriaWithholdingRateTable>;
};

const WHT_RATES: Record<WithholdingCategory, NigeriaWithholdingRateTable> = {
	none: { resident: 0, nonResident: 0 },
	goods_materials: { resident: 2, nonResident: 0 },
	general_services: { resident: 2, nonResident: 5 },
	major_construction: { resident: 2, nonResident: 5 },
	telecom_colocation: { resident: 2, nonResident: 5 },
	professional_fees: { resident: 5, nonResident: 10 },
	other_construction: { resident: 5, nonResident: 10 },
	brokerage: { resident: 5, nonResident: 10 },
	rent_hire_lease: { resident: 10, nonResident: 10 },
};

/**
 * The full Nigeria rule-set history. Append-only: a rule set is added when the
 * authority changes a rate, and `effectiveTo` is set on the retired set.
 */
const currentNigeriaRuleSet: NigeriaTaxRuleSet = {
	id: NIGERIA_TAX_RULE_SET_VERSION,
	label: "Nigeria 2026 Q1 tax rules",
	authority: NIGERIA_AUTHORITY_LABEL,
	effectiveFrom: "2026-01-01",
	vatRate: 7.5,
	withholdingRates: WHT_RATES,
};

export const NIGERIA_TAX_RULE_SETS: readonly NigeriaTaxRuleSet[] = [
	currentNigeriaRuleSet,
];

/**
 * Rule-set ids earlier Velure versions wrote into workspaces before rule sets
 * were versioned. They all represented the same Nigeria rules; the read path
 * resolves them and the write path normalizes them to the canonical id.
 */
const LEGACY_RULE_SET_ALIASES: Readonly<Record<string, string>> = {
	"ng-nrs-2026.1": NIGERIA_TAX_RULE_SET_VERSION,
	"NG-2026-v1": NIGERIA_TAX_RULE_SET_VERSION,
};

export type NigeriaRuleSetStatus =
	| "current"
	| "legacy_alias"
	| "superseded"
	| "unknown";

export function getNigeriaRuleSet(
	versionId: string | null | undefined,
): NigeriaTaxRuleSet | undefined {
	if (!versionId) return undefined;
	return NIGERIA_TAX_RULE_SETS.find((ruleSet) => ruleSet.id === versionId);
}

/** Maps legacy ids and the canonical id to a canonical rule-set id. */
export function resolveNigeriaRuleSetId(
	versionId: string | null | undefined,
): string {
	if (!versionId) return NIGERIA_TAX_RULE_SET_VERSION;
	return LEGACY_RULE_SET_ALIASES[versionId] ?? versionId;
}

/**
 * Resolves any stored version string to a real rule set. Unknown versions fall
 * back to the current rule set so tax calculation never silently zeroes out.
 */
export function resolveNigeriaRuleSet(
	versionId: string | null | undefined,
): NigeriaTaxRuleSet {
	const canonical = resolveNigeriaRuleSetId(versionId);
	return getNigeriaRuleSet(canonical) ?? currentNigeriaRuleSet;
}

export function isKnownNigeriaRuleSetVersion(
	versionId: string | null | undefined,
): boolean {
	if (!versionId) return false;
	return getNigeriaRuleSet(resolveNigeriaRuleSetId(versionId)) !== undefined;
}

/**
 * Classifies a stored version string for display. `legacy_alias` means an old
 * Velure default id that resolves to the current rules; `superseded` means a
 * known rule set that is no longer current; `unknown` needs review.
 */
export function classifyNigeriaRuleSetVersion(
	versionId: string | null | undefined,
): NigeriaRuleSetStatus {
	if (!versionId) return "unknown";
	if (versionId === NIGERIA_TAX_RULE_SET_VERSION) return "current";
	if (LEGACY_RULE_SET_ALIASES[versionId]) return "legacy_alias";
	return getNigeriaRuleSet(versionId) ? "superseded" : "unknown";
}

/**
 * Write-boundary guard for workspace rule-set versions. Accepts the canonical
 * id and known legacy aliases (normalizing them to the canonical id) and
 * rejects anything else so stale or typo'd versions cannot be stored.
 */
export function normalizeRuleSetVersionForWrite(
	versionId: string | null | undefined,
): string {
	if (!versionId) {
		throw new Error("A Nigeria tax rule set version is required.");
	}
	const canonical = resolveNigeriaRuleSetId(versionId);
	if (!getNigeriaRuleSet(canonical)) {
		throw new Error(
			`Unknown Nigeria tax rule set "${versionId}". Update the workspace to a known rule set.`,
		);
	}
	return canonical;
}

export const NIGERIA_VAT_RATE = currentNigeriaRuleSet.vatRate;

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
	ruleSetVersion?: string;
}) {
	if (input.manualOverride && typeof input.rate === "number") {
		return input.rate;
	}

	const ruleSet = resolveNigeriaRuleSet(input.ruleSetVersion);
	const table = ruleSet.withholdingRates[input.category];
	return input.recipientResidency === "resident"
		? table.resident
		: table.nonResident;
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
