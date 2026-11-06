import { composeSupplierAddress } from "./supplier-profile";
import type { StructuredPostalAddress } from "./types";

/**
 * Server-derived party identity for the persisted invoice compliance snapshot.
 *
 * The pre-submission validator (WP12, `validateCanonicalInvoice`) requires the
 * seller and buyer postal addresses, the seller jurisdiction, and — for a B2B
 * buyer — a tax identifier. Those fields live in the workspace supplier
 * profile and the workspace-scoped `clients` row, not in the client payload,
 * so the invoice write paths derive them here before the snapshot is
 * normalized and stored. The UI never supplies authoritative identity
 * (AGENTS.md §8).
 *
 * Pure and framework-free so the derivation rules can be unit-tested without a
 * Supabase client. A field left `undefined` means the authority had no value.
 */

export type DerivedPartyIdentity = {
	address?: string;
	postalAddress?: StructuredPostalAddress;
	taxId?: string;
	rcNumber?: string;
	countryCode?: string;
};

export type DerivedPartyIdentityMap = {
	seller?: DerivedPartyIdentity;
	buyer?: DerivedPartyIdentity;
};

function text(value: string | null | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

/**
 * Builds the structured postal address from the parts Invoicly actually stores.
 * Returns `undefined` when every part is empty, so a profile with no structured
 * address never emits an empty object into the snapshot.
 */
function structuredPostalAddress(input: {
	street?: string | null;
	lga?: string | null;
	state?: string | null;
}): StructuredPostalAddress | undefined {
	const street = text(input.street);
	const lga = text(input.lga);
	const state = text(input.state);
	if (!street && !lga && !state) return undefined;
	return {
		...(street ? { street } : {}),
		...(lga ? { lga } : {}),
		...(state ? { state } : {}),
	};
}

/**
 * Seller identity from the workspace supplier profile. Composes the structured
 * address (street, LGA, state) and falls back to the legacy free-text address
 * only when every structured part is empty.
 */
export function supplierIdentityFromProfile(input: {
	address?: string | null;
	addressStreet?: string | null;
	addressLga?: string | null;
	addressState?: string | null;
	countryCode?: string | null;
	taxId?: string | null;
	rcNumber?: string | null;
}): DerivedPartyIdentity {
	return {
		address:
			composeSupplierAddress({
				street: input.addressStreet,
				lga: input.addressLga,
				state: input.addressState,
			}) || text(input.address),
		postalAddress: structuredPostalAddress({
			street: input.addressStreet,
			lga: input.addressLga,
			state: input.addressState,
		}),
		taxId: text(input.taxId),
		rcNumber: text(input.rcNumber),
		countryCode: text(input.countryCode),
	};
}

/** Buyer identity from the workspace-scoped `clients` row. */
export function buyerIdentityFromClient(input: {
	billingAddress?: string | null;
	taxId?: string | null;
}): DerivedPartyIdentity {
	return {
		address: text(input.billingAddress),
		taxId: text(input.taxId),
	};
}

function asParty(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? { ...(value as Record<string, unknown>) }
		: {};
}

/**
 * Overwrites the derived keys on a party, keeping every other field the
 * snapshot producer wrote. A derived `undefined` deletes the field so a
 * client-supplied value can never stand in for an authority that has none
 * (address, postalAddress, taxId, rcNumber). `countryCode` is only replaced
 * when the authority supplies one, so a snapshot default (e.g. the workspace's
 * `countryCode`) survives an unset legacy column.
 */
function overrideParty(
	current: unknown,
	derived: DerivedPartyIdentity,
	keys: ReadonlyArray<keyof DerivedPartyIdentity>,
	clearMissing: ReadonlyArray<keyof DerivedPartyIdentity>,
): Record<string, unknown> {
	const party = asParty(current);
	for (const key of keys) {
		const value = derived[key];
		if (value !== undefined) party[key] = value;
		else if (clearMissing.includes(key)) delete party[key];
	}
	return party;
}

/**
 * Applies the server-derived seller and buyer identity to a compliance
 * snapshot. Only the keys the server is authoritative for are touched; all
 * other snapshot fields (totals, tax lines, delivery email, legal names) are
 * preserved. A party key that is absent from `identity` is left untouched.
 */
export function applyPartyIdentity(
	compliance: Record<string, unknown>,
	identity: DerivedPartyIdentityMap,
): Record<string, unknown> {
	const sellerKeys = [
		"address",
		"postalAddress",
		"taxId",
		"rcNumber",
		"countryCode",
	] as const;
	const buyerKeys = ["address", "postalAddress", "taxId"] as const;
	return {
		...compliance,
		...(identity.seller
			? {
					seller: overrideParty(
						compliance.seller,
						identity.seller,
						sellerKeys,
						["address", "postalAddress", "taxId", "rcNumber"],
					),
				}
			: {}),
		...(identity.buyer
			? {
					buyer: overrideParty(
						compliance.buyer,
						identity.buyer,
						buyerKeys,
						buyerKeys,
					),
				}
			: {}),
	};
}
