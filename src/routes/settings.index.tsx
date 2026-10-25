import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FormField } from "#/components/redesign/form-field";
import { Panel } from "#/components/redesign/panel";
import { StatusPill } from "#/components/redesign/status-pill";
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
import { NIGERIA_TAX_RULE_SET_VERSION } from "#/features/compliance/nigeria";
import {
	composeSupplierAddress,
	SUPPLIER_ADDRESS_MAX_LENGTHS,
	type SupplierProfileIssueCode,
	type SupplierProfileValidation,
	supplierProfileBanner,
	supplierProfileIssueMessage,
	validateSupplierProfile,
} from "#/features/compliance/supplier-profile";
import { authClient } from "#/lib/auth-client";
import { useSupabaseSession } from "#/lib/supabase-session";
import {
	getWorkspaceSettings,
	SUPPLIER_PROFILE_REJECTION_PREFIX,
	upsertWorkspaceSettings,
} from "#/server/data/compliance";
export const Route = createFileRoute("/settings/")({
	component: SettingsPage,
});

type BusinessForm = {
	name: string;
	legalName: string;
	email: string;
	phone: string;
	addressStreet: string;
	addressLga: string;
	addressState: string;
	country: string;
	logoUrl: string;
	taxId: string;
	rcNumber: string;
	paymentDetails: string;
	defaultCurrency: string;
	defaultPaymentTermsDays: string;
	invoiceNumberMode: "prefix" | "business_name";
	invoiceNumberPrefix: string;
	nextInvoiceSequence: string;
};

type FormErrors = Partial<Record<keyof BusinessForm | "logo", string>>;

const initialForm: BusinessForm = {
	name: "",
	legalName: "",
	email: "",
	phone: "",
	addressStreet: "",
	addressLga: "",
	addressState: "",
	country: "NG",
	logoUrl: "",
	taxId: "",
	rcNumber: "",
	paymentDetails: "",
	defaultCurrency: "NGN",
	defaultPaymentTermsDays: "14",
	invoiceNumberMode: "prefix",
	invoiceNumberPrefix: "INV",
	nextInvoiceSequence: "1",
};

const CURRENCY_SYMBOLS: Record<string, string> = {
	NGN: "₦",
	USD: "$",
	GBP: "£",
	EUR: "€",
};

function formatDate(value: unknown) {
	if (!value) return "Not available";

	const date =
		value instanceof Date ||
		typeof value === "string" ||
		typeof value === "number"
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

function currencySymbol(code: string) {
	return CURRENCY_SYMBOLS[code.trim().toUpperCase()] ?? "₦";
}

function invoicePreviewNumber(form: BusinessForm) {
	const n = String(Number.parseInt(form.nextInvoiceSequence, 10) || 1);
	if (form.invoiceNumberMode === "business_name") {
		const stripped =
			form.name
				.trim()
				.toUpperCase()
				.replace(/[^A-Z0-9]/g, "") || "INV";
		return `${stripped}-2026-${n.padStart(4, "0")}`;
	}
	const prefix = form.invoiceNumberPrefix.trim().toUpperCase() || "INV";
	return `${prefix}-2026-${n.padStart(6, "0")}`;
}

const PROFILE_ISSUE_FIELDS: Partial<
	Record<SupplierProfileIssueCode, keyof BusinessForm>
> = {
	tin_required: "taxId",
	tin_format: "taxId",
	tin_placeholder: "taxId",
	cac_rc_required: "rcNumber",
	cac_rc_format: "rcNumber",
	cac_rc_placeholder: "rcNumber",
	address_street_required: "addressStreet",
	address_street_too_long: "addressStreet",
	address_lga_too_long: "addressLga",
	address_state_required: "addressState",
	address_state_too_long: "addressState",
	address_country_required: "country",
};

function profileValidationFor(form: BusinessForm): SupplierProfileValidation {
	return validateSupplierProfile({
		tin: form.taxId,
		rcNumber: form.rcNumber,
		address: {
			street: form.addressStreet,
			lga: form.addressLga,
			state: form.addressState,
			countryCode: form.country,
		},
	});
}

function validate(form: BusinessForm): FormErrors {
	const errors: FormErrors = {};

	if (!form.name.trim()) errors.name = "Business name is required.";
	if (!form.email.trim()) {
		errors.email = "Business email is required.";
	} else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
		errors.email = "Enter a valid email address.";
	}

	// B1 supplier profile: validated TIN, required CAC RC, structured address.
	// Same rules the server enforces — the client check is UX, the server is
	// the boundary.
	const profile = profileValidationFor(form);
	for (const issue of profile.issues) {
		const field = PROFILE_ISSUE_FIELDS[issue.code];
		if (field && !errors[field]) errors[field] = issue.message;
	}

	if (
		form.defaultCurrency.trim() &&
		!/^[A-Z]{3}$/.test(form.defaultCurrency.trim())
	) {
		errors.defaultCurrency = "Use a 3-letter currency code like NGN.";
	}
	if (
		form.invoiceNumberMode === "prefix" &&
		!/^[A-Z0-9]{2,12}$/.test(form.invoiceNumberPrefix.trim())
	) {
		errors.invoiceNumberPrefix =
			"Invoice prefix must be 2-12 letters or numbers.";
	}

	return errors;
}

