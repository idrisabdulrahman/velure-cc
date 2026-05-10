import { createLazyFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import { toast } from "#/components/ui/use-toast";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  NIGERIA_AUTHORITY_LABEL,
  NIGERIA_TAX_RULE_SET_VERSION,
  NIGERIA_VAT_RATE,
  SELLER_TAX_STATUS_OPTIONS,
} from "#/features/compliance/nigeria";

type ComplianceFormErrors = Partial<{
  taxId: string;
  rcNumber: string;
  baseCurrency: string;
  profileName: string;
  profileLabel: string;
  profileRate: string;
}>;

function validateBusinessProfile(form: {
  taxId: string;
  rcNumber: string;
  baseCurrency: string;
}): ComplianceFormErrors {
  const errors: ComplianceFormErrors = {};
  if (form.rcNumber.trim() && !/^RC-\d{7}$/i.test(form.rcNumber.trim())) {
    errors.rcNumber = "CAC RC Number must use RC-1234567 format.";
  }
  if (!/^[A-Z]{3}$/.test(form.baseCurrency.trim())) {
    errors.baseCurrency = "Use a 3-letter currency code like NGN.";
  }
  return errors;
}

function validateTaxProfile(form: {
  name: string;
  label: string;
  rate: number;
}): ComplianceFormErrors {
  const errors: ComplianceFormErrors = {};
  if (!form.name.trim()) errors.profileName = "Profile name is required.";
  if (!form.label.trim()) errors.profileLabel = "Tax label is required.";
  if (!Number.isFinite(form.rate) || form.rate < 0 || form.rate > 100) {
    errors.profileRate = "Rate must be between 0 and 100.";
  }
  return errors;
}

export const Route = createLazyFileRoute("/settings/compliance")({
  component: ComplianceSettingsPage,
});

