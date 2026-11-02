import type { VatCategory } from "#/features/invoices/types";

/**
 * Accounting-system import targets (T10 step 3, 2026-11-02).
 *
 * One canonical per-line row model feeds every target; each target only
 * supplies its own headers, date rendering and code tables. QuickBooks Online
 * is the first profile. Nothing here is a filing or a tax code authority:
 * tax-code mapping is a blank-default config table and must be filled from the
 * user's own accounting system (SPEC A2).
 */

/** Date renderings a target may require. */
export const ACCOUNTING_DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY"] as const;

export type AccountingDateFormat = (typeof ACCOUNTING_DATE_FORMATS)[number];

/**
 * Default import date format. Xero's accepted format depends on the
 * organisation's regional settings, so the format is a parameter rather than a
 * hardcoded write; the export screen states which one was used.
 */
export const DEFAULT_ACCOUNTING_DATE_FORMAT: AccountingDateFormat =
	"DD/MM/YYYY";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/;

/**
 * Renders a stored `YYYY-MM-DD` date in the target format. Returns `""` for a
 * missing or invalid calendar date rather than passing an unparseable value to
 * an importer; `2026-02-31` is rejected by the UTC round-trip.
 */
export function formatAccountingDate(
	value: string | null | undefined,
	format: AccountingDateFormat = DEFAULT_ACCOUNTING_DATE_FORMAT,
): string {
	if (typeof value !== "string") return "";
	const match = ISO_DATE.exec(value.trim());
	if (!match) return "";
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day
	) {
		return "";
	}
	const month2 = String(month).padStart(2, "0");
	const day2 = String(day).padStart(2, "0");
	return format === "MM/DD/YYYY"
		? `${month2}/${day2}/${year}`
		: `${day2}/${month2}/${year}`;
}

/* -----------------------------------------------------------------------
 * QuickBooks Online invoice import
 *
 * These are the vendor's invoice columns, in the vendor's order: the import
 * matches headings literally, so a leading disclaimer row or a renamed column
 * breaks the file. Keep them exactly as written.
 * --------------------------------------------------------------------- */

export const QBO_INVOICE_HEADERS = [
	"Invoice No.",
	"Customer",
	"Invoice Date",
	"Due Date",
	"Terms",
	"Item",
	"Item Description",
	"Item Quantity",
	"Item Rate",
	"Item Amount",
	"Item Tax Code",
] as const;

/** The 1,000-row-per-file ceiling reported for the QuickBooks importer. */
export const QBO_MAX_ROWS = 1000;

/** The 100-invoice-per-file ceiling reported for the QuickBooks importer. */
export const QBO_MAX_INVOICES = 100;

/**
 * QuickBooks **item tax codes** are company-specific (the user's own tax
 * agency/code list). The table is **empty by default**: every line emits a
 * blank `Item Tax Code` rather than an invented code. Fill it from the user's
 * QuickBooks company once their codes are known. Keys are Velure line VAT
 * categories.
 */
export const QBO_ITEM_TAX_CODE_CONFIG: Readonly<Record<VatCategory, string>> = {
	standard: "",
	zero_rated: "",
	exempt: "",
};

/** The configured QuickBooks item tax code for a line, else `""`. */
export function qboItemTaxCodeFor(category: VatCategory): string {
	return QBO_ITEM_TAX_CODE_CONFIG[category] ?? "";
}
