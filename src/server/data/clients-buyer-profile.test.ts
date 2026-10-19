import { beforeEach, describe, expect, it } from "vitest";
import {
	buildClientBuyerColumns,
	CLIENT_BUYER_REJECTION_PREFIX,
	createClient,
	getClientById,
	importClientsCsv,
	updateClient,
} from "./clients";
import { createFakeSupabase, type FakeTables } from "./testing/fake-db";
import type { Supabase } from "./workspaces";

/**
 * B2 server boundary for the buyer profile on clients: format-invalid values
 * are rejected, completeness gaps are flagged (never deleted or rewritten),
 * and every write stays workspace-scoped.
 */

const storedRow = {
	buyer_type: "b2b" as string | null,
	tax_id: "8129473650" as string | null,
	billing_address: "12 Wetheral Road, Lagos" as string | null,
};

const input = {
	name: "Acme Limited",
	email: "billing@acme.test",
};

describe("buildClientBuyerColumns (B2 server boundary)", () => {
	it("normalizes and stores a complete B2B buyer", () => {
		const columns = buildClientBuyerColumns(storedRow, {
			...input,
			taxId: "8129 473650",
			buyerType: "b2b",
		});
		expect(columns).toEqual({
			buyer_type: "b2b",
			buyer_profile_status: "complete",
			buyer_profile_issues: [],
			billing_address: "12 Wetheral Road, Lagos",
			tax_id: "8129473650",
		});
	});

	it("accepts a B2C buyer without a TIN", () => {
		const columns = buildClientBuyerColumns(
			{ buyer_type: "b2c", tax_id: null, billing_address: "7 Marina" },
			{ ...input, buyerType: "b2c", taxId: "" },
		);
		expect(columns.buyer_type).toBe("b2c");
		expect(columns.buyer_profile_status).toBe("complete");
		expect(columns.tax_id).toBeNull();
	});

	it.each([
		["walkthrough placeholder", "1234567890"],
		["all zeros", "0000000000"],
	])("rejects a placeholder TIN: %s", (_label, taxId) => {
		expect(() =>
			buildClientBuyerColumns(storedRow, { ...input, taxId }),
		).toThrow(/placeholder/i);
	});

	it("rejects a malformed TIN and a malformed email", () => {
		expect(() =>
			buildClientBuyerColumns(storedRow, { ...input, taxId: "12345" }),
		).toThrow(/exactly 10 digits/);
		expect(() =>
			buildClientBuyerColumns(storedRow, {
				...input,
				email: "not-an-email",
			}),
		).toThrow(/email format is invalid/i);
	});

	it("throws with the exported rejection prefix so the UI toast stays actionable", () => {
		let message = "";
		try {
			buildClientBuyerColumns(storedRow, { ...input, taxId: "12345" });
		} catch (error) {
			message = error instanceof Error ? error.message : "";
		}
		expect(message.startsWith(CLIENT_BUYER_REJECTION_PREFIX)).toBe(true);
	});

	it("flags — never rejects — an incomplete buyer (missing address / B2B TIN)", () => {
		const columns = buildClientBuyerColumns(
			{ buyer_type: "b2b", tax_id: null, billing_address: null },
			{ ...input, taxId: "", billingAddress: "" },
		);
		expect(columns.buyer_profile_status).toBe("needs_review");
		expect(columns.buyer_profile_issues.sort()).toEqual([
			"address_required",
			"tin_required",
		]);
		expect(columns.billing_address).toBeNull();
		expect(columns.tax_id).toBeNull();
	});

	it("keeps stored values when an edit omits them, and clears on empty string", () => {
		// Same contract as B1's buildSupplierProfileUpdate: undefined keeps
		// the stored value, "" is an explicit clear.
		const omitted = buildClientBuyerColumns(storedRow, input);
		expect(omitted.tax_id).toBe("8129473650");
		expect(omitted.billing_address).toBe("12 Wetheral Road, Lagos");

		const cleared = buildClientBuyerColumns(storedRow, {
			...input,
			taxId: "",
			billingAddress: "",
			buyerType: "b2c",
		});
		expect(cleared.tax_id).toBeNull();
		expect(cleared.billing_address).toBeNull();
		expect(cleared.buyer_type).toBe("b2c");
		// Clearing the TIN on a B2B buyer is a completeness gap, flagged not
		// rejected — the caller sees needs_review and can fix it.
		expect(
			buildClientBuyerColumns(storedRow, {
				...input,
				taxId: "",
			}).buyer_profile_status,
		).toBe("needs_review");
	});

	it("refuses to persist a stored placeholder that the edit leaves in place", () => {
		const legacyPlaceholderRow = {
			...storedRow,
			tax_id: "1234567890",
		};
		expect(() => buildClientBuyerColumns(legacyPlaceholderRow, input)).toThrow(
			/placeholder/i,
		);
	});

	it("only ever writes the whitelisted buyer columns", () => {
		const columns = buildClientBuyerColumns(storedRow, input);
		expect(Object.keys(columns).sort()).toEqual([
			"billing_address",
			"buyer_profile_issues",
			"buyer_profile_status",
			"buyer_type",
			"tax_id",
		]);
	});
});

