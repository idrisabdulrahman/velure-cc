import type { BuyerType } from "../clients/buyer-profile";
import { validateSupplierTin } from "../compliance/supplier-profile";
import type { CanonicalDecimal, CanonicalInvoice } from "./canonical-invoice";

export type CanonicalInvoiceIssue = Readonly<{
	code: string;
	path: string;
	message: string;
}>;

export type CanonicalInvoiceValidation = Readonly<{
	valid: boolean;
	issues: readonly CanonicalInvoiceIssue[];
}>;

type BuyerContext = Readonly<{ buyerType?: BuyerType }>;
const CATEGORIES = new Set(["standard", "zero_rated", "exempt"]);
const TREATMENTS = new Set([
	"none",
	"exclusive_rate",
	"inclusive_rate",
	"reverse_charge",
	"exempt",
	"zero_rated",
]);
const NO_TAX_TREATMENTS = new Set([
	"none",
	"exempt",
	"zero_rated",
	"reverse_charge",
]);

type Decimal = { coefficient: bigint; scale: number };
function decimal(value: CanonicalDecimal): Decimal | null {
	if (!/^-?\d+(?:\.\d+)?$/.test(value)) return null;
	const negative = value.startsWith("-");
	const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
	const coefficient = BigInt(`${whole}${fraction}`) * (negative ? -1n : 1n);
	return { coefficient, scale: fraction.length };
}
function align(a: Decimal, b: Decimal): [bigint, bigint, number] {
	const scale = Math.max(a.scale, b.scale);
	return [
		a.coefficient * 10n ** BigInt(scale - a.scale),
		b.coefficient * 10n ** BigInt(scale - b.scale),
		scale,
	];
}
function add(a: Decimal, b: Decimal): Decimal {
	const [x, y, scale] = align(a, b);
	return { coefficient: x + y, scale };
}
function multiply(a: Decimal, b: Decimal): Decimal {
	return {
		coefficient: a.coefficient * b.coefficient,
		scale: a.scale + b.scale,
	};
}
function roundCurrency(value: Decimal): Decimal {
	if (value.scale <= 2)
		return {
			coefficient: value.coefficient * 10n ** BigInt(2 - value.scale),
			scale: 2,
		};
	const divisor = 10n ** BigInt(value.scale - 2);
	const abs = value.coefficient < 0n ? -value.coefficient : value.coefficient;
	let rounded = abs / divisor;
	if ((abs % divisor) * 2n >= divisor) rounded += 1n;
	return { coefficient: value.coefficient < 0n ? -rounded : rounded, scale: 2 };
}
function text(value: Decimal): string {
	const negative = value.coefficient < 0n;
	const digits = (negative ? -value.coefficient : value.coefficient)
		.toString()
		.padStart(value.scale + 1, "0");
	if (!value.scale) return `${negative ? "-" : ""}${digits}`;
	const whole = digits.slice(0, -value.scale);
	const fraction = digits.slice(-value.scale).replace(/0+$/, "");
	return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
function equalsCurrency(
	actual: CanonicalDecimal | undefined,
	expected: Decimal,
): boolean {
	const parsed = actual === undefined ? null : decimal(actual);
	return (
		!!parsed && text(roundCurrency(parsed)) === text(roundCurrency(expected))
	);
}
function sum(values: readonly CanonicalDecimal[]): Decimal | null {
	let total: Decimal = { coefficient: 0n, scale: 0 };
	for (const value of values) {
		const parsed = decimal(value);
		if (!parsed) return null;
		total = add(total, parsed);
	}
	return total;
}
function partyName(party: CanonicalInvoice["seller"]): string {
	return party.legalName?.trim() || party.tradingName?.trim() || "";
}
function ngParty(party: CanonicalInvoice["seller"]): boolean {
	return party.jurisdiction?.value.toUpperCase() === "NG";
}
function tin(
	party: CanonicalInvoice["seller"],
	path: string,
	required: boolean,
	issues: CanonicalInvoiceIssue[],
) {
	const supplied = party.identifiers?.find(
		(entry) => entry.scheme === "tax-id",
	)?.value;
	if (!supplied) {
		if (required)
			issues.push({
				code: "tin_required",
				path,
				message: "A tax identifier is required for this party.",
			});
		return;
	}
	// D8 has a documented NG format only. Keep requiredness separate from
	// format so foreign TINs are retained without imposing a Nigerian pattern.
	if (!ngParty(party)) return;
	const result = validateSupplierTin(supplied);
	if (!result.ok)
		issues.push({ code: result.code, path, message: result.message });
}
function issue(
	issues: CanonicalInvoiceIssue[],
	code: string,
	path: string,
	message: string,
) {
	issues.push({ code, path, message });
}

/** Pure readiness check for the existing canonical snapshot; this never mutates invoice state. */
export function validateCanonicalInvoice(
	invoice: CanonicalInvoice,
	context: BuyerContext = {},
): CanonicalInvoiceValidation {
	const issues: CanonicalInvoiceIssue[] = [];
	if (invoice.documentType === "proforma")
		issue(
			issues,
			"document_type_not_submittable",
			"documentType",
			"Convert a pro-forma to an invoice before submission.",
		);
	if (
		(invoice.documentType === "credit_note" ||
			invoice.documentType === "debit_note") &&
		!invoice.relatedDocuments?.some(
			(doc) => doc.relation === "corrects" && doc.documentId.trim(),
		)
	)
		issue(
			issues,
			"correction_source_required",
			"relatedDocuments",
			"A correction document must reference the invoice it corrects.",
		);
	if (!/^[A-Z0-9]{2,12}-\d{4}-\d{4,6}$/.test(invoice.number))
		issue(
			issues,
			"invoice_number_invalid",
			"number",
			"Enter a valid issued invoice number.",
		);
	const validDate = (value: string) =>
		/^\d{4}-\d{2}-\d{2}$/.test(value) &&
		!Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
		new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
	if (!validDate(invoice.issueDate))
		issue(
			issues,
			"issue_date_invalid",
			"issueDate",
			"Enter a valid issue date.",
		);
	if (!validDate(invoice.dueDate))
		issue(issues, "due_date_invalid", "dueDate", "Enter a valid due date.");
	if (
		validDate(invoice.issueDate) &&
		validDate(invoice.dueDate) &&
		invoice.dueDate < invoice.issueDate
	)
		issue(
			issues,
			"due_date_before_issue",
			"dueDate",
			"Due date cannot be before issue date.",
		);
	if (!/^[A-Z]{3}$/.test(invoice.currency))
		issue(
			issues,
			"currency_invalid",
			"currency",
			"Use a three-letter currency code.",
		);
	for (const [key, party] of [
		["seller", invoice.seller],
		["buyer", invoice.buyer],
	] as const) {
		if (!partyName(party))
			issue(
				issues,
				"party_name_required",
				`${key}.legalName`,
				"A legal or trading name is required.",
			);
		if (!party.address?.trim())
			issue(
				issues,
				"party_address_required",
				`${key}.address`,
				"A billing address is required.",
			);
		if (!party.jurisdiction?.value.trim())
			issue(
				issues,
				"party_jurisdiction_required",
				`${key}.jurisdiction`,
				"A party jurisdiction is required.",
			);
	}
	tin(invoice.seller, "seller.identifiers", ngParty(invoice.seller), issues);
	if (!context.buyerType)
		issue(
			issues,
			"buyer_type_unverified",
			"buyer",
			"A trusted buyer profile is required to validate buyer TIN requirements.",
		);
	else
		tin(
			invoice.buyer,
			"buyer.identifiers",
			context.buyerType === "b2b",
			issues,
		);
	if (!invoice.lines.length)
		issue(
			issues,
			"lines_required",
			"lines",
			"At least one invoice line is required.",
		);
	let lineSubtotal: Decimal = { coefficient: 0n, scale: 0 };
	let validLineMath = true;
	invoice.lines.forEach((line, index) => {
		const path = `lines[${index}]`;
		if (!line.description.trim())
			issue(
				issues,
				"line_description_required",
				`${path}.description`,
				"A line description is required.",
			);
		if (!line.unit?.trim())
			issue(
				issues,
				"unit_required",
				`${path}.unit`,
				"A line unit is required.",
			);
		if (!Number.isFinite(line.quantity) || line.quantity <= 0)
			issue(
				issues,
				"quantity_invalid",
				`${path}.quantity`,
				"Quantity must be positive.",
			);
		const price = decimal(line.unitPrice);
		const quantity = decimal(String(line.quantity));
		if (!price || price.coefficient < 0n) {
			issue(
				issues,
				"unit_price_invalid",
				`${path}.unitPrice`,
				"Unit price must be a nonnegative decimal.",
			);
			validLineMath = false;
		} else if (!quantity || quantity.coefficient <= 0n) validLineMath = false;
		else lineSubtotal = add(lineSubtotal, multiply(price, quantity));
		if (!line.taxCategory || !CATEGORIES.has(line.taxCategory.value))
			issue(
				issues,
				"vat_category_invalid",
				`${path}.taxCategory`,
				"Choose a supported VAT category.",
			);
		if (!line.classification?.value.trim())
			issue(
				issues,
				"classification_required",
				`${path}.classification`,
				"A goods or service classification code is required.",
			);
	});
	const discount = invoice.totals.discount
		? decimal(invoice.totals.discount)
		: { coefficient: 0n, scale: 0 };
	if (!discount || discount.coefficient < 0n)
		issue(
			issues,
			"discount_invalid",
			"totals.discount",
			"Discount must be a nonnegative decimal.",
		);
	else if (discount.coefficient !== 0n)
		issue(
			issues,
			"discount_semantics_unsupported",
			"totals.discount",
			"Nonzero discounts are blocked until their tax treatment is defined.",
		);
	if (
		validLineMath &&
		!equalsCurrency(invoice.totals.subtotal, roundCurrency(lineSubtotal))
	)
		issue(
			issues,
			"subtotal_mismatch",
			"totals.subtotal",
			"Subtotal does not match the rounded line amounts.",
		);
	const taxSum = sum((invoice.taxes ?? []).map((tax) => tax.amount));
	if (!taxSum)
		issue(
			issues,
			"tax_amount_invalid",
			"taxes",
			"Tax amounts must be valid decimals.",
		);
	(invoice.taxes ?? []).forEach((tax, index) => {
		const amount = decimal(tax.amount);
		if (amount && amount.coefficient < 0n)
			issue(
				issues,
				"tax_amount_negative",
				`taxes[${index}].amount`,
				"Tax line amounts cannot be negative.",
			);
	});
	if (taxSum && !equalsCurrency(invoice.totals.taxTotal, taxSum))
		issue(
			issues,
			"tax_total_mismatch",
			"totals.taxTotal",
			"Tax total does not match tax lines.",
		);
	const treatment = invoice.taxContext?.taxTreatment.value;
	if (!treatment || !TREATMENTS.has(treatment))
		issue(
			issues,
			"tax_treatment_invalid",
			"taxContext.taxTreatment",
			"A supported tax treatment is required.",
		);
	if (treatment && NO_TAX_TREATMENTS.has(treatment)) {
		const storedTaxTotal = invoice.totals.taxTotal
			? decimal(invoice.totals.taxTotal)
			: null;
		if (
			!taxSum ||
			taxSum.coefficient !== 0n ||
			!storedTaxTotal ||
			storedTaxTotal.coefficient !== 0n
		) {
			issue(
				issues,
				"no_tax_treatment_has_tax",
				"taxes",
				"This tax treatment requires zero tax lines and a zero tax total.",
			);
		}
	}
	if (taxSum && validLineMath && treatment && TREATMENTS.has(treatment)) {
		const subtotal = roundCurrency(lineSubtotal);
		const tax = roundCurrency(taxSum);
		const gross =
			treatment === "exclusive_rate"
				? roundCurrency(add(subtotal, tax))
				: subtotal;
		if (!equalsCurrency(invoice.totals.grossTotal, gross))
			issue(
				issues,
				"gross_total_mismatch",
				"totals.grossTotal",
				"Gross total does not match the stored tax treatment.",
			);
		const withholding = invoice.withholding
			? decimal(invoice.withholding.amount)
			: { coefficient: 0n, scale: 0 };
		if (!withholding || withholding.coefficient < 0n)
			issue(
				issues,
				"withholding_invalid",
				"withholding.amount",
				"Withholding must be a nonnegative decimal.",
			);
		else {
			if (!equalsCurrency(invoice.totals.withholdingTotal, withholding))
				issue(
					issues,
					"withholding_total_mismatch",
					"totals.withholdingTotal",
					"Withholding total does not match the stored withholding amount.",
				);
			const payable = add(gross, {
				coefficient: -withholding.coefficient,
				scale: withholding.scale,
			});
			if (
				!equalsCurrency(invoice.totals.payableTotal, payable) ||
				!equalsCurrency(invoice.totals.invoiceTotal, payable)
			)
				issue(
					issues,
					"payable_total_mismatch",
					"totals.payableTotal",
					"Payable and invoice totals must equal gross less withholding.",
				);
		}
	}
	return { valid: issues.length === 0, issues };
}
