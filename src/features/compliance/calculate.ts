import {
	lineTotalKobo,
	priceToKobo,
	subtotalKobo,
} from "#/features/invoices/line-money";
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
	DiscountMode,
	InvoiceComplianceSnapshot,
	InvoiceWithholdingSnapshot,
	SellerTaxStatus,
	TaxTreatment,
	TemplateVariant,
} from "./types";

type InvoiceLineLike = {
	quantity: number;
	price: number;
	/** Line-level discount in major units; only used by the `line` mode. */
	discount?: number;
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
	/** Invoice-level discount in major units (before- or after-tax per mode). */
	discount?: number;
	discountMode?: DiscountMode;
	lineItems: InvoiceLineLike[];
};

export function roundCurrency(value: number) {
	if (!Number.isFinite(value)) return 0;
	return Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;
}

export function invoiceSubtotal(lineItems: InvoiceLineLike[]) {
	return subtotalKobo(lineItems) / 100;
}

function percentageKobo(amountKobo: number, rate: number, inclusive = false) {
	const rateBasisPoints = BigInt(priceToKobo(rate));
	const denominator = inclusive ? 10_000n + rateBasisPoints : 10_000n;
	if (denominator <= 0n) return 0;
	return Number(
		(BigInt(amountKobo) * rateBasisPoints + denominator / 2n) / denominator,
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

/**
 * Resolves the discount mode and the amounts in kobo. The three modes are
 * mutually exclusive: an invoice may carry either one invoice-level discount
 * (before or after tax) or per-line discounts, never both. An explicit mode is
 * trusted; a stored discount with no mode falls back to `invoice_after_tax`,
 * matching what the document renderer has always displayed.
 */
export function resolveInvoiceDiscount(input: {
	lineItems: InvoiceLineLike[];
	discount?: number;
	discountMode?: DiscountMode;
}): {
	mode: DiscountMode;
	invoiceDiscountMinor: number;
	lineDiscountMinor: number;
} {
	const lineDiscountMinor = input.lineItems.reduce((sum, line) => {
		const value = priceToKobo(line.discount ?? 0);
		if (value < 0) {
			throw new RangeError("A line discount cannot be negative.");
		}
		return sum + value;
	}, 0);
	const invoiceDiscountMinor = priceToKobo(input.discount ?? 0);
	if (invoiceDiscountMinor < 0) {
		throw new RangeError("An invoice discount cannot be negative.");
	}

	let mode = input.discountMode ?? "none";
	if (mode === "none") {
		if (invoiceDiscountMinor > 0) mode = "invoice_after_tax";
		else if (lineDiscountMinor > 0) mode = "line";
	}

	const hasInvoiceDiscount =
		mode === "invoice_before_tax" || mode === "invoice_after_tax";
	if (mode === "line" && invoiceDiscountMinor > 0) {
		throw new Error(
			"Line-level and invoice-level discounts cannot be combined on one invoice.",
		);
	}
	if (hasInvoiceDiscount && lineDiscountMinor > 0) {
		throw new Error(
			"Line-level and invoice-level discounts cannot be combined on one invoice.",
		);
	}

	return { mode, invoiceDiscountMinor, lineDiscountMinor };
}

export function calculateInvoiceCompliance(
	input: ComplianceInput,
): InvoiceComplianceSnapshot {
	const subtotalMinor = subtotalKobo(input.lineItems);
	const subtotal = subtotalMinor / 100;
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

	const {
		mode: discountMode,
		invoiceDiscountMinor,
		lineDiscountMinor,
	} = resolveInvoiceDiscount({
		lineItems: input.lineItems,
		discount: input.discount,
		discountMode: input.discountMode,
	});

	// A line discount must never exceed that line's own net.
	if (discountMode === "line") {
		input.lineItems.forEach((line, index) => {
			const netMinor = lineTotalKobo(line);
			const lineDiscount = priceToKobo(line.discount ?? 0);
			if (lineDiscount > Math.max(netMinor, 0)) {
				throw new RangeError(
					`Line ${index + 1} discount cannot exceed the line amount.`,
				);
			}
		});
	}
	if (
		(discountMode === "invoice_before_tax" ||
			discountMode === "invoice_after_tax") &&
		invoiceDiscountMinor > subtotalMinor
	) {
		throw new RangeError("Discount cannot exceed the invoice subtotal.");
	}

	// Before-tax and per-line discounts reduce the taxable base; an after-tax
	// discount leaves the base alone and is subtracted from the total instead.
	const beforeTaxDiscountMinor =
		discountMode === "invoice_before_tax"
			? invoiceDiscountMinor
			: discountMode === "line"
				? lineDiscountMinor
				: 0;
	const taxableBaseMinor = subtotalMinor - beforeTaxDiscountMinor;

	let totalTaxMinor = 0;
	let grandTotalMinor = taxableBaseMinor;

	if (taxTreatment === "exclusive_rate") {
		totalTaxMinor = percentageKobo(taxableBaseMinor, taxRate);
		grandTotalMinor = taxableBaseMinor + totalTaxMinor;
	} else if (taxTreatment === "inclusive_rate" && taxRate > 0) {
		// Inclusive prices already contain tax; the discount reduces the
		// inclusive amount, and the included tax is derived from that base.
		totalTaxMinor = percentageKobo(taxableBaseMinor, taxRate, true);
		grandTotalMinor = taxableBaseMinor;
	}
	if (discountMode === "invoice_after_tax") {
		grandTotalMinor -= invoiceDiscountMinor;
	}

	const totalTax = totalTaxMinor / 100;
	const grandTotal = grandTotalMinor / 100;

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
	const withholdingTaxMinor =
		resolvedWithholdingBase.category === "none"
			? 0
			: percentageKobo(grandTotalMinor, resolvedWithholdingBase.rate);
	const withholdingTaxAmount = withholdingTaxMinor / 100;
	const withholding = {
		...resolvedWithholdingBase,
		amount: withholdingTaxAmount,
	};
	const netPayable = (grandTotalMinor - withholdingTaxMinor) / 100;
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
