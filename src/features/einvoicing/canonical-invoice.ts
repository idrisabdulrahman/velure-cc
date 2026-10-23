import type { InvoiceRecord } from "../invoices/types";

/** A base-10 decimal string; money is never recalculated as a JS number. */
export type CanonicalDecimal = string;

export type CanonicalIdentifier = Readonly<{
	scheme: "tax-id" | "registration-number";
	value: string;
}>;

export type CanonicalParty = Readonly<{
	legalName?: string;
	tradingName?: string;
	email?: string;
	phone?: string;
	address?: string;
	website?: string;
	countryCode?: string;
	identifiers?: readonly CanonicalIdentifier[];
}>;

export type CanonicalInvoiceLine = Readonly<{
	description: string;
	quantity: number;
	unit?: string;
	unitPrice: CanonicalDecimal;
	classification?: Readonly<{
		scheme: "source.classificationCode";
		value: string;
	}>;
	taxCategory?: Readonly<{ scheme: "source.vatCategory"; value: string }>;
}>;

export type CanonicalTaxLine = Readonly<{
	label: string;
	rate: number;
	amount: CanonicalDecimal;
	treatment: Readonly<{ scheme: "source.taxTreatment"; value: string }>;
	jurisdiction: Readonly<{ scheme: "source.jurisdictionCode"; value: string }>;
}>;

export type CanonicalWithholding = Readonly<{
	amount: CanonicalDecimal;
	rate: number;
	mode: string;
	category: Readonly<{ scheme: "source.withholdingCategory"; value: string }>;
	recipientEntityType: string;
	recipientResidency: string;
	ruleVersion: string;
	manualOverride: boolean;
	overrideNote?: string;
	legacyPreset?: Readonly<{
		scheme: "source.legacyWithholdingPreset";
		value: string;
	}>;
}>;

export type CanonicalInvoice = Readonly<{
	id: string;
	number: string;
	documentType: NonNullable<InvoiceRecord["documentType"]>;
	issueDate: string;
	dueDate: string;
	currency: string;
	relatedDocuments?: readonly Readonly<{
		relation: "corrects";
		documentId: string;
	}>[];
	seller: CanonicalParty;
	buyer: CanonicalParty;
	lines: readonly CanonicalInvoiceLine[];
	taxContext?: Readonly<{
		treatment: Readonly<{ scheme: "source.taxTreatment"; value: string }>;
		rate: number;
		label: string;
		ruleSet: Readonly<{ scheme: "source.taxRuleSetVersion"; value: string }>;
	}>;
	taxes?: readonly CanonicalTaxLine[];
	withholding?: CanonicalWithholding;
	totals: Readonly<{
		invoiceTotal: CanonicalDecimal;
		subtotal?: CanonicalDecimal;
		discount?: CanonicalDecimal;
		taxTotal?: CanonicalDecimal;
		withholdingTotal?: CanonicalDecimal;
		grossTotal?: CanonicalDecimal;
		payableTotal?: CanonicalDecimal;
	}>;
}>;

/**
 * Serializes the shortest decimal that round-trips to the stored JS number.
 * It performs no arithmetic or rounding, so values such as 1.005 stay 1.005.
 */
export function canonicalDecimal(
	value: number,
	field: string,
): CanonicalDecimal {
	if (!Number.isFinite(value)) {
		throw new RangeError(`${field} must be a finite decimal amount.`);
	}
	if (Object.is(value, -0) || value === 0) return "0";

	const source = value.toString().toLowerCase();
	const match = source.match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/);
	if (!match)
		throw new RangeError(`${field} cannot be represented as a decimal.`);
	const [, sign, integerPart, fractionalPart = "", exponentPart = "0"] = match;
	const digits = `${integerPart}${fractionalPart}`;
	const decimalPosition = integerPart.length + Number(exponentPart);
	let integer: string;
	let fraction: string;
	if (decimalPosition <= 0) {
		integer = "0";
		fraction = `${"0".repeat(-decimalPosition)}${digits}`;
	} else if (decimalPosition >= digits.length) {
		integer = `${digits}${"0".repeat(decimalPosition - digits.length)}`;
		fraction = "";
	} else {
		integer = digits.slice(0, decimalPosition);
		fraction = digits.slice(decimalPosition);
	}
	integer = integer.replace(/^0+(?=\d)/, "");
	fraction = fraction.replace(/0+$/, "");
	return `${sign}${integer}${fraction ? `.${fraction}` : ""}`;
}

function freezeDeep<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) freezeDeep(child);
	}
	return value;
}

