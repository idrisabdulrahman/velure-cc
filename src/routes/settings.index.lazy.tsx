import { Link, createLazyFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Settings, Trash2, Upload } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Textarea } from "#/components/ui/textarea";
import { toast } from "#/components/ui/use-toast";
import { authClient } from "#/lib/auth-client";
import { api } from "../../convex/_generated/api";

export const Route = createLazyFileRoute("/settings/")({
  component: SettingsPage,
});

type BusinessForm = {
  name: string;
  email: string;
  phone: string;
  address: string;
  logoUrl: string;
  taxId: string;
  paymentDetails: string;
  defaultPaymentLink: string;
  defaultCurrency: string;
  defaultPaymentTermsDays: string;
  invoiceNumberPrefix: string;
  nextInvoiceSequence: string;
};

type FormErrors = Partial<Record<keyof BusinessForm | "logo", string>>;

const initialForm: BusinessForm = {
  name: "",
  email: "",
  phone: "",
  address: "",
  logoUrl: "",
  taxId: "",
  paymentDetails: "",
  defaultPaymentLink: "",
  defaultCurrency: "NGN",
  defaultPaymentTermsDays: "14",
  invoiceNumberPrefix: "INV",
  nextInvoiceSequence: "1",
};

function formatDate(value: unknown) {
  if (!value) return "Not available";

  const date =
    value instanceof Date || typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : null;
  if (!date) return "Not available";
  if (Number.isNaN(date.getTime())) return "Not available";

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatPhone(value: string) {
  const allowed = value.replace(/[^\d+()\-\s]/g, "");
  return allowed.replace(/\s{2,}/g, " ").trimStart();
}

function validate(form: BusinessForm): FormErrors {
  const errors: FormErrors = {};

  if (!form.name.trim()) errors.name = "Business name is required.";
  if (!form.email.trim()) {
    errors.email = "Business email is required.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    errors.email = "Enter a valid email address.";
  }
  if (!form.address.trim()) errors.address = "Business address is required.";
  if (form.taxId.trim() && !/^\d{10}$/.test(form.taxId.trim())) {
    errors.taxId = "TIN must be exactly 10 numeric digits.";
  }
  if (form.defaultCurrency.trim() && !/^[A-Z]{3}$/.test(form.defaultCurrency.trim())) {
    errors.defaultCurrency = "Use a 3-letter currency code like NGN.";
  }

  return errors;
}

function SettingsPage() {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const workspace = useQuery(api.compliance.getWorkspaceSettings, {});
  const saveWorkspace = useMutation(api.compliance.upsertWorkspaceSettings);
  const deleteAccount = useMutation(api.account.deleteCurrentAccount);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [form, setForm] = useState<BusinessForm>(initialForm);
  const [savedForm, setSavedForm] = useState<BusinessForm>(initialForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [logoPreview, setLogoPreview] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem("velure-business-logo");
  });
  const [saving, setSaving] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  useEffect(() => {
    if (!workspace) return;

    const nextForm = {
      name: workspace.name ?? "",
      email: workspace.email || session?.user.email || "",
      phone: workspace.phone ?? "",
      address: workspace.address ?? "",
      logoUrl: workspace.logoUrl ?? "",
      taxId: workspace.taxId ?? "",
      paymentDetails: workspace.paymentDetails ?? "",
      defaultPaymentLink: workspace.defaultPaymentLink ?? "",
      defaultCurrency: workspace.baseCurrency ?? "NGN",
      defaultPaymentTermsDays: String(workspace.defaultPaymentTermsDays ?? 14),
      invoiceNumberPrefix: workspace.invoiceNumberPrefix ?? "INV",
      nextInvoiceSequence: String(workspace.nextInvoiceSequence ?? 1),
    };

    setForm(nextForm);
    setSavedForm(nextForm);
  }, [workspace, session?.user.email]);

  const updateField = (field: keyof BusinessForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const onLogoChange = (file: File | undefined) => {
    setErrors((current) => ({ ...current, logo: undefined }));
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setErrors((current) => ({
        ...current,
        logo: "Logo must be 2MB or smaller.",
      }));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      setLogoPreview(result);
      if (result && typeof window !== "undefined") {
        window.localStorage.setItem("velure-business-logo", result);
      }
    };
    reader.readAsDataURL(file);
  };

  const resetForm = () => {
    setForm(savedForm);
    setErrors({});
  };

  const saveChanges = async () => {
    const nextErrors = validate(form);
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0 || !workspace) return;

    setSaving(true);
    try {
      await saveWorkspace({
        name: form.name.trim(),
        legalName: workspace.legalName || form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        address: form.address.trim(),
        website: workspace.website || undefined,
        taxId: form.taxId.trim() || undefined,
        rcNumber: (workspace as { rcNumber?: string }).rcNumber || undefined,
        countryCode: workspace.countryCode,
        baseCurrency: form.defaultCurrency,
        sellerTaxStatus:
          (
            workspace as {
              sellerTaxStatus?:
                | "vat_registered"
                | "below_threshold_not_charging_vat"
                | "statutorily_exempt";
            }
          ).sellerTaxStatus ?? "vat_registered",
        taxRuleSetVersion:
          (workspace as { taxRuleSetVersion?: string }).taxRuleSetVersion ?? "NG-2026-v1",
        atrs: (
          workspace as {
            atrs?: {
              environment?: "sandbox" | "production";
              credentialsConfigured: boolean;
            };
          }
        ).atrs ?? {
          environment: "sandbox",
          credentialsConfigured: false,
        },
        reminderSignature: workspace.reminderSignature || undefined,
        remindersEnabled: workspace.remindersEnabled,
        logoUrl: logoPreview || form.logoUrl.trim() || undefined,
        paymentDetails: form.paymentDetails.trim() || undefined,
        defaultPaymentLink: form.defaultPaymentLink.trim() || undefined,
        defaultPaymentTermsDays: Number(form.defaultPaymentTermsDays) || 14,
        invoiceNumberPrefix: form.invoiceNumberPrefix.trim().toUpperCase() || "INV",
        nextInvoiceSequence: Number(form.nextInvoiceSequence) || 1,
      });
      setSavedForm(form);
      toast({ title: "Profile updated", variant: "success" });
    } catch (error) {
      toast({
        title: "Could not update profile",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const user = session?.user;
  const memberSince = formatDate((user as { createdAt?: string | Date } | undefined)?.createdAt);
  const canDeleteAccount = deleteConfirm === "DELETE" && !deletingAccount;

  const handleDeleteAccount = async () => {
    if (!canDeleteAccount) return;

    setDeletingAccount(true);
    try {
      await deleteAccount({});
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("velure-business-logo");
      }
      await authClient.signOut();
      toast({ title: "Account deleted", variant: "success" });
      await navigate({ to: "/", replace: true });
    } catch (error) {
      toast({
        title: "Could not delete account",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "error",
      });
      setDeletingAccount(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex items-start gap-3">
        <div className="mt-1 flex h-10 w-10 items-center justify-center rounded-md border border-[#2b2d30] bg-[#17191b] text-[#a7bc62]">
          <Settings className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-[-0.02em] text-[#ece7de]">Settings</h1>
          <p className="mt-2 text-sm text-white/55">Manage your business profile and preferences</p>
        </div>
      </div>

      <section className="rounded-md border border-[#2f7d5a] bg-[#17191b]/80 shadow-[0_20px_80px_rgba(0,0,0,0.28)] backdrop-blur-md">
        <div className="border-b border-[#2b2d30] px-5 py-4">
          <h2 className="text-sm font-medium text-[#ece7de]">Business profile</h2>
        </div>

        <div className="grid gap-6 px-5 py-5 lg:grid-cols-[220px_1fr]">
          <div className="flex flex-col items-center">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-36 w-36 items-center justify-center overflow-hidden rounded-full border border-dashed border-[#2f7d5a] bg-[#121314] text-center text-sm text-[#a29b90] transition-[border-color,background-color] hover:border-[#a7bc62] hover:bg-[#182019] focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgba(47,125,90,0.5)]"
            >
              {logoPreview ? (
                <img src={logoPreview} alt="Business logo" className="h-full w-full object-cover" />
              ) : (
                <span className="px-5">Logo placeholder</span>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => onLogoChange(event.target.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 h-10 rounded-md border-[#2f7d5a] bg-transparent text-sm text-[#d5d0c7] hover:bg-[#1d2023]"
            >
              <Upload className="mr-2 h-4 w-4" />
              Upload Logo
            </Button>
            <p className="mt-2 text-center text-xs text-[#8a857d]">Max 2MB, square crop.</p>
            {errors.logo ? (
              <p className="mt-2 text-center text-xs text-[#ef9a9a]">{errors.logo}</p>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Business Name*" error={errors.name}>
              <Input
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
                className="rounded-md border-[#2b2d30] bg-[#121314] text-[#ece7de] focus-visible:border-[#2f7d5a]"
              />
            </Field>
            <Field label="Business Email*" error={errors.email}>
              <Input
                type="email"
                value={form.email}
                onChange={(event) => updateField("email", event.target.value)}
                className="rounded-md border-[#2b2d30] bg-[#121314] text-[#ece7de] focus-visible:border-[#2f7d5a]"
              />
            </Field>
            <Field label="Business Phone" error={errors.phone}>
              <Input
                type="tel"
                value={form.phone}
                onChange={(event) => updateField("phone", formatPhone(event.target.value))}
                className="rounded-md border-[#2b2d30] bg-[#121314] text-[#ece7de] focus-visible:border-[#2f7d5a]"
              />
            </Field>
            <Field label="TIN" error={errors.taxId}>
              <Input
                value={form.taxId}
                onChange={(event) =>
                  updateField("taxId", event.target.value.replace(/\D/g, "").slice(0, 10))
                }
                placeholder="10-digit TIN"
                aria-invalid={Boolean(errors.taxId)}
                className={`rounded-md bg-[#121314] text-[#ece7de] focus-visible:border-[#2f7d5a] ${
                  errors.taxId ? "border-[#c76f5b]" : "border-[#2b2d30]"
                }`}
              />
            </Field>
            <Field label="Default Currency" error={errors.defaultCurrency}>
              <Input
                value={form.defaultCurrency}
                onChange={(event) =>
                  updateField("defaultCurrency", event.target.value.toUpperCase().slice(0, 3))
                }
                aria-invalid={Boolean(errors.defaultCurrency)}
                className={`rounded-md bg-[#121314] text-[#ece7de] focus-visible:border-[#2f7d5a] ${
                  errors.defaultCurrency ? "border-[#c76f5b]" : "border-[#2b2d30]"
                }`}
              />
            </Field>
            <Field label="Payment Terms" error={errors.defaultPaymentTermsDays}>
              <Input
                type="number"
                min={1}
                value={form.defaultPaymentTermsDays}
                onChange={(event) => updateField("defaultPaymentTermsDays", event.target.value)}
                className="rounded-md border-[#2b2d30] bg-[#121314] text-[#ece7de] focus-visible:border-[#2f7d5a]"
              />
            </Field>
            <Field label="Invoice Prefix" error={errors.invoiceNumberPrefix}>
              <Input
                value={form.invoiceNumberPrefix}
                onChange={(event) =>
                  updateField(
                    "invoiceNumberPrefix",
                    event.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9]/g, "")
                      .slice(0, 12),
                  )
                }
                className="rounded-md border-[#2b2d30] bg-[#121314] text-[#ece7de] focus-visible:border-[#2f7d5a]"
              />
            </Field>
            <Field label="Next Invoice Number" error={errors.nextInvoiceSequence}>
              <Input
                type="number"
                min={1}
                value={form.nextInvoiceSequence}
                onChange={(event) => updateField("nextInvoiceSequence", event.target.value)}
                className="rounded-md border-[#2b2d30] bg-[#121314] text-[#ece7de] focus-visible:border-[#2f7d5a]"
              />
              <p className="mt-2 text-xs text-[#8a857d]">
                Generated format: {form.invoiceNumberPrefix || "INV"}-{new Date().getFullYear()}-
                {String(Number(form.nextInvoiceSequence) || 1).padStart(4, "0")}.
              </p>
            </Field>
            <Field label="Business Address*" error={errors.address} className="md:col-span-2">
              <Textarea
                value={form.address}
                onChange={(event) => updateField("address", event.target.value)}
                className="min-h-28 rounded-md border-[#2b2d30] bg-[#121314] text-[#ece7de] focus-visible:border-[#2f7d5a]"
              />
            </Field>
            <Field label="Payment Details" error={errors.paymentDetails} className="md:col-span-2">
              <Textarea
                value={form.paymentDetails}
                onChange={(event) => updateField("paymentDetails", event.target.value)}
                placeholder={
                  "Bank Name: Zenith Bank\nAccount Name: Velure Studio\nAccount Number: 0123456789"
                }
                className="min-h-28 rounded-md border-[#2b2d30] bg-[#121314] text-[#ece7de] focus-visible:border-[#2f7d5a]"
              />
            </Field>
            <Field
              label="Default Payment Link"
              error={errors.defaultPaymentLink}
              className="md:col-span-2"
            >
              <Input
                value={form.defaultPaymentLink}
                onChange={(event) => updateField("defaultPaymentLink", event.target.value)}
                placeholder="https://paystack.com/pay/..."
                className="rounded-md border-[#2b2d30] bg-[#121314] text-[#ece7de] focus-visible:border-[#2f7d5a]"
              />
              <p className="mt-2 text-xs text-[#8a857d]">
                Leave blank to use Paystack checkout from each invoice total.
              </p>
            </Field>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-t border-[#2b2d30] px-5 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={resetForm}
            className="h-10 rounded-md border-[#2b2d30] bg-transparent px-4 text-sm text-[#d5d0c7] hover:bg-[#1d2023]"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving}
            onClick={() => {
              void saveChanges();
            }}
            className="h-10 rounded-md bg-[#a7bc62] px-4 text-sm font-medium text-[#121314] hover:bg-[#b5c97a]"
          >
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </section>

      <section className="ui-panel rounded-md border border-[#2b2d30] bg-[#17191b]">
        <div className="border-b border-[#2b2d30] px-5 py-4">
          <h2 className="text-sm font-medium text-[#ece7de]">Account info</h2>
        </div>
        <div className="grid gap-3 px-5 py-5 md:grid-cols-3">
          <ReadOnlyItem label="Email" value={user?.email ?? "Not available"} />
          <ReadOnlyItem label="Member Since" value={memberSince} />
          <div className="rounded-md border border-[#2b2d30] bg-[#121314] px-4 py-3">
            <p className="text-xs text-[#a29b90]">Plan</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="rounded-sm border border-[#41463b] bg-[#20241e] px-2 py-1 text-xs font-medium text-[#a7bc62]">
                Free Plan
              </span>
              <Button
                asChild
                type="button"
                variant="outline"
                className="h-8 rounded-md border-[#2b2d30] bg-transparent px-3 text-xs text-[#d5d0c7] hover:bg-[#1d2023]"
              >
                <Link to="/pricing">PRO</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-md border border-[#2b2d30] bg-[#17191b]">
        <div className="border-b border-[#2b2d30] px-5 py-4">
          <h2 className="text-sm font-medium text-[#ece7de]">Backup and tax notes</h2>
        </div>
        <div className="grid gap-3 px-5 py-5 md:grid-cols-2">
          <div className="rounded-md border border-[#2b2d30] bg-[#121314] px-4 py-3">
            <p className="text-sm font-medium text-[#ece7de]">Your data is yours.</p>
            <p className="mt-1 text-sm text-[#a29b90]">
              Export invoices as PDF or CSV anytime. Use Compliance exports for invoice CSV, tax
              summary CSV, and customer ledger CSV.
            </p>
          </div>
          <div className="rounded-md border border-[#2b2d30] bg-[#121314] px-4 py-3">
            <p className="text-sm font-medium text-[#ece7de]">Tax disclaimer</p>
            <p className="mt-1 text-sm text-[#a29b90]">
              Velure helps format VAT and WHT fields. Confirm filing, deduction, and NRS
              requirements with your accountant or tax adviser.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-md border border-[#5d4747] bg-[#17191b]">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5">
          <div>
            <h2 className="text-sm font-medium text-[#efb1b1]">Danger Zone</h2>
            <p className="mt-1 text-sm text-[#a29b90]">Permanently remove this account.</p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-md border-[#5d4747] bg-transparent px-4 text-sm text-[#d48f8f] hover:bg-[#2a1f1f]"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Account
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="border-[#5d4747] bg-[#17191b] text-[#ece7de]">
              <AlertDialogHeader>
                <AlertDialogTitle className="text-[#efb1b1]">Delete account?</AlertDialogTitle>
                <AlertDialogDescription className="text-[#a29b90]">
                  This cannot be undone. Your workspace, invoices, clients, exports, reminders,
                  sessions, and sign-in records will be permanently deleted. Type DELETE to confirm.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                value={deleteConfirm}
                onChange={(event) => setDeleteConfirm(event.target.value)}
                placeholder="DELETE"
                className="rounded-md border-[#5d4747] bg-[#121314] text-[#ece7de] placeholder:text-[#7f7a72] focus-visible:border-[#8a5a5a]"
              />
              <AlertDialogFooter>
                <AlertDialogCancel
                  disabled={deletingAccount}
                  onClick={() => setDeleteConfirm("")}
                  className="border-[#2b2d30] bg-transparent text-[#d5d0c7] hover:bg-[#1d2023]"
                >
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={!canDeleteAccount}
                  onClick={(event) => {
                    event.preventDefault();
                    void handleDeleteAccount();
                  }}
                  className="bg-[#7f1d1d] text-[#fee2e2] hover:bg-[#991b1b] disabled:bg-[#3a2323] disabled:text-[#8a6a6a]"
                >
                  {deletingAccount ? "Deleting..." : "Delete Account"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  error,
  className,
  children,
}: {
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <span className="mb-2 block text-xs font-medium text-[#a29b90]">{label}</span>
      {children}
      {error ? <span className="mt-2 block text-xs text-[#ef9a9a]">{error}</span> : null}
    </div>
  );
}

function ReadOnlyItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#2b2d30] bg-[#121314] px-4 py-3">
      <p className="text-xs text-[#a29b90]">{label}</p>
      <p className="mt-2 truncate text-sm text-[#8a857d]">{value}</p>
    </div>
  );
}
