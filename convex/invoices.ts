import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import {
  assertValidRcNumber,
  assertValidTin,
  defaultTaxTreatmentForSellerTaxStatus,
  defaultWithholdingSelection,
  formatInvoiceNumber,
  NIGERIA_FOREIGN_CURRENCY_WARNING,
  NIGERIA_TAX_RULE_SET_VERSION,
  NIGERIA_VAT_RATE,
  normalizeNigeriaPhone,
} from "./nigeria";
import { requireWritableInvoice, requireWritableWorkspace, requireWorkspaceForRead } from "./rls";

const statusValidator = v.union(
  v.literal("draft"),
  v.literal("unpaid"),
  v.literal("paid"),
  v.literal("overdue"),
  v.literal("canceled"),
  v.literal("scheduled"),
);

const typeValidator = v.union(v.literal("one-time"), v.literal("recurring"));
const invoiceSizeValidator = v.union(v.literal("A4"), v.literal("LETTER"));
const dateFormatValidator = v.union(v.literal("iso"), v.literal("us"), v.literal("ng"));
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

const lineItemValidator = v.object({
  id: v.string(),
  name: v.string(),
  quantity: v.number(),
  price: v.number(),
});

const importInvoiceRowValidator = v.object({
  invoiceNumber: v.optional(v.string()),
  customerName: v.string(),
  currency: v.optional(v.string()),
  status: v.optional(statusValidator),
  issueDate: v.optional(v.string()),
  dueDate: v.optional(v.string()),
  description: v.string(),
  quantity: v.optional(v.number()),
  price: v.optional(v.number()),
  notes: v.optional(v.string()),
  paymentDetails: v.optional(v.string()),
  paymentLink: v.optional(v.string()),
});

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

