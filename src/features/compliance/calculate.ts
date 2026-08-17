import {
	defaultTaxTreatmentForSellerTaxStatus,
	defaultWithholdingSelection,
	legacyPresetFromWithholding,
	legacyWithholdingSelectionFromPreset,
	NIGERIA_FOREIGN_CURRENCY_WARNING,
	NIGERIA_TAX_RULE_SET_VERSION,
	NIGERIA_VAT_RATE,
	resolveWithholdingRate,
	withholdingLabelForCategory,
} from "./nigeria";
import type {
	BusinessIdentity,
	ComplianceWarningCode,
	InvoiceComplianceSnapshot,
	InvoiceWithholdingSnapshot,
	SellerTaxStatus,
	TaxTreatment,
	TemplateVariant,
} from "./types";

type InvoiceLineLike = {
	quantity: number;
	price: number;
};

type ComplianceInput = {
	seller?: BusinessIdentity;
	buyer?: BusinessIdentity;
	sellerTaxStatus?: SellerTaxStatus;
	placeOfSupply?: InvoiceComplianceSnapshot["placeOfSupply"];
	currency?: string;
	taxTreatment?: TaxTreatment;
	taxRate?: number;
	taxLabel?: string;
	taxRuleSetVersion?: string;
	withholding?: Partial<InvoiceWithholdingSnapshot>;
	withholdingTaxPreset?: InvoiceComplianceSnapshot["withholdingTaxPreset"];
	lineItems: InvoiceLineLike[];
};

export function roundCurrency(value: number) {
	if (!Number.isFinite(value)) return 0;
	return Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;
}

export function invoiceSubtotal(lineItems: InvoiceLineLike[]) {
	return roundCurrency(
		lineItems.reduce((sum, item) => sum + item.quantity * item.price, 0),
	);
}

function resolveTemplateVariant(
	sellerCountry: string | undefined,
	buyerCountry: string | undefined,
	taxTreatment: TaxTreatment,
): TemplateVariant {
	if (sellerCountry && buyerCountry && sellerCountry !== buyerCountry) {
		return "cross_border";
	}

	if (taxTreatment === "exclusive_rate" || taxTreatment === "inclusive_rate") {
		return "vat_ready";
	}

	return "default_ng";
}

function resolveWarnings(input: {
	sellerCountry?: string;
	buyerCountry?: string;
	sellerTaxId?: string;
	buyerTaxId?: string;
	sellerTaxStatus?: SellerTaxStatus;
	taxTreatment: TaxTreatment;
	explicitTaxTreatment?: TaxTreatment;
	explicitTaxRate?: number;
	defaultTaxTreatment: TaxTreatment;
	defaultTaxRate: number;
	withholding: InvoiceWithholdingSnapshot;
}): ComplianceWarningCode[] {
	const warnings: ComplianceWarningCode[] = [];

	if (!input.sellerCountry || !input.buyerCountry) {
		warnings.push("unknown_jurisdiction");
	}

	if (
		(input.taxTreatment === "exclusive_rate" ||
			input.taxTreatment === "inclusive_rate") &&
		!input.sellerTaxId
	) {
		warnings.push("missing_seller_tax_id");
	}

	if (input.taxTreatment === "reverse_charge") {
		warnings.push("reverse_charge_review");
		if (!input.buyerTaxId) {
			warnings.push("missing_buyer_tax_id");
		}
	}

	if (
		input.sellerCountry &&
		input.buyerCountry &&
		input.sellerCountry !== input.buyerCountry
	) {
		warnings.push("cross_border_review");
	}

	if (
		input.sellerCountry === "NG" &&
		input.buyerCountry === "NG" &&
		!input.sellerTaxStatus
	) {
		warnings.push("missing_workspace_tax_status");
	}

	if (
		input.explicitTaxTreatment &&
		(input.explicitTaxTreatment !== input.defaultTaxTreatment ||
			(input.explicitTaxRate !== undefined &&
				input.explicitTaxRate !== input.defaultTaxRate))
	) {
		warnings.push("manual_tax_override");
	}

	if (input.withholding.manualOverride) {
		warnings.push("manual_wht_override");
	}

	if (input.withholding.mode === "legacy_manual") {
		warnings.push("legacy_wht_mapping");
	}

	return Array.from(new Set(warnings));
}

function resolveDomesticTaxDefaults(
	sellerCountry: string | undefined,
	buyerCountry: string | undefined,
	sellerTaxStatus: SellerTaxStatus | undefined,
) {
	if (sellerCountry === "NG" && buyerCountry === "NG") {
		const defaultTreatment =
			defaultTaxTreatmentForSellerTaxStatus(sellerTaxStatus);
		return {
			defaultTreatment,
			defaultRate: defaultTreatment === "exclusive_rate" ? NIGERIA_VAT_RATE : 0,
		};
	}

	return {
		defaultTreatment: "none" as TaxTreatment,
		defaultRate: 0,
	};
}