function SettingsPage() {
	const navigate = useNavigate();
	const { data: session } = authClient.useSession();
	const { client, velureUserId } = useSupabaseSession(session?.user.id);
	const {
		data: workspace,
		isPending: settingsPending,
		isError: settingsError,
		refetch: refetchSettings,
	} = useQuery({
		queryKey: ["supabase-workspace-settings", velureUserId],
		queryFn: () => getWorkspaceSettings(client!, velureUserId!),
		enabled: Boolean(client && velureUserId),
	});
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	const [form, setForm] = useState<BusinessForm>(initialForm);
	const [savedForm, setSavedForm] = useState<BusinessForm>(initialForm);
	// Validation of the values from the last successful save; recomputes the
	// flagged-for-review banner immediately after saving instead of waiting
	// for the workspace refetch. Null until something is saved this session.
	const [savedProfile, setSavedProfile] =
		useState<SupplierProfileValidation | null>(null);
	const [errors, setErrors] = useState<FormErrors>({});
	const [logoPreview, setLogoPreview] = useState<string | null>(() => {
		if (typeof window === "undefined") return null;
		return window.localStorage.getItem("velure-business-logo");
	});
	const [savedLogo, setSavedLogo] = useState<string | null>(() => {
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
			legalName: workspace.legalName ?? "",
			email: workspace.email || session?.user.email || "",
			phone: workspace.phone ?? "",
			addressStreet: workspace.addressStreet ?? workspace.address ?? "",
			addressLga: workspace.addressLga ?? "",
			addressState: workspace.addressState ?? "",
			country: workspace.countryCode ?? "NG",
			logoUrl: workspace.logoUrl ?? "",
			taxId: workspace.taxId ?? "",
			rcNumber: workspace.rcNumber ?? "",
			paymentDetails: workspace.paymentDetails ?? "",
			defaultCurrency: workspace.baseCurrency ?? "NGN",
			defaultPaymentTermsDays: String(workspace.defaultPaymentTermsDays ?? 14),
			invoiceNumberMode: workspace.invoiceNumberMode ?? "prefix",
			invoiceNumberPrefix: workspace.invoiceNumberPrefix ?? "INV",
			nextInvoiceSequence: String(workspace.nextInvoiceSequence ?? 1),
		};

		setForm(nextForm);
		setSavedForm(nextForm);
		// A fresh workspace read carries the authoritative flag columns, so it
		// supersedes any local post-save recomputation.
		setSavedProfile(null);
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
		setLogoPreview(savedLogo);
		setErrors({});
	};

	const saveChanges = async () => {
		const nextErrors = validate(form);
		setErrors(nextErrors);

		if (Object.keys(nextErrors).length > 0 || !workspace) return;

		setSaving(true);
		try {
			if (!client || !velureUserId)
				throw new Error("Supabase session unavailable.");
			await upsertWorkspaceSettings(client, velureUserId, {
				name: form.name.trim(),
				legalName: form.legalName.trim() || form.name.trim(),
				email: form.email.trim(),
				phone: form.phone.trim() || undefined,
				website: workspace.website || undefined,
				taxId: form.taxId.trim(),
				rcNumber: form.rcNumber.trim(),
				addressStreet: form.addressStreet.trim(),
				// Empty string is an explicit clear; only `undefined` means "keep
				// the stored value" on the server, so never coerce a cleared LGA
				// back to undefined here.
				addressLga: form.addressLga.trim(),
				addressState: form.addressState.trim(),
				countryCode: form.country.trim().toUpperCase(),
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
					(workspace as { taxRuleSetVersion?: string }).taxRuleSetVersion ??
					NIGERIA_TAX_RULE_SET_VERSION,
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
				defaultPaymentTermsDays: Number(form.defaultPaymentTermsDays) || 14,
				invoiceNumberMode: form.invoiceNumberMode,
				invoiceNumberPrefix:
					form.invoiceNumberPrefix.trim().toUpperCase() || "INV",
				nextInvoiceSequence: Number(form.nextInvoiceSequence) || 1,
			});
			setSavedForm(form);
			setSavedLogo(logoPreview);
			// Recompute the flagged-for-review banner from the values that were
			// just persisted (the server only accepts valid profiles), then
			// refresh the workspace so the stored flag columns catch up too.
			setSavedProfile(profileValidationFor(form));
			await refetchSettings();
			toast({ title: "Profile updated", variant: "success" });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			// A rejected registration profile names the failing fields and
			// limits (e.g. the 300/200/200 address caps); surface that text
			// directly instead of a generic save-failure message.
			const profileRejected = message.startsWith(
				SUPPLIER_PROFILE_REJECTION_PREFIX,
			);
			toast({
				title: profileRejected
					? "Check your registration details"
					: "Could not update profile",
				description: profileRejected
					? message.slice(SUPPLIER_PROFILE_REJECTION_PREFIX.length).trim()
					: message,
				variant: "error",
			});
		} finally {
			setSaving(false);
		}
	};

	const user = session?.user;
	const memberSince = formatDate(
		(user as { createdAt?: string | Date } | undefined)?.createdAt,
	);
	const canDeleteAccount = deleteConfirm === "DELETE" && !deletingAccount;

	const handleDeleteAccount = async () => {
		if (!canDeleteAccount) return;

		setDeletingAccount(true);
		try {
			const response = await fetch("/api/auth/delete-user", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ callbackURL: "/" }),
			});
			if (!response.ok) throw new Error("Account deletion is not enabled.");
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

	const dirty =
		JSON.stringify(form) !== JSON.stringify(savedForm) ||
		logoPreview !== savedLogo;
	const requiredInvalid =
		!form.name.trim() ||
		!form.email.trim() ||
		!form.addressStreet.trim() ||
		!form.addressState.trim() ||
		!form.country.trim();
	const loaded = Boolean(workspace);
	const nameError =
		errors.name ??
		(loaded && !form.name.trim() ? "Business name is required." : undefined);
	const emailError =
		errors.email ??
		(loaded && !form.email.trim() ? "Business email is required." : undefined);
	const profileBanner = supplierProfileBanner(
		{
			status: workspace?.supplierProfileStatus,
			issues: workspace?.supplierProfileIssues,
		},
		savedProfile,
	);
	const profileFlagged = profileBanner.flagged;
	const previewAddress = composeSupplierAddress({
		street: form.addressStreet,
		lga: form.addressLga,
		state: form.addressState,
	});

	const previewNumber = invoicePreviewNumber(form);
	const previewSymbol = currencySymbol(form.defaultCurrency);
	const previewInitial = (form.name.trim().charAt(0) || "?").toUpperCase();
	const previewTerms = form.defaultPaymentTermsDays.trim() || "14";
	const isPrefixMode = form.invoiceNumberMode === "prefix";

	return (
		<div className="mx-auto w-full max-w-7xl space-y-6 pb-24">
			<div>
				<h1 className="text-3xl font-bold tracking-[-0.02em] text-ink">
					General
				</h1>
				<p className="mt-2 text-sm text-ink-3">
					Manage your business profile, invoice defaults and payment details.
					The preview on the right shows how it lands on an invoice.
				</p>
			</div>

			{settingsPending ? (
				<Panel title="Loading settings">
					<p className="text-sm text-ink-3">Fetching your workspace…</p>
				</Panel>
			) : null}
			{!settingsPending && settingsError ? (
				<Panel
					title="Could not load settings"
					sub="Check your connection and try again."
				>
					<Button
						type="button"
						variant="outline"
						onClick={() => {
							void refetchSettings();
						}}
						className="h-9 rounded-md border-rule bg-transparent px-3 text-sm text-ink-2 hover:bg-paper-3"
					>
						Retry
					</Button>
				</Panel>
			) : null}

			<div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
				<div className="grid min-w-0 gap-5">
					<Panel
						title="Business profile"
						sub="Shown on every invoice you send."
					>
						<div className="grid gap-5">
							{profileBanner.setupRequired ? (
								<div
									role="status"
									className="rounded-md border border-rule bg-paper-2 px-4 py-3"
								>
									<p className="text-sm font-medium text-ink">
										Complete your business profile
									</p>
									<p className="mt-1 text-sm text-ink-3">
										Add your TIN, CAC RC number and structured address below,
										then save. They print on every invoice you send.
									</p>
								</div>
							) : null}
							{profileFlagged ? (
								<div
									role="status"
									className="rounded-md border border-warn-line bg-warn-soft px-4 py-3"
								>
									<p className="text-sm font-medium text-warn">
										Supplier profile flagged for review
									</p>
									<p className="mt-1 text-sm text-ink-2">
										Saved registration details are incomplete or use a
										placeholder. Complete the TIN, CAC RC number and structured
										address below, then save. Nothing was deleted.
									</p>
									{profileBanner.codes.length ? (
										<ul className="mt-2 list-disc pl-5 text-xs text-ink-2">
											{profileBanner.codes.map((code) => (
												<li key={code}>
													{supplierProfileIssueMessage(
														code as SupplierProfileIssueCode,
													)}
												</li>
											))}
										</ul>
									) : null}
								</div>
							) : null}
							<div className="flex flex-wrap items-center gap-4">
								<button
									type="button"
									onClick={() => fileInputRef.current?.click()}
									aria-label="Upload business logo"
									className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border border-dashed border-rule bg-paper-2 text-center text-lg font-semibold text-ink-2 transition-[border-color,background-color] hover:border-brand hover:bg-brand-soft focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-focus)]"
								>
									{logoPreview ? (
										<img
											src={logoPreview}
											alt="Business logo"
											className="h-full w-full object-cover"
										/>
									) : (
										<span aria-hidden="true">{previewInitial}</span>
									)}
								</button>
								<div>
									<Button
										type="button"
										variant="outline"
										onClick={() => fileInputRef.current?.click()}
										className="h-9 rounded-md border-rule bg-transparent text-sm text-ink-2 hover:bg-paper-3"
									>
										<Upload className="mr-2 h-4 w-4" />
										Upload logo
									</Button>
									<p className="mt-2 text-xs text-ink-3">
										Max 2MB, square crop.
									</p>
								</div>
								<input
									ref={fileInputRef}
									type="file"
									accept="image/png,image/jpeg,image/webp"
									className="hidden"
									aria-label="Business logo file"
									onChange={(event) => onLogoChange(event.target.files?.[0])}
								/>
							</div>
							{errors.logo ? (
								<p role="alert" className="text-xs text-danger">
									{errors.logo}
								</p>
							) : null}
							<div className="grid gap-5 sm:grid-cols-2">
								<FormField label="Workspace name *" error={nameError}>
									<Input
										value={form.name}
										onChange={(event) =>
											updateField("name", event.target.value)
										}
										className="rounded-md border-rule bg-paper text-ink focus-visible:border-brand"
									/>
								</FormField>
								<FormField label="Registered business name">
									<Input
										value={form.legalName}
										onChange={(event) =>
											updateField("legalName", event.target.value)
										}
										placeholder="Shown on invoices when different"
										className="rounded-md border-rule bg-paper text-ink focus-visible:border-brand"
									/>
								</FormField>
								<FormField label="Business email *" error={emailError}>
									<Input
										type="email"
										value={form.email}
										onChange={(event) =>
											updateField("email", event.target.value)
										}
										className="rounded-md border-rule bg-paper text-ink focus-visible:border-brand"
									/>
								</FormField>
								<FormField label="Business phone" error={errors.phone}>
									<Input
										type="tel"
										value={form.phone}
										onChange={(event) =>
											updateField("phone", formatPhone(event.target.value))
										}
										className="rounded-md border-rule bg-paper text-ink focus-visible:border-brand"
									/>
								</FormField>
								<FormField
									label="TIN *"
									error={errors.taxId}
									hint="10 digits from your tax record. Placeholder values are rejected."
								>
									<Input
										value={form.taxId}
										onChange={(event) =>
											updateField(
												"taxId",
												event.target.value.replace(/\D/g, "").slice(0, 10),
											)
										}
										placeholder="10-digit TIN"
										inputMode="numeric"
										aria-invalid={Boolean(errors.taxId)}
										className={`rounded-md bg-paper text-ink focus-visible:border-brand ${
											errors.taxId ? "border-danger" : "border-rule"
										}`}
									/>
								</FormField>
								<FormField
									label="CAC RC number *"
									error={errors.rcNumber}
									hint="Company registration number, e.g. RC-1234567."
								>
									<Input
										value={form.rcNumber}
										onChange={(event) =>
											updateField(
												"rcNumber",
												event.target.value
													.toUpperCase()
													.replace(/\s+/g, "")
													.slice(0, 10),
											)
										}
										placeholder="RC-1234567"
										aria-invalid={Boolean(errors.rcNumber)}
										className={`rounded-md bg-paper text-ink focus-visible:border-brand ${
											errors.rcNumber ? "border-danger" : "border-rule"
										}`}
									/>
								</FormField>
							</div>
						</div>
					</Panel>

					<Panel
						title="Invoicing"
						sub="Currency, terms and how invoice numbers are built."
					>
						<div className="grid gap-5">
							<div className="grid gap-5 sm:grid-cols-2">
								<FormField
									label="Default currency"
									error={errors.defaultCurrency}
								>
									<Input
										value={form.defaultCurrency}
										onChange={(event) =>
											updateField(
												"defaultCurrency",
												event.target.value.toUpperCase().slice(0, 3),
											)
										}
										aria-invalid={Boolean(errors.defaultCurrency)}
										className={`rounded-md bg-paper text-ink focus-visible:border-brand ${
											errors.defaultCurrency ? "border-danger" : "border-rule"
										}`}
									/>
								</FormField>
								<FormField
									label="Payment terms"
									error={errors.defaultPaymentTermsDays}
								>
									<Input
										type="number"
										min={1}
										value={form.defaultPaymentTermsDays}
										onChange={(event) =>
											updateField("defaultPaymentTermsDays", event.target.value)
										}
										className="rounded-md border-rule bg-paper text-ink focus-visible:border-brand"
									/>
								</FormField>
							</div>
							<div>
								<span
									id="invoice-naming-label"
									className="mb-2 block text-xs font-medium text-ink-2"
								>
									Invoice naming
								</span>
								<div
									role="radiogroup"
									aria-labelledby="invoice-naming-label"
									className="grid gap-2 sm:grid-cols-2"
								>
									<button
										type="button"
										role="radio"
										aria-checked={isPrefixMode}
										onClick={() => updateField("invoiceNumberMode", "prefix")}
										className={`rounded-md border px-3 py-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-focus)] ${
											isPrefixMode
												? "border-brand bg-brand-soft text-ink"
												: "border-rule bg-paper text-ink-3 hover:bg-paper-2"
										}`}
									>
										<span className="block font-medium">
											Use invoice prefix
										</span>
										<span className="mt-1 block text-xs text-ink-3">
											Keep generated numbers like INV-2026-000001.
										</span>
									</button>
									<button
										type="button"
										role="radio"
										aria-checked={!isPrefixMode}
										onClick={() =>
											updateField("invoiceNumberMode", "business_name")
										}
										className={`rounded-md border px-3 py-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--color-focus)] ${
											!isPrefixMode
												? "border-brand bg-brand-soft text-ink"
												: "border-rule bg-paper text-ink-3 hover:bg-paper-2"
										}`}
									>
										<span className="block font-medium">Use business name</span>
										<span className="mt-1 block text-xs text-ink-3">
											Build generated numbers from the business name.
										</span>
									</button>
								</div>
							</div>
							<div className="grid gap-5 sm:grid-cols-2">
								<FormField
									label="Invoice prefix"
									error={errors.invoiceNumberPrefix}
									hint="Only used with Use invoice prefix."
								>
									<Input
										value={form.invoiceNumberPrefix}
										disabled={!isPrefixMode}
										onChange={(event) =>
											updateField(
												"invoiceNumberPrefix",
												event.target.value
													.toUpperCase()
													.replace(/[^A-Z0-9]/g, "")
													.slice(0, 12),
											)
										}
										className="rounded-md border-rule bg-paper text-ink focus-visible:border-brand disabled:opacity-50"
									/>
								</FormField>
								<FormField
									label="Next invoice number"
									error={errors.nextInvoiceSequence}
									hint={
										workspace?.numberingLocked
											? "Locked: your first invoice has been issued, so numbering is now managed automatically."
											: undefined
									}
								>
									<Input
										type="number"
										min={1}
										value={form.nextInvoiceSequence}
										disabled={workspace?.numberingLocked === true}
										onChange={(event) =>
											updateField("nextInvoiceSequence", event.target.value)
										}
										className="rounded-md border-rule bg-paper text-ink focus-visible:border-brand disabled:opacity-50"
									/>
								</FormField>
							</div>
							<div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-rule bg-paper-2 px-4 py-3">
								<div>
									<p className="text-xs text-ink-3">Next invoice number</p>
									<p className="mt-1 font-num text-sm font-medium tabular-nums text-ink">
										{previewNumber}
									</p>
								</div>
								<StatusPill tone="ok">Live preview</StatusPill>
							</div>
						</div>
					</Panel>

					<Panel
						title="Address"
						sub="Structured address, printed in the invoice header."
					>
						<div className="grid gap-5">
							<FormField
								label="Street address *"
								error={errors.addressStreet}
								hint={`Up to ${SUPPLIER_ADDRESS_MAX_LENGTHS.street} characters.`}
							>
								<Textarea
									value={form.addressStreet}
									maxLength={SUPPLIER_ADDRESS_MAX_LENGTHS.street}
									onChange={(event) =>
										updateField("addressStreet", event.target.value)
									}
									className="min-h-20 rounded-md border-rule bg-paper text-ink focus-visible:border-brand"
								/>
							</FormField>
							<div className="grid gap-5 sm:grid-cols-3">
								<FormField
									label="LGA"
									error={errors.addressLga}
									hint={`Up to ${SUPPLIER_ADDRESS_MAX_LENGTHS.lga} characters.`}
								>
									<Input
										value={form.addressLga}
										maxLength={SUPPLIER_ADDRESS_MAX_LENGTHS.lga}
										onChange={(event) =>
											updateField("addressLga", event.target.value)
										}
										placeholder="Local government area"
										className="rounded-md border-rule bg-paper text-ink focus-visible:border-brand"
									/>
								</FormField>
								<FormField
									label="State / region *"
									error={errors.addressState}
									hint={`Up to ${SUPPLIER_ADDRESS_MAX_LENGTHS.state} characters.`}
								>
									<Input
										value={form.addressState}
										maxLength={SUPPLIER_ADDRESS_MAX_LENGTHS.state}
										onChange={(event) =>
											updateField("addressState", event.target.value)
										}
										placeholder="e.g. Lagos"
										className="rounded-md border-rule bg-paper text-ink focus-visible:border-brand"
									/>
								</FormField>
								<FormField
									label="Country *"
									error={errors.country}
									hint="2-letter code."
								>
									<Input
										value={form.country}
										onChange={(event) =>
											updateField(
												"country",
												event.target.value
													.toUpperCase()
													.replace(/[^A-Z]/g, "")
													.slice(0, 2),
											)
										}
										placeholder="NG"
										aria-invalid={Boolean(errors.country)}
										className={`rounded-md bg-paper text-ink focus-visible:border-brand ${
											errors.country ? "border-danger" : "border-rule"
										}`}
									/>
								</FormField>
							</div>
						</div>
					</Panel>

					<Panel
						title="Payment details"
						sub="Where customers send money. Printed on every invoice."
					>
						<FormField label="Payment details" error={errors.paymentDetails}>
							<Textarea
								value={form.paymentDetails}
								onChange={(event) =>
									updateField("paymentDetails", event.target.value)
								}
								placeholder={
									"Bank Name: Zenith Bank\nAccount Name: Velure Studio\nAccount Number: 0123456789"
								}
								className="min-h-28 rounded-md border-rule bg-paper text-ink focus-visible:border-brand"
							/>
						</FormField>
					</Panel>
				</div>

				<div className="min-w-0 lg:sticky lg:top-6">
					<Panel title="Invoice preview" sub="Updates as you type">
						<div className="rounded-md border border-rule bg-paper-2 p-4">
							<div className="flex items-start justify-between gap-3">
								<div className="flex min-w-0 items-center gap-2.5">
									{logoPreview ? (
										<img
											src={logoPreview}
											alt=""
											aria-hidden="true"
											className="h-9 w-9 flex-none rounded-md object-cover"
										/>
									) : (
										<span
											aria-hidden="true"
											className="grid h-9 w-9 flex-none place-items-center rounded-md bg-brand font-semibold text-brand-ink"
										>
											{previewInitial}
										</span>
									)}
									<div className="min-w-0">
										<p className="truncate text-[13px] font-semibold text-ink">
											{form.name.trim() || "Workspace name"}
										</p>
										<p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink-3">
											{previewAddress || "Business address"}
										</p>
									</div>
								</div>
								<div className="flex-none text-right">
									<p className="font-num text-[10px] font-semibold tracking-wide text-ink-3">
										INVOICE
									</p>
									<p className="mt-1 font-num text-xs font-medium tabular-nums text-ink">
										{previewNumber}
									</p>
								</div>
							</div>
							<div className="my-3.5 border-t border-rule" />
							<div className="flex items-center justify-between text-[11px] text-ink-3">
								<span>Bill to</span>
								<span>Due in {previewTerms} days</span>
							</div>
							<p className="mt-1 text-[11px] text-ink-2">Client name</p>
							<div className="my-3.5 border-t border-rule" />
							<div className="grid gap-1.5 text-[11px]">
								<div className="flex items-center justify-between gap-3">
									<span className="min-w-0 truncate text-ink-2">
										Solar panel 730W × 4
									</span>
									<span className="flex-none font-num tabular-nums text-ink">
										{previewSymbol}620,000
									</span>
								</div>
								<div className="flex items-center justify-between gap-3">
									<span className="min-w-0 truncate text-ink-2">
										Inverter 12KVA × 1
									</span>
									<span className="flex-none font-num tabular-nums text-ink">
										{previewSymbol}1,500,000
									</span>
								</div>
							</div>
							<div className="mt-2 flex items-center justify-between text-xs font-semibold">
								<span className="text-ink">Total</span>
								<span className="font-num tabular-nums text-ink">
									{previewSymbol}2,120,000
								</span>
							</div>
							<div className="mt-3.5 rounded-md bg-paper-3 p-2.5 text-[11px] leading-relaxed">
								<p className="font-semibold text-ink">Pay to</p>
								<p className="mt-0.5 whitespace-pre-line text-ink-2">
									{form.paymentDetails.trim() || "Bank name · Account number"}
								</p>
							</div>
						</div>
					</Panel>
				</div>
			</div>

			<Panel title="Account info">
				<div className="grid gap-3 sm:grid-cols-2">
					<ReadOnlyItem label="Member Since" value={memberSince} />
					<div className="rounded-md border border-rule bg-paper-2 px-4 py-3">
						<p className="text-xs text-ink-3">Plan</p>
						<div className="mt-2 flex items-center justify-between gap-3">
							<StatusPill tone="ok">Free Plan</StatusPill>
							<Button
								asChild
								type="button"
								variant="outline"
								className="h-8 rounded-md border-rule bg-transparent px-3 text-xs text-ink-2 hover:bg-paper-3"
							>
								<Link to="/pricing">PRO</Link>
							</Button>
						</div>
					</div>
				</div>
			</Panel>

			<Panel title="Backup and tax notes">
				<div className="grid gap-3 sm:grid-cols-2">
					<div className="rounded-md border border-rule bg-paper-2 px-4 py-3">
						<p className="text-sm font-medium text-ink">Your data is yours.</p>
						<p className="mt-1 text-sm text-ink-3">
							Export invoices as PDF or CSV anytime. Use Compliance exports for
							invoice CSV, tax summary CSV, and customer ledger CSV.
						</p>
					</div>
					<div className="rounded-md border border-rule bg-paper-2 px-4 py-3">
						<p className="text-sm font-medium text-ink">Tax disclaimer</p>
						<p className="mt-1 text-sm text-ink-3">
							Velure helps structure invoice data for Nigerian finance
							workflows. Confirm VAT, WHT, and filing treatment with your
							accountant or tax advisor.
						</p>
					</div>
				</div>
			</Panel>

			<Panel
				title="Danger Zone"
				sub="Permanently remove this account."
				className="border-danger-line"
			>
				<div className="flex flex-wrap items-center justify-between gap-4">
					<p className="text-sm text-ink-3">
						This cannot be undone. Your workspace, invoices, clients, exports,
						reminders, sessions, and sign-in records will be permanently
						deleted.
					</p>
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button
								type="button"
								variant="outline"
								className="h-10 rounded-md border-danger-line bg-transparent px-4 text-sm text-danger hover:bg-danger-soft"
							>
								<Trash2 className="mr-2 h-4 w-4" />
								Delete Account
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent className="border-danger-line bg-paper-2 text-ink">
							<AlertDialogHeader>
								<AlertDialogTitle className="text-danger">
									Delete account?
								</AlertDialogTitle>
								<AlertDialogDescription className="text-ink-3">
									This cannot be undone. Your workspace, invoices, clients,
									exports, reminders, sessions, and sign-in records will be
									permanently deleted. Type DELETE to confirm.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<Input
								value={deleteConfirm}
								onChange={(event) => setDeleteConfirm(event.target.value)}
								placeholder="DELETE"
								className="rounded-md border-danger-line bg-paper text-ink placeholder:text-ink-3 focus-visible:border-danger-line"
							/>
							<AlertDialogFooter>
								<AlertDialogCancel
									disabled={deletingAccount}
									onClick={() => setDeleteConfirm("")}
									className="border-rule bg-transparent text-ink-2 hover:bg-paper-3"
								>
									Cancel
								</AlertDialogCancel>
								<AlertDialogAction
									disabled={!canDeleteAccount}
									onClick={(event) => {
										event.preventDefault();
										void handleDeleteAccount();
									}}
									className="bg-danger text-paper hover:bg-danger disabled:bg-paper-3 disabled:text-ink-3"
								>
									{deletingAccount ? "Deleting..." : "Delete Account"}
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</div>
			</Panel>

			<div
				className={`pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-5 transition-transform duration-200 ${
					dirty ? "translate-y-0" : "translate-y-[120%]"
				}`}
			>
				<div className="pointer-events-auto flex items-center gap-4 rounded-lg border border-rule bg-paper-2 py-2.5 pr-2.5 pl-4 shadow-lg">
					<span className="flex items-center gap-2.5 text-[13px] text-ink">
						<span aria-hidden="true" className="h-2 w-2 rounded-full bg-warn" />
						Unsaved changes
					</span>
					<Button
						type="button"
						variant="outline"
						onClick={resetForm}
						className="h-9 rounded-md border-rule bg-transparent px-3 text-sm text-ink-2 hover:bg-paper-3"
					>
						Discard
					</Button>
					<Button
						type="button"
						disabled={saving || requiredInvalid}
						onClick={() => {
							void saveChanges();
						}}
						className="h-9 rounded-md bg-brand px-4 text-sm font-medium text-brand-ink hover:bg-brand-hi disabled:opacity-50"
					>
						{saving ? "Saving..." : "Save changes"}
					</Button>
				</div>
			</div>
		</div>
	);
}

function ReadOnlyItem({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-md border border-rule bg-paper-2 px-4 py-3">
			<p className="text-xs text-ink-3">{label}</p>
			<p className="mt-2 truncate text-sm text-ink-3">{value}</p>
		</div>
	);
}