const withholdingValidator = v.object({
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

const fiscalizationValidator = v.object({
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

const complianceValidator = v.object({
  seller: businessIdentityValidator,
  buyer: businessIdentityValidator,
  sellerTaxStatus: v.optional(sellerTaxStatusValidator),
  placeOfSupply: jurisdictionValidator,
  taxRuleSetVersion: v.string(),
  taxTreatment: taxTreatmentValidator,
  taxRate: v.number(),
  taxLabel: v.string(),
  taxLines: v.array(
    v.object({
      label: v.string(),
      rate: v.number(),
      amount: v.number(),
      treatment: taxTreatmentValidator,
      jurisdictionCode: jurisdictionValidator,
    }),
  ),
  warnings: v.array(complianceWarningValidator),
  templateVariant: v.union(
    v.literal("default_ng"),
    v.literal("cross_border"),
    v.literal("vat_ready"),
  ),
  subtotal: v.number(),
  totalTax: v.number(),
  withholding: withholdingValidator,
  withholdingTaxPreset: withholdingTaxPresetValidator,
  withholdingTaxLabel: v.string(),
  withholdingTaxRate: v.number(),
  withholdingTaxAmount: v.number(),
  regulatoryNotice: v.optional(v.string()),
  grandTotal: v.number(),
  fiscalization: v.optional(fiscalizationValidator),
});

const reminderValidator = v.object({
  enabled: v.boolean(),
  paused: v.boolean(),
  stage: reminderStageValidator,
  lastReminderAt: v.optional(v.number()),
  nextReminderAt: v.optional(v.number()),
  escalationStatus: escalationStatusValidator,
  paidAt: v.optional(v.number()),
});

const providerSyncStateValidator = v.object({
  externalId: v.optional(v.string()),
  status: syncStatusValidator,
  lastSyncedAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
});

function normalizeJurisdictionCode(value: unknown) {
  return value === "NGN" ? "NG" : value;
}

function normalizeComplianceSnapshot(compliance: any) {
  return {
    ...compliance,
    placeOfSupply: normalizeJurisdictionCode(compliance.placeOfSupply),
    seller: {
      ...compliance.seller,
      countryCode: normalizeJurisdictionCode(compliance.seller?.countryCode),
      phone: normalizeNigeriaPhone(compliance.seller?.phone),
    },
    buyer: {
      ...compliance.buyer,
      countryCode: normalizeJurisdictionCode(compliance.buyer?.countryCode),
      phone: normalizeNigeriaPhone(compliance.buyer?.phone),
    },
    taxLines: (compliance.taxLines ?? []).map((line: any) => ({
      ...line,
      jurisdictionCode: normalizeJurisdictionCode(line.jurisdictionCode),
    })),
  };
}

const syncValidator = v.object({
  quickbooks: providerSyncStateValidator,
  xero: providerSyncStateValidator,
  slack: providerSyncStateValidator,
});

const paymentProviderValidator = v.union(v.literal("manual"), v.literal("paystack"));

const invoiceValidator = v.object({
  id: v.id("invoices"),
  token: v.string(),
  invoiceNumber: v.string(),
  customerName: v.string(),
  logoUrl: v.optional(v.string()),
  currency: v.string(),
  type: typeValidator,
  invoiceSize: invoiceSizeValidator,
  dateFormat: dateFormatValidator,
  paymentTermsDays: v.number(),
  template: v.string(),
  issueDate: v.string(),
  dueDate: v.string(),
  status: statusValidator,
  paymentDetails: v.optional(v.string()),
  paymentLink: v.optional(v.string()),
  paymentProvider: v.optional(paymentProviderValidator),
  paidAt: v.optional(v.number()),
  paymentReference: v.optional(v.string()),
  notes: v.optional(v.string()),
  lineItems: v.array(lineItemValidator),
  compliance: v.optional(complianceValidator),
  fiscalization: v.optional(fiscalizationValidator),
  reminder: v.optional(reminderValidator),
  sync: v.optional(syncValidator),
});

function defaultCompliance(args: {
  customerName: string;
  lineItems: Array<{ quantity: number; price: number }>;
}): any {
  const subtotal = args.lineItems.reduce((sum, item) => sum + item.quantity * item.price, 0);
  const taxTreatment = defaultTaxTreatmentForSellerTaxStatus("vat_registered");
  const withholding = defaultWithholdingSelection();

  return {
    seller: {
      legalName: "Velure",
      countryCode: "NG",
    },
    buyer: {
      legalName: args.customerName || undefined,
      countryCode: "NG",
    },
    sellerTaxStatus: "vat_registered",
    placeOfSupply: "NG",
    taxRuleSetVersion: NIGERIA_TAX_RULE_SET_VERSION,
    taxTreatment,
    taxRate: NIGERIA_VAT_RATE,
    taxLabel: "VAT",
    taxLines:
      taxTreatment === "exclusive_rate"
        ? [
            {
              label: "VAT",
              rate: NIGERIA_VAT_RATE,
              amount: Math.round(((subtotal * NIGERIA_VAT_RATE) / 100) * 100) / 100,
              treatment: "exclusive_rate",
              jurisdictionCode: "NG",
            },
          ]
        : [],
    warnings: [],
    templateVariant: "vat_ready",
    subtotal,
    totalTax: Math.round(((subtotal * NIGERIA_VAT_RATE) / 100) * 100) / 100,
    withholding: {
      ...withholding,
      amount: 0,
    },
    withholdingTaxPreset: "none",
    withholdingTaxLabel: "WHT",
    withholdingTaxRate: withholding.rate,
    withholdingTaxAmount: 0,
    grandTotal: subtotal + Math.round(((subtotal * NIGERIA_VAT_RATE) / 100) * 100) / 100,
    fiscalization: {
      status: "not_configured",
    },
  };
}

function netPayableFromCompliance(compliance?: {
  netPayable?: number;
  grandTotal?: number;
  withholdingTaxAmount?: number;
}) {
  if (!compliance) return undefined;
  if (compliance.netPayable !== undefined) return compliance.netPayable;
  if (compliance.grandTotal !== undefined) {
    return compliance.grandTotal - (compliance.withholdingTaxAmount ?? 0);
  }
  return undefined;
}

function defaultReminder(): any {
  return {
    enabled: true,
    paused: false,
    stage: "none",
    escalationStatus: "idle",
  };
}

function defaultSync(): any {
  return {
    quickbooks: { status: "idle" },
    xero: { status: "idle" },
    slack: { status: "idle" },
  };
}

function invoiceAmount(invoice: {
  lineItems: Array<{ quantity: number; price: number }>;
  compliance?: { netPayable?: number; grandTotal?: number; withholdingTaxAmount?: number };
}) {
  const complianceAmount = netPayableFromCompliance(invoice.compliance);
  if (complianceAmount !== undefined) return complianceAmount;

  return invoice.lineItems.reduce((sum, item) => sum + item.quantity * item.price, 0);
}

const mapInvoice = (invoice: any) => ({
  id: invoice._id,
  token: invoice.token,
  invoiceNumber: invoice.invoiceNumber,
  customerName: invoice.customerName,
  logoUrl: invoice.logoUrl,
  currency: invoice.currency,
  type: invoice.type ?? "one-time",
  invoiceSize: invoice.invoiceSize ?? "A4",
  dateFormat: invoice.dateFormat ?? "ng",
  paymentTermsDays: invoice.paymentTermsDays ?? 14,
  template: invoice.template ?? "Default",
  issueDate: invoice.issueDate,
  dueDate: invoice.dueDate,
  status: invoice.status,
  paymentDetails: invoice.paymentDetails,
  paymentLink: invoice.paymentLink,
  paymentProvider: invoice.paymentProvider,
  paidAt: invoice.paidAt,
  paymentReference: invoice.paymentReference,
  notes: invoice.notes,
  lineItems: invoice.lineItems,
  compliance: invoice.compliance ?? defaultCompliance(invoice),
  fiscalization: invoice.fiscalization ??
    invoice.compliance?.fiscalization ?? { status: "not_configured" },
  reminder: invoice.reminder ?? defaultReminder(),
  sync: invoice.sync ?? defaultSync(),
  createdAt: invoice.createdAt ?? Date.now(),
  updatedAt: invoice.updatedAt ?? Date.now(),
});

function assertInvoiceInput(args: {
  invoiceNumber: string;
  currency: string;
  lineItems: Array<{ id: string; name: string; quantity: number; price: number }>;
  compliance?: {
    seller?: { taxId?: string; rcNumber?: string; phone?: string };
    buyer?: { taxId?: string; phone?: string };
    regulatoryNotice?: string;
  };
}) {
  if (!/^[A-Z0-9]{2,12}-\d{4}-\d{4,6}$/.test(args.invoiceNumber.trim())) {
    throw new Error("Invoice number must use the format PREFIX-YYYY-NNNN.");
  }

  if (args.lineItems.length === 0) {
    throw new Error("At least one invoice line item is required.");
  }

  if (args.lineItems.length > 50) {
    throw new Error("Invoices support a maximum of 50 line items for safe rendering.");
  }

  assertValidTin(args.compliance?.seller?.taxId);
  assertValidTin(args.compliance?.buyer?.taxId);
  assertValidRcNumber(args.compliance?.seller?.rcNumber);

  if (
    args.currency.trim().toUpperCase() !== "NGN" &&
    args.compliance?.regulatoryNotice !== NIGERIA_FOREIGN_CURRENCY_WARNING
  ) {
    throw new Error(
      "Foreign currency invoices to Nigerian buyers must include the CBN settlement warning.",
    );
  }
}

async function nextInvoiceNumberForWorkspace(ctx: any, workspaceId: string) {
  const workspace = await ctx.db.get(workspaceId);
  const prefix =
    String(workspace?.invoiceNumberPrefix ?? "INV")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 12) || "INV";
  const invoices = await ctx.db
    .query("invoices")
    .withIndex("by_workspaceId", (q: any) => q.eq("workspaceId", workspaceId))
    .collect();
  const year = new Date().getFullYear();
  const pattern = new RegExp(`^${prefix}-(\\d{4})-(\\d{4,6})$`);
  const maxSequence = invoices.reduce((max: number, invoice: any) => {
    const match = String(invoice.invoiceNumber).match(pattern);
    if (!match || Number(match[1]) !== year) return max;
    return Math.max(max, Number(match[2]));
  }, 0);
  const sequence = Math.max(Number(workspace?.nextInvoiceSequence ?? 1), maxSequence + 1);
  return {
    invoiceNumber:
      prefix === "INV"
        ? formatInvoiceNumber(year, sequence)
        : `${prefix}-${year}-${String(sequence).padStart(4, "0")}`,
    nextSequence: sequence + 1,
  };
}

export const list = query({
  args: {
    q: v.optional(v.string()),
    status: v.optional(v.union(v.literal("all"), statusValidator)),
    type: v.optional(v.union(v.literal("all"), typeValidator)),
    customer: v.optional(v.string()),
    dueDateFrom: v.optional(v.string()),
    dueDateTo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireWorkspaceForRead(ctx);
    if (!scope) return [];

    let invoices = await ctx.db
      .query("invoices")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", scope.workspaceId))
      .order("desc")
      .collect();

    if (args.status && args.status !== "all") {
      invoices = invoices.filter((invoice) => invoice.status === args.status);
    }

    if (args.type && args.type !== "all") {
      invoices = invoices.filter((invoice) => (invoice.type ?? "one-time") === args.type);
    }

    if (args.customer && args.customer.trim().length > 0) {
      const customer = args.customer.trim().toLowerCase();
      invoices = invoices.filter((invoice) =>
        invoice.customerName.toLowerCase().includes(customer),
      );
    }

    if (args.dueDateFrom) {
      invoices = invoices.filter((invoice) => invoice.dueDate >= args.dueDateFrom!);
    }

    if (args.dueDateTo) {
      invoices = invoices.filter((invoice) => invoice.dueDate <= args.dueDateTo!);
    }

    const queryText = (args.q ?? "").toLowerCase().trim();
    if (queryText.length > 0) {
      invoices = invoices.filter(
        (invoice) =>
          invoice.customerName.toLowerCase().includes(queryText) ||
          invoice.invoiceNumber.toLowerCase().includes(queryText),
      );
    }

    return invoices.map(mapInvoice);
  },
});

export const getById = query({
  args: { id: v.id("invoices") },
  handler: async (ctx, args) => {
    const scope = await requireWorkspaceForRead(ctx);
    if (!scope) return null;

    const invoice = await ctx.db.get(args.id);
    if (!invoice || invoice.workspaceId !== scope.workspaceId) return null;

    return mapInvoice(invoice);
  },
});

export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const scope = await requireWorkspaceForRead(ctx);
    if (!scope) return null;

    const invoice = await ctx.db
      .query("invoices")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!invoice || invoice.workspaceId !== scope.workspaceId) return null;

    return mapInvoice(invoice);
  },
});

