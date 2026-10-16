/**
 * Pure invoice tax math for e-invoicing (spec fix E2, `docs/e-invoicing/SPEC.md`
 * §5.E). VAT (standard / zero-rated / exempt) and WHT on integer minor units
 * (kobo) only — never floats. No DB, env, network, or server imports; this
 * module is safe to use on both client and server.
 *
 * Rounding rule (single source of truth below, in `applyBps`):
 * round-half-away-from-zero, applied per line to the line VAT amount and once
 * per invoice to the WHT amount. Invoice totals are exact integer sums of the
 * already-rounded line values; sums are never re-rounded, so
 * `grandTotalMinor === sum(lineTotalMinor)` by construction (guarded at
 * runtime).
 *
 * WHT is deducted by the payer and, matching the existing compliance
 * calculator, is computed on the VAT-inclusive grand total. The WHT rate is
 * always supplied by the caller in basis points — exact current rates are
 * unverified per spec §8, so this module deliberately bakes in no schedule.
 */

/** VAT categories. Spec §8 flags unconfirmed treatment nuances; only the
 * standard / zero-rated / exempt split is modelled here. */
export type VatCategory = "standard" | "zero_rated" | "exempt";

/**
 * Default standard VAT rate in basis points: 7.5% (750 bps). Rate per spec,
 * unconfirmed — callers may override per invoice or per line.
 */
export const VAT_RATE_BPS_SPEC_DEFAULT = 750;

const BPS_DIVISOR = 10_000;
const BPS_HALF = BPS_DIVISOR / 2;
/** Rates above 100% are rejected; WHT/VAT rates live in [0, 10000] bps. */
const MAX_RATE_BPS = 10_000;

const VAT_CATEGORY_ORDER: readonly VatCategory[] = [
	"standard",
	"zero_rated",
	"exempt",
];

function assertSafeInteger(value: number, name: string): void {
	if (!Number.isSafeInteger(value)) {
		throw new RangeError(
			`${name} must be a safe integer in minor units (kobo); received ${String(value)}.`,
		);
	}
}

function assertRateBps(value: number, name: string): void {
	assertSafeInteger(value, name);
	if (value < 0 || value > MAX_RATE_BPS) {
		throw new RangeError(
			`${name} must be between 0 and ${MAX_RATE_BPS} basis points (0–100%); received ${String(value)}.`,
		);
	}
}

function assertVatCategory(value: VatCategory): void {
	if (value !== "standard" && value !== "zero_rated" && value !== "exempt") {
		throw new TypeError(
			`Unknown VAT category "${String(value)}"; expected standard, zero_rated, or exempt.`,
		);
	}
}

/**
 * Multiplies an integer minor-unit amount by a basis-point rate and rounds
 * half away from zero, using integer arithmetic only. This is the module's
 * single rounding rule; every VAT and WHT amount flows through it.
 */
export function applyBps(amountMinor: number, rateBps: number): number {
	assertSafeInteger(amountMinor, "amountMinor");
	assertRateBps(rateBps, "rateBps");
	const product = amountMinor * rateBps;
	if (!Number.isSafeInteger(product)) {
		throw new RangeError(
			`amountMinor × rateBps overflows safe integer arithmetic; split the amount into smaller lines.`,
		);
	}
	const magnitude = Math.floor((Math.abs(product) + BPS_HALF) / BPS_DIVISOR);
	if (!Number.isSafeInteger(magnitude)) {
		throw new RangeError(`Rounded tax amount overflows safe integer range.`);
	}
	// Normalize −0 away so money values never carry a negative zero.
	if (magnitude === 0) return 0;
	return product < 0 ? -magnitude : magnitude;
}

export type LineTaxInput = {
	/** Line net amount in kobo (minor units), before any discount. */
	netMinor: number;
	vatCategory: VatCategory;
	/** Basis points; defaults to `VAT_RATE_BPS_SPEC_DEFAULT`. */
	vatRateBps?: number;
};

/**
 * Computes the VAT for one line, in kobo. Only `standard` lines carry VAT;
 * `zero_rated` and `exempt` return 0 (they still appear in invoice
 * breakdowns). VAT is rounded half away from zero at the line level.
 */
export function computeLineTax(input: LineTaxInput): number {
	assertSafeInteger(input.netMinor, "netMinor");
	assertVatCategory(input.vatCategory);
	const rateBps = input.vatRateBps ?? VAT_RATE_BPS_SPEC_DEFAULT;
	assertRateBps(rateBps, "vatRateBps");
	if (input.vatCategory !== "standard") {
		return 0;
	}
	return applyBps(input.netMinor, rateBps);
}

export type InvoiceLineTaxInput = {
	/** Line net amount in kobo, before discount. May be negative (credit line). */
	netMinor: number;
	/** Optional non-negative discount in kobo, not exceeding a non-negative net. */
	discountMinor?: number;
	vatCategory: VatCategory;
	/** Per-line basis-point override; defaults to the invoice-level rate. */
	vatRateBps?: number;
};

export type InvoiceLineTaxResult = {
	index: number;
	netMinor: number;
	discountMinor: number;
	/** netMinor − discountMinor; the VAT base for this line. */
	taxableNetMinor: number;
	vatCategory: VatCategory;
	vatRateBps: number;
	vatMinor: number;
	/** taxableNetMinor + vatMinor. */
	lineTotalMinor: number;
};

export type VatCategoryTotal = {
	category: VatCategory;
	taxableNetMinor: number;
	vatMinor: number;
};

