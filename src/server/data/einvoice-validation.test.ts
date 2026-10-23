import { describe, expect, it } from "vitest";
import { validateWorkspaceInvoice } from "./einvoice-validation";
import { createFakeSupabase, type FakeTables } from "./testing/fake-db";

const compliance = {
	seller: {
		legalName: "Seller Ltd",
		countryCode: "NG",
		address: "1 Seller Road",
		taxId: "1234567891",
	},
	buyer: { legalName: "Buyer Ltd", countryCode: "NG", address: "2 Buyer Road" },
	placeOfSupply: "NG",
	taxRuleSetVersion: "ng-v1",
	taxTreatment: "exclusive_rate",
	taxRate: 7.5,
	taxLabel: "VAT",
	taxLines: [
		{
			label: "VAT",
			rate: 7.5,
			amount: 7.5,
			treatment: "exclusive_rate",
			jurisdictionCode: "NG",
		},
	],
	warnings: [],
	templateVariant: "vat_ready",
	subtotal: 100,
	totalTax: 7.5,
	grandTotal: 107.5,
	netPayable: 107.5,
	withholdingTaxAmount: 0,
	withholding: {
		mode: "rule_based",
		category: "none",
		recipientEntityType: "corporate",
		recipientResidency: "resident",
		rate: 0,
		amount: 0,
		ruleVersion: "ng-v1",
		manualOverride: false,
	},
	withholdingTaxPreset: "none",
	withholdingTaxLabel: "WHT",
	withholdingTaxRate: 0,
};

function tables(customerWorkspace: string): FakeTables {
	return {
		active_workspaces: [{ user_id: "user-a", workspace_id: "workspace-a" }],
		invoices: [
			{
				id: "invoice-a",
				workspace_id: "workspace-a",
				token: "private-token",
				token_revoked_at: null,
				document_type: "standard",
				corrects_invoice_id: null,
				shipment_details: null,
				invoice_number: "INV-2026-0001",
				customer_id: "client-a",
				customer_name: "Buyer Ltd",
				logo_url: null,
				customer_po_number: null,
				currency: "NGN",
				invoice_type: "one-time",
				invoice_size: "A4",
				date_format: "iso",
				payment_terms_days: 14,
				template: "Default",
				issue_date: "2026-01-01",
				due_date: "2026-01-15",
				status: "unpaid",
				payment_amount: 0,
				delivered_at: null,
				canceled_at: null,
				payment_details: null,
				payment_link: null,
				payment_provider: null,
				paid_at: null,
				payment_reference: null,
				finalized_at: null,
				scheduled_at: null,
				schedule_version: null,
				notes: null,
				internal_notes: null,
				deleted_at: null,
				line_items: [
					{
						id: "line-a",
						name: "Service",
						quantity: 1,
						price: 100,
						unit: "hour",
						vatCategory: "standard",
						classificationCode: "SVC-01",
					},
				],
				template_settings: null,
				top_block: null,
				bottom_block: null,
				compliance,
				fiscalization: null,
				reminder: null,
				sync: null,
				lifecycle: null,
				created_at: "2026-01-01T00:00:00Z",
				updated_at: "2026-01-01T00:00:00Z",
			},
		],
		clients: [
			{
				id: "client-a",
				workspace_id: customerWorkspace,
				buyer_type: "b2b",
				name: "Private customer record",
				tax_id: "9876543210",
			},
		],
	};
}

