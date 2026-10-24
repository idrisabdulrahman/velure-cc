export type JurisdictionCode =
	| "NG"
	| "GH"
	| "KE"
	| "ZA"
	| "US"
	| "GB"
	| "EU"
	| "OTHER";

export type TaxTreatment =
	| "none"
	| "exclusive_rate"
	| "inclusive_rate"
	| "reverse_charge"
	| "exempt"
	| "zero_rated";

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

export type WithholdingMode = "rule_based" | "legacy_manual";

export type ComplianceWarningCode =
	| "missing_seller_tax_id"
	| "missing_buyer_tax_id"
	| "cross_border_review"
	| "reverse_charge_review"
	| "unknown_jurisdiction"
	| "domestic_vat_not_applied"
	| "missing_workspace_tax_status"
	| "manual_tax_override"
	| "manual_wht_override"
	| "legacy_wht_mapping";

export type TemplateVariant = "default_ng" | "cross_border" | "vat_ready";

export type BusinessIdentity = {
	legalName?: string;
	tradingName?: string;
	email?: string;
	phone?: string;
	address?: string;
	website?: string;
	countryCode?: JurisdictionCode;
	taxId?: string;
	rcNumber?: string;
};

export type InvoiceTaxLine = {
	label: string;
	rate: number;
	amount: number;
	treatment: TaxTreatment;
	jurisdictionCode: JurisdictionCode;
};

export type InvoiceWithholdingSnapshot = {
	mode: WithholdingMode;
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

export type FiscalizationSnapshot = {
	status:
		| "not_configured"
		| "ready"
		| "pending"
		| "fiscalized"
		| "mock_cleared"
		| "failed";
	provider?: "mock";
	environment?: "sandbox";
	mock?: boolean;
	mockIrn?: string;
	uid?: string;
	sid?: string;
	qrCodePayload?: string;
	clearedAt?: number;
	lastError?: string;
	lastAttemptAt?: number;
};

export type InvoiceComplianceSnapshot = {
	seller: BusinessIdentity;
	buyer: BusinessIdentity;
	sellerTaxStatus?: SellerTaxStatus;
	placeOfSupply: JurisdictionCode;
	taxRuleSetVersion: string;
	taxTreatment: TaxTreatment;
	taxRate: number;
	taxLabel: string;
	taxLines: InvoiceTaxLine[];
	warnings: ComplianceWarningCode[];
	templateVariant: TemplateVariant;
	subtotal: number;
	totalTax: number;
	withholding: InvoiceWithholdingSnapshot;
	withholdingTaxPreset: LegacyWithholdingTaxPreset;
	withholdingTaxLabel: string;
	withholdingTaxRate: number;
	withholdingTaxAmount: number;
	netPayable: number;
	regulatoryNotice?: string;
	grandTotal: number;
	fiscalization?: FiscalizationSnapshot;
};

export const JURISDICTION_OPTIONS: Array<{
	value: JurisdictionCode;
	label: string;
}> = [
	{ value: "NG", label: "Nigeria" },
	{ value: "OTHER", label: "Outside Nigeria" },
];

export const TAX_TREATMENT_OPTIONS: Array<{
	value: TaxTreatment;
	label: string;
}> = [
	{ value: "none", label: "No tax" },
	{ value: "exclusive_rate", label: "Add tax on top" },
	{ value: "inclusive_rate", label: "Tax included in prices" },
	{ value: "reverse_charge", label: "Reverse charge" },
	{ value: "exempt", label: "Exempt" },
	{ value: "zero_rated", label: "Zero rated" },
];