export function calculateInvoiceCompliance(
	input: ComplianceInput,
): InvoiceComplianceSnapshot {
	const subtotal = invoiceSubtotal(input.lineItems);
	const sellerCountry = input.seller?.countryCode;
	const buyerCountry = input.buyer?.countryCode;
	const sellerTaxStatus = input.sellerTaxStatus;
	const placeOfSupply =
		input.placeOfSupply ?? buyerCountry ?? sellerCountry ?? "NG";
	const { defaultTreatment, defaultRate } = resolveDomesticTaxDefaults(
		sellerCountry,
		buyerCountry,
		sellerTaxStatus,
	);
	const taxTreatment = input.taxTreatment ?? defaultTreatment;
	const taxRate =
		input.taxRate ??
		(taxTreatment === "exclusive_rate" ? NIGERIA_VAT_RATE : defaultRate);
	const taxRuleSetVersion =
		input.taxRuleSetVersion ?? NIGERIA_TAX_RULE_SET_VERSION;

	let totalTax = 0;
	let grandTotal = subtotal;

	if (taxTreatment === "exclusive_rate") {
		totalTax = roundCurrency((subtotal * taxRate) / 100);
		grandTotal = roundCurrency(subtotal + totalTax);
	} else if (taxTreatment === "inclusive_rate" && taxRate > 0) {
		totalTax = roundCurrency(subtotal - subtotal / (1 + taxRate / 100));
		grandTotal = subtotal;
	}

	const fallbackWithholding =
		input.withholdingTaxPreset && input.withholdingTaxPreset !== "none"
			? legacyWithholdingSelectionFromPreset(input.withholdingTaxPreset)
			: defaultWithholdingSelection();
	const resolvedWithholdingBase: InvoiceWithholdingSnapshot = {
		...fallbackWithholding,
		...input.withholding,
		category: input.withholding?.category ?? fallbackWithholding.category,
		recipientEntityType:
			input.withholding?.recipientEntityType ??
			fallbackWithholding.recipientEntityType,
		recipientResidency:
			input.withholding?.recipientResidency ??
			fallbackWithholding.recipientResidency,
		ruleVersion: input.withholding?.ruleVersion ?? taxRuleSetVersion,
		manualOverride:
			input.withholding?.manualOverride ?? fallbackWithholding.manualOverride,
		overrideNote:
			input.withholding?.overrideNote ?? fallbackWithholding.overrideNote,
		legacyPreset:
			input.withholding?.legacyPreset ?? fallbackWithholding.legacyPreset,
		rate: resolveWithholdingRate({
			category: input.withholding?.category ?? fallbackWithholding.category,
			recipientEntityType:
				input.withholding?.recipientEntityType ??
				fallbackWithholding.recipientEntityType,
			recipientResidency:
				input.withholding?.recipientResidency ??
				fallbackWithholding.recipientResidency,
			manualOverride:
				input.withholding?.manualOverride ?? fallbackWithholding.manualOverride,
			rate: input.withholding?.rate ?? fallbackWithholding.rate,
		}),
		amount: 0,
	};
	const withholdingTaxAmount =
		resolvedWithholdingBase.category === "none"
			? 0
			: roundCurrency((grandTotal * resolvedWithholdingBase.rate) / 100);
	const withholding = {
		...resolvedWithholdingBase,
		amount: withholdingTaxAmount,
	};
	const netPayable = roundCurrency(grandTotal - withholdingTaxAmount);
	const normalizedCurrency = input.currency?.trim().toUpperCase();
	const regulatoryNotice =
		normalizedCurrency && normalizedCurrency !== "NGN" && placeOfSupply === "NG"
			? NIGERIA_FOREIGN_CURRENCY_WARNING
			: undefined;

	const templateVariant = resolveTemplateVariant(
		sellerCountry,
		buyerCountry,
		taxTreatment,
	);

	const warnings = resolveWarnings({
		sellerCountry,
		buyerCountry,
		sellerTaxId: input.seller?.taxId,
		buyerTaxId: input.buyer?.taxId,
		sellerTaxStatus,
		taxTreatment,
		explicitTaxTreatment: input.taxTreatment,
		explicitTaxRate: input.taxRate,
		defaultTaxTreatment: defaultTreatment,
		defaultTaxRate: defaultRate,
		withholding,
	});

	const taxLines =
		taxTreatment === "none" ||
		taxTreatment === "exempt" ||
		taxTreatment === "zero_rated"
			? []
			: [
					{
						label: input.taxLabel ?? "VAT",
						rate: taxRate,
						amount: totalTax,
						treatment: taxTreatment,
						jurisdictionCode: placeOfSupply,
					},
				];

	return {
		seller: input.seller ?? {},
		buyer: input.buyer ?? {},
		sellerTaxStatus,
		placeOfSupply,
		taxRuleSetVersion,
		taxTreatment,
		taxRate,
		taxLabel: input.taxLabel ?? "VAT",
		taxLines,
		warnings,
		templateVariant,
		subtotal,
		totalTax,
		withholding,
		withholdingTaxPreset:
			input.withholdingTaxPreset ?? legacyPresetFromWithholding(withholding),
		withholdingTaxLabel:
			withholding.category === "none"
				? "WHT"
				: `WHT - ${withholdingLabelForCategory(withholding.category)}`,
		withholdingTaxRate: withholding.rate,
		withholdingTaxAmount,
		netPayable,
		regulatoryNotice,
		grandTotal,
	};
}

export function defaultComplianceSnapshot(): InvoiceComplianceSnapshot {
	return calculateInvoiceCompliance({
		seller: { legalName: "Velure", countryCode: "NG" },
		buyer: { countryCode: "NG" },
		sellerTaxStatus: "vat_registered",
		placeOfSupply: "NG",
		taxTreatment: "exclusive_rate",
		taxRate: NIGERIA_VAT_RATE,
		taxLabel: "VAT",
		withholding: defaultWithholdingSelection(),
		currency: "NGN",
		lineItems: [],
	});
}