describe("validateWorkspaceInvoice", () => {
	it("scopes invoice and buyer profile to the verified active workspace and returns issues only", async () => {
		const state = tables("workspace-b");
		const { client } = createFakeSupabase(state);
		const result = await validateWorkspaceInvoice(
			client,
			"user-a",
			"invoice-a",
		);
		expect(result.issues.map(({ code }) => code)).toContain(
			"buyer_type_unverified",
		);
		expect(JSON.stringify(result)).not.toContain("Private customer record");
		expect(JSON.stringify(result)).not.toContain("9876543210");
	});

	it("uses the client type only when both rows belong to the same workspace", async () => {
		const { client } = createFakeSupabase(tables("workspace-a"));
		const result = await validateWorkspaceInvoice(
			client,
			"user-a",
			"invoice-a",
		);
		expect(result.issues.map(({ code }) => code)).toContain("tin_required");
		expect("invoice" in result).toBe(false);
	});

	it("does not reveal whether an invoice exists outside the active workspace", async () => {
		const state = tables("workspace-a");
		state.invoices[0].workspace_id = "workspace-b";
		const { client } = createFakeSupabase(state);
		const result = await validateWorkspaceInvoice(
			client,
			"user-a",
			"invoice-a",
		);
		expect(result.issues).toEqual([
			{
				code: "invoice_not_found",
				path: "invoice",
				message: "Invoice was not found in the active workspace.",
			},
		]);
	});

	it("does not validate fabricated defaults when the stored compliance snapshot is missing", async () => {
		const state = tables("workspace-a");
		state.invoices[0].compliance = null;
		const { client } = createFakeSupabase(state);
		const result = await validateWorkspaceInvoice(
			client,
			"user-a",
			"invoice-a",
		);
		expect(result).toEqual({
			valid: false,
			issues: [
				{
					code: "compliance_snapshot_invalid",
					path: "compliance",
					message:
						"A complete stored compliance snapshot is required for validation.",
				},
			],
		});
	});

	it("rejects malformed compliance data instead of filling defaults or throwing", async () => {
		const withholding = compliance.withholding;
		const requiredWithholdingFields = [
			"mode",
			"category",
			"recipientEntityType",
			"recipientResidency",
			"ruleVersion",
			"manualOverride",
		] as const;
		const malformedSnapshots = [
			{},
			{ ...compliance, withholding: {} },
			{
				...compliance,
				withholding: {
					amount: withholding.amount,
					rate: withholding.rate,
				},
			},
			...requiredWithholdingFields.map((field) => {
				const partial = { ...withholding } as Record<string, unknown>;
				delete partial[field];
				return { ...compliance, withholding: partial };
			}),
			{
				...compliance,
				taxLines: [{ ...compliance.taxLines[0], amount: Number.NaN }],
			},
			{
				...compliance,
				taxLines: [{ ...compliance.taxLines[0], rate: -1 }],
			},
			{
				...compliance,
				taxLines: [{ ...compliance.taxLines[0], treatment: "bogus" }],
			},
			{ ...compliance, seller: { legalName: 42 } },
		];
		for (const snapshot of malformedSnapshots) {
			const state = tables("workspace-a");
			state.invoices[0].compliance = snapshot;
			const { client } = createFakeSupabase(state);
			const result = await validateWorkspaceInvoice(
				client,
				"user-a",
				"invoice-a",
			);
			expect(result.valid).toBe(false);
			expect(result.issues[0]?.code).toBe("compliance_snapshot_invalid");
		}
	});

	it("uses the established B2B default for an existing same-workspace client", async () => {
		const state = tables("workspace-a");
		state.clients[0].buyer_type = null;
		const { client } = createFakeSupabase(state);
		const result = await validateWorkspaceInvoice(
			client,
			"user-a",
			"invoice-a",
		);
		expect(result.issues.map(({ code }) => code)).toContain("tin_required");
		expect(result.issues.map(({ code }) => code)).not.toContain(
			"buyer_type_unverified",
		);
	});

	it("rejects malformed raw line amounts before row normalization can coerce them", async () => {
		const state = tables("workspace-a");
		(state.invoices[0].line_items as Array<Record<string, unknown>>)[0].price =
			"not-a-number";
		const { client } = createFakeSupabase(state);
		const result = await validateWorkspaceInvoice(
			client,
			"user-a",
			"invoice-a",
		);
		expect(result.valid).toBe(false);
		expect(result.issues[0]).toEqual({
			code: "line_amount_invalid",
			path: "lineItems[0].price",
			message: "Stored line quantity and price must be finite numbers.",
		});
	});

	it("rejects malformed raw compliance amounts before normalizeCompliance coerces them", async () => {
		const state = tables("workspace-a");
		(state.invoices[0].line_items as Array<Record<string, unknown>>)[0].price =
			0;
		state.invoices[0].compliance = {
			...compliance,
			subtotal: "garbage",
			totalTax: 0,
			grandTotal: 0,
			netPayable: 0,
			withholdingTaxAmount: 0,
			taxLines: [],
			withholding: { ...compliance.withholding, amount: 0 },
		};
		const { client } = createFakeSupabase(state);
		const result = await validateWorkspaceInvoice(
			client,
			"user-a",
			"invoice-a",
		);
		expect(result.valid).toBe(false);
		expect(result.issues[0]?.code).toBe("compliance_snapshot_invalid");
	});
});
