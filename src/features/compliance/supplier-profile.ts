/**
 * B1 — supplier (workspace) profile validation.
 *
 * Spec: docs/e-invoicing/SPEC.md §3.1 P6, §5.B row B1, §6.2 item 4.
 *
 * These are FORMAT checks, not legal verification. The exact Nigerian TIN
 * structure/checksum is explicitly unconfirmed in SPEC 6.2 item 4; we accept
 * the 10-digit shape the UI hints at and reject obvious placeholder values.
 * Never present these checks as tax-authority validation.
 */

export const NIGERIA_TIN_DIGITS = 10;

/** Canonical CAC RC shape the settings UI hints at: RC-1234567. */
const NIGERIA_RC_PATTERN = /^RC-?\d{7}$/;
const NIGERIA_RC_CANONICAL = /^RC-\d{7}$/;

/**
 * Obvious placeholder TINs. SPEC P6 observed the product accepting
 * `1234567890`; all-same-digit strings are rejected separately below.
 */
const PLACEHOLDER_TINS = new Set(["1234567890", "0123456789", "9876543210"]);

const COUNTRY_CODE_PATTERN = /^[A-Z]{2}$/;

/**
 * TODO(tin-checksum): the Nigerian TIN checksum/structure rule is UNCONFIRMED
 * (SPEC 6.2 item 4). When an authoritative rule is confirmed, implement it
 * here and return `false` for TINs that fail it. Until then this accepts every
 * 10-digit, non-placeholder string — a format check, not legal validation.
 */
function tinPassesChecksum(tin: string): boolean {
	void tin;
	return true;
}

function isAllSameDigit(value: string): boolean {
	return value.length > 0 && /^(.)\1*$/.test(value);
}

function compact(value?: string | null): string {
	return value?.trim() ?? "";
}

export type TinValidation =
	| { ok: true; tin: string }
	| {
			ok: false;
			code: "tin_required" | "tin_format" | "tin_placeholder";
			message: string;
	  };

export function validateSupplierTin(value?: string | null): TinValidation {
	const tin = compact(value).replace(/\s+/g, "");
	if (!tin) {
		return {
			ok: false,
			code: "tin_required",
			message: "TIN is required (10 digits).",
		};
	}
	if (!new RegExp(`^\\d{${NIGERIA_TIN_DIGITS}}$`).test(tin)) {
		return {
			ok: false,
			code: "tin_format",
			message: `TIN must be exactly ${NIGERIA_TIN_DIGITS} digits.`,
		};
	}
	if (isAllSameDigit(tin) || PLACEHOLDER_TINS.has(tin)) {
		return {
			ok: false,
			code: "tin_placeholder",
			message: "That looks like a placeholder TIN. Enter your real TIN.",
		};
	}
	if (!tinPassesChecksum(tin)) {
		return {
			ok: false,
			code: "tin_format",
			message: "TIN failed its checksum rule.",
		};
	}
	return { ok: true, tin };
}

export type RcValidation =
	| { ok: true; rcNumber: string }
	| {
			ok: false;
			code: "cac_rc_required" | "cac_rc_format";
			message: string;
	  };

/**
 * Validates a Nigerian CAC company registration number and normalizes it to
 * the canonical `RC-1234567` form the invoices print.
 */
export function validateSupplierRcNumber(value?: string | null): RcValidation {
	const rc = compact(value).toUpperCase().replace(/\s+/g, "");
	if (!rc) {
		return {
			ok: false,
			code: "cac_rc_required",
			message: "CAC RC number is required (e.g. RC-1234567).",
		};
	}
	if (!NIGERIA_RC_PATTERN.test(rc)) {
		return {
			ok: false,
			code: "cac_rc_format",
			message: "CAC RC number must use the RC-1234567 format.",
		};
	}
	if (NIGERIA_RC_CANONICAL.test(rc)) return { ok: true, rcNumber: rc };
	const digits = rc.replace(/\D/g, "");
	return { ok: true, rcNumber: `RC-${digits}` };
}

