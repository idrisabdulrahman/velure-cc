import { v } from "convex/values";

export const jurisdictionValidator = v.union(
	v.literal("NG"),
	v.literal("NGN"),
	v.literal("GH"),
	v.literal("KE"),
	v.literal("ZA"),
	v.literal("US"),
	v.literal("GB"),
	v.literal("EU"),
	v.literal("OTHER"),
);

export const taxTreatmentValidator = v.union(
	v.literal("none"),
	v.literal("exclusive_rate"),
	v.literal("inclusive_rate"),
	v.literal("reverse_charge"),
	v.literal("exempt"),
	v.literal("zero_rated"),
);

export const sellerTaxStatusValidator = v.union(
	v.literal("vat_registered"),
	v.literal("below_threshold_not_charging_vat"),
	v.literal("statutorily_exempt"),
);

export const withholdingTaxPresetValidator = v.union(
	v.literal("none"),
	v.literal("contracts_supplies"),
	v.literal("consultancy_company"),
	v.literal("consultancy_individual"),
	v.literal("rent_interest"),
);

export const withholdingCategoryValidator = v.union(
	v.literal("none"),
	v.literal("goods_materials"),
	v.literal("general_services"),
	v.literal("professional_fees"),
	v.literal("major_construction"),
	v.literal("other_construction"),
	v.literal("telecom_colocation"),
	v.literal("brokerage"),
	v.literal("rent_hire_lease"),
);

export const withholdingRecipientEntityTypeValidator = v.union(
	v.literal("corporate"),
	v.literal("non_corporate"),
);

export const withholdingRecipientResidencyValidator = v.union(
	v.literal("resident"),
	v.literal("non_resident"),
);

export const complianceWarningValidator = v.union(
	v.literal("missing_seller_tax_id"),
	v.literal("missing_buyer_tax_id"),
	v.literal("cross_border_review"),
	v.literal("reverse_charge_review"),
	v.literal("unknown_jurisdiction"),
	v.literal("domestic_vat_not_applied"),
	v.literal("missing_workspace_tax_status"),
	v.literal("manual_tax_override"),
	v.literal("manual_wht_override"),
	v.literal("legacy_wht_mapping"),
);

export const providerValidator = v.union(
	v.literal("quickbooks"),
	v.literal("xero"),
	v.literal("slack"),
);

export const invoiceLifecycleStatusValidator = v.union(
	v.literal("draft"),
	v.literal("unpaid"),
	v.literal("partially-paid"),
	v.literal("paid"),
	v.literal("overdue"),
	v.literal("canceled"),
);

export const invoiceStatusValidator = v.union(
	v.literal("draft"),
	v.literal("unpaid"),
	v.literal("partially-paid"),
	v.literal("paid"),
	v.literal("overdue"),
	v.literal("canceled"),
	v.literal("scheduled"),
);

export const invoiceTypeValidator = v.union(
	v.literal("one-time"),
	v.literal("recurring"),
);

export const invoiceDocumentTypeValidator = v.union(
	v.literal("standard"),
	v.literal("proforma"),
);

export const invoiceSizeValidator = v.union(
	v.literal("A4"),
	v.literal("LETTER"),
);

export const invoiceDateFormatValidator = v.union(
	v.literal("iso"),
	v.literal("us"),
	v.literal("ng"),
);

export const paymentSourceValidator = v.union(
	v.literal("manual"),
	v.literal("paystack"),
);

export const paymentProviderValidator = paymentSourceValidator;

export const paymentChargeStatusValidator = v.union(
	v.literal("pending"),
	v.literal("succeeded"),
	v.literal("failed"),
	v.literal("expired"),
	v.literal("manual_review"),
);

export const reminderStageValidator = v.union(
	v.literal("none"),
	v.literal("before_due"),
	v.literal("due_date"),
	v.literal("overdue_1"),
	v.literal("overdue_2"),
	v.literal("overdue_3"),
	v.literal("escalated"),
);

export const escalationStatusValidator = v.union(
	v.literal("idle"),
	v.literal("queued"),
	v.literal("sent"),
	v.literal("manual_review"),
);

export const workspaceRoleValidator = v.union(
	v.literal("owner"),
	v.literal("member"),
	v.literal("viewer"),
);

export const invoiceNumberModeValidator = v.union(
	v.literal("prefix"),
	v.literal("business_name"),
);

export const recurringFrequencyValidator = v.union(
	v.literal("monthly"),
	v.literal("quarterly"),
);

export const recurringScheduleStatusValidator = v.union(
	v.literal("active"),
	v.literal("paused"),
	v.literal("ended"),
);

export const recurringRunStatusValidator = v.union(
	v.literal("created"),
	v.literal("skipped"),
	v.literal("failed"),
);

export const emailEventTypeValidator = v.union(
	v.literal("sent"),
	v.literal("delivered"),
	v.literal("delivery_delayed"),
	v.literal("bounced"),
	v.literal("complained"),
	v.literal("opened"),
	v.literal("clicked"),
	v.literal("failed"),
);

export const jobStatusValidator = v.union(
	v.literal("success"),
	v.literal("failure"),
);

export const exportKindValidator = v.union(
	v.literal("invoices_csv"),
	v.literal("tax_summary_csv"),
	v.literal("customer_ledger_csv"),
	v.literal("normalized_accounting"),
);

export const editorDocValidator = v.object({
	type: v.literal("doc"),
	content: v.array(
		v.object({
			type: v.string(),
			text: v.optional(v.string()),
			attrs: v.optional(v.any()),
			marks: v.optional(v.array(v.any())),
			content: v.optional(v.array(v.any())),
		}),
	),
});