// ---------------------------------------------------------------------------
// Server write paths against the no-RLS fake (workspace scoping proven by
// tenant-isolation.test.ts; here the focus is stored flag behavior).
// ---------------------------------------------------------------------------

const USER_B = "user-b";
const WS_B = "ws-b";

const clientInput = {
	name: "Beta Fresh",
	email: "beta-fresh@example.test",
	currency: "NGN",
	paymentTerms: "Net 14",
	contact: {},
	favorite: false,
	status: "active",
} as const;

let tables: FakeTables;
let client: Supabase;

function seed(): FakeTables {
	return {
		active_workspaces: [{ user_id: USER_B, workspace_id: WS_B }],
		workspaces: [{ id: WS_B, name: "Beta", invoice_number_prefix: "INV" }],
		clients: [
			{
				id: "client-b",
				workspace_id: WS_B,
				owner_id: USER_B,
				name: "Client B",
				company: null,
				email: "client-b@example.test",
				phone: null,
				website: null,
				billing_address: null,
				tax_id: "1234567890",
				buyer_type: "b2b",
				buyer_profile_status: "needs_review",
				buyer_profile_issues: ["tin_placeholder", "address_required"],
				currency: "NGN",
				payment_terms: "Net 14",
				internal_notes: null,
				contact: {},
				favorite: false,
				status: "active",
				created_at: "2026-01-01T00:00:00.000Z",
				updated_at: "2026-01-01T00:00:00.000Z",
			},
		],
	};
}

function row(id: string) {
	return tables.clients?.find((entry) => entry.id === id);
}

beforeEach(() => {
	tables = seed();
	client = createFakeSupabase(tables).client;
});

describe("client write paths store buyer flags", () => {
	it("createClient stores buyer_type and a needs_review flag for an incomplete quick-created buyer", async () => {
		const id = await createClient(client, USER_B, clientInput);
		const created = row(id);
		expect(created?.buyer_type).toBe("b2b");
		expect(created?.buyer_profile_status).toBe("needs_review");
		expect(created?.buyer_profile_issues).toEqual([
			"address_required",
			"tin_required",
		]);
		expect(created?.billing_address).toBeNull();
		expect(created?.tax_id).toBeNull();
	});

	it("createClient stores a complete profile when the buyer data is present", async () => {
		const id = await createClient(client, USER_B, {
			...clientInput,
			billingAddress: "12 Wetheral Road, Lagos",
			taxId: "8129473650",
			buyerType: "b2b",
		});
		const created = row(id);
		expect(created?.buyer_profile_status).toBe("complete");
		expect(created?.buyer_profile_issues).toEqual([]);
		expect(created?.tax_id).toBe("8129473650");
	});

	it("createClient rejects a placeholder TIN and writes nothing", async () => {
		const before = tables.clients?.length;
		await expect(
			createClient(client, USER_B, { ...clientInput, taxId: "1234567890" }),
		).rejects.toThrow(/placeholder/i);
		expect(tables.clients?.length).toBe(before);
	});

	it("updateClient rejects a format-invalid TIN and leaves the row untouched", async () => {
		const snapshot = { ...row("client-b") };
		await expect(
			updateClient(client, USER_B, "client-b", {
				...clientInput,
				name: "Client B",
				email: "client-b@example.test",
				taxId: "12345",
			}),
		).rejects.toThrow(/exactly 10 digits/);
		expect(row("client-b")).toEqual(snapshot);
	});

	it("updateClient re-flags a legacy placeholder TIN when the buyer type is confirmed B2B", async () => {
		// The legacy row carries a placeholder TIN; confirming/editing through
		// the validated path refuses it instead of silently keeping it.
		await expect(
			updateClient(client, USER_B, "client-b", {
				...clientInput,
				name: "Client B",
				email: "client-b@example.test",
			}),
		).rejects.toThrow(/placeholder/i);
	});

	it("importClientsCsv skips format-invalid rows and imports flagged ones", async () => {
		const result = await importClientsCsv(client, USER_B, [
			{ name: "Bad TIN Co", email: "bad-tin@example.test", taxId: "12345" },
			{ name: "Plain Co", email: "plain@example.test" },
		]);
		expect(result.created).toBe(1);
		expect(result.skipped).toBe(1);
		expect(result.errors[0]).toMatchObject({ row: 2 });
		const imported = tables.clients?.find(
			(entry) => entry.email === "plain@example.test",
		);
		expect(imported?.buyer_type).toBe("b2b");
		expect(imported?.buyer_profile_status).toBe("needs_review");
		expect(imported?.buyer_profile_issues).toEqual([
			"address_required",
			"tin_required",
		]);
	});

	it("reads back the buyer fields through the workspace-scoped getter", async () => {
		const fetched = await getClientById(client, USER_B, "client-b");
		expect(fetched?.buyerType).toBe("b2b");
		expect(fetched?.buyerProfileStatus).toBe("needs_review");
		expect(fetched?.buyerProfileIssues).toEqual([
			"tin_placeholder",
			"address_required",
		]);
	});
});
