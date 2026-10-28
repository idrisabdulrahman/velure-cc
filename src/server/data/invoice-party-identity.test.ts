import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server-derived party identity on the invoice write paths.
 *
 * The compliance snapshot the UI sends carries the seller/buyer legal names and
 * totals but no postal addresses and no buyer TIN, so WP12's
 * `validateCanonicalInvoice` rejected every UI-created invoice with
 * `party_address_required`. These probes pin the fix: the write paths fill the
 * snapshot from the active workspace's supplier profile and the
 * workspace-scoped client row before it is stored, and validation then passes.
 *
 * Audit transport posts to a server route that does not exist in Node; it is
 * replaced with a no-op so the lifecycle mutations can run.
 */

vi.mock("#/server/data/audit-client", () => ({
	recordInvoiceAudit: vi.fn(async () => {}),
}));

import { calculateInvoiceCompliance } from "#/features/compliance/calculate";
import {
	hasStoredComplianceSnapshot,
	validateWorkspaceInvoice,
} from "./einvoice-validation";
import { autosaveDraft, createDraft } from "./invoices";
import { createFakeSupabase, type FakeTables } from "./testing/fake-db";

const USER = "user-a";
const WS = "ws-a";
const CLIENT = "client-a";

function workspaceRow() {
	return {
		id: WS,
		owner_id: USER,
		name: "Alpha",
		legal_name: "Alpha Legal",
		email: "alpha@example.test",
		phone: "",
		address: "Legacy free-text address",
		address_street: "1 Workspace Way",
		address_lga: "Ikeja",
		address_state: "Lagos",
		website: "",
		base_currency: "NGN",
		country_code: "NG",
		default_payment_terms_days: 14,
		default_payment_link: null,
		logo_url: null,
		payment_details: null,
		tax_id: "8129473650",
		rc_number: "RC-1234567",
		seller_tax_status: "vat_registered",
		tax_rule_set_version: "ng-2026-q1",
		invoice_template_defaults: null,
		reminder_signature: null,
		reminders_enabled: true,
		supplier_profile_status: "complete",
		supplier_profile_issues: [],
		invoice_number_mode: "prefix",
		invoice_number_prefix: "INV",
		next_invoice_sequence: 1,
		updated_at: "2026-01-01T00:00:00.000Z",
	};
}

function clientRow(overrides: Record<string, unknown> = {}) {
	return {
		id: CLIENT,
		workspace_id: WS,
		owner_id: USER,
		name: "Buyer Ltd",
		company: null,
		email: "buyer@example.test",
		phone: null,
		website: null,
		billing_address: "2 Buyer Road, Victoria Island",
		tax_id: "4815162342",
		buyer_type: "b2b",
		buyer_profile_status: "complete",
		buyer_profile_issues: [],
		currency: "NGN",
		payment_terms: "Net 14",
		internal_notes: null,
		contact: { email: "buyer@example.test" },
		favorite: false,
		status: "active",
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
		...overrides,
	};
}

function seedTables(client: Record<string, unknown> = clientRow()): FakeTables {
	return {
		workspaces: [workspaceRow()],
		active_workspaces: [{ user_id: USER, workspace_id: WS }],
		workspace_members: [{ workspace_id: WS, user_id: USER, role: "owner" }],
		clients: [
			client,
			// A same-id row in a foreign workspace: enrichment must never read it.
			clientRow({ id: "client-b", workspace_id: "ws-b", name: "Foreign Ltd" }),
		],
		invoices: [],
	};
}

const lineItems = [
	{
		id: "li-1",
		name: "Consulting",
		quantity: 1,
		price: 5000,
		unit: "hour",
		vatCategory: "standard" as const,
		classificationCode: "SVC-001",
	},
];

/** The snapshot the UI produces: totals + names, but no addresses or buyer TIN. */
function uiCompliance() {
	return calculateInvoiceCompliance({
		seller: { legalName: "Alpha Legal", countryCode: "NG" },
		buyer: { legalName: "Buyer Ltd", countryCode: "NG" },
		sellerTaxStatus: "vat_registered",
		placeOfSupply: "NG",
		currency: "NGN",
		taxTreatment: "exclusive_rate",
		taxRate: 7.5,
		taxLabel: "VAT",
		withholding: { category: "none" },
		lineItems,
	});
}