export type StructuredAddressInput = {
	street?: string | null;
	lga?: string | null;
	state?: string | null;
	countryCode?: string | null;
};

export type NormalizedStructuredAddress = {
	street: string;
	lga: string;
	state: string;
	countryCode: string;
};

/**
 * Composes the printable address from the structured parts. Keeps the legacy
 * free-text `workspaces.address` column useful for invoice rendering without
 * ever being the stored source of truth again.
 */
export function composeSupplierAddress(
	address: StructuredAddressInput,
): string {
	return [compact(address.street), compact(address.lga), compact(address.state)]
		.filter(Boolean)
		.join(", ");
}

export type SupplierProfileIssueCode =
	| "address_street_required"
	| "address_state_required"
	| "address_country_required"
	| "address_not_structured"
	| "tin_required"
	| "tin_format"
	| "tin_placeholder"
	| "cac_rc_required"
	| "cac_rc_format";

export type SupplierProfileIssue = {
	code: SupplierProfileIssueCode;
	message: string;
};

export type SupplierProfileStatus = "complete" | "needs_review";

export type SupplierProfileInput = {
	tin?: string | null;
	rcNumber?: string | null;
	address: StructuredAddressInput;
};

export type SupplierProfileValidation = {
	valid: boolean;
	status: SupplierProfileStatus;
	issues: SupplierProfileIssue[];
	normalized: {
		tin: string;
		rcNumber: string;
		address: NormalizedStructuredAddress;
	};
};

/**
 * Full B1 supplier-profile check. Structured address (street, state/region,
 * country) is required for every workspace; TIN and CAC RC are required only
 * for Nigeria workspaces because both formats are Nigeria-specific.
 */
export function validateSupplierProfile(
	input: SupplierProfileInput,
): SupplierProfileValidation {
	const issues: SupplierProfileIssue[] = [];
	const push = (issue: SupplierProfileIssue) => issues.push(issue);

	const street = compact(input.address.street);
	const lga = compact(input.address.lga);
	const state = compact(input.address.state);
	const countryCode = compact(input.address.countryCode).toUpperCase();

	if (!street) {
		push({
			code: "address_street_required",
			message: "Street address is required.",
		});
	}
	if (!state) {
		push({
			code: "address_state_required",
			message: "State or region is required.",
		});
	}
	if (!COUNTRY_CODE_PATTERN.test(countryCode)) {
		push({
			code: "address_country_required",
			message: "Country (2-letter code) is required.",
		});
	}

	let tin = compact(input.tin);
	let rcNumber = compact(input.rcNumber);

	if (countryCode === "NG") {
		const tinResult = validateSupplierTin(input.tin);
		if (!tinResult.ok) push(tinResult);
		else tin = tinResult.tin;

		const rcResult = validateSupplierRcNumber(input.rcNumber);
		if (!rcResult.ok) push(rcResult);
		else rcNumber = rcResult.rcNumber;
	} else {
		tin = compact(input.tin);
		rcNumber = compact(input.rcNumber);
	}

	return {
		valid: issues.length === 0,
		status: issues.length === 0 ? "complete" : "needs_review",
		issues,
		normalized: {
			tin,
			rcNumber,
			address: { street, lga, state, countryCode },
		},
	};
}

const ISSUE_MESSAGES: Record<SupplierProfileIssueCode, string> = {
	address_street_required: "Street address is required.",
	address_state_required: "State or region is required.",
	address_country_required: "Country (2-letter code) is required.",
	address_not_structured:
		"Address must be entered as street, state/region and country.",
	tin_required: "TIN is required (10 digits).",
	tin_format: "TIN must be exactly 10 digits.",
	tin_placeholder: "Placeholder TINs are not accepted.",
	cac_rc_required: "CAC RC number is required.",
	cac_rc_format: "CAC RC number must use the RC-1234567 format.",
};

/** Human-readable text for a stored/derived issue code (UI banner). */
export function supplierProfileIssueMessage(
	code: SupplierProfileIssueCode,
): string {
	return ISSUE_MESSAGES[code] ?? code;
}
