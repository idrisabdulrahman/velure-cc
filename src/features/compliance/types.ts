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

/**
 * How a discount is applied to an invoice. The modes are **mutually
 * exclusive** per invoice (2026-10-30 decision):
 *
 *   * `invoice_before_tax` — one invoice-level amount reduces the taxable
 *     base before VAT, so VAT is charged on the discounted amount.
 *   * `invoice_after_tax` — one invoice-level amount is subtracted from the
 *     total after VAT.
 *   * `line` — each line carries its own discount, reducing that line's base
 *     before VAT.
 *
 * `none` means no discount. The default for a legacy stored discount that has
 * no mode is `invoice_after_tax`, which is what the document renderer already
 * displayed.
 */
export type DiscountMode =
	| "none"
	| "invoice_before_tax"
	| "invoice_after_tax"
	| "line";

export const DISCOUNT_MODE_OPTIONS: ReadonlyArray<{
	value: DiscountMode;
	label: string;
}> = [
	{ value: "none", label: "No discount" },
	{ value: "invoice_before_tax", label: "Before tax (reduces VAT base)" },
	{ value: "invoice_after_tax", label: "After tax (reduces total)" },
	{ value: "line", label: "Per line item" },
];

export function isDiscountMode(value: unknown): value is DiscountMode {
	return (
		value === "none" ||
		value === "invoice_before_tax" ||
		value === "invoice_after_tax" ||
		value === "line"
	);
}

/**
 * Structured postal address carried alongside the printable `address` string.
 *
 * The workspace supplier profile already collects street, LGA/area and
 * state/region structurally, so flattening them into one free-text string
 * (and forcing a future provider/UBL adapter to parse it back) was a needless
 * lossy step. The components are now carried through the snapshot and the
 * canonical model unchanged. `city` and `postalZone` are **not** collected by
 * Velure yet and stay absent — do not invent them
 * (docs/EINVOICE-GAP-ANALYSIS.md §5.2). Buyer records only store a single
 * free-text billing address, so a buyer postal address is normally absent too.
 */
export type StructuredPostalAddress = {
	street?: string;
	lga?: string;
	state?: string;
};

export type BusinessIdentity = {
	legalName?: string;
	tradingName?: string;
	email?: string;
	phone?: string;
	address?: string;
	postalAddress?: StructuredPostalAddress;
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
