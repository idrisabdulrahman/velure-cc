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

/** 10-digit TIN shape (SPEC 6.2 item 4: exact format unconfirmed). */
export const NIGERIA_TIN_PATTERN = new RegExp(`^\\d{${NIGERIA_TIN_DIGITS}}$`);

/** Canonical CAC RC shape the settings UI hints at: RC-1234567. */
export const NIGERIA_RC_PATTERN = /^RC-?\d{7}$/;
const NIGERIA_RC_CANONICAL = /^RC-\d{7}$/;

/**
 * App-layer caps for the structured address columns, mirroring the DB CHECK
 * lengths in supabase/migrations/20261016000001_supplier_profile_validation_flags.sql
 * (`char_length <= 300/200/200`). Enforced here so an over-long save fails as
 * an actionable field error instead of an opaque Postgres CHECK violation.
 */
export const SUPPLIER_ADDRESS_MAX_LENGTHS = {
	street: 300,
	lga: 200,
	state: 200,
} as const;

/**
 * Obvious placeholder TINs. SPEC P6 observed the product accepting
 * `1234567890`; all-same-digit strings are rejected separately below.
 * Exported so the migration-parity test can pin the SQL backfill's copy of
 * this list — both sides must reject the same placeholders.
 */
export const PLACEHOLDER_TIN_VALUES: readonly string[] = [
	"1234567890",
	"0123456789",
	"9876543210",
];
const PLACEHOLDER_TINS = new Set(PLACEHOLDER_TIN_VALUES);

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
	if (!NIGERIA_TIN_PATTERN.test(tin)) {
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
			code: "cac_rc_required" | "cac_rc_format" | "cac_rc_placeholder";
			message: string;
	  };

/**
 * Validates a Nigerian CAC company registration number and normalizes it to
 * the canonical `RC-1234567` form the invoices print. All-same-digit numbers
 * (e.g. `RC-0000000`) are rejected as placeholders, like the TIN path.
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
	const digits = rc.replace(/\D/g, "");
	if (isAllSameDigit(digits)) {
		return {
			ok: false,
			code: "cac_rc_placeholder",
			message:
				"That looks like a placeholder CAC RC number. Enter your real registration number.",
		};
	}
	if (NIGERIA_RC_CANONICAL.test(rc)) return { ok: true, rcNumber: rc };
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
	| "address_street_too_long"
	| "address_lga_too_long"
	| "address_state_too_long"
	| "address_state_required"
	| "address_country_required"
	| "address_not_structured"
	| "tin_required"
	| "tin_format"
	| "tin_placeholder"
	| "cac_rc_required"
	| "cac_rc_format"
	| "cac_rc_placeholder";

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
	} else if (street.length > SUPPLIER_ADDRESS_MAX_LENGTHS.street) {
		push({
			code: "address_street_too_long",
			message: `Street address must be ${SUPPLIER_ADDRESS_MAX_LENGTHS.street} characters or fewer.`,
		});
	}
	if (lga.length > SUPPLIER_ADDRESS_MAX_LENGTHS.lga) {
		push({
			code: "address_lga_too_long",
			message: `LGA must be ${SUPPLIER_ADDRESS_MAX_LENGTHS.lga} characters or fewer.`,
		});
	}
	if (!state) {
		push({
			code: "address_state_required",
			message: "State or region is required.",
		});
	} else if (state.length > SUPPLIER_ADDRESS_MAX_LENGTHS.state) {
		push({
			code: "address_state_too_long",
			message: `State or region must be ${SUPPLIER_ADDRESS_MAX_LENGTHS.state} characters or fewer.`,
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
	address_street_too_long: "Street address is too long.",
	address_lga_too_long: "LGA is too long.",
	address_state_too_long: "State or region is too long.",
	address_state_required: "State or region is required.",
	address_country_required: "Country (2-letter code) is required.",
	address_not_structured:
		"Address must be entered as street, state/region and country.",
	tin_required: "TIN is required (10 digits).",
	tin_format: "TIN must be exactly 10 digits.",
	tin_placeholder: "Placeholder TINs are not accepted.",
	cac_rc_required: "CAC RC number is required.",
	cac_rc_format: "CAC RC number must use the RC-1234567 format.",
	cac_rc_placeholder: "Placeholder CAC RC numbers are not accepted.",
};

/** Human-readable text for a stored/derived issue code (UI banner). */
export function supplierProfileIssueMessage(
	code: SupplierProfileIssueCode,
): string {
	return ISSUE_MESSAGES[code] ?? code;
}

export type StoredSupplierProfileFlag = {
	status?: string | null;
	issues?: readonly string[] | null;
};

export type SupplierProfileBannerState = {
	flagged: boolean;
	/**
	 * A brand-new workspace: status `needs_review` with an empty issue list,
	 * i.e. nothing was ever saved and flagged — the settings page shows
	 * neutral "complete your profile" copy instead of the flagged wording.
	 */
	setupRequired: boolean;
	/** Raw issue codes, ready for `supplierProfileIssueMessage`. */
	codes: string[];
};

/**
 * Settings-page banner state for the supplier profile.
 *
 * `stored` is the flag columns as last read from the workspace row; `saved` is
 * the validation of the values from the most recent successful save (null when
 * nothing has been saved this session). The server write path rejects every
 * invalid profile, so a successful save supersedes a stored `needs_review`
 * flag immediately — without this, the query cache keeps showing the pre-save
 * banner until the follow-up refetch lands.
 *
 * A stored `needs_review` with no issue codes means the workspace has never
 * been saved through the validated path (the column default), not that saved
 * data was flagged — that is `setupRequired`, never `flagged`.
 */
export function supplierProfileBanner(
	stored: StoredSupplierProfileFlag | null | undefined,
	saved: SupplierProfileValidation | null,
): SupplierProfileBannerState {
	if (saved) {
		const flagged = saved.status === "needs_review";
		return {
			flagged,
			setupRequired: false,
			codes: flagged ? saved.issues.map((issue) => issue.code) : [],
		};
	}
	const needsReview = stored?.status === "needs_review";
	const codes = needsReview ? [...(stored?.issues ?? [])] : [];
	return {
		flagged: needsReview && codes.length > 0,
		setupRequired: needsReview && codes.length === 0,
		codes,
	};
}
