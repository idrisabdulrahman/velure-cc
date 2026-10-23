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
			finite(line.amount) &&
			typeof line.treatment === "string" &&
			typeof line.jurisdictionCode === "string"
		);
	};
	const withholdingValid = (entry: unknown) => {
		if (!record(entry)) return false;
		const withholding = entry as Record<string, unknown>;
		return finite(withholding.amount) && finite(withholding.rate);
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
	const invoiceDoc = rowToInvoiceDoc(row as never);
	if (!hasStoredComplianceSnapshot(invoiceDoc.compliance)) {
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
