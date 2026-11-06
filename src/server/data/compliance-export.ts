import {
	type AccountingDateFormat,
	DEFAULT_ACCOUNTING_DATE_FORMAT,
	formatAccountingDate,
	QBO_INVOICE_HEADERS,
	QBO_MAX_INVOICES,
	QBO_MAX_ROWS,
	qboItemTaxCodeFor,
	ZOHO_INVOICE_HEADERS,
	ZOHO_MAX_FILE_BYTES,
	zohoVatNameFor,
} from "#/features/compliance/accounting-import";
import { resolveInvoiceDiscount } from "#/features/compliance/calculate";
import { NRS_INFORMATIONAL_DISCLAIMER } from "#/features/compliance/nigeria";
import {
	rev360ProductCodeFor,
	rev360VatStatusFor,
} from "#/features/compliance/rev360-vat-status";
import {
	validateSupplierRcNumber,
	validateSupplierTin,
} from "#/features/compliance/supplier-profile";
import type { DiscountMode } from "#/features/compliance/types";
import { priceToKobo } from "#/features/invoices/line-money";
import type { VatCategory } from "#/features/invoices/types";

export type ComplianceExportKind =
	| "invoices_csv"
	| "tax_summary_csv"
	| "customer_ledger_csv"
	| "normalized_accounting"
	/** T10 step 1 (`docs/EXPORT-FORMATS.md`): one row per invoice line. */
	| "accountant_lines_csv"
	| "accountant_lines_xlsx"
	/** T10 step 2 (Rev360): six-field VAT sales schedule, XLSX, per line. */
	| "vat_sales_schedule_xlsx"
	/** T10 step 3: QuickBooks Online invoice import, one row per line. */
	| "qbo_invoices_csv"
	/** T10 step 3: Zoho Books invoice import, one row per line. */
	| "zoho_invoices_csv";

export type ComplianceExportInvoiceRow = {
	invoice_number: string | null;
	customer_name: string | null;
	/** Stored `invoices.document_type`; absent rows export as `standard`. */
	document_type?: string | null;
	currency: string | null;
	payment_amount: number | string | null;
	status: string | null;
	issue_date: string | null;
	due_date: string | null;
	compliance?: unknown;
	line_items?: unknown;
	/** Raw craft settings JSON — the discount/discountMode source. */
	template_settings?: unknown;
	/** Invoice FK to the linked client (buyer), if any. */
	customer_id?: string | null;
	/**
	 * Buyer TIN resolved from the linked client (`clients.tax_id`), or `null`
	 * when the invoice has no client link. Only the VAT sales schedule reads it.
	 */
	customer_tin?: string | null;
};

/**
 * Provisional accountant columns (see
 * `prompts/accountant-export-quality-2026-10.md`): the tax split and the
 * document type sit next to `total` so a spreadsheet can group and sum a
 * workspace's VAT and withholding without re-deriving them.
 */
const CSV_HEADERS = [
	"invoiceNumber",
	"customerName",
	"documentType",
	"currency",
	"subtotal",
	"vat",
	"withholdingTax",
	"total",
	"status",
	"issueDate",
	"dueDate",
] as const;

