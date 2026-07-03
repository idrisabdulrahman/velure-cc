import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { auditActionValidator, auditResultValidator } from "./auditActions";

const jurisdictionValidator = v.union(
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

const taxTreatmentValidator = v.union(
	v.literal("none"),
	v.literal("exclusive_rate"),
	v.literal("inclusive_rate"),
	v.literal("reverse_charge"),
	v.literal("exempt"),
	v.literal("zero_rated"),
);

const sellerTaxStatusValidator = v.union(
	v.literal("vat_registered"),
	v.literal("below_threshold_not_charging_vat"),
	v.literal("statutorily_exempt"),
);

const withholdingTaxPresetValidator = v.union(
	v.literal("none"),
	v.literal("contracts_supplies"),
	v.literal("consultancy_company"),
	v.literal("consultancy_individual"),
	v.literal("rent_interest"),
);

const withholdingCategoryValidator = v.union(
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

const withholdingRecipientEntityTypeValidator = v.union(
	v.literal("corporate"),
	v.literal("non_corporate"),
);

const withholdingRecipientResidencyValidator = v.union(
	v.literal("resident"),
	v.literal("non_resident"),
);

const complianceWarningValidator = v.union(
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

const providerValidator = v.union(
	v.literal("quickbooks"),
	v.literal("xero"),
	v.literal("slack"),
);

const invoiceStatusValidator = v.union(
	v.literal("draft"),
	v.literal("unpaid"),
	v.literal("partially-paid"),
	v.literal("paid"),
	v.literal("overdue"),
	v.literal("canceled"),
	v.literal("scheduled"),
);

const invoiceDocumentTypeValidator = v.union(
	v.literal("standard"),
	v.literal("proforma"),
);

const paymentSourceValidator = v.union(
	v.literal("manual"),
	v.literal("paystack"),
);

const paymentChargeStatusValidator = v.union(
	v.literal("pending"),
	v.literal("succeeded"),
	v.literal("failed"),
	v.literal("expired"),
	v.literal("manual_review"),
);

const syncStatusValidator = v.union(
	v.literal("idle"),
	v.literal("pending"),
	v.literal("success"),
	v.literal("failed"),
	v.literal("needs_configuration"),
);

const reminderStageValidator = v.union(
	v.literal("none"),
	v.literal("before_due"),
	v.literal("due_date"),
	v.literal("overdue_1"),
	v.literal("overdue_2"),
	v.literal("overdue_3"),
	v.literal("escalated"),
);

const escalationStatusValidator = v.union(
	v.literal("idle"),
	v.literal("queued"),
	v.literal("sent"),
	v.literal("manual_review"),
);

const workspaceRoleValidator = v.union(
	v.literal("owner"),
	v.literal("member"),
	v.literal("viewer"),
);

const invoiceNumberModeValidator = v.union(
	v.literal("prefix"),
	v.literal("business_name"),
);

const recurringFrequencyValidator = v.union(
	v.literal("monthly"),
	v.literal("quarterly"),
);

const recurringScheduleStatusValidator = v.union(
	v.literal("active"),
	v.literal("paused"),
	v.literal("ended"),
);

const recurringRunStatusValidator = v.union(
	v.literal("created"),
	v.literal("skipped"),
	v.literal("failed"),
);

const emailEventTypeValidator = v.union(
	v.literal("sent"),
	v.literal("delivered"),
	v.literal("delivery_delayed"),
	v.literal("bounced"),
	v.literal("complained"),
	v.literal("opened"),
	v.literal("clicked"),
	v.literal("failed"),
);

const jobStatusValidator = v.union(v.literal("success"), v.literal("failure"));

const businessIdentityValidator = v.object({
	legalName: v.optional(v.string()),
	tradingName: v.optional(v.string()),
	email: v.optional(v.string()),
	phone: v.optional(v.string()),
	address: v.optional(v.string()),
	website: v.optional(v.string()),
	countryCode: v.optional(jurisdictionValidator),
	taxId: v.optional(v.string()),
	rcNumber: v.optional(v.string()),
});

const invoiceTaxLineValidator = v.object({
	label: v.string(),
	rate: v.number(),
	amount: v.number(),
	treatment: taxTreatmentValidator,
	jurisdictionCode: jurisdictionValidator,
});

const withholdingSnapshotValidator = v.object({
	mode: v.union(v.literal("rule_based"), v.literal("legacy_manual")),
	category: withholdingCategoryValidator,
	recipientEntityType: withholdingRecipientEntityTypeValidator,
	recipientResidency: withholdingRecipientResidencyValidator,
	rate: v.number(),
	amount: v.number(),
	ruleVersion: v.string(),
	manualOverride: v.boolean(),
	overrideNote: v.optional(v.string()),
	legacyPreset: v.optional(withholdingTaxPresetValidator),
});

const fiscalizationSnapshotValidator = v.object({
	status: v.union(
		v.literal("not_configured"),
		v.literal("ready"),
		v.literal("pending"),
		v.literal("fiscalized"),
		v.literal("failed"),
	),
	uid: v.optional(v.string()),
	sid: v.optional(v.string()),
	qrCodePayload: v.optional(v.string()),
	lastError: v.optional(v.string()),
	lastAttemptAt: v.optional(v.number()),
});

const complianceSnapshotValidator = v.object({
	seller: businessIdentityValidator,
	buyer: businessIdentityValidator,
	sellerTaxStatus: v.optional(sellerTaxStatusValidator),
	placeOfSupply: jurisdictionValidator,
	taxRuleSetVersion: v.string(),
	taxTreatment: taxTreatmentValidator,
	taxRate: v.number(),
	taxLabel: v.string(),
	taxLines: v.array(invoiceTaxLineValidator),
	warnings: v.array(complianceWarningValidator),
	templateVariant: v.union(
		v.literal("default_ng"),
		v.literal("cross_border"),
		v.literal("vat_ready"),
	),
	subtotal: v.number(),
	totalTax: v.number(),
	withholding: withholdingSnapshotValidator,
	withholdingTaxPreset: withholdingTaxPresetValidator,
	withholdingTaxLabel: v.string(),
	withholdingTaxRate: v.number(),
	withholdingTaxAmount: v.number(),
	regulatoryNotice: v.optional(v.string()),
	grandTotal: v.number(),
	fiscalization: v.optional(fiscalizationSnapshotValidator),
});

const providerSyncStateValidator = v.object({
	externalId: v.optional(v.string()),
	status: syncStatusValidator,
	lastSyncedAt: v.optional(v.number()),
	lastError: v.optional(v.string()),
});

const reminderSnapshotValidator = v.object({
	enabled: v.boolean(),
	paused: v.boolean(),
	stage: reminderStageValidator,
	lastReminderAt: v.optional(v.number()),
	nextReminderAt: v.optional(v.number()),
	escalationStatus: escalationStatusValidator,
	paidAt: v.optional(v.number()),
});

const shipmentDetailsValidator = v.object({
	weight: v.optional(v.string()),
	packageCount: v.optional(v.number()),
	hsCode: v.optional(v.string()),
	incoterms: v.optional(v.string()),
	portOfLoading: v.optional(v.string()),
	portOfDischarge: v.optional(v.string()),
});

const depositRequestValidator = v.object({
	kind: v.union(v.literal("amount"), v.literal("percentage")),
	value: v.number(),
	dueDate: v.optional(v.string()),
});

export default defineSchema({
	workspaces: defineTable({
		ownerId: v.string(),
		name: v.string(),
		legalName: v.optional(v.string()),
		email: v.optional(v.string()),
		phone: v.optional(v.string()),
		address: v.optional(v.string()),
		website: v.optional(v.string()),
		taxId: v.optional(v.string()),
		rcNumber: v.optional(v.string()),
		countryCode: jurisdictionValidator,
		baseCurrency: v.string(),
		sellerTaxStatus: v.optional(sellerTaxStatusValidator),
		taxRuleSetVersion: v.optional(v.string()),
		atrs: v.optional(
			v.object({
				environment: v.optional(
					v.union(v.literal("sandbox"), v.literal("production")),
				),
				credentialsConfigured: v.boolean(),
			}),
		),
		reminderSignature: v.optional(v.string()),
		remindersEnabled: v.boolean(),
		logoUrl: v.optional(v.string()),
		paymentDetails: v.optional(v.string()),
		defaultPaymentLink: v.optional(v.string()),
		defaultPaymentTermsDays: v.optional(v.number()),
		invoiceNumberMode: v.optional(invoiceNumberModeValidator),
		invoiceNumberPrefix: v.optional(v.string()),
		nextInvoiceSequence: v.optional(v.number()),
		defaultTaxProfileId: v.optional(v.id("tax_profiles")),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_ownerId", ["ownerId"]),
	workspaceMembers: defineTable({
		workspaceId: v.id("workspaces"),
		userId: v.string(),
		role: workspaceRoleValidator,
		invitedBy: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_workspaceId", ["workspaceId"])
		.index("by_userId", ["userId"])
		.index("by_workspaceId_and_userId", ["workspaceId", "userId"]),
	active_workspaces: defineTable({
		userId: v.string(),
		workspaceId: v.id("workspaces"),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_userId", ["userId"])
		.index("by_workspaceId", ["workspaceId"]),
	audit_logs: defineTable({
		workspaceId: v.optional(v.id("workspaces")),
		actorId: v.optional(v.string()),
		actorType: v.union(v.literal("user"), v.literal("system")),
		action: auditActionValidator,
		resourceType: v.string(),
		resourceId: v.optional(v.string()),
		result: auditResultValidator,
		message: v.optional(v.string()),
		metadata: v.optional(v.string()),
		createdAt: v.number(),
	})
		.index("by_workspaceId", ["workspaceId"])
		.index("by_workspaceId_and_createdAt", ["workspaceId", "createdAt"])
		.index("by_action", ["action"])
		.index("by_resource", ["resourceType", "resourceId"]),
	jurisdictions: defineTable({
		code: jurisdictionValidator,
		name: v.string(),
		defaultTaxLabel: v.string(),
		supportsReverseCharge: v.boolean(),
		supportsVat: v.boolean(),
		notes: v.optional(v.string()),
		updatedAt: v.number(),
	}).index("by_code", ["code"]),
	tax_profiles: defineTable({
		ownerId: v.string(),
		name: v.string(),
		jurisdictionCode: jurisdictionValidator,
		taxTreatment: taxTreatmentValidator,
		rate: v.number(),
		label: v.string(),
		isDefault: v.boolean(),
		active: v.boolean(),
		notes: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_ownerId", ["ownerId"])
		.index("by_ownerId_and_default", ["ownerId", "isDefault"]),
	clients: defineTable({
		workspaceId: v.optional(v.id("workspaces")),
		ownerId: v.optional(v.string()),
		name: v.string(),
		company: v.optional(v.string()),
		email: v.string(),
		phone: v.optional(v.string()),
		website: v.optional(v.string()),
		billingAddress: v.optional(v.string()),
		taxId: v.optional(v.string()),
		currency: v.string(),
		paymentTerms: v.string(),
		internalNotes: v.optional(v.string()),
		contact: v.object({
			fullName: v.optional(v.string()),
			role: v.optional(v.string()),
			email: v.optional(v.string()),
			phone: v.optional(v.string()),
		}),
		favorite: v.boolean(),
		status: v.union(
			v.literal("active"),
			v.literal("pending"),
			v.literal("inactive"),
			v.literal("archived"),
		),
		createdAt: v.optional(v.number()),
		updatedAt: v.optional(v.number()),
	})
		.index("by_workspaceId", ["workspaceId"])
		.index("by_workspaceId_and_email", ["workspaceId", "email"])
		.index("by_workspaceId_and_status", ["workspaceId", "status"])
		.index("by_email", ["email"])
		.index("by_status", ["status"])
		.index("by_updatedAt", ["updatedAt"]),
	products: defineTable({
		workspaceId: v.id("workspaces"),
		type: v.union(v.literal("product"), v.literal("service")),
		name: v.string(),
		description: v.optional(v.string()),
		sku: v.optional(v.string()),
		unitName: v.optional(v.string()),
		defaultUnitPrice: v.number(),
		defaultTaxId: v.optional(v.string()),
		isActive: v.boolean(),
		createdAt: v.number(),
		updatedAt: v.number(),
		deletedAt: v.optional(v.number()),
	})
		.index("by_workspaceId", ["workspaceId"])
		.index("by_workspaceId_and_name", ["workspaceId", "name"])
		.index("by_workspaceId_and_isActive", ["workspaceId", "isActive"]),
	invoices: defineTable({
		workspaceId: v.id("workspaces"),
		userId: v.optional(v.string()),
		token: v.string(),
		documentType: v.optional(invoiceDocumentTypeValidator),
		convertedToInvoiceId: v.optional(v.id("invoices")),
		shipmentDetails: v.optional(shipmentDetailsValidator),
		depositRequest: v.optional(depositRequestValidator),
		invoiceNumber: v.string(),
		customerName: v.string(),
		logoUrl: v.optional(v.string()),
		customerPoNumber: v.optional(v.string()),
		currency: v.string(),
		type: v.optional(v.union(v.literal("one-time"), v.literal("recurring"))),
		invoiceSize: v.optional(v.union(v.literal("A4"), v.literal("LETTER"))),
		dateFormat: v.optional(
			v.union(v.literal("iso"), v.literal("us"), v.literal("ng")),
		),
		paymentTermsDays: v.optional(v.number()),
		template: v.optional(v.string()),
		issueDate: v.string(),
		dueDate: v.string(),
		status: v.optional(invoiceStatusValidator),
		paymentAmount: v.optional(v.number()),
		deliveredAt: v.optional(v.number()),
		canceledAt: v.optional(v.number()),
		paymentDetails: v.optional(v.string()),
		paymentLink: v.optional(v.string()),
		paymentProvider: v.optional(
			v.union(v.literal("manual"), v.literal("paystack")),
		),
		paidAt: v.optional(v.number()),
		paymentReference: v.optional(v.string()),
		notes: v.optional(v.string()),
		deletedAt: v.optional(v.number()),
		lineItems: v.array(
			v.object({
				id: v.string(),
				name: v.string(),
				quantity: v.number(),
				price: v.number(),
				productId: v.optional(v.id("products")),
			}),
		),
		compliance: v.optional(complianceSnapshotValidator),
		fiscalization: v.optional(fiscalizationSnapshotValidator),
		reminder: v.optional(reminderSnapshotValidator),
		sync: v.optional(
			v.object({
				quickbooks: providerSyncStateValidator,
				xero: providerSyncStateValidator,
				slack: providerSyncStateValidator,
			}),
		),
		lifecycle: v.optional(
			v.object({
				sentAt: v.optional(v.number()),
				emailDeliveredAt: v.optional(v.number()),
				firstViewedAt: v.optional(v.number()),
				paymentReceivedAt: v.optional(v.number()),
			}),
		),
		createdAt: v.optional(v.number()),
		updatedAt: v.optional(v.number()),
	})
		.index("by_workspaceId", ["workspaceId"])
		.index("by_workspaceId_and_documentType", ["workspaceId", "documentType"])
		.index("by_workspaceId_and_status", ["workspaceId", "status"])
		.index("by_workspaceId_and_dueDate", ["workspaceId", "dueDate"])
		.index("by_workspaceId_and_updatedAt", ["workspaceId", "updatedAt"])
		.index("by_workspaceId_and_invoice_number", [
			"workspaceId",
			"invoiceNumber",
		])
		.index("by_token", ["token"])
		.index("by_userId", ["userId"])
		.index("by_invoice_number", ["invoiceNumber"])
		.index("by_status", ["status"])
		.index("by_updatedAt", ["updatedAt"]),
	recurring_invoice_schedules: defineTable({
		workspaceId: v.id("workspaces"),
		ownerId: v.string(),
		name: v.string(),
		status: recurringScheduleStatusValidator,
		frequency: recurringFrequencyValidator,
		interval: v.number(),
		startDate: v.string(),
		nextRunDate: v.string(),
		endDate: v.optional(v.string()),
		autoSend: v.boolean(),
		customerName: v.string(),
		logoUrl: v.optional(v.string()),
		currency: v.string(),
		invoiceSize: v.optional(v.union(v.literal("A4"), v.literal("LETTER"))),
		dateFormat: v.optional(
			v.union(v.literal("iso"), v.literal("us"), v.literal("ng")),
		),
		paymentTermsDays: v.number(),
		template: v.string(),
		paymentDetails: v.optional(v.string()),
		paymentLink: v.optional(v.string()),
		paymentProvider: v.optional(
			v.union(v.literal("manual"), v.literal("paystack")),
		),
		notes: v.optional(v.string()),
		lineItems: v.array(
			v.object({
				id: v.string(),
				name: v.string(),
				quantity: v.number(),
				price: v.number(),
				productId: v.optional(v.id("products")),
			}),
		),
		compliance: v.optional(complianceSnapshotValidator),
		lastGeneratedAt: v.optional(v.number()),
		lastGeneratedInvoiceId: v.optional(v.id("invoices")),
		lastGeneratedPeriod: v.optional(v.string()),
		generatedCount: v.number(),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_workspaceId", ["workspaceId"])
		.index("by_workspaceId_and_status", ["workspaceId", "status"])
		.index("by_nextRunDate_and_status", ["nextRunDate", "status"]),
	recurring_invoice_runs: defineTable({
		workspaceId: v.id("workspaces"),
		scheduleId: v.id("recurring_invoice_schedules"),
		periodKey: v.string(),
		invoiceId: v.optional(v.id("invoices")),
		status: recurringRunStatusValidator,
		error: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_workspaceId", ["workspaceId"])
		.index("by_scheduleId", ["scheduleId"])
		.index("by_scheduleId_and_periodKey", ["scheduleId", "periodKey"]),
	invoice_exports: defineTable({
		ownerId: v.string(),
		workspaceId: v.optional(v.id("workspaces")),
		invoiceId: v.optional(v.id("invoices")),
		kind: v.union(
			v.literal("invoices_csv"),
			v.literal("tax_summary_csv"),
			v.literal("customer_ledger_csv"),
			v.literal("normalized_accounting"),
		),
		provider: v.optional(providerValidator),
		status: v.union(
			v.literal("pending"),
			v.literal("ready"),
			v.literal("failed"),
		),
		fileName: v.string(),
		content: v.string(),
		error: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_ownerId", ["ownerId"])
		.index("by_workspaceId", ["workspaceId"]),
	invoice_delivery_events: defineTable({
		workspaceId: v.id("workspaces"),
		ownerId: v.string(),
		invoiceId: v.id("invoices"),
		channel: v.literal("email"),
		recipient: v.string(),
		provider: v.literal("resend"),
		status: v.union(v.literal("sent"), v.literal("failed")),
		providerMessageId: v.optional(v.string()),
		publicUrl: v.optional(v.string()),
		error: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_workspaceId", ["workspaceId"])
		.index("by_invoiceId", ["invoiceId"])
		.index("by_ownerId", ["ownerId"])
		.index("by_providerMessageId", ["providerMessageId"]),
	email_events: defineTable({
		workspaceId: v.optional(v.id("workspaces")),
		ownerId: v.optional(v.string()),
		invoiceId: v.optional(v.id("invoices")),
		deliveryEventId: v.optional(v.id("invoice_delivery_events")),
		provider: v.literal("resend"),
		providerMessageId: v.optional(v.string()),
		providerEventId: v.optional(v.string()),
		eventType: emailEventTypeValidator,
		recipient: v.optional(v.string()),
		subject: v.optional(v.string()),
		error: v.optional(v.string()),
		rawEvent: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_workspaceId", ["workspaceId"])
		.index("by_invoiceId", ["invoiceId"])
		.index("by_providerMessageId", ["providerMessageId"])
		.index("by_providerEventId", ["providerEventId"]),
	payment_transactions: defineTable({
		workspaceId: v.id("workspaces"),
		ownerId: v.optional(v.string()),
		invoiceId: v.id("invoices"),
		source: paymentSourceValidator,
		provider: v.optional(v.literal("paystack")),
		reference: v.optional(v.string()),
		providerPaymentId: v.optional(v.string()),
		eventType: v.optional(v.string()),
		providerStatus: v.optional(v.string()),
		amount: v.number(),
		currency: v.string(),
		recordedBy: v.optional(v.string()),
		customerEmail: v.optional(v.string()),
		rawEvent: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_workspaceId", ["workspaceId"])
		.index("by_invoiceId", ["invoiceId"])
		.index("by_reference", ["reference"]),
	payment_charges: defineTable({
		workspaceId: v.id("workspaces"),
		invoiceId: v.id("invoices"),
		provider: v.literal("paystack"),
		reference: v.string(),
		status: paymentChargeStatusValidator,
		amount: v.number(),
		currency: v.string(),
		accountName: v.optional(v.string()),
		accountNumber: v.optional(v.string()),
		bankName: v.optional(v.string()),
		bankSlug: v.optional(v.string()),
		expiresAt: v.number(),
		providerStatus: v.optional(v.string()),
		providerMessage: v.optional(v.string()),
		rawResponse: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_workspaceId", ["workspaceId"])
		.index("by_invoiceId", ["invoiceId"])
		.index("by_reference", ["reference"])
		.index("by_invoiceId_and_status", ["invoiceId", "status"]),
	reminder_rules: defineTable({
		ownerId: v.string(),
		enabled: v.boolean(),
		daysBeforeDue: v.number(),
		onDueDate: v.boolean(),
		overdueCadenceDays: v.number(),
		maxOverdueReminders: v.number(),
		escalateAfterCount: v.number(),
		businessSignature: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_ownerId", ["ownerId"]),
	reminder_runs: defineTable({
		ownerId: v.string(),
		runDate: v.string(),
		status: v.union(
			v.literal("queued"),
			v.literal("completed"),
			v.literal("failed"),
		),
		scannedCount: v.number(),
		queuedCount: v.number(),
		sentCount: v.number(),
		escalatedCount: v.number(),
		notes: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_ownerId", ["ownerId"]),
	reminder_events: defineTable({
		ownerId: v.string(),
		invoiceId: v.id("invoices"),
		stage: reminderStageValidator,
		channel: v.union(
			v.literal("email"),
			v.literal("slack"),
			v.literal("internal"),
		),
		scheduledFor: v.number(),
		sentAt: v.optional(v.number()),
		status: v.union(
			v.literal("queued"),
			v.literal("sent"),
			v.literal("skipped"),
			v.literal("failed"),
		),
		error: v.optional(v.string()),
		meta: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_ownerId", ["ownerId"])
		.index("by_invoiceId", ["invoiceId"]),
	collections_cases: defineTable({
		ownerId: v.string(),
		invoiceId: v.id("invoices"),
		status: v.union(
			v.literal("open"),
			v.literal("paused"),
			v.literal("resolved"),
			v.literal("manual_exception"),
		),
		lastActionAt: v.number(),
		note: v.optional(v.string()),
		escalationStatus: escalationStatusValidator,
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_ownerId", ["ownerId"])
		.index("by_invoiceId", ["invoiceId"]),
	integration_connections: defineTable({
		ownerId: v.string(),
		provider: providerValidator,
		status: v.union(
			v.literal("disconnected"),
			v.literal("connected"),
			v.literal("error"),
		),
		authType: v.union(
			v.literal("oauth"),
			v.literal("webhook"),
			v.literal("api_key"),
			v.literal("manual"),
		),
		externalAccountId: v.optional(v.string()),
		accessToken: v.optional(v.string()),
		refreshToken: v.optional(v.string()),
		expiresAt: v.optional(v.number()),
		webhookUrl: v.optional(v.string()),
		defaultRevenueAccount: v.optional(v.string()),
		defaultTaxCode: v.optional(v.string()),
		configJson: v.optional(v.string()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_ownerId", ["ownerId"])
		.index("by_ownerId_and_provider", ["ownerId", "provider"]),
	integration_sync_jobs: defineTable({
		ownerId: v.string(),
		provider: providerValidator,
		entityType: v.union(
			v.literal("invoice"),
			v.literal("client"),
			v.literal("export"),
		),
		entityId: v.string(),
		direction: v.literal("push"),
		status: v.union(
			v.literal("pending"),
			v.literal("success"),
			v.literal("failed"),
			v.literal("needs_configuration"),
		),
		requestPayload: v.optional(v.string()),
		responsePayload: v.optional(v.string()),
		error: v.optional(v.string()),
		retryCount: v.number(),
		lastAttemptAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_ownerId", ["ownerId"]),
	integration_logs: defineTable({
		ownerId: v.string(),
		provider: providerValidator,
		level: v.union(v.literal("info"), v.literal("error")),
		message: v.string(),
		entityType: v.optional(v.string()),
		entityId: v.optional(v.string()),
		createdAt: v.number(),
	}).index("by_ownerId", ["ownerId"]),
	integration_webhooks: defineTable({
		ownerId: v.string(),
		provider: providerValidator,
		endpoint: v.string(),
		secret: v.optional(v.string()),
		active: v.boolean(),
		lastReceivedAt: v.optional(v.number()),
		createdAt: v.number(),
		updatedAt: v.number(),
	}).index("by_ownerId", ["ownerId"]),
	job_runs: defineTable({
		workspaceId: v.optional(v.id("workspaces")),
		jobName: v.string(),
		status: jobStatusValidator,
		durationMs: v.number(),
		retries: v.number(),
		error: v.optional(v.string()),
		resultJson: v.optional(v.string()),
		startedAt: v.number(),
		completedAt: v.number(),
		createdAt: v.number(),
	})
		.index("by_workspaceId", ["workspaceId"])
		.index("by_jobName", ["jobName"])
		.index("by_createdAt", ["createdAt"]),
});