export type InvoiceTotalsResult = {
	lineTaxes: InvoiceLineTaxResult[];
	totalNetMinor: number;
	totalDiscountMinor: number;
	totalTaxableNetMinor: number;
	/** All three categories always appear, in fixed order, even at 0. */
	vatBreakdown: VatCategoryTotal[];
	totalVatMinor: number;
	/** Caller-supplied; 0 when WHT does not apply. */
	whtRateBps: number;
	totalWhtMinor: number;
	/** totalTaxableNetMinor + totalVatMinor (VAT-exclusive pricing + VAT). */
	grandTotalMinor: number;
	/** grandTotalMinor − totalWhtMinor (WHT is deducted by the payer). */
	netPayableMinor: number;
};

export type InvoiceTotalsInput = {
	lines: readonly InvoiceLineTaxInput[];
	/** Invoice-level VAT rate in basis points; defaults to the spec rate. */
	vatRateBps?: number;
	/** WHT rate in basis points, supplied by the caller. Defaults to 0. */
	whtRateBps?: number;
};

function sumMinor(values: readonly number[], label: string): number {
	let sum = 0;
	for (const value of values) {
		sum += value;
		assertSafeInteger(sum, label);
	}
	return sum;
}

/**
 * Computes per-line taxes and invoice totals for a set of lines. Totals are
 * exact integer sums of the per-line rounded values, so
 * `grandTotalMinor === Σ lineTotalMinor` and
 * `totalVatMinor === Σ lineTax.vatMinor` hold by construction (the grand
 * total invariant is also asserted before returning).
 */
export function computeInvoiceTotals(
	input: InvoiceTotalsInput,
): InvoiceTotalsResult {
	const invoiceRateBps = input.vatRateBps ?? VAT_RATE_BPS_SPEC_DEFAULT;
	assertRateBps(invoiceRateBps, "vatRateBps");
	const whtRateBps = input.whtRateBps ?? 0;
	assertRateBps(whtRateBps, "whtRateBps");

	const lineTaxes: InvoiceLineTaxResult[] = input.lines.map(
		(line: InvoiceLineTaxInput, index: number) => {
			assertSafeInteger(line.netMinor, `lines[${index}].netMinor`);
			const discountMinor = line.discountMinor ?? 0;
			assertSafeInteger(discountMinor, `lines[${index}].discountMinor`);
			if (discountMinor < 0) {
				throw new RangeError(
					`lines[${index}].discountMinor must not be negative; received ${String(discountMinor)}.`,
				);
			}
			if (discountMinor > Math.max(line.netMinor, 0)) {
				throw new RangeError(
					`lines[${index}].discountMinor must not exceed netMinor; received discount ${String(discountMinor)} on net ${String(line.netMinor)}.`,
				);
			}
			const taxableNetMinor = line.netMinor - discountMinor;
			const vatRateBps = line.vatRateBps ?? invoiceRateBps;
			const vatMinor = computeLineTax({
				netMinor: taxableNetMinor,
				vatCategory: line.vatCategory,
				vatRateBps,
			});
			return {
				index,
				netMinor: line.netMinor,
				discountMinor,
				taxableNetMinor,
				vatCategory: line.vatCategory,
				vatRateBps,
				vatMinor,
				lineTotalMinor: taxableNetMinor + vatMinor,
			};
		},
	);

	const totalNetMinor = sumMinor(
		lineTaxes.map((line) => line.netMinor),
		"totalNetMinor",
	);
	const totalDiscountMinor = sumMinor(
		lineTaxes.map((line) => line.discountMinor),
		"totalDiscountMinor",
	);
	const totalTaxableNetMinor = sumMinor(
		lineTaxes.map((line) => line.taxableNetMinor),
		"totalTaxableNetMinor",
	);
	const totalVatMinor = sumMinor(
		lineTaxes.map((line) => line.vatMinor),
		"totalVatMinor",
	);

	const vatBreakdown: VatCategoryTotal[] = VAT_CATEGORY_ORDER.map(
		(category) => {
			const linesInCategory = lineTaxes.filter(
				(line) => line.vatCategory === category,
			);
			return {
				category,
				taxableNetMinor: sumMinor(
					linesInCategory.map((line) => line.taxableNetMinor),
					`vatBreakdown[${category}].taxableNetMinor`,
				),
				vatMinor: sumMinor(
					linesInCategory.map((line) => line.vatMinor),
					`vatBreakdown[${category}].vatMinor`,
				),
			};
		},
	);

	const grandTotalMinor = totalTaxableNetMinor + totalVatMinor;
	const sumOfLineTotals = sumMinor(
		lineTaxes.map((line) => line.lineTotalMinor),
		"sumOfLineTotals",
	);
	if (grandTotalMinor !== sumOfLineTotals) {
		throw new Error(
			`Invoice tax invariant violated: grand total ${String(grandTotalMinor)} does not equal the sum of line totals ${String(sumOfLineTotals)}.`,
		);
	}

	const totalWhtMinor = applyBps(grandTotalMinor, whtRateBps);
	const netPayableMinor = grandTotalMinor - totalWhtMinor;

	return {
		lineTaxes,
		totalNetMinor,
		totalDiscountMinor,
		totalTaxableNetMinor,
		vatBreakdown,
		totalVatMinor,
		whtRateBps,
		totalWhtMinor,
		grandTotalMinor,
		netPayableMinor,
	};
}