function partyFromSnapshot(
	identity: NonNullable<InvoiceRecord["compliance"]>["seller"],
): CanonicalParty {
	const identifiers: CanonicalIdentifier[] = [];
	if (identity.taxId)
		identifiers.push({ scheme: "tax-id", value: identity.taxId });
	if (identity.rcNumber) {
		identifiers.push({
			scheme: "registration-number",
			value: identity.rcNumber,
		});
	}
	return {
		legalName: identity.legalName,
		tradingName: identity.tradingName,
		email: identity.email,
		phone: identity.phone,
		address: identity.address,
		website: identity.website,
		countryCode: identity.countryCode,
		...(identifiers.length ? { identifiers } : {}),
	};
}

/** Purely maps the existing invoice snapshot; it performs no reads or calculations. */
export function toCanonicalInvoice(invoice: InvoiceRecord): CanonicalInvoice {
	const compliance = invoice.compliance;
	const templateSettings = invoice.templateSettings;
	const model: CanonicalInvoice = {
		id: invoice.id,
		number: invoice.invoiceNumber,
		documentType: invoice.documentType ?? "standard",
		issueDate: invoice.issueDate,
		dueDate: invoice.dueDate,
		currency: invoice.currency,
		...(invoice.correctsInvoiceId
			? {
					relatedDocuments: [
						{
							relation: "corrects" as const,
							documentId: invoice.correctsInvoiceId,
						},
					],
				}
			: {}),
		seller: compliance ? partyFromSnapshot(compliance.seller) : {},
		buyer: compliance
			? partyFromSnapshot(compliance.buyer)
			: { legalName: invoice.customerName },
		lines: invoice.lineItems.map((line) => ({
			description: line.name,
			quantity: line.quantity,
			...(line.unit ? { unit: line.unit } : {}),
			unitPrice: canonicalDecimal(line.price, `Line ${line.id} unit price`),
			...(line.classificationCode
				? {
						classification: {
							scheme: "source.classificationCode" as const,
							value: line.classificationCode,
						},
					}
				: {}),
			...(line.vatCategory
				? {
						taxCategory: {
							scheme: "source.vatCategory" as const,
							value: line.vatCategory,
						},
					}
				: {}),
		})),
		...(compliance
			? {
					taxContext: {
						treatment: {
							scheme: "source.taxTreatment" as const,
							value: compliance.taxTreatment,
						},
						rate: compliance.taxRate,
						label: compliance.taxLabel,
						ruleSet: {
							scheme: "source.taxRuleSetVersion" as const,
							value: compliance.taxRuleSetVersion,
						},
					},
					taxes: compliance.taxLines.map((tax) => ({
						label: tax.label,
						rate: tax.rate,
						amount: canonicalDecimal(tax.amount, `Tax ${tax.label}`),
						treatment: {
							scheme: "source.taxTreatment" as const,
							value: tax.treatment,
						},
						jurisdiction: {
							scheme: "source.jurisdictionCode" as const,
							value: tax.jurisdictionCode,
						},
					})),
					withholding: {
						amount: canonicalDecimal(
							compliance.withholding.amount,
							"Withholding amount",
						),
						rate: compliance.withholding.rate,
						mode: compliance.withholding.mode,
						category: {
							scheme: "source.withholdingCategory",
							value: compliance.withholding.category,
						},
						recipientEntityType: compliance.withholding.recipientEntityType,
						recipientResidency: compliance.withholding.recipientResidency,
						ruleVersion: compliance.withholding.ruleVersion,
						manualOverride: compliance.withholding.manualOverride,
						...(compliance.withholding.overrideNote
							? { overrideNote: compliance.withholding.overrideNote }
							: {}),
						...(compliance.withholding.legacyPreset
							? {
									legacyPreset: {
										scheme: "source.legacyWithholdingPreset" as const,
										value: compliance.withholding.legacyPreset,
									},
								}
							: {}),
					},
				}
			: {}),
		totals: {
			invoiceTotal: canonicalDecimal(invoice.total, "Invoice total"),
			...(compliance
				? {
						subtotal: canonicalDecimal(compliance.subtotal, "Subtotal"),
						taxTotal: canonicalDecimal(compliance.totalTax, "Tax total"),
						withholdingTotal: canonicalDecimal(
							compliance.withholdingTaxAmount,
							"Withholding total",
						),
						grossTotal: canonicalDecimal(compliance.grandTotal, "Gross total"),
						payableTotal: canonicalDecimal(
							compliance.netPayable,
							"Payable total",
						),
					}
				: {}),
			...(templateSettings?.includeDiscount &&
			templateSettings.discount !== undefined
				? { discount: canonicalDecimal(templateSettings.discount, "Discount") }
				: {}),
		},
	};
	return freezeDeep(model);
}