export const getPublicByToken = query({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const invoice = await ctx.db
      .query("invoices")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!invoice || invoice.status === "canceled") return null;

    return mapInvoice(invoice);
  },
});

export const createDraft = mutation({
  args: {
    token: v.string(),
    invoiceNumber: v.string(),
    customerName: v.string(),
    logoUrl: v.optional(v.string()),
    currency: v.string(),
    type: v.optional(typeValidator),
    invoiceSize: v.optional(invoiceSizeValidator),
    dateFormat: v.optional(dateFormatValidator),
    paymentTermsDays: v.optional(v.number()),
    template: v.optional(v.string()),
    issueDate: v.string(),
    dueDate: v.string(),
    paymentDetails: v.optional(v.string()),
    paymentLink: v.optional(v.string()),
    paymentProvider: v.optional(paymentProviderValidator),
    notes: v.optional(v.string()),
    lineItems: v.array(lineItemValidator),
    compliance: v.optional(complianceValidator),
    fiscalization: v.optional(fiscalizationValidator),
    reminder: v.optional(reminderValidator),
    sync: v.optional(syncValidator),
  },
  handler: async (ctx, args) => {
    const scope = await requireWritableWorkspace(ctx);
    const now = Date.now();
    const compliance = args.compliance ?? defaultCompliance(args);
    const generated = /^[A-Z0-9]{2,12}-\d{4}-\d{4,6}$/.test(args.invoiceNumber.trim())
      ? null
      : await nextInvoiceNumberForWorkspace(ctx, scope.workspaceId);
    const invoiceNumber = generated?.invoiceNumber ?? args.invoiceNumber.trim();
    const normalizedCompliance = normalizeComplianceSnapshot(compliance);
    assertInvoiceInput({
      invoiceNumber,
      currency: args.currency,
      lineItems: args.lineItems,
      compliance: normalizedCompliance,
    });
    const reminder = args.reminder ?? defaultReminder();
    const sync = args.sync ?? defaultSync();

    const id = await ctx.db.insert("invoices", {
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      token: args.token,
      invoiceNumber,
      customerName: args.customerName,
      logoUrl: args.logoUrl,
      currency: args.currency,
      type: args.type ?? "one-time",
      invoiceSize: args.invoiceSize ?? "A4",
      dateFormat: args.dateFormat ?? "ng",
      paymentTermsDays: args.paymentTermsDays ?? 14,
      template: args.template ?? "Default",
      issueDate: args.issueDate,
      dueDate: args.dueDate,
      status: "draft",
      paymentDetails: args.paymentDetails,
      paymentLink: args.paymentLink,
      paymentProvider: args.paymentProvider,
      notes: args.notes,
      lineItems: args.lineItems,
      compliance: normalizedCompliance,
      fiscalization: args.fiscalization ??
        normalizedCompliance.fiscalization ?? { status: "not_configured" },
      reminder,
      sync,
      createdAt: now,
      updatedAt: now,
    });

    if (generated) {
      await ctx.db.patch(scope.workspaceId, {
        nextInvoiceSequence: generated.nextSequence,
        updatedAt: now,
      });
    }

    return mapInvoice({
      _id: id,
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      token: args.token,
      invoiceNumber,
      customerName: args.customerName,
      logoUrl: args.logoUrl,
      currency: args.currency,
      type: args.type,
      invoiceSize: args.invoiceSize,
      dateFormat: args.dateFormat,
      paymentTermsDays: args.paymentTermsDays,
      template: args.template,
      issueDate: args.issueDate,
      dueDate: args.dueDate,
      status: "draft",
      paymentDetails: args.paymentDetails,
      paymentLink: args.paymentLink,
      paymentProvider: args.paymentProvider,
      notes: args.notes,
      lineItems: args.lineItems,
      compliance: normalizedCompliance,
      fiscalization: args.fiscalization ??
        normalizedCompliance.fiscalization ?? { status: "not_configured" },
      reminder,
      sync,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const save = mutation({
  args: invoiceValidator,
  handler: async (ctx, args) => {
    const { invoice: current } = await requireWritableInvoice(ctx, args.id);

    const compliance = args.compliance ?? defaultCompliance(args);
    const normalizedCompliance = normalizeComplianceSnapshot(compliance);
    assertInvoiceInput({
      invoiceNumber: args.invoiceNumber,
      currency: args.currency,
      lineItems: args.lineItems,
      compliance: normalizedCompliance,
    });

    await ctx.db.patch(args.id, {
      token: args.token,
      invoiceNumber: args.invoiceNumber,
      customerName: args.customerName,
      logoUrl: args.logoUrl,
      currency: args.currency,
      type: args.type,
      invoiceSize: args.invoiceSize,
      dateFormat: args.dateFormat,
      paymentTermsDays: args.paymentTermsDays,
      template: args.template,
      issueDate: args.issueDate,
      dueDate: args.dueDate,
      status: args.status,
      paymentDetails: args.paymentDetails,
      paymentLink: args.paymentLink,
      paymentProvider: args.paymentProvider,
      paidAt: args.paidAt,
      paymentReference: args.paymentReference,
      notes: args.notes,
      lineItems: args.lineItems,
      compliance: normalizedCompliance,
      fiscalization:
        args.fiscalization ?? normalizedCompliance.fiscalization ?? current.fiscalization,
      reminder: args.reminder ?? defaultReminder(),
      sync: args.sync ?? defaultSync(),
      updatedAt: Date.now(),
    });

    return args;
  },
});

export const saveDraftSettings = mutation({
  args: {
    id: v.id("invoices"),
    invoiceSize: invoiceSizeValidator,
    dateFormat: dateFormatValidator,
    paymentTermsDays: v.number(),
    template: v.string(),
    currency: v.string(),
    type: typeValidator,
    dueDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireWritableInvoice(ctx, args.id);

    await ctx.db.patch(args.id, {
      invoiceSize: args.invoiceSize,
      dateFormat: args.dateFormat,
      paymentTermsDays: args.paymentTermsDays,
      template: args.template,
      currency: args.currency,
      type: args.type,
      dueDate: args.dueDate,
      updatedAt: Date.now(),
    });
    return { ok: true };
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("invoices"),
    status: statusValidator,
    paidAt: v.optional(v.number()),
    paymentReference: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { invoice: current } = await requireWritableInvoice(ctx, args.id);

    const reminder =
      args.status === "paid"
        ? {
            ...(current.reminder ?? defaultReminder()),
            paidAt: args.paidAt ?? Date.now(),
            nextReminderAt: undefined,
          }
        : current.reminder;

    await ctx.db.patch(args.id, {
      status: args.status,
      paidAt: args.status === "paid" ? (args.paidAt ?? Date.now()) : current.paidAt,
      paymentReference:
        args.status === "paid"
          ? (args.paymentReference ?? current.paymentReference)
          : current.paymentReference,
      reminder,
      updatedAt: Date.now(),
    });

    return { ok: true };
  },
});

export const remove = mutation({
  args: { id: v.id("invoices") },
  handler: async (ctx, args) => {
    await requireWritableInvoice(ctx, args.id);

    await ctx.db.delete(args.id);
    return { ok: true };
  },
});

export const duplicate = mutation({
  args: { id: v.id("invoices") },
  handler: async (ctx, args) => {
    const { scope, invoice: source } = await requireWritableInvoice(ctx, args.id);

    const generated = await nextInvoiceNumberForWorkspace(ctx, scope.workspaceId);
    const now = Date.now();

    const id = await ctx.db.insert("invoices", {
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      token: `pub-${crypto.randomUUID()}`,
      invoiceNumber: generated.invoiceNumber,
      customerName: source.customerName,
      logoUrl: source.logoUrl,
      currency: source.currency,
      type: source.type ?? "one-time",
      invoiceSize: source.invoiceSize ?? "A4",
      dateFormat: source.dateFormat ?? "iso",
      paymentTermsDays: source.paymentTermsDays ?? 14,
      template: source.template ?? "Default",
      issueDate: source.issueDate,
      dueDate: source.dueDate,
      status: "draft",
      paymentDetails: source.paymentDetails,
      paymentLink: source.paymentLink,
      paymentProvider: source.paymentProvider,
      notes: source.notes,
      lineItems: source.lineItems,
      compliance: source.compliance ?? defaultCompliance(source),
      fiscalization: source.fiscalization ??
        source.compliance?.fiscalization ?? { status: "not_configured" },
      reminder: defaultReminder(),
      sync: defaultSync(),
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(scope.workspaceId, {
      nextInvoiceSequence: generated.nextSequence,
      updatedAt: now,
    });

    return { id };
  },
});

export const importCsv = mutation({
  args: {
    rows: v.array(importInvoiceRowValidator),
  },
  handler: async (ctx, args) => {
    const scope = await requireWritableWorkspace(ctx);
    const now = Date.now();
    const rows = args.rows.slice(0, 200);
    const created: string[] = [];
    let skipped = 0;

    const existing = await ctx.db
      .query("invoices")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", scope.workspaceId))
      .collect();
    const usedNumbers = new Set(existing.map((invoice) => String(invoice.invoiceNumber)));
    const groups = new Map<
      string,
      {
        invoiceNumber?: string;
        customerName: string;
        currency: string;
        status: "draft" | "unpaid" | "paid" | "overdue" | "canceled" | "scheduled";
        issueDate: string;
        dueDate: string;
        notes?: string;
        paymentDetails?: string;
        paymentLink?: string;
        lineItems: Array<{ id: string; name: string; quantity: number; price: number }>;
      }
    >();

    for (const [index, row] of rows.entries()) {
      const customerName = row.customerName.trim();
      const description = row.description.trim();
      const quantity = Math.max(1, Number(row.quantity ?? 1));
      const price = Math.max(0, Number(row.price ?? 0));

      if (!customerName || !description || price <= 0) {
        skipped += 1;
        continue;
      }

      const today = new Date().toISOString().slice(0, 10);
      const dueDate =
        row.dueDate?.trim() ||
        new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const invoiceNumber = row.invoiceNumber?.trim().toUpperCase();
      const key = invoiceNumber || `row-${index}`;
      const group = groups.get(key);

      if (group) {
        group.lineItems.push({
          id: `li-${crypto.randomUUID()}`,
          name: description,
          quantity,
          price,
        });
        continue;
      }

      groups.set(key, {
        invoiceNumber,
        customerName,
        currency: (row.currency ?? "NGN").trim().toUpperCase() || "NGN",
        status: row.status ?? "draft",
        issueDate: row.issueDate?.trim() || today,
        dueDate,
        notes: row.notes?.trim() || undefined,
        paymentDetails: row.paymentDetails?.trim() || undefined,
        paymentLink: row.paymentLink?.trim() || undefined,
        lineItems: [
          {
            id: `li-${crypto.randomUUID()}`,
            name: description,
            quantity,
            price,
          },
        ],
      });
    }

    for (const group of groups.values()) {
      const generated =
        group.invoiceNumber &&
        /^[A-Z0-9]{2,12}-\d{4}-\d{4,6}$/.test(group.invoiceNumber) &&
        !usedNumbers.has(group.invoiceNumber)
          ? null
          : await nextInvoiceNumberForWorkspace(ctx, scope.workspaceId);
      const invoiceNumber = generated?.invoiceNumber ?? group.invoiceNumber!;
      usedNumbers.add(invoiceNumber);
      const compliance = defaultCompliance({
        customerName: group.customerName,
        lineItems: group.lineItems,
      });
      const normalizedCompliance = {
        ...compliance,
        regulatoryNotice:
          group.currency !== "NGN" ? NIGERIA_FOREIGN_CURRENCY_WARNING : compliance.regulatoryNotice,
      };

      assertInvoiceInput({
        invoiceNumber,
        currency: group.currency,
        lineItems: group.lineItems,
        compliance: normalizedCompliance,
      });

      const id = await ctx.db.insert("invoices", {
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        token: `pub-${crypto.randomUUID()}`,
        invoiceNumber,
        customerName: group.customerName,
        currency: group.currency,
        type: "one-time",
        invoiceSize: "A4",
        dateFormat: "ng",
        paymentTermsDays: 14,
        template: "Default",
        issueDate: group.issueDate,
        dueDate: group.dueDate,
        status: group.status,
        paymentDetails: group.paymentDetails,
        paymentLink: group.paymentLink,
        paymentProvider: group.paymentLink ? "manual" : "paystack",
        paidAt: group.status === "paid" ? now : undefined,
        notes: group.notes,
        lineItems: group.lineItems,
        compliance: normalizedCompliance,
        fiscalization: { status: "not_configured" },
        reminder: defaultReminder(),
        sync: defaultSync(),
        createdAt: now,
        updatedAt: now,
      });

      if (generated) {
        await ctx.db.patch(scope.workspaceId, {
          nextInvoiceSequence: generated.nextSequence,
          updatedAt: now,
        });
      }

      created.push(id);
    }

    return { created: created.length, skipped };
  },
});

export const summary = query({
  args: {},
  handler: async (ctx) => {
    const scope = await requireWorkspaceForRead(ctx);
    if (!scope) {
      return { open: 0, paid: 0, overdue: 0 };
    }

    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", scope.workspaceId))
      .collect();

    const totalForStatuses = (
      statuses: Array<"draft" | "unpaid" | "paid" | "overdue" | "canceled" | "scheduled">,
    ) => {
      return invoices
        .filter((invoice) => statuses.includes(invoice.status))
        .reduce((sum, invoice) => sum + invoiceAmount(invoice), 0);
    };

    return {
      open: totalForStatuses(["draft", "unpaid"]),
      paid: totalForStatuses(["paid"]),
      overdue: totalForStatuses(["overdue"]),
    };
  },
});

export const products = query({
  args: {},
  handler: async (ctx) => {
    const scope = await requireWorkspaceForRead(ctx);
    if (!scope) return [];

    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", scope.workspaceId))
      .collect();
    const map = new Map<
      string,
      { quantity: number; amount: number; currency: string; usedIn: number }
    >();

    for (const invoice of invoices) {
      for (const item of invoice.lineItems) {
        const name = item.name.trim() || "Untitled Item";
        const existing = map.get(name);

        if (existing) {
          existing.quantity += item.quantity;
          existing.amount += item.quantity * item.price;
          existing.usedIn += 1;
        } else {
          map.set(name, {
            quantity: item.quantity,
            amount: item.quantity * item.price,
            currency: invoice.currency,
            usedIn: 1,
          });
        }
      }
    }

    return [...map.entries()]
      .map(([name, value]) => ({ name, ...value }))
      .sort((a, b) => b.amount - a.amount);
  },
});
