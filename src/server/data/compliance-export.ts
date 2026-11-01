import { resolveInvoiceDiscount } from "#/features/compliance/calculate";
import { NRS_INFORMATIONAL_DISCLAIMER } from "#/features/compliance/nigeria";
import { validateSupplierTin } from "#/features/compliance/supplier-profile";
import type { DiscountMode } from "#/features/compliance/types";
import { priceToKobo } from "#/features/invoices/line-money";

export type ComplianceExportKind =
	| "invoices_csv"
	| "tax_summary_csv"
	| "customer_ledger_csv"
	| "normalized_accounting"
	/** T10 step 1 (`docs/EXPORT-FORMATS.md`): one row per invoice line. */
	| "accountant_lines_csv"
	| "accountant_lines_xlsx"
	/** T10 step 2: provisional TaxPro Max-shaped VAT sales schedule. */
	| "vat_sales_schedule_csv";

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

/** Extra per-export context that is not part of an invoice row. */
export type ComplianceExportMeta = {
	/** Workspace (seller) TIN, from `workspaces.tax_id`. */
	sellerTin?: string | null;
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
	return JSON.stringify(guardFormulaLead(text));
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
	meta: ComplianceExportMeta = {},
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

	if (kind === "vat_sales_schedule_csv") {
		return [
			JSON.stringify(NRS_INFORMATIONAL_DISCLAIMER),
			VAT_SCHEDULE_HEADERS.join(","),
			...rows
				.map((row) => vatScheduleRowForInvoice(row, meta.sellerTin))
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

	// The workbook needs async serialization; going through the sync builder
	// would silently emit CSV bytes named `.xlsx`.
	if (kind === "accountant_lines_xlsx") {
		throw new Error(
			"Use buildInvoiceExportArtifact for accountant_lines_xlsx.",
		);
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
 * VAT sales schedule (T10 step 2) — `docs/EXPORT-FORMATS.md`.
 *
 * A provisional, TaxPro Max-shaped VAT-only schedule, one row per invoice.
 * The buyer TIN prints the literal `0` when it is unknown (blank, malformed,
 * a placeholder, or the invoice has no linked client) so a manual filing has
 * a value to key on. Taxable/VAT come from the stored snapshot with the same
 * discount rule `calculateInvoiceCompliance` uses, so
 * `taxableAmount + vatAmount = totalAmount` in every mode.
 * --------------------------------------------------------------------- */

const VAT_SCHEDULE_HEADERS = [
	"supplierTin",
	"customerTin",
	"customerName",
	"invoiceNumber",
	"invoiceDate",
	"description",
	"taxableAmount",
	"vatAmount",
	"totalAmount",
	"documentType",
	"currency",
] as const;

/**
 * A TIN for a filing cell: the normalized digits when the value passes the
 * shared Nigerian TIN format/placeholder rule, otherwise the literal `0`
 * ("unknown"). Reuses `validateSupplierTin` so the buyer and seller rules
 * cannot drift from the supplier-profile rule.
 */
function tinOrZero(value: unknown): string {
	const result = validateSupplierTin(typeof value === "string" ? value : null);
	return result.ok ? result.tin : "0";
}

type VatScheduleCells = Array<string | number>;

function vatScheduleRowForInvoice(
	row: ComplianceExportInvoiceRow,
	sellerTin: string | null | undefined,
): VatScheduleCells {
	const compliance = (row.compliance ?? {}) as Record<string, unknown>;
	const settings = (row.template_settings ?? {}) as Record<string, unknown>;

	const lines = storedLinesOf(row);
	const synthetic = lines.length === 0;

	// Stored subtotal is authoritative; legacy rows fall back to line sums,
	// then the paid amount (mirrors the accountant export).
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

	// Same discount engine as the calculator / accountant export. A malformed
	// legacy combination degrades to no discount instead of aborting.
	let mode: DiscountMode = "none";
	let invoiceDiscountMinor = 0;
	let lineDiscountMinor = 0;
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
		lineDiscountMinor = resolved.lineDiscountMinor;
	} catch {
		mode = "none";
		invoiceDiscountMinor = 0;
		lineDiscountMinor = 0;
	}

	// Only before-tax and line discounts reduce the taxable base; an after-tax
	// discount is applied to the total after tax (calculate.ts:279-303).
	const beforeTaxDiscountMinor =
		mode === "invoice_before_tax"
			? invoiceDiscountMinor
			: mode === "line"
				? lineDiscountMinor
				: 0;
	const taxableBaseKobo = assertKobo(
		subtotalTargetKobo - beforeTaxDiscountMinor,
		"taxable base",
	);

	const vatKobo = assertKobo(
		numeric(compliance.totalTax) !== undefined
			? koboOfStored(compliance.totalTax)
			: 0,
		"invoice vat",
	);
	const grandTotalKobo =
		numeric(compliance.grandTotal) !== undefined
			? assertKobo(koboOfStored(compliance.grandTotal), "grand total")
			: 0;
	const treatment = compliance.taxTreatment;
	const discountTotalKobo = invoiceDiscountMinor + lineDiscountMinor;
	// Legacy rows without a stored treatment infer inclusive exactly like the
	// accountant export (grand == subtotal − discount while VAT > 0).
	const inclusive =
		typeof treatment === "string"
			? treatment === "inclusive_rate"
			: vatKobo > 0 &&
				grandTotalKobo === subtotalTargetKobo - discountTotalKobo;

	const taxableKobo = inclusive
		? assertKobo(taxableBaseKobo - vatKobo, "taxable amount")
		: taxableBaseKobo;
	const totalKobo = inclusive
		? taxableBaseKobo
		: assertKobo(taxableBaseKobo + vatKobo, "total amount");

	const firstLine = workingLines[0];
	const description =
		firstLine && firstLine.name.trim().length > 0
			? firstLine.name
			: ACCOUNTANT_NO_LINE_LABEL;

	const sign = row.document_type === "credit_note" ? -1 : 1;

	return [
		tinOrZero(sellerTin),
		tinOrZero(row.customer_tin),
		row.customer_name ?? "",
		row.invoice_number ?? "",
		row.issue_date ?? "",
		description,
		naira(sign * taxableKobo),
		naira(sign * vatKobo),
		naira(sign * totalKobo),
		documentTypeForExportRow(row),
		row.currency ?? "",
	];
}

/**
 * The stored artifact for `createInvoiceExport`: `accountant_lines_xlsx`
 * needs async workbook serialization (base64 text in `content`), the other
 * kinds are plain strings.
 */
export async function buildInvoiceExportArtifact(
	kind: ComplianceExportKind,
	rows: ComplianceExportInvoiceRow[],
	generatedAt: number,
	meta: ComplianceExportMeta = {},
): Promise<string> {
	if (kind === "accountant_lines_xlsx") {
		return buildAccountantLinesXlsx(rows);
	}
	return buildInvoiceExportContent(kind, rows, generatedAt, meta);
}
