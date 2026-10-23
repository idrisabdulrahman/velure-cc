import type { BuyerType } from "#/features/clients/buyer-profile";
import { toCanonicalInvoice } from "#/features/einvoicing/canonical-invoice";
import {
	type CanonicalInvoiceValidation,
	validateCanonicalInvoice,
} from "#/features/einvoicing/validate-canonical-invoice";
import type { InvoiceRecord } from "#/features/invoices/types";
import { mapInvoice, rowToInvoiceDoc } from "./invoices";
import { resolveActiveWorkspaceId, type Supabase } from "./workspaces";

const notFound: CanonicalInvoiceValidation = {
	valid: false,
	issues: [
		{
			code: "invoice_not_found",
			path: "invoice",
			message: "Invoice was not found in the active workspace.",
		},
	],
};
const TAX_TREATMENTS = new Set([
	"none",
	"exclusive_rate",
	"inclusive_rate",
	"reverse_charge",
	"exempt",
	"zero_rated",
]);

function hasStoredComplianceSnapshot(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const snapshot = value as Record<string, unknown>;
	const record = (entry: unknown) => !!entry && typeof entry === "object";
	const finite = (entry: unknown) =>
		typeof entry === "number" && Number.isFinite(entry);
	const partyValid = (entry: unknown) => {
		if (!record(entry)) return false;
		const party = entry as Record<string, unknown>;
		return [
			"legalName",
			"tradingName",
			"email",
			"phone",
			"address",
			"website",
			"countryCode",
			"taxId",
			"rcNumber",
		].every(
			(key) => party[key] === undefined || typeof party[key] === "string",
		);
	};
	const taxLineValid = (entry: unknown) => {
		if (!record(entry)) return false;
		const line = entry as Record<string, unknown>;
		return (
			typeof line.label === "string" &&
			finite(line.rate) &&
			Number(line.rate) >= 0 &&
			finite(line.amount) &&
			typeof line.treatment === "string" &&
			TAX_TREATMENTS.has(line.treatment) &&
			typeof line.jurisdictionCode === "string"
		);
	};
	const withholdingValid = (entry: unknown) => {
		if (!record(entry)) return false;
		const withholding = entry as Record<string, unknown>;
		const categories = new Set([
			"none",
			"goods_materials",
			"general_services",
			"professional_fees",
			"major_construction",
			"other_construction",
			"telecom_colocation",
			"brokerage",
			"rent_hire_lease",
		]);
		const legacyPresets = new Set([
			"none",
			"contracts_supplies",
			"consultancy_company",
			"consultancy_individual",
			"rent_interest",
		]);
		return (
			finite(withholding.amount) &&
			finite(withholding.rate) &&
			(withholding.mode === "rule_based" ||
				withholding.mode === "legacy_manual") &&
			categories.has(String(withholding.category)) &&
			(withholding.recipientEntityType === "corporate" ||
				withholding.recipientEntityType === "non_corporate") &&
			(withholding.recipientResidency === "resident" ||
				withholding.recipientResidency === "non_resident") &&
			typeof withholding.ruleVersion === "string" &&
			withholding.ruleVersion.trim() !== "" &&
			typeof withholding.manualOverride === "boolean" &&
			(withholding.overrideNote === undefined ||
				typeof withholding.overrideNote === "string") &&
			(withholding.legacyPreset === undefined ||
				legacyPresets.has(String(withholding.legacyPreset)))
		);
	};
	return (
		partyValid(snapshot.seller) &&
		partyValid(snapshot.buyer) &&
		Array.isArray(snapshot.taxLines) &&
		snapshot.taxLines.every(taxLineValid) &&
		withholdingValid(snapshot.withholding) &&
		["placeOfSupply", "taxTreatment", "taxLabel", "taxRuleSetVersion"].every(
			(key) => typeof snapshot[key] === "string" && snapshot[key].trim() !== "",
		) &&
		[
			"taxRate",
			"subtotal",
			"totalTax",
			"grandTotal",
			"netPayable",
			"withholdingTaxAmount",
		].every((key) => finite(snapshot[key]))
	);
}

function invalidRawLineItems(value: unknown) {
	if (!Array.isArray(value) || value.length === 0) {
		return {
			code: "line_items_invalid",
			path: "lineItems",
			message: "Stored invoice lines must be a non-empty array.",
		};
	}
	for (let index = 0; index < value.length; index += 1) {
		const entry = value[index];
		if (!entry || typeof entry !== "object") {
			return {
				code: "line_item_invalid",
				path: `lineItems[${index}]`,
				message: "Stored invoice line must be an object.",
			};
		}
		const line = entry as Record<string, unknown>;
		if (typeof line.name !== "string") {
			return {
				code: "line_description_invalid",
				path: `lineItems[${index}].name`,
				message: "Stored invoice line description must be text.",
			};
		}
		for (const key of ["quantity", "price"] as const) {
			if (typeof line[key] !== "number" || !Number.isFinite(line[key])) {
				return {
					code: "line_amount_invalid",
					path: `lineItems[${index}].${key}`,
					message: "Stored line quantity and price must be finite numbers.",
				};
			}
		}
		for (const key of ["unit", "vatCategory", "classificationCode"] as const) {
			if (line[key] !== undefined && typeof line[key] !== "string") {
				return {
					code: "line_field_invalid",
					path: `lineItems[${index}].${key}`,
					message: "Stored invoice line classification fields must be text.",
				};
			}
		}
	}
	return null;
}

/** Loads only trusted same-workspace buyer type; returns validation issues, never source rows. */
export async function validateWorkspaceInvoice(
	client: Supabase,
	userId: string,
	invoiceId: string,
): Promise<CanonicalInvoiceValidation> {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) return notFound;
	const { data: row, error } = await client
		.from("invoices")
		.select("*")
		.eq("id", invoiceId)
		.eq("workspace_id", workspaceId)
		.is("deleted_at", null)
		.maybeSingle();
	if (error) throw error;
	if (!row) return notFound;
	const rawRow = row as Record<string, unknown>;
	if (!hasStoredComplianceSnapshot(rawRow.compliance)) {
		return {
			valid: false,
			issues: [
				{
					code: "compliance_snapshot_invalid",
					path: "compliance",
					message:
						"A complete stored compliance snapshot is required for validation.",
				},
			],
		};
	}
	const rawLineIssue = invalidRawLineItems(rawRow.line_items);
	if (rawLineIssue) return { valid: false, issues: [rawLineIssue] };
	const invoiceDoc = rowToInvoiceDoc(row as never);
	const invoice = mapInvoice(invoiceDoc);
	let buyerType: BuyerType | undefined;
	if (invoice.customerId) {
		const { data: customer, error: customerError } = await client
			.from("clients")
			.select("buyer_type")
			.eq("id", invoice.customerId)
			.eq("workspace_id", workspaceId)
			.maybeSingle();
		if (customerError) throw customerError;
		if (customer) buyerType = customer.buyer_type === "b2c" ? "b2c" : "b2b";
	}
	return validateCanonicalInvoice(
		toCanonicalInvoice(invoice as unknown as InvoiceRecord),
		{ buyerType },
	);
}
