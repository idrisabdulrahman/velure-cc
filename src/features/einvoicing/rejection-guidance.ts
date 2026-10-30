export type RejectionGuidance = Readonly<{
	code: string;
	fix: string;
}>;

/**
 * Guidance for the MOCK provider's submission codes. Every key here is a
 * Velure-invented code, so each carries a `MOCK_` prefix to prevent it being
 * mistaken for a real NRS or provider code. The real rejection-code catalogue
 * is UNKNOWN and must come from the NITDA guideline or a provider contract
 * (see docs/EINVOICE-GAP-ANALYSIS.md §6). A real code that arrives with no
 * mapping falls back to the generic fix below.
 */
const REJECTION_FIXES: Readonly<Record<string, string>> = {
	MOCK_BUYER_TIN_INVALID:
		"Check the buyer TIN and update the buyer record before retrying.",
	MOCK_SUPPLIER_TIN_INVALID:
		"Check the supplier TIN in workspace compliance settings before retrying.",
	MOCK_LINE_CLASSIFICATION_MISSING:
		"Add a unit, VAT category, and goods or service code to each invoice line.",
	MOCK_TOTAL_MISMATCH:
		"Review line prices, quantities, tax treatment, and invoice totals.",
	MOCK_LOCAL_VALIDATION_FAILED:
		"Correct the listed invoice validation issues before retrying.",
	MOCK_IDEMPOTENCY_KEY_REQUIRED:
		"Retry from the invoice using the existing sandbox submission action.",
	MOCK_IDEMPOTENCY_KEY_REUSED:
		"Start a new sandbox submission for this invoice; the existing key belongs to another request.",
	MOCK_REJECTION:
		"Review the invoice details and correct any issues before retrying.",
};

export function mapRejectionCodeToGuidance(
	code: string | null | undefined,
): RejectionGuidance | null {
	if (!code) return null;
	const safeCode = /^[A-Z0-9_]{1,80}$/.test(code) ? code : "UNKNOWN_REJECTION";
	return {
		code: safeCode,
		fix:
			REJECTION_FIXES[safeCode] ??
			"Review the invoice details and contact your administrator before retrying.",
	};
}
