/**
 * B2 — buyer (client) profile validation.
 *
 * Spec: docs/e-invoicing/SPEC.md §3.1 P3/P4, §5.B row B2, §6.2 item 7.
 *
 * A buyer record carries name, email, address, TIN and a B2B/B2C type as
 * first-class fields. TIN rules reuse the B1 supplier TIN validator
 * (`#/features/compliance/supplier-profile`): FORMAT checks only, never legal
 * or tax-authority verification.
 *
 * Severity split (deliberate divergence from B1's reject-on-incomplete):
 * - FORMAT issues (invalid buyer_type, bad email shape, malformed/placeholder
 *   TIN, over-long address) must never persist — the server write path
 *   rejects them. Missing name or email is blocking too: the clients write
 *   path already requires both upstream (`assertValidClientPayload`).
 * - COMPLETENESS issues (missing address, missing B2B TIN) are surfaced
 *   through `status`/`issues` and stored in the non-destructive
 *   `buyer_profile_status` / `buyer_profile_issues` flag columns so bulk
 *   pre-existing clients and CSV imports keep working while incomplete
 *   buyers are flagged for follow-up.
 */

import {
	NIGERIA_TIN_DIGITS,
	validateSupplierTin,
} from "../compliance/supplier-profile";

export const BUYER_TYPES = ["b2b", "b2c"] as const;
export type BuyerType = (typeof BUYER_TYPES)[number];

/**
 * New clients without an explicit type default to B2B: Velure's core motion
 * is business invoicing, and the migration backfills every pre-existing row
 * as B2B for the same reason (a flagged missing TIN drives the fix).
 */
export const DEFAULT_BUYER_TYPE: BuyerType = "b2b";

/** Mirrors the DB CHECK length planned for `clients.billing_address`. */
export const BUYER_ADDRESS_MAX_LENGTH = 300;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type BuyerProfileIssueCode =
	| "buyer_type_invalid"
	| "name_required"
	| "email_required"
	| "email_format"
	| "address_required"
	| "address_too_long"
	| "tin_required"
	| "tin_format"
	| "tin_placeholder";

export type BuyerProfileIssue = {
	code: BuyerProfileIssueCode;
	message: string;
};

/**
 * Issue codes that block persistence (format problems). Everything else is a
 * completeness gap that is flagged, not rejected.
 */
const BLOCKING_ISSUE_CODES = new Set<BuyerProfileIssueCode>([
	"buyer_type_invalid",
	"email_required",
	"email_format",
	"address_too_long",
	"tin_format",
	"tin_placeholder",
	"name_required",
]);

export type BuyerProfileInput = {
	name?: string | null;
	email?: string | null;
	billingAddress?: string | null;
	taxId?: string | null;
	buyerType?: string | null;
};

export type NormalizedBuyerProfile = {
	name: string;
	email: string;
	billingAddress: string;
	taxId: string;
	buyerType: BuyerType;
};

export type BuyerProfileValidation = {
	/** No blocking (format) issues — the profile may be persisted. */
	valid: boolean;
	/** Blocking (format) issues only — the subset that rejects a save. */
	blockingIssues: BuyerProfileIssue[];
	/** No issues at all — name, email, address and (B2B) TIN are present. */
	complete: boolean;
	status: "complete" | "needs_review";
	issues: BuyerProfileIssue[];
	normalized: NormalizedBuyerProfile;
};

function compact(value?: string | null): string {
	return value?.trim() ?? "";
}

export function normalizeBuyerType(value?: string | null): BuyerType | null {
	const normalized = compact(value).toLowerCase();
	if (!normalized) return DEFAULT_BUYER_TYPE;
	return (BUYER_TYPES as readonly string[]).includes(normalized)
		? (normalized as BuyerType)
		: null;
}

/**
 * Full B2 buyer-profile check. Name, email and address are required for every
 * buyer; the TIN is required only for B2B buyers (SPEC §3.1 P3: "name, TIN
 * for B2B") but is format-checked whenever it is present.
 */
export function validateBuyerProfile(
	input: BuyerProfileInput,
): BuyerProfileValidation {
	const issues: BuyerProfileIssue[] = [];
	const push = (code: BuyerProfileIssueCode, message: string) =>
		issues.push({ code, message });

	const name = compact(input.name);
	const email = compact(input.email).toLowerCase();
	const billingAddress = compact(input.billingAddress);
	const buyerType = normalizeBuyerType(input.buyerType);

	if (!name) {
		push("name_required", "Buyer name is required.");
	}

	if (!email) {
		push("email_required", "Buyer email is required.");
	} else if (!EMAIL_PATTERN.test(email)) {
		push("email_format", "Buyer email format is invalid.");
	}

	if (!billingAddress) {
		push("address_required", "Buyer address is required.");
	} else if (billingAddress.length > BUYER_ADDRESS_MAX_LENGTH) {
		push(
			"address_too_long",
			`Buyer address must be ${BUYER_ADDRESS_MAX_LENGTH} characters or fewer.`,
		);
	}

	let taxId = compact(input.taxId).replace(/\s+/g, "");
	if (!buyerType) {
		push(
			"buyer_type_invalid",
			`Buyer type must be one of: ${BUYER_TYPES.join(", ")}.`,
		);
	} else if (buyerType === "b2b" && !taxId) {
		push(
			"tin_required",
			`TIN is required for B2B buyers (${NIGERIA_TIN_DIGITS} digits).`,
		);
	} else if (taxId) {
		const tinResult = validateSupplierTin(taxId);
		if (!tinResult.ok) push(tinResult.code, tinResult.message);
		else taxId = tinResult.tin;
	}

	const valid = issues.every((issue) => !BLOCKING_ISSUE_CODES.has(issue.code));
	const blockingIssues = issues.filter((issue) =>
		BLOCKING_ISSUE_CODES.has(issue.code),
	);
	return {
		valid,
		blockingIssues,
		complete: issues.length === 0,
		status: issues.length === 0 ? "complete" : "needs_review",
		issues,
		normalized: {
			name,
			email,
			billingAddress,
			taxId,
			buyerType: buyerType ?? DEFAULT_BUYER_TYPE,
		},
	};
}