/** Stored snapshot values arrive as numbers or as numeric strings. */
function numeric(value: unknown): number | undefined {
	if (typeof value === "number")
		return Number.isFinite(value) ? value : undefined;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

/**
 * The invoice total for one export row, using the same precedence the app uses
 * everywhere else (`netPayableFromCompliance` / `invoiceAmount`): the stored
 * `netPayable`, else `grandTotal` less withholding, else the summed line items.
 *
 * `payment_amount` is the amount PAID, not the total — a draft or unpaid
 * invoice stores 0 there, so exporting it under the `total` header reported 0
 * for most rows. It is now only a last resort for a row with no stored
 * compliance and no usable line items.
 */
export function invoiceTotalForExportRow(
	row: ComplianceExportInvoiceRow,
): number {
	const compliance = (row.compliance ?? {}) as Record<string, unknown>;
	const netPayable = numeric(compliance.netPayable);
	if (netPayable !== undefined) return netPayable;

	const grandTotal = numeric(compliance.grandTotal);
	if (grandTotal !== undefined) {
		return grandTotal - (numeric(compliance.withholdingTaxAmount) ?? 0);
	}

	let value = 0;
	let sawLineItem = false;
	if (Array.isArray(row.line_items)) {
		for (const raw of row.line_items) {
			const item = (raw ?? {}) as Record<string, unknown>;
			const quantity = numeric(item.quantity);
			const price = numeric(item.price);
			if (quantity === undefined || price === undefined) continue;
			value += quantity * price;
			sawLineItem = true;
		}
	}
	if (sawLineItem) {
		return Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;
	}

	return Math.max(0, numeric(row.payment_amount) ?? 0);
}

/**
 * Spreadsheet formula injection guard (OWASP CSV injection). `JSON.stringify`
 * quotes and escapes a cell but does not stop Excel/Sheets from evaluating a
 * cell that starts with `=`, `+`, `-`, `@`, a tab or a CR — and this export is
 * a file the user downloads and opens. A leading apostrophe forces text.
 *
 * Applied only to the free-text columns so the numeric money columns keep
 * their type and still sum in a spreadsheet.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function csvTextCell(value: unknown): string {
	const text = value === null || value === undefined ? "" : String(value);
	// RFC 4180: wrap the field and double any embedded quote. JSON escaping
	// (`\"`) is not CSV and importers would keep the backslash.
	return `"${guardFormulaLead(text).replace(/"/g, '""')}"`;
}

/** Neutralises a spreadsheet formula lead (see `guardFormulaLead`). */
function guardFormulaLead(text: string): string {
	return FORMULA_LEAD.test(text) ? `'${text}` : text;
}

function csvValueCell(value: unknown): string {
	return JSON.stringify(value ?? "");
}

/** The raw stored document type, defaulting to a standard invoice. */
function documentTypeForExportRow(row: ComplianceExportInvoiceRow): string {
	const value = row.document_type;
	return typeof value === "string" && value.length > 0 ? value : "standard";
}

/**
 * The money columns of one export row. `subtotal`/`vat`/`withholdingTax` come
 * straight from the stored compliance snapshot (`totalTax` is VAT);
 * `total` keeps the existing payable precedence.
 *
 * A credit note reduces revenue, so every money column is negated for it.
 * Debit notes, standard invoices and pro-formas stay positive. Missing
 * snapshot values fall back to `0` so a spreadsheet never sees `undefined` or
 * `NaN`, and no new float arithmetic is introduced (the values are the stored
 * decimals, negated exactly).
 */
function invoiceMoneyForExportRow(row: ComplianceExportInvoiceRow): {
	subtotal: number;
	vat: number;
	withholdingTax: number;
	total: number;
} {
	const compliance = (row.compliance ?? {}) as Record<string, unknown>;
	const sign = row.document_type === "credit_note" ? -1 : 1;
	return {
		subtotal: sign * (numeric(compliance.subtotal) ?? 0),
		vat: sign * (numeric(compliance.totalTax) ?? 0),
		withholdingTax: sign * (numeric(compliance.withholdingTaxAmount) ?? 0),
		total: sign * invoiceTotalForExportRow(row),
	};
}

/**
 * Builds the stored export artifact for `createInvoiceExport`. Every export
 * leaves the Compliance page, so every artifact carries the NRS disclaimer
 * inside the file itself (a leading quoted line for CSV, a `disclaimer`
 * field for JSON) — a downloaded copy can never read as a cleared tax
 * filing (e-invoicing SPEC A2).
 */
export function buildInvoiceExportContent(
	kind: ComplianceExportKind,
	rows: ComplianceExportInvoiceRow[],
	generatedAt: number,
): string {
	if (kind === "normalized_accounting") {
		return JSON.stringify(
			{
				generatedAt,
				disclaimer: NRS_INFORMATIONAL_DISCLAIMER,
				invoices: rows,
			},
			null,
			2,
		);
	}

	if (kind === "accountant_lines_csv") {
		return [
			JSON.stringify(NRS_INFORMATIONAL_DISCLAIMER),
			ACCOUNTANT_LINE_HEADERS.join(","),
			...rows
				.flatMap(accountantRowsForInvoice)
				.map((cells) =>
					cells
						.map((cell) =>
							typeof cell === "number"
								? JSON.stringify(cell)
								: csvTextCell(cell),
						)
						.join(","),
				),
		].join("\n");
	}

	// The workbook kinds need async serialization; going through the sync
	// builder would silently emit CSV bytes named `.xlsx`. QuickBooks has its
	// own profile (warnings + limits), so it must use its dedicated builder.
	if (kind === "qbo_invoices_csv") {
		throw new Error(`Use buildQboInvoicesExport for ${kind}.`);
	}
	if (kind === "zoho_invoices_csv") {
		throw new Error(`Use buildZohoInvoicesExport for ${kind}.`);
	}
	if (kind === "accountant_lines_xlsx" || kind === "vat_sales_schedule_xlsx") {
		throw new Error(`Use buildInvoiceExportArtifact for ${kind}.`);
	}

	return [
		JSON.stringify(NRS_INFORMATIONAL_DISCLAIMER),
		CSV_HEADERS.join(","),
		...rows.map((row) => {
			const money = invoiceMoneyForExportRow(row);
			return [
				csvTextCell(row.invoice_number),
				csvTextCell(row.customer_name),
				csvTextCell(documentTypeForExportRow(row)),
				csvTextCell(row.currency),
				csvValueCell(money.subtotal),
				csvValueCell(money.vat),
				csvValueCell(money.withholdingTax),
				csvValueCell(money.total),
				csvValueCell(row.status),
				csvValueCell(row.issue_date),
				csvValueCell(row.due_date),
			].join(",");
		}),
	].join("\n");
}

/* -----------------------------------------------------------------------
 * Accountant line export (T10 step 1) — `docs/EXPORT-FORMATS.md`.
 *
 * One row per invoice line, both CSV and XLSX projections of one row model.
 * All money is computed in KOBO integer arithmetic (single rounding rule)
 * and is reconciled EXACTLY to the stored compliance snapshot; the stored
 * snapshot is always the authority. WHT stays an invoice-level,
 * payment-time deduction (2026-10 decision) and is never allocated to a
 * line. A credit note negates every money column of its rows, like the
 * invoice-level CSVs.
 * --------------------------------------------------------------------- */

const ACCOUNTANT_LINE_HEADERS = [
	"invoiceNumber",
	"customerName",
	"documentType",
	"currency",
	"status",
	"issueDate",
	"dueDate",
	"lineDescription",
	"quantity",
	"unit",
	"unitPrice",
	"lineGross",
	"lineDiscount",
	"vat",
	"lineNet",
	"vatCategory",
	"classificationCode",
	"invoiceSubtotal",
	"invoiceDiscount",
	"invoiceVat",
	"invoiceWht",
	"invoiceNetPayable",
] as const;

/** One output row; `null` renders as an empty cell (continuation rows). */
type AccountantLineCells = Array<string | number | null>;

function assertKobo(value: number, label: string): number {
	if (!Number.isSafeInteger(value)) {
		throw new RangeError(`${label} leaves the safe kobo range.`);
	}
	return value;
}

/** Stored snapshot values as exact kobo (major-unit → kobo). */
function koboOfStored(value: unknown): number {
	return priceToKobo(numeric(value) ?? 0);
}

function naira(kobo: number): number {
	return assertKobo(kobo, "money value") / 100;
}

/**
 * Exact integer largest-remainder allocation: Σ shares = `total` precisely.
 * Base shares floor(total·w/W); the unit leftover goes to the largest
 * fractional remainders, ties to the earlier line. Weights are non-negative.
 */
function allocateMinor(total: number, weights: readonly number[]): number[] {
	if (total === 0) return weights.map(() => 0);
	const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
	if (weightTotal <= 0) {
		throw new RangeError("Allocation weights must sum to a positive number.");
	}
	const totalBig = BigInt(assertKobo(total, "allocation total"));
	const weightBig = BigInt(weightTotal);
	const shares = weights.map((weight) => {
		const numerator = totalBig * BigInt(weight);
		return {
			base: Number(numerator / weightBig),
			remainder: Number(numerator % weightBig),
		};
	});
	let leftover = total - shares.reduce((sum, share) => sum + share.base, 0);
	const order = shares
		.map((share, index) => ({ index, remainder: share.remainder }))
		.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
	for (const entry of order) {
		if (leftover <= 0) break;
		shares[entry.index].base += 1;
		leftover -= 1;
	}
	return shares.map((share) => assertKobo(share.base, "allocation share"));
}

/** Stored line, sanitized to kobo inputs (legacy rules: EXPORT-FORMATS.md). */
const ACCOUNTANT_NO_LINE_LABEL = "(no line items recorded)";

type StoredExportLine = {
	name: string;
	quantity: number;
	unit: string;
	unitPriceKobo: number;
	grossKobo: number;
	/** Line's own stored discount (line mode), in kobo. */
	ownDiscountKobo: number;
	vatCategory: "standard" | "zero_rated" | "exempt";
	classificationCode: string;
};

function lineTotalKoboExact(quantity: number, unitPriceKobo: number): number {
	return assertKobo(
		Number(BigInt(quantity) * BigInt(unitPriceKobo)),
		"line gross",
	);
}

function storedLinesOf(row: ComplianceExportInvoiceRow): StoredExportLine[] {
	const raw = Array.isArray(row.line_items) ? row.line_items : [];
	return raw.map((entry) => {
		const item = (entry ?? {}) as Record<string, unknown>;
		// Legacy rows may carry malformed quantities; truncation keeps the
		// money conservative (documented in EXPORT-FORMATS.md).
		const quantity = Math.max(0, Math.trunc(numeric(item.quantity) ?? 0));
		const unitPriceKobo = koboOfStored(item.price);
		return {
			name: typeof item.name === "string" ? item.name : "",
			quantity,
			unit: typeof item.unit === "string" ? item.unit : "",
			unitPriceKobo,
			grossKobo: lineTotalKoboExact(quantity, unitPriceKobo),
			ownDiscountKobo: koboOfStored(item.discount),
			vatCategory:
				item.vatCategory === "zero_rated" || item.vatCategory === "exempt"
					? item.vatCategory
					: "standard",
			classificationCode:
				typeof item.classificationCode === "string"
					? item.classificationCode
					: "",
		};
	});
}

function syntheticLine(subtotalKobo: number): StoredExportLine[] {
	return [
		{
			name: ACCOUNTANT_NO_LINE_LABEL,
			quantity: 0,
			unit: "",
			unitPriceKobo: subtotalKobo,
			grossKobo: subtotalKobo,
			ownDiscountKobo: 0,
			vatCategory: "standard",
			classificationCode: "",
		},
	];
}

/**
 * Builds the line rows of one invoice. The four pinned identities
 * (EXPORT-FORMATS.md) hold for every stored invoice: Σ gross = subtotal,
 * Σ discount = invoice discount, Σ vat = invoice vat, Σ(net+vat) = grand
 * total, all in kobo against the stored snapshot.
 */
function accountantRowsForInvoice(
	row: ComplianceExportInvoiceRow,
): AccountantLineCells[] {
	const compliance = (row.compliance ?? {}) as Record<string, unknown>;
	const settings = (row.template_settings ?? {}) as Record<string, unknown>;

	const lines = storedLinesOf(row);
	const synthetic = lines.length === 0;

	// Stored subtotal is authoritative; legacy rows without one fall back to
	// their line sums, then the paid amount (mirrors the invoice-level CSVs).
	let subtotalTargetKobo: number;
	if (numeric(compliance.subtotal) !== undefined) {
		subtotalTargetKobo = assertKobo(
			koboOfStored(compliance.subtotal),
			"invoice subtotal",
		);
	} else {
		const lineSum = lines.reduce((sum, line) => sum + line.grossKobo, 0);
		subtotalTargetKobo = assertKobo(
			lineSum > 0 ? lineSum : Math.max(0, koboOfStored(row.payment_amount)),
			"invoice subtotal",
		);
	}

	const workingLines = synthetic ? syntheticLine(subtotalTargetKobo) : lines;
	const grossKobo = workingLines.map((line) => line.grossKobo);

	// Legacy drift: stored lines that do not sum to the stored subtotal.
	// The LAST line absorbs the residual so the invoice still reconciles.
	if (!synthetic && workingLines.length > 0) {
		const residual =
			subtotalTargetKobo -
			workingLines.reduce((sum, line) => sum + line.grossKobo, 0);
		if (residual !== 0) {
			const last = grossKobo.length - 1;
			grossKobo[last] = assertKobo(
				grossKobo[last] + residual,
				"reconciled line gross",
			);
		}
	}

	// Discount engine — the same precedence the compliance calculator uses.
	// Stored data passes the write-path guards (`assertInvoiceInput`); a
	// malformed legacy row degrades to no discount instead of aborting the
	// whole workspace export.
	let mode: DiscountMode = "none";
	let invoiceDiscountMinor = 0;
	try {
		const resolved = resolveInvoiceDiscount({
			lineItems: workingLines.map((line) => ({
				quantity: line.quantity,
				price: naira(line.unitPriceKobo),
				discount: naira(line.ownDiscountKobo),
			})),
			discount:
				settings.includeDiscount === true
					? naira(koboOfStored(settings.discount))
					: 0,
			discountMode:
				typeof settings.discountMode === "string"
					? (settings.discountMode as DiscountMode)
					: undefined,
		});
		mode = resolved.mode;
		invoiceDiscountMinor = resolved.invoiceDiscountMinor;
	} catch {
		mode = "none";
		invoiceDiscountMinor = 0;
	}

	let discountKobo: number[];
	if (mode === "line") {
		discountKobo = workingLines.map((line) => line.ownDiscountKobo);
	} else if (mode === "invoice_before_tax" || mode === "invoice_after_tax") {
		discountKobo = allocateMinor(invoiceDiscountMinor, grossKobo);
	} else {
		discountKobo = workingLines.map(() => 0);
	}
	const discountTotalKobo = discountKobo.reduce((sum, value) => sum + value, 0);

	// VAT: the stored invoice VAT total distributed over standard lines
	// weighted by (gross − discount). zero_rated/exempt lines take 0. A
	// legacy invoice that has VAT but no standard-weighted line falls back
	// to all lines, and the last line takes the remainder.
	const vatTargetKobo = assertKobo(
		numeric(compliance.totalTax) !== undefined
			? koboOfStored(compliance.totalTax)
			: 0,
		"invoice vat",
	);
	let vatWeights = workingLines.map((line, index) =>
		line.vatCategory === "standard"
			? Math.max(0, grossKobo[index] - discountKobo[index])
			: 0,
	);
	if (vatTargetKobo > 0 && vatWeights.reduce((sum, w) => sum + w, 0) <= 0) {
		const last = vatWeights.length - 1;
		vatWeights = vatWeights.map((_, index) => (index === last ? 1 : 0));
	}
	const vatKobo = allocateMinor(vatTargetKobo, vatWeights);
	const vatTotalKobo = vatKobo.reduce((sum, value) => sum + value, 0);

	// inclusive iff the stored treatment says so; legacy rows without a
	// treatment infer it from the stored totals (EXPORT-FORMATS.md).
	const treatment = compliance.taxTreatment;
	const grandTotalKobo =
		numeric(compliance.grandTotal) !== undefined
			? assertKobo(koboOfStored(compliance.grandTotal), "grand total")
			: 0;
	const inclusive =
		typeof treatment === "string"
			? treatment === "inclusive_rate"
			: vatTotalKobo > 0 &&
				grandTotalKobo === subtotalTargetKobo - discountTotalKobo;

	const netKobo = grossKobo.map((gross, index) =>
		assertKobo(
			gross - discountKobo[index] - (inclusive ? vatKobo[index] : 0),
			"line net",
		),
	);

	// WHT is invoice-level only (2026-10 Q-H decision) and never on a line.
	const whtKobo = assertKobo(
		koboOfStored(compliance.withholdingTaxAmount),
		"wht",
	);
	const payableKobo = assertKobo(
		priceToKobo(invoiceTotalForExportRow(row)),
		"net payable",
	);

	const sign = row.document_type === "credit_note" ? -1 : 1;

	return workingLines.map((line, index) => {
		const first = index === 0;
		return [
			row.invoice_number ?? "",
			row.customer_name ?? "",
			documentTypeForExportRow(row),
			row.currency ?? "",
			row.status ?? "",
			row.issue_date ?? "",
			row.due_date ?? "",
			line.name,
			line.quantity,
			line.unit,
			naira(sign * line.unitPriceKobo),
			naira(sign * grossKobo[index]),
			naira(sign * discountKobo[index]),
			naira(sign * vatKobo[index]),
			naira(sign * netKobo[index]),
			line.vatCategory,
			line.classificationCode,
			first ? naira(sign * subtotalTargetKobo) : null,
			first ? naira(sign * discountTotalKobo) : null,
			first ? naira(sign * vatTotalKobo) : null,
			first ? naira(sign * whtKobo) : null,
			first ? naira(sign * payableKobo) : null,
		];
	});
}

/* -----------------------------------------------------------------------
 * Canonical accounting line rows (T10 step 3, 2026-11-02).
 *
 * ONE typed per-line model feeds every accounting-system target. It is a
 * read-only projection of `accountantRowsForInvoice`, so the kobo money
 * identity (Σ gross = subtotal, Σ discount = invoice discount, Σ vat = stored
 * VAT, Σ net + vat = grand total) is derived exactly once. Targets supply
 * headings, date rendering and code tables only; they never redo money math.
 *
 * Invoice-level cells (`invoiceSubtotal`…) are `null` on continuation rows,
 * exactly like the accountant export, so a target must read them from the
 * first line of each invoice.
 * --------------------------------------------------------------------- */

type AccountantColumn = (typeof ACCOUNTANT_LINE_HEADERS)[number];

const ACCOUNTANT_COLUMN = ACCOUNTANT_LINE_HEADERS.reduce(
	(map, header, index) => {
		map[header] = index;
		return map;
	},
	{} as Record<AccountantColumn, number>,
);

function vatCategoryOf(value: string): VatCategory {
	return value === "zero_rated" || value === "exempt" ? value : "standard";
}

export type CanonicalAccountingLine = {
	invoiceNumber: string;
	customerName: string;
	documentType: string;
	currency: string;
	status: string;
	issueDate: string;
	dueDate: string;
	lineDescription: string;
	quantity: number;
	unit: string;
	unitPrice: number;
	lineGross: number;
	lineDiscount: number;
	vat: number;
	lineNet: number;
	vatCategory: VatCategory;
	classificationCode: string;
	invoiceSubtotal: number | null;
	invoiceDiscount: number | null;
	invoiceVat: number | null;
	invoiceWht: number | null;
	invoiceNetPayable: number | null;
	/** The invoice had no stored line items; one synthetic line was used. */
	synthetic: boolean;
};

function canonicalLinesForInvoice(
	row: ComplianceExportInvoiceRow,
): CanonicalAccountingLine[] {
	const synthetic = storedLinesOf(row).length === 0;
	return accountantRowsForInvoice(row).map((cells) => {
		const text = (column: AccountantColumn) => {
			const value = cells[ACCOUNTANT_COLUMN[column]];
			return value === null || value === undefined ? "" : String(value);
		};
		const amount = (column: AccountantColumn) => {
			const value = cells[ACCOUNTANT_COLUMN[column]];
			return typeof value === "number" ? value : 0;
		};
		const nullableAmount = (column: AccountantColumn) => {
			const value = cells[ACCOUNTANT_COLUMN[column]];
			return typeof value === "number" ? value : null;
		};
		return {
			invoiceNumber: text("invoiceNumber"),
			customerName: text("customerName"),
			documentType: text("documentType"),
			currency: text("currency"),
			status: text("status"),
			issueDate: text("issueDate"),
			dueDate: text("dueDate"),
			lineDescription: text("lineDescription"),
			quantity: amount("quantity"),
			unit: text("unit"),
			unitPrice: amount("unitPrice"),
			lineGross: amount("lineGross"),
			lineDiscount: amount("lineDiscount"),
			vat: amount("vat"),
			lineNet: amount("lineNet"),
			vatCategory: vatCategoryOf(text("vatCategory")),
			classificationCode: text("classificationCode"),
			invoiceSubtotal: nullableAmount("invoiceSubtotal"),
			invoiceDiscount: nullableAmount("invoiceDiscount"),
			invoiceVat: nullableAmount("invoiceVat"),
			invoiceWht: nullableAmount("invoiceWht"),
			invoiceNetPayable: nullableAmount("invoiceNetPayable"),
			synthetic,
		};
	});
}

/**
 * Every canonical line of every invoice, in stored invoice/line order. Exposed
 * for targets (and their tests) that need the shared projection without the
 * accountant column layout.
 */
export function canonicalAccountingLines(
	rows: ComplianceExportInvoiceRow[],
): CanonicalAccountingLine[] {
	return rows.flatMap(canonicalLinesForInvoice);
}

/* -----------------------------------------------------------------------
 * QuickBooks Online invoice import (T10 step 3) — `qbo_invoices_csv`.
 *
 * One row per invoice LINE; the invoice number repeats on every line so the
 * importer groups the lines. Headings are the vendor's invoice columns exactly
 * and must stay the first line: a leading disclaimer row would break the
 * import, so this is the documented in-file disclaimer exception (the screen
 * and audit log still carry the informational framing).
 *
 * Excluded with a returned warning: credit notes (imported separately as
 * credit memos), discounted invoices (the vendor columns have no discount
 * field), invoices outside the workspace base currency (the import uses the
 * company home currency), and invoices without a customer name (QBO requires
 * one). Above 100 invoices or 1,000 rows the export aborts until auto-split
 * exists — silently truncating would produce a wrong ledger.
 * --------------------------------------------------------------------- */

export type QboInvoiceExportOptions = {
	dateFormat?: AccountingDateFormat;
	/** Workspace base currency; defaults to `NGN` when unknown. */
	baseCurrency?: string | null;
};

export type BuiltQboInvoiceExport = {
	content: string;
	warnings: string[];
	invoiceCount: number;
	lineCount: number;
};

type IncludedAccountingInvoice = {
	lines: CanonicalAccountingLine[];
	synthetic: boolean;
};

type AccountingInclusions = {
	included: IncludedAccountingInvoice[];
	skippedCreditNotes: number;
	skippedDiscounts: number;
	skippedCurrency: number;
	skippedCustomer: number;
};

/**
 * The invoice-level filters every accounting-system target shares. A credit
 * note (imported separately), a discounted invoice, an invoice outside the
 * workspace base currency and an invoice without a customer cannot be
 * represented by the provisional vendor columns, so the target leaves them out
 * and reports a warning instead of silently misstating money.
 */
function includeAccountingInvoices(
	rows: ComplianceExportInvoiceRow[],
	baseCurrency: string,
): AccountingInclusions {
	const included: IncludedAccountingInvoice[] = [];
	let skippedCreditNotes = 0;
	let skippedDiscounts = 0;
	let skippedCurrency = 0;
	let skippedCustomer = 0;
	for (const row of rows) {
		if (documentTypeForExportRow(row) === "credit_note") {
			skippedCreditNotes += 1;
			continue;
		}
		const currency = row.currency?.trim() || baseCurrency;
		if (currency.toUpperCase() !== baseCurrency) {
			skippedCurrency += 1;
			continue;
		}
		if (!String(row.customer_name ?? "").trim()) {
			skippedCustomer += 1;
			continue;
		}
		const lines = canonicalLinesForInvoice(row);
		if (lines.some((line) => line.lineDiscount !== 0)) {
			skippedDiscounts += 1;
			continue;
		}
		if (lines.length === 0) continue;
		included.push({
			lines,
			synthetic: lines.some((line) => line.synthetic),
		});
	}
	return {
		included,
		skippedCreditNotes,
		skippedDiscounts,
		skippedCurrency,
		skippedCustomer,
	};
}

/** `"1 credit note was"` / `"2 credit notes were"` warning prefix. */
function skippedWarning(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

export function buildQboInvoicesExport(
	rows: ComplianceExportInvoiceRow[],
	options: QboInvoiceExportOptions = {},
): BuiltQboInvoiceExport {
	const dateFormat = options.dateFormat ?? DEFAULT_ACCOUNTING_DATE_FORMAT;
	const baseCurrency = String(options.baseCurrency ?? "NGN").toUpperCase();
	const {
		included,
		skippedCreditNotes,
		skippedDiscounts,
		skippedCurrency,
		skippedCustomer,
	} = includeAccountingInvoices(rows, baseCurrency);
	const warnings: string[] = [];
	const dataRows: string[] = [];
	let syntheticInvoices = 0;

	if (included.length > QBO_MAX_INVOICES) {
		throw new RangeError(
			`QuickBooks imports at most ${QBO_MAX_INVOICES} invoices per file; this export has ${included.length}. Split it or wait for automatic splitting.`,
		);
	}

	for (const invoice of included) {
		if (invoice.synthetic) syntheticInvoices += 1;
		for (const line of invoice.lines) {
			const quantity = line.synthetic ? 1 : line.quantity;
			const rate = line.synthetic ? line.lineGross : line.unitPrice;
			dataRows.push(
				[
					csvTextCell(line.invoiceNumber),
					csvTextCell(line.customerName),
					csvTextCell(formatAccountingDate(line.issueDate, dateFormat)),
					csvTextCell(formatAccountingDate(line.dueDate, dateFormat)),
					csvTextCell(""),
					csvTextCell(line.lineDescription),
					csvTextCell(line.lineDescription),
					csvValueCell(quantity),
					csvValueCell(rate),
					csvValueCell(line.lineGross),
					csvTextCell(qboItemTaxCodeFor(line.vatCategory)),
				].join(","),
			);
		}
	}

	if (dataRows.length > QBO_MAX_ROWS) {
		throw new RangeError(
			`QuickBooks imports at most ${QBO_MAX_ROWS.toLocaleString("en-US")} rows per file; this export has ${dataRows.length}. Split it or wait for automatic splitting.`,
		);
	}

	if (skippedCreditNotes > 0) {
		warnings.push(
			`${skippedWarning(skippedCreditNotes, "credit note was", "credit notes were")} left out; import credit notes as credit memos in QuickBooks.`,
		);
	}
	if (skippedDiscounts > 0) {
		warnings.push(
			`${skippedWarning(skippedDiscounts, "discounted invoice was", "discounted invoices were")} left out; the QuickBooks invoice columns have no discount field.`,
		);
	}
	if (skippedCurrency > 0) {
		warnings.push(
			`${skippedWarning(skippedCurrency, "invoice in another currency was", "invoices in another currency were")} left out; the QuickBooks import uses the company home currency.`,
		);
	}
	if (skippedCustomer > 0) {
		warnings.push(
			`${skippedWarning(skippedCustomer, "invoice without a customer name was", "invoices without a customer name were")} left out; QuickBooks requires a customer.`,
		);
	}
	if (syntheticInvoices > 0) {
		warnings.push(
			`${skippedWarning(syntheticInvoices, "invoice had", "invoices had")} no stored line items and ${syntheticInvoices === 1 ? "was" : "were"} exported as a single line at the stored subtotal.`,
		);
	}
	if (included.length === 0) {
		warnings.push("No invoices matched; the file has only the header row.");
	}

	return {
		content: [QBO_INVOICE_HEADERS.join(","), ...dataRows].join("\n"),
		warnings,
		invoiceCount: included.length,
		lineCount: dataRows.length,
	};
}

/* -----------------------------------------------------------------------
 * Zoho Books invoice import (T10 step 3) — `zoho_invoices_csv`.
 *
 * Zoho Books maps imported columns to fields in its wizard, so this profile
 * ships a readable provisional header set rather than a rigid template. One
 * row per line; the invoice number repeats so Zoho groups the lines. Auto-
 * generate Invoice Numbers must stay OFF so Invoicly numbers survive.
 *
 * `Tax Name` is a blank-default config table (never invented) and
 * `Tax Amount` carries the line VAT. Exclusions mirror QuickBooks; the file
 * byte cap (10 MB) is Zoho's own documented limit. No in-file disclaimer row.
 * --------------------------------------------------------------------- */

export type ZohoInvoiceExportOptions = {
	dateFormat?: AccountingDateFormat;
	/** Workspace base currency; defaults to `NGN` when unknown. */
	baseCurrency?: string | null;
};

export type BuiltZohoInvoiceExport = {
	content: string;
	warnings: string[];
	invoiceCount: number;
	lineCount: number;
};

export function buildZohoInvoicesExport(
	rows: ComplianceExportInvoiceRow[],
	options: ZohoInvoiceExportOptions = {},
): BuiltZohoInvoiceExport {
	const dateFormat = options.dateFormat ?? DEFAULT_ACCOUNTING_DATE_FORMAT;
	const baseCurrency = String(options.baseCurrency ?? "NGN").toUpperCase();
	const {
		included,
		skippedCreditNotes,
		skippedDiscounts,
		skippedCurrency,
		skippedCustomer,
	} = includeAccountingInvoices(rows, baseCurrency);
	const warnings: string[] = [];
	const dataRows: string[] = [];
	let syntheticInvoices = 0;
	let unTaxedLines = 0;

	for (const invoice of included) {
		if (invoice.synthetic) syntheticInvoices += 1;
		for (const line of invoice.lines) {
			const taxName = zohoVatNameFor(line.vatCategory);
			if (line.vat > 0 && taxName === "") unTaxedLines += 1;
			const quantity = line.synthetic ? 1 : line.quantity;
			const price = line.synthetic ? line.lineGross : line.unitPrice;
			dataRows.push(
				[
					csvTextCell(line.invoiceNumber),
					csvTextCell(formatAccountingDate(line.issueDate, dateFormat)),
					csvTextCell(formatAccountingDate(line.dueDate, dateFormat)),
					csvTextCell(line.customerName),
					csvTextCell(line.lineDescription),
					csvTextCell(line.lineDescription),
					csvValueCell(quantity),
					csvValueCell(price),
					csvValueCell(line.lineGross),
					csvTextCell(taxName),
					csvValueCell(line.vat),
				].join(","),
			);
		}
	}

	if (skippedCreditNotes > 0) {
		warnings.push(
			`${skippedWarning(skippedCreditNotes, "credit note was", "credit notes were")} left out; import credit notes as credit notes in Zoho Books.`,
		);
	}
	if (skippedDiscounts > 0) {
		warnings.push(
			`${skippedWarning(skippedDiscounts, "discounted invoice was", "discounted invoices were")} left out; the provisional Zoho columns carry no discount.`,
		);
	}
	if (skippedCurrency > 0) {
		warnings.push(
			`${skippedWarning(skippedCurrency, "invoice in another currency was", "invoices in another currency were")} left out; the Zoho import uses the organisation base currency.`,
		);
	}
	if (skippedCustomer > 0) {
		warnings.push(
			`${skippedWarning(skippedCustomer, "invoice without a customer name was", "invoices without a customer name were")} left out; Zoho Books requires a customer.`,
		);
	}
	if (syntheticInvoices > 0) {
		warnings.push(
			`${skippedWarning(syntheticInvoices, "invoice had", "invoices had")} no stored line items and ${syntheticInvoices === 1 ? "was" : "were"} exported as a single line at the stored subtotal.`,
		);
	}
	if (unTaxedLines > 0) {
		warnings.push(
			`${skippedWarning(unTaxedLines, "taxable line carries", "taxable lines carry")} VAT but no Zoho tax name is configured; choose a Tax Name in Zoho's import wizard.`,
		);
	}
	if (included.length === 0) {
		warnings.push("No invoices matched; the file has only the header row.");
	}

	const content = [ZOHO_INVOICE_HEADERS.join(","), ...dataRows].join("\n");
	const bytes = new TextEncoder().encode(content).length;
	if (bytes > ZOHO_MAX_FILE_BYTES) {
		throw new RangeError(
			`Zoho Books accepts files up to 10 MB; this export is ${(bytes / (1024 * 1024)).toFixed(1)} MB. Split it or wait for automatic splitting.`,
		);
	}

	return {
		content,
		warnings,
		invoiceCount: included.length,
		lineCount: dataRows.length,
	};
}

/**
 * The XLSX projection. `invoice_exports.content` is a text column, so the
 * workbook bytes are stored base64-encoded; the download path decodes them
 * with the SpreadsheetML MIME. The disclaimer sits in cell A1 above the
 * header row, mirroring the CSV's leading disclaimer line.
 */
async function buildAccountantLinesXlsx(
	rows: ComplianceExportInvoiceRow[],
): Promise<string> {
	const XLSX = await import("xlsx");
	const sheetData: Array<Array<string | number | null>> = [
		[NRS_INFORMATIONAL_DISCLAIMER],
		[...ACCOUNTANT_LINE_HEADERS],
		...rows
			.flatMap(accountantRowsForInvoice)
			.map((cells) =>
				cells.map((cell) =>
					typeof cell === "string" ? guardFormulaLead(cell) : cell,
				),
			),
	];
	const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
	const workbook = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(workbook, worksheet, "Invoice lines");
	return XLSX.write(workbook, { bookType: "xlsx", type: "base64" });
}

/* -----------------------------------------------------------------------
 * Rev360 VAT sales data (T10 step 2 correction, 2026-11-02) — XLSX.
 *
 * Rev360 VAT is a **schedule-based Excel template**: NRS expects the official
 * workbook filled in, and guides warn that editing its return-form sheet breaks
 * the upload. Invoicly therefore does NOT generate an uploadable replacement.
 * It exports **paste-ready Sales-sheet rows** for the official template, one
 * row per invoice LINE, with invoice number/date appended for the accountant's
 * cross-check.
 *
 * Columns (the six template-named fields, then product code and cross-check):
 *   beneficiary_name, beneficiary_tax_id, item, item_cost, item_description,
 *   vat_status, product_code, invoice_number, invoice_date
 *
 * The layout is UNVERIFIED against the live template. VAT status and product
 * codes live in `rev360-vat-status.ts` (product codes default to blank, never
 * invented). The buyer Tax ID prints the literal `0` when unknown (blank,
 * malformed, a placeholder, or the invoice has no linked client) and accepts a
 * TIN, an RC number or a NIN. A credit note negates `item_cost`. Informational
 * only; never a filing-ready or NRS-cleared document (SPEC A2).
 * --------------------------------------------------------------------- */

const REV360_VAT_HEADERS = [
	"beneficiary_name",
	"beneficiary_tax_id",
	"item",
	"item_cost",
	"item_description",
	"vat_status",
	"product_code",
	"invoice_number",
	"invoice_date",
] as const;

const REV360_VAT_SHEET_NAME = "VAT sales data";

/**
 * The in-file warning that this is paste-ready data, not an uploadable
 * workbook, and that the layout is unverified. Mirrors the UI label; never
 * claims NRS compatibility.
 */
const REV360_LAYOUT_NOTE =
	"Paste into the official Rev360 template. Layout not verified against the live template.";

/**
 * A Tax ID for a filing cell: a TIN (10-12 digits), an RC number, or a NIN
 * (11 digits) when it passes the shared supplier-profile rules, otherwise the
 * literal `0` ("unknown"). TIN and NIN are covered by the 10-12 digit rule;
 * RC numbers are validated and canonicalised separately. Placeholder and
 * all-same-digit values are rejected by both, so they also print `0`.
 */
function taxIdOrZero(value: unknown): string {
	if (typeof value !== "string") return "0";
	const tin = validateSupplierTin(value);
	if (tin.ok) return tin.tin;
	const rc = validateSupplierRcNumber(value);
	if (rc.ok) return rc.rcNumber;
	return "0";
}

/** The lines to schedule: stored lines, or one synthetic row when none exist. */
function rev360LinesOf(row: ComplianceExportInvoiceRow): StoredExportLine[] {
	const lines = storedLinesOf(row);
	if (lines.length > 0) return lines;

	const compliance = (row.compliance ?? {}) as Record<string, unknown>;
	const explicit = numeric(compliance.subtotal);
	// Stored subtotal is authoritative; legacy rows fall back to the line sum
	// (already empty here), then the paid amount (mirrors the accountant export).
	const subtotalKobo =
		explicit !== undefined
			? koboOfStored(explicit)
			: Math.max(0, koboOfStored(row.payment_amount));
	return syntheticLine(assertKobo(subtotalKobo, "invoice subtotal"));
}

/**
 * The nine cells of one scheduled line. `item_cost` is the line's extended
 * amount (quantity × unit price) in naira, negated for a credit note; the
 * paste-ready layout has no discount or VAT-amount column. Invoicly stores a
 * single line label, so both `item` and `item_description` carry it.
 * `product_code` is blank unless the user has configured it.
 */
function rev360VatRowForLine(
	row: ComplianceExportInvoiceRow,
	line: StoredExportLine,
	sign: number,
): Array<string | number> {
	return [
		row.customer_name ?? "",
		taxIdOrZero(row.customer_tin),
		line.name,
		naira(sign * line.grossKobo),
		line.name,
		rev360VatStatusFor(line.vatCategory),
		rev360ProductCodeFor(line.classificationCode),
		row.invoice_number ?? "",
		row.issue_date ?? "",
	];
}

/**
 * The XLSX projection. `invoice_exports.content` is a text column, so the
 * workbook bytes are stored base64-encoded (decoded on download with the
 * SpreadsheetML MIME). Row 1 = NRS disclaimer, row 2 = paste-ready/unverified
 * note, row 3 = header, data from row 4. `item_cost` stays numeric so a
 * spreadsheet can total it; text cells are formula-lead guarded.
 */
async function buildRev360VatScheduleXlsx(
	rows: ComplianceExportInvoiceRow[],
): Promise<string> {
	const XLSX = await import("xlsx");
	const sheetData: Array<Array<string | number | null>> = [
		[NRS_INFORMATIONAL_DISCLAIMER],
		[REV360_LAYOUT_NOTE],
		[...REV360_VAT_HEADERS],
		...rows.flatMap((row) => {
			const sign = row.document_type === "credit_note" ? -1 : 1;
			return rev360LinesOf(row).map((line) =>
				rev360VatRowForLine(row, line, sign).map((cell) =>
					typeof cell === "string" ? guardFormulaLead(cell) : cell,
				),
			);
		}),
	];
	const worksheet = XLSX.utils.aoa_to_sheet(sheetData);
	const workbook = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(workbook, worksheet, REV360_VAT_SHEET_NAME);
	return XLSX.write(workbook, { bookType: "xlsx", type: "base64" });
}

/**
 * The stored artifact for `createInvoiceExport`: the XLSX kinds need async
 * workbook serialization (base64 text in `content`), the other kinds are
 * plain strings.
 */
export async function buildInvoiceExportArtifact(
	kind: ComplianceExportKind,
	rows: ComplianceExportInvoiceRow[],
	generatedAt: number,
): Promise<string> {
	if (kind === "qbo_invoices_csv") {
		throw new Error("Use buildQboInvoicesExport for qbo_invoices_csv.");
	}
	if (kind === "zoho_invoices_csv") {
		throw new Error("Use buildZohoInvoicesExport for zoho_invoices_csv.");
	}
	if (kind === "accountant_lines_xlsx") {
		return buildAccountantLinesXlsx(rows);
	}
	if (kind === "vat_sales_schedule_xlsx") {
		return buildRev360VatScheduleXlsx(rows);
	}
	return buildInvoiceExportContent(kind, rows, generatedAt);
}