function ComplianceSettingsPage() {
  const workspace = useQuery(api.compliance.getWorkspaceSettings, {});
  const taxProfiles = (useQuery(api.compliance.listTaxProfiles, {}) ?? []) as Array<{
    _id: string;
    name: string;
    label: string;
    taxTreatment: string;
    rate: number;
    isDefault: boolean;
  }>;
  const exportsHistory = (useQuery(api.compliance.listExportHistory, {}) ?? []) as Array<{
    _id: Id<"invoice_exports">;
    kind: string;
    status: string;
    fileName: string;
    content: string;
  }>;
  const saveWorkspace = useMutation(api.compliance.upsertWorkspaceSettings);
  const saveTaxProfile = useMutation(api.compliance.saveTaxProfile);
  const createExport = useMutation(api.compliance.createExport);
  const retryExport = useMutation(api.compliance.retryExport);

  const [form, setForm] = useState({
    name: "Velure Workspace",
    legalName: "Velure Workspace",
    email: "",
    phone: "",
    address: "",
    website: "",
    taxId: "",
    rcNumber: "",
    countryCode: "NG",
    baseCurrency: "NGN",
    sellerTaxStatus: "vat_registered",
    taxRuleSetVersion: NIGERIA_TAX_RULE_SET_VERSION,
    atrsEnvironment: "sandbox",
    atrsCredentialsConfigured: false,
    reminderSignature: "Velure Finance Team",
    remindersEnabled: true,
    logoUrl: "",
    paymentDetails: "",
    defaultPaymentLink: "",
    defaultPaymentTermsDays: 14,
    invoiceNumberPrefix: "INV",
    nextInvoiceSequence: 1,
  });
  const [profileForm, setProfileForm] = useState({
    name: "Nigeria Standard VAT",
    jurisdictionCode: "NG",
    taxTreatment: "exclusive_rate",
    rate: 7.5,
    label: "VAT",
    isDefault: true,
    active: true,
    notes: "Default VAT profile for domestic invoices.",
  });
  const [errors, setErrors] = useState<ComplianceFormErrors>({});

  const visibleExports = exportsHistory.filter((record) => record.kind !== "normalized_accounting");

  useEffect(() => {
    if (!workspace) return;
    setForm({
      name: workspace.name,
      legalName: workspace.legalName ?? "",
      email: workspace.email ?? "",
      phone: workspace.phone ?? "",
      address: workspace.address ?? "",
      website: workspace.website ?? "",
      taxId: workspace.taxId ?? "",
      rcNumber: (workspace as { rcNumber?: string }).rcNumber ?? "",
      countryCode: workspace.countryCode,
      baseCurrency: workspace.baseCurrency,
      sellerTaxStatus:
        (workspace as { sellerTaxStatus?: string }).sellerTaxStatus ?? "vat_registered",
      taxRuleSetVersion:
        (workspace as { taxRuleSetVersion?: string }).taxRuleSetVersion ??
        NIGERIA_TAX_RULE_SET_VERSION,
      atrsEnvironment:
        (workspace as { atrs?: { environment?: string } }).atrs?.environment ?? "sandbox",
      atrsCredentialsConfigured:
        (workspace as { atrs?: { credentialsConfigured?: boolean } }).atrs?.credentialsConfigured ??
        false,
      reminderSignature: workspace.reminderSignature ?? "Velure Finance Team",
      remindersEnabled: workspace.remindersEnabled,
      logoUrl: workspace.logoUrl ?? "",
      paymentDetails: workspace.paymentDetails ?? "",
      defaultPaymentLink: workspace.defaultPaymentLink ?? "",
      defaultPaymentTermsDays: workspace.defaultPaymentTermsDays ?? 14,
      invoiceNumberPrefix: workspace.invoiceNumberPrefix ?? "INV",
      nextInvoiceSequence: workspace.nextInvoiceSequence ?? 1,
    });
  }, [workspace]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-[-0.02em] text-[#ece7de]">Compliance</h1>
        <p className="mt-2 text-sm text-[#a29b90]">
          Keep business identity, Nigeria VAT settings, WHT notes, and accountant-ready exports in
          one place.
        </p>
      </div>

      <section className="rounded-md border border-[#2b2d30] bg-[#17191b] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-[#ece7de]">Business profile</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-[#a29b90]">
              These details appear on invoices and exports. Keep them aligned with your registered
              business records.
            </p>
          </div>
          <span className="flex items-center gap-1.5 rounded-sm border border-[#3a3d30] bg-[#20241e] px-2 py-1 text-xs font-medium text-[#a7bc62]">
            <span role="img" aria-label="Nigeria flag">
              🇳🇬
            </span>
            Nigeria
          </span>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Input
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Workspace name"
            className="border-[#2b2d30] bg-[#121314]"
          />
          <Input
            value={form.legalName}
            onChange={(event) =>
              setForm((current) => ({ ...current, legalName: event.target.value }))
            }
            placeholder="Legal name"
            className="border-[#2b2d30] bg-[#121314]"
          />
          <Input
            value={form.email}
            onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
            placeholder="Finance email"
            className="border-[#2b2d30] bg-[#121314]"
          />
          <Input
            value={form.phone}
            onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
            placeholder="Phone"
            className="border-[#2b2d30] bg-[#121314]"
          />
          <Input
            value={form.taxId}
            onChange={(event) => {
              setForm((current) => ({
                ...current,
                taxId: event.target.value.slice(0, 15),
              }));
              setErrors((current) => ({ ...current, taxId: undefined }));
            }}
            placeholder="TIN (Tax ID)"
            aria-invalid={Boolean(errors.taxId)}
            className={`${errors.taxId ? "border-[#c76f5b]" : "border-[#2b2d30]"} bg-[#121314]`}
          />
          <Input
            value={form.rcNumber}
            onChange={(event) => {
              setForm((current) => ({
                ...current,
                rcNumber: event.target.value.toUpperCase().replace(/\s+/g, "").slice(0, 10),
              }));
              setErrors((current) => ({ ...current, rcNumber: undefined }));
            }}
            placeholder="CAC RC Number"
            aria-invalid={Boolean(errors.rcNumber)}
            className={`${errors.rcNumber ? "border-[#c76f5b]" : "border-[#2b2d30]"} bg-[#121314]`}
          />
          <Input
            value={form.baseCurrency}
            onChange={(event) => {
              setForm((current) => ({
                ...current,
                baseCurrency: event.target.value.toUpperCase().slice(0, 3),
              }));
              setErrors((current) => ({ ...current, baseCurrency: undefined }));
            }}
            placeholder="Base currency"
            aria-invalid={Boolean(errors.baseCurrency)}
            className={`${errors.baseCurrency ? "border-[#c76f5b]" : "border-[#2b2d30]"} bg-[#121314]`}
          />
          <div className="rounded-md border border-[#2b2d30] bg-[#121314] px-3 py-2">
            <div className="mb-2 text-xs text-[#a29b90]">Seller tax status</div>
            <select
              value={form.sellerTaxStatus}
              onChange={(event) =>
                setForm((current) => ({ ...current, sellerTaxStatus: event.target.value }))
              }
              className="h-10 w-full rounded-md border border-[#2b2d30] bg-[#0f1114] px-3 text-sm text-[#ece7de]"
            >
              {SELLER_TAX_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {errors.taxId || errors.rcNumber || errors.baseCurrency ? (
          <div className="mt-3 space-y-1 text-xs text-[#c76f5b]">
            {errors.taxId ? <p>{errors.taxId}</p> : null}
            {errors.rcNumber ? <p>{errors.rcNumber}</p> : null}
            {errors.baseCurrency ? <p>{errors.baseCurrency}</p> : null}
          </div>
        ) : null}
        <Textarea
          value={form.address}
          onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
          placeholder="Registered address"
          className="mt-4 border-[#2b2d30] bg-[#121314]"
        />
        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={async () => {
              const nextErrors = validateBusinessProfile(form);
              setErrors((current) => ({ ...current, ...nextErrors }));
              if (Object.keys(nextErrors).length > 0) return;
              await saveWorkspace({
                name: form.name,
                legalName: form.legalName || undefined,
                email: form.email || undefined,
                phone: form.phone || undefined,
                address: form.address || undefined,
                website: form.website || undefined,
                taxId: form.taxId || undefined,
                rcNumber: form.rcNumber || undefined,
                countryCode: form.countryCode as
                  | "NG"
                  | "GH"
                  | "KE"
                  | "ZA"
                  | "US"
                  | "GB"
                  | "EU"
                  | "OTHER",
                baseCurrency: form.baseCurrency,
                sellerTaxStatus: form.sellerTaxStatus as
                  | "vat_registered"
                  | "below_threshold_not_charging_vat"
                  | "statutorily_exempt",
                taxRuleSetVersion: form.taxRuleSetVersion,
                atrs: {
                  environment: form.atrsEnvironment as "sandbox" | "production",
                  credentialsConfigured: form.atrsCredentialsConfigured,
                },
                reminderSignature: form.reminderSignature || undefined,
                remindersEnabled: form.remindersEnabled,
                logoUrl: form.logoUrl || undefined,
                paymentDetails: form.paymentDetails || undefined,
                defaultPaymentLink: form.defaultPaymentLink || undefined,
                defaultPaymentTermsDays: form.defaultPaymentTermsDays,
                invoiceNumberPrefix: form.invoiceNumberPrefix || "INV",
                nextInvoiceSequence: form.nextInvoiceSequence,
              });
              toast({ title: "Compliance settings saved", variant: "success" });
            }}
            className="bg-[#a7bc62] text-[#121314] hover:bg-[#b5c97a]"
          >
            Save business profile
          </Button>
        </div>
        <p className="mt-3 text-xs text-[#8f8a81]">
          CSV exports are for spreadsheets and accountants. Connected accounting apps will be added
          later.
        </p>
        <p className="mt-1 text-xs text-[#8f8a81]">
          Legal note: Velure helps prepare invoice records; it does not replace tax advice. Confirm
          VAT, WHT, and filing treatment with your accountant.
        </p>
        <p className="mt-1 text-xs text-[#8f9e66]">
          {NIGERIA_AUTHORITY_LABEL} is now the federal revenue authority. Standard VAT remains{" "}
          {NIGERIA_VAT_RATE}% for taxable supplies where VAT applies.
        </p>
      </section>

      <section className="rounded-md border border-[#2b2d30] bg-[#17191b] p-5">
        <div>
          <h2 className="text-sm font-medium text-[#ece7de]">Tax settings</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[#a29b90]">
            Use VAT settings for invoice display. Use WHT fields only when a customer deducts tax at
            source or your accountant asks you to show expected deductions.
          </p>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-[#2b2d30] bg-[#121314] px-4 py-3">
            <p className="text-sm font-medium text-[#ece7de]">VAT profile</p>
            <p className="mt-1 text-xs text-[#a29b90]">
              Nigeria standard VAT is {NIGERIA_VAT_RATE}% for taxable supplies. Businesses below
              registration threshold or exempt supplies should not charge VAT by default.
            </p>
          </div>
          <div className="rounded-md border border-[#2b2d30] bg-[#121314] px-4 py-3">
            <p className="text-sm font-medium text-[#ece7de]">WHT deduction</p>
            <p className="mt-1 text-xs text-[#a29b90]">
              WHT is not an extra charge. It is usually deducted by the paying customer and remitted
              to the tax authority under category-based deduction rules.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Input
            value={profileForm.name}
            onChange={(event) => {
              setProfileForm((current) => ({ ...current, name: event.target.value }));
              setErrors((current) => ({ ...current, profileName: undefined }));
            }}
            placeholder="Profile name"
            aria-invalid={Boolean(errors.profileName)}
            className={`${errors.profileName ? "border-[#c76f5b]" : "border-[#2b2d30]"} bg-[#121314]`}
          />
          <Input
            value={profileForm.label}
            onChange={(event) => {
              setProfileForm((current) => ({ ...current, label: event.target.value }));
              setErrors((current) => ({ ...current, profileLabel: undefined }));
            }}
            placeholder="Tax label"
            aria-invalid={Boolean(errors.profileLabel)}
            className={`${errors.profileLabel ? "border-[#c76f5b]" : "border-[#2b2d30]"} bg-[#121314]`}
          />
          <Input
            type="number"
            step="0.5"
            value={profileForm.rate}
            onChange={(event) => {
              setProfileForm((current) => ({ ...current, rate: Number(event.target.value) || 0 }));
              setErrors((current) => ({ ...current, profileRate: undefined }));
            }}
            placeholder="Rate"
            aria-invalid={Boolean(errors.profileRate)}
            className={`${errors.profileRate ? "border-[#c76f5b]" : "border-[#2b2d30]"} bg-[#121314]`}
          />
        </div>
        {errors.profileName || errors.profileLabel || errors.profileRate ? (
          <div className="mt-3 space-y-1 text-xs text-[#c76f5b]">
            {errors.profileName ? <p>{errors.profileName}</p> : null}
            {errors.profileLabel ? <p>{errors.profileLabel}</p> : null}
            {errors.profileRate ? <p>{errors.profileRate}</p> : null}
          </div>
        ) : null}
        <Textarea
          value={profileForm.notes}
          onChange={(event) =>
            setProfileForm((current) => ({ ...current, notes: event.target.value }))
          }
          placeholder="Notes"
          className="mt-4 border-[#2b2d30] bg-[#121314]"
        />
        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={async () => {
              const nextErrors = validateTaxProfile(profileForm);
              setErrors((current) => ({ ...current, ...nextErrors }));
              if (Object.keys(nextErrors).length > 0) return;
              await saveTaxProfile(profileForm as any);
              toast({ title: "Tax profile saved", variant: "success" });
            }}
            className="bg-[#a7bc62] text-[#121314] hover:bg-[#b5c97a]"
          >
            Save VAT profile
          </Button>
          <Button
            type="button"
            variant="outline"
            className="border-[#2b2d30] bg-transparent"
            onClick={async () => {
              const result = await createExport({ kind: "tax_summary_csv" });
              toast({
                title: "Tax summary generated",
                description: result.fileName,
                variant: "success",
              });
            }}
          >
            Export tax summary
          </Button>
        </div>

        <div className="mt-5 space-y-3">
          {(taxProfiles ?? []).map((profile) => (
            <div
              key={profile._id}
              className="rounded-md border border-[#2b2d30] bg-[#121314] px-4 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-[#ece7de]">{profile.name}</p>
                  <p className="text-xs text-[#a29b90]">
                    {profile.label} • {profile.taxTreatment} • {profile.rate}%
                  </p>
                </div>
                {profile.isDefault ? <span className="text-xs text-[#8f9e66]">Default</span> : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-[#2b2d30] bg-[#17191b] p-5">
        <div className="grid gap-4 xl:grid-cols-[1fr_auto] xl:items-start">
          <div>
            <h2 className="text-sm font-medium text-[#ece7de]">Exports</h2>
            <p className="mt-1 text-sm text-[#a29b90]">
              Your data is yours. Export invoices as PDF or CSV anytime. Downloadable CSV reports
              cover invoicing, customer balances, and tax review.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 xl:w-[430px] xl:justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-10 min-w-[190px] rounded-md border-[#2b2d30] bg-[#121314] px-3 text-xs font-semibold tracking-[0.02em] text-[#d5d0c7] hover:bg-[#1d2023] hover:text-[#ece7de]"
              onClick={async () => {
                const result = await createExport({ kind: "invoices_csv" });
                toast({
                  title: "Invoice report generated",
                  description: result.fileName,
                  variant: "success",
                });
              }}
            >
              Invoice CSV
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 min-w-[190px] rounded-md border-[#2b2d30] bg-[#121314] px-3 text-xs font-semibold tracking-[0.02em] text-[#d5d0c7] hover:bg-[#1d2023] hover:text-[#ece7de]"
              onClick={async () => {
                const result = await createExport({ kind: "customer_ledger_csv" });
                toast({
                  title: "Customer balance report generated",
                  description: result.fileName,
                  variant: "success",
                });
              }}
            >
              Customer ledger
            </Button>
          </div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-[#2b2d30] bg-[#121314] px-4 py-3">
            <p className="text-sm font-medium text-[#ece7de]">Invoice list CSV</p>
            <p className="mt-1 text-xs text-[#a29b90]">
              One row per invoice with totals, due dates, status, and tax amounts.
            </p>
          </div>
          <div className="rounded-md border border-[#2b2d30] bg-[#121314] px-4 py-3">
            <p className="text-sm font-medium text-[#ece7de]">Customer balance CSV</p>
            <p className="mt-1 text-xs text-[#a29b90]">
              A customer-focused ledger showing invoice history and outstanding amounts.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {visibleExports.map((record) => (
            <div
              key={record._id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[#2b2d30] bg-[#121314] px-4 py-3"
            >
              <div>
                <p className="text-sm font-medium text-[#ece7de]">{record.fileName}</p>
                <p className="text-xs text-[#a29b90]">
                  {record.kind} • {record.status}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="border-[#2b2d30] bg-transparent"
                  onClick={() => navigator.clipboard.writeText(record.content)}
                >
                  Copy content
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-[#2b2d30] bg-transparent"
                  onClick={async () => {
                    await retryExport({ id: record._id });
                    toast({ title: "Export marked ready", variant: "success" });
                  }}
                >
                  Retry
                </Button>
              </div>
            </div>
          ))}
          {visibleExports.length === 0 ? (
            <div className="rounded-md border border-dashed border-[#2b2d30] bg-[#121314] px-4 py-6 text-sm text-[#a29b90]">
              No downloadable exports yet. Generate an invoice list, customer balance report, or tax
              summary.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
