import type { VatCategory } from "#/features/invoices/types";

/**
 * Rev360 VAT sales-schedule status labels (T10 step 2 correction, 2026-11-01).
 *
 * NRS retired TaxPro Max and replaced it with **Rev360** (selfservice.nrs.gov.ng,
 * live ~April 2026). The Rev360 VAT sales-schedule template is **not public**,
 * so the exact `vat_status` spelling is UNCONFIRMED. The 2026-11-01 research
 * supplies a single weak source listing `VATable` / `zero-rated` / `exempt`.
 *
 * These labels are therefore a **config table, not logic**: the exporter never
 * hardcodes a status string, so replacing this map with the values read from a
 * real downloaded Rev360 template is the only change needed. Never present
 * these as NRS-recognised codes; the export is informational only (SPEC A2).
 */
export const REV360_VAT_STATUS_CONFIG: Readonly<Record<VatCategory, string>> = {
	standard: "VATable",
	zero_rated: "Zero-rated",
	exempt: "Exempt",
};

/** The configured Rev360 status label for one line's VAT category. */
export function rev360VatStatusFor(category: VatCategory): string {
	return REV360_VAT_STATUS_CONFIG[category];
}