const draftInput = {
	token: "pub-token-new",
	invoiceNumber: "INV-2026-0007",
	customerId: CLIENT,
	customerName: "Buyer Ltd",
	currency: "NGN",
	issueDate: "2026-01-01",
	dueDate: "2099-02-01",
	lineItems,
	compliance: uiCompliance() as unknown as Record<string, unknown>,
};

let tables: FakeTables;
let client: ReturnType<typeof createFakeSupabase>["client"];

beforeEach(() => {
	tables = seedTables();
	client = createFakeSupabase(tables).client;
});

function storedSnapshot(invoiceId: string) {
	const row = (tables.invoices as Array<Record<string, unknown>>).find(
		(entry) => entry.id === invoiceId,
	);
	return row?.compliance as Record<string, unknown>;
}

describe("server-derived party identity on invoice writes", () => {
	it("createDraft fills seller/buyer address and buyer TIN, and the invoice validates", async () => {
		const created = await createDraft(client, USER, draftInput);
		const snapshot = storedSnapshot(created.id) as Record<
			string,
			Record<string, unknown>
		>;

		expect(snapshot.seller.address).toBe("1 Workspace Way, Ikeja, Lagos");
		expect(snapshot.buyer.address).toBe("2 Buyer Road, Victoria Island");
		expect(snapshot.buyer.taxId).toBe("4815162342");
		expect(snapshot.seller.taxId).toBe("8129473650");
		// Criterion 4: the snapshot stays canonical and keeps its money fields.
		expect(hasStoredComplianceSnapshot(snapshot)).toBe(true);
		expect(typeof snapshot.netPayable).toBe("number");

		const validation = await validateWorkspaceInvoice(client, USER, created.id);
		expect(validation.issues).toEqual([]);
		expect(validation.valid).toBe(true);
	});

	it("autosaveDraft applies the same server-derived identity", async () => {
		const created = await autosaveDraft(client, USER, {
			...draftInput,
			invoiceNumber: "INV-2026-0008",
		});
		const snapshot = storedSnapshot(created.id) as Record<
			string,
			Record<string, unknown>
		>;
		expect(snapshot.seller.address).toBe("1 Workspace Way, Ikeja, Lagos");
		expect(snapshot.buyer.address).toBe("2 Buyer Road, Victoria Island");
		expect(snapshot.buyer.taxId).toBe("4815162342");

		const validation = await validateWorkspaceInvoice(client, USER, created.id);
		expect(validation.valid).toBe(true);
	});

	it("a client with no address still fails validation with party_address_required", async () => {
		tables = seedTables(
			clientRow({ billing_address: null, tax_id: "4815162342" }),
		);
		client = createFakeSupabase(tables).client;
		const created = await createDraft(client, USER, draftInput);

		const validation = await validateWorkspaceInvoice(client, USER, created.id);
		expect(validation.valid).toBe(false);
		expect(validation.issues).toContainEqual({
			code: "party_address_required",
			path: "buyer.address",
			message: "A billing address is required.",
		});
	});

	it("a B2B client with no TIN is flagged, never auto-filled", async () => {
		tables = seedTables(clientRow({ tax_id: null }));
		client = createFakeSupabase(tables).client;
		const created = await createDraft(client, USER, draftInput);

		const snapshot = storedSnapshot(created.id) as Record<
			string,
			Record<string, unknown>
		>;
		expect(snapshot.buyer.taxId).toBeUndefined();
		const validation = await validateWorkspaceInvoice(client, USER, created.id);
		expect(validation.issues.map(({ code }) => code)).toContain("tin_required");
	});

	it("discards a client-supplied fiscalization snapshot", async () => {
		const created = await createDraft(client, USER, {
			...draftInput,
			compliance: {
				...draftInput.compliance,
				fiscalization: {
					status: "mock_cleared",
					provider: "mock",
					environment: "sandbox",
					mock: true,
				},
			},
		});
		const snapshot = storedSnapshot(created.id);
		expect(snapshot).not.toHaveProperty("fiscalization");
		expect(hasStoredComplianceSnapshot(snapshot)).toBe(true);
	});

	it("rejects a foreign-workspace client instead of enriching from it", async () => {
		const before = (tables.invoices as unknown[]).length;
		await expect(
			createDraft(client, USER, { ...draftInput, customerId: "client-b" }),
		).rejects.toThrow("Customer not found.");
		expect((tables.invoices as unknown[]).length).toBe(before);
	});
});
