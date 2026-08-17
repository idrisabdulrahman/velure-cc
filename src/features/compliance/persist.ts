import type { ComplianceWarningCode } from "./types";

/**
 * Compliance warnings that are safe to persist with a saved invoice. Anything
 * derived at display time (rates, amounts) must be recomputed, not stored.
 */
export const PERSISTABLE_WARNING_CODES = new Set<ComplianceWarningCode>([
	"missing_seller_tax_id",
	"missing_buyer_tax_id",
	"cross_border_review",
	"reverse_charge_review",
	"unknown_jurisdiction",
	"domestic_vat_not_applied",
	"missing_workspace_tax_status",
]);

export function netPayableFromCompliance(compliance: {
	grandTotal: number;
	withholdingTaxAmount?: number;
	netPayable?: number;
}) {
	return (
		compliance.netPayable ??
		compliance.grandTotal - (compliance.withholdingTaxAmount ?? 0)
	);
}
