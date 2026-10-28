import { describe, expect, it } from "vitest";
import {
	applyPartyIdentity,
	buyerIdentityFromClient,
	supplierIdentityFromProfile,
} from "./party-identity";

describe("supplierIdentityFromProfile", () => {
	it("composes the structured address from street, LGA and state", () => {
		const identity = supplierIdentityFromProfile({
			addressStreet: "1 Workspace Way",
			addressLga: "Ikeja",
			addressState: "Lagos",
			countryCode: "NG",
			taxId: "8129473650",
			rcNumber: "RC-1234567",
		});
		expect(identity).toEqual({
			address: "1 Workspace Way, Ikeja, Lagos",
			taxId: "8129473650",
			rcNumber: "RC-1234567",
			countryCode: "NG",
		});
	});

	it("falls back to the legacy free-text address only when structured parts are empty", () => {
		expect(
			supplierIdentityFromProfile({
				address: "Legacy 1 Address",
				addressStreet: "  ",
				addressLga: null,
				addressState: "",
			}).address,
		).toBe("Legacy 1 Address");
		// A partially structured address wins over the legacy free text.
		expect(
			supplierIdentityFromProfile({
				address: "Legacy 1 Address",
				addressStreet: "2 New Way",
				addressState: "Abuja",
			}).address,
		).toBe("2 New Way, Abuja");
	});

	it("omits every empty supplier field", () => {
		const identity = supplierIdentityFromProfile({
			address: "   ",
			addressStreet: null,
			taxId: "",
			rcNumber: "  ",
			countryCode: null,
		});
		expect(identity.address).toBeUndefined();
		expect(identity.taxId).toBeUndefined();
		expect(identity.rcNumber).toBeUndefined();
		expect(identity.countryCode).toBeUndefined();
	});
});

describe("buyerIdentityFromClient", () => {
	it("trims the stored billing address and tax id", () => {
		expect(
			buyerIdentityFromClient({
				billingAddress: "  2 Buyer Road  ",
				taxId: " 9876543210 ",
			}),
		).toEqual({ address: "2 Buyer Road", taxId: "9876543210" });
	});

	it("omits a blank address or tax id", () => {
		expect(
			buyerIdentityFromClient({ billingAddress: "", taxId: null }),
		).toEqual({ address: undefined, taxId: undefined });
	});
});

describe("applyPartyIdentity", () => {
	const base = {
		seller: {
			legalName: "Client Claimed Seller",
			email: "seller@example.test",
			address: "client supplied seller address",
			taxId: "0000000001",
		},
		buyer: {
			legalName: "Buyer Ltd",
			address: "client supplied buyer address",
			taxId: "0000000002",
		},
		subtotal: 100,
	};

	it("lets the server-derived seller and buyer values win over client-supplied ones", () => {
		const applied = applyPartyIdentity(base, {
			seller: {
				address: "1 Workspace Way, Ikeja, Lagos",
				taxId: "8129473650",
				rcNumber: "RC-1234567",
				countryCode: "NG",
			},
			buyer: { address: "2 Buyer Road", taxId: "9876543210" },
		});
		expect(applied.seller).toEqual({
			legalName: "Client Claimed Seller",
			email: "seller@example.test",
			address: "1 Workspace Way, Ikeja, Lagos",
			taxId: "8129473650",
			rcNumber: "RC-1234567",
			countryCode: "NG",
		});
		expect(applied.buyer).toEqual({
			legalName: "Buyer Ltd",
			address: "2 Buyer Road",
			taxId: "9876543210",
		});
		// Non-party snapshot fields are untouched.
		expect(applied.subtotal).toBe(100);
	});

	it("clears a client-supplied seller identity when the workspace has none", () => {
		const applied = applyPartyIdentity(base, {
			seller: supplierIdentityFromProfile({}),
		});
		expect(applied.seller).toEqual({
			legalName: "Client Claimed Seller",
			email: "seller@example.test",
		});
	});

	it("clears a client-supplied buyer address/TIN when the client row has none", () => {
		const applied = applyPartyIdentity(base, {
			buyer: buyerIdentityFromClient({}),
		});
		expect(applied.buyer).toEqual({ legalName: "Buyer Ltd" });
	});

	it("keeps the snapshot seller country when the workspace country is unset", () => {
		const applied = applyPartyIdentity(
			{ seller: { countryCode: "NG" } },
			{ seller: supplierIdentityFromProfile({ addressStreet: "1 Way" }) },
		);
		expect((applied.seller as Record<string, unknown>).countryCode).toBe("NG");
	});

	it("leaves the buyer untouched when no client authority was derived", () => {
		const applied = applyPartyIdentity(base, {});
		expect(applied.buyer).toEqual(base.buyer);
	});
});
