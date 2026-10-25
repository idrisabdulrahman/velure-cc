export type RejectionGuidance = Readonly<{
	code: string;
	fix: string;
}>;

const REJECTION_FIXES: Readonly<Record<string, string>> = {
	BUYER_TIN_INVALID:
		"Check the buyer TIN and update the buyer record before retrying.",
	SUPPLIER_TIN_INVALID:
		"Check the supplier TIN in workspace compliance settings before retrying.",
	LINE_CLASSIFICATION_MISSING:
		"Add a unit, VAT category, and goods or service code to each invoice line.",
	TOTAL_MISMATCH:
		"Review line prices, quantities, tax treatment, and invoice totals.",
	LOCAL_VALIDATION_FAILED:
		"Correct the listed invoice validation issues before retrying.",
	IDEMPOTENCY_KEY_REQUIRED:
		"Retry from the invoice using the existing sandbox submission action.",
	IDEMPOTENCY_KEY_REUSED:
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
