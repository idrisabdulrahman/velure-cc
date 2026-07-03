import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
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

export const Route = createFileRoute("/settings/")({
	beforeLoad: async ({ context }) => {
		await context.queryClient.prefetchQuery(
			convexQuery(api.compliance.getWorkspaceSettings, {}),
		);
	},
	component: SettingsPage,
});

type BusinessForm = {
	name: string;
	legalName: string;
	email: string;
	phone: string;
	address: string;
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
	address: "",
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

function invoicePreviewPrefix(form: BusinessForm) {
	const source =
		form.invoiceNumberMode === "business_name"
			? form.name
			: form.invoiceNumberPrefix;
	return (
		source
			.trim()
			.toUpperCase()
			.replace(/[^A-Z0-9]/g, "")
			.slice(0, 12) || "INV"
	);
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
	if (form.rcNumber.trim() && !/^RC-\d{7}$/i.test(form.rcNumber.trim())) {
		errors.rcNumber = "CAC RC Number must use RC-1234567 format.";
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
	const { data: workspace } = useQuery(
		convexQuery(api.compliance.getWorkspaceSettings, {}),
	);
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
				legalName: workspace.legalName ?? "",
				email: workspace.email || session?.user.email || "",
				phone: workspace.phone ?? "",
				address: workspace.address ?? "",
				logoUrl: workspace.logoUrl ?? "",
				taxId: workspace.taxId ?? "",
				rcNumber: (workspace as { rcNumber?: string }).rcNumber ?? "",
				paymentDetails: workspace.paymentDetails ?? "",
			defaultCurrency: workspace.baseCurrency ?? "NGN",
			defaultPaymentTermsDays: String(workspace.defaultPaymentTermsDays ?? 14),
			invoiceNumberMode: workspace.invoiceNumberMode ?? "prefix",
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
					legalName: form.legalName.trim() || form.name.trim(),
					email: form.email.trim(),
				phone: form.phone.trim() || undefined,
				address: form.address.trim(),
				website: workspace.website || undefined,
					taxId: form.taxId.trim() || undefined,
					rcNumber: form.rcNumber.trim() || undefined,
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
					(workspace as { taxRuleSetVersion?: string }).taxRuleSetVersion ??
					"NG-2026-v1",
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
	const memberSince = formatDate(
		(user as { createdAt?: string | Date } | undefined)?.createdAt,
	);
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
				<div className="mt-1 flex h-10 w-10 items-center justify-center rounded-md border border-[#30352f] bg-[#151817] text-[#c8ff62]">
					<Settings className="h-5 w-5" />
				</div>
				<div>
					<h1 className="text-3xl font-bold tracking-[-0.02em] text-[#f2efe7]">
						Settings
					</h1>
					<p className="mt-2 text-sm text-white/55">
						Manage your business profile and preferences
					</p>
				</div>
			</div>

			<section className="rounded-md border border-[#30352f] bg-[#101211]/95 shadow-[0_20px_80px_rgba(0,0,0,0.28)] backdrop-blur-md">
				<div className="border-b border-[#30352f] px-5 py-4">
					<h2 className="text-sm font-medium text-[#f2efe7]">
						Business profile
					</h2>
				</div>

				<div className="grid gap-6 px-5 py-5 lg:grid-cols-[220px_1fr]">
					<div className="flex flex-col items-center">
						<button
							type="button"
							onClick={() => fileInputRef.current?.click()}
							className="flex h-36 w-36 items-center justify-center overflow-hidden rounded-full border border-dashed border-[#30352f] bg-[#101211] text-center text-sm text-[#aaa294] transition-[border-color,background-color] hover:border-[#c8ff62] hover:bg-[#1a2117] focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_rgba(200,255,98,0.24)]"
						>
							{logoPreview ? (
								<img
									src={logoPreview}
									alt="Business logo"
									className="h-full w-full object-cover"
								/>
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
							className="mt-4 h-10 rounded-md border-[#30352f] bg-transparent text-sm text-[#d8d1c4] hover:bg-[#20241f]"
						>
							<Upload className="mr-2 h-4 w-4" />
							Upload Logo
						</Button>
						<p className="mt-2 text-center text-xs text-[#817d72]">
							Max 2MB, square crop.
						</p>
						{errors.logo ? (
							<p className="mt-2 text-center text-xs text-[#ef9a9a]">
								{errors.logo}
							</p>
						) : null}
					</div>

					<div className="grid gap-4 md:grid-cols-2">
							<Field label="Workspace Name*" error={errors.name}>
								<Input
									value={form.name}
									onChange={(event) => updateField("name", event.target.value)}
									className="rounded-md border-[#30352f] bg-[#0f1111] text-[#f2efe7] focus-visible:border-[#c8ff62]"
								/>
							</Field>
							<Field label="Registered Business Name" error={errors.legalName}>
								<Input
									value={form.legalName}
									onChange={(event) =>
										updateField("legalName", event.target.value)
									}
									placeholder="Shown on invoices when different"
									className="rounded-md border-[#30352f] bg-[#0f1111] text-[#f2efe7] focus-visible:border-[#c8ff62]"
								/>
							</Field>
							<Field label="Business Email*" error={errors.email}>
							<Input
								type="email"
								value={form.email}
								onChange={(event) => updateField("email", event.target.value)}
								className="rounded-md border-[#30352f] bg-[#0f1111] text-[#f2efe7] focus-visible:border-[#c8ff62]"
							/>
						</Field>
						<Field label="Business Phone" error={errors.phone}>
							<Input
								type="tel"
								value={form.phone}
								onChange={(event) =>
									updateField("phone", formatPhone(event.target.value))
								}
								className="rounded-md border-[#30352f] bg-[#0f1111] text-[#f2efe7] focus-visible:border-[#c8ff62]"
							/>
						</Field>
							<Field label="TIN" error={errors.taxId}>
								<Input
								value={form.taxId}
								onChange={(event) =>
									updateField(
										"taxId",
										event.target.value.replace(/\D/g, "").slice(0, 10),
									)
								}
								placeholder="10-digit TIN"
								aria-invalid={Boolean(errors.taxId)}
								className={`rounded-md bg-[#0f1111] text-[#f2efe7] focus-visible:border-[#c8ff62] ${
									errors.taxId ? "border-[#c76f5b]" : "border-[#30352f]"
									}`}
								/>
							</Field>
							<Field label="CAC RC Number" error={errors.rcNumber}>
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
									className={`rounded-md bg-[#0f1111] text-[#f2efe7] focus-visible:border-[#c8ff62] ${
										errors.rcNumber ? "border-[#c76f5b]" : "border-[#30352f]"
									}`}
								/>
							</Field>
						<Field label="Default Currency" error={errors.defaultCurrency}>
							<Input
								value={form.defaultCurrency}
								onChange={(event) =>
									updateField(
										"defaultCurrency",
										event.target.value.toUpperCase().slice(0, 3),
									)
								}
								aria-invalid={Boolean(errors.defaultCurrency)}
								className={`rounded-md bg-[#0f1111] text-[#f2efe7] focus-visible:border-[#c8ff62] ${
									errors.defaultCurrency
										? "border-[#c76f5b]"
										: "border-[#30352f]"
								}`}
							/>
						</Field>
						<Field label="Payment Terms" error={errors.defaultPaymentTermsDays}>
							<Input
								type="number"
								min={1}
								value={form.defaultPaymentTermsDays}
								onChange={(event) =>
									updateField("defaultPaymentTermsDays", event.target.value)
								}
								className="rounded-md border-[#30352f] bg-[#0f1111] text-[#f2efe7] focus-visible:border-[#c8ff62]"
							/>
						</Field>
						<Field label="Invoice Naming" className="md:col-span-2">
							<div className="grid gap-2 sm:grid-cols-2">
								<button
									type="button"
									onClick={() => updateField("invoiceNumberMode", "prefix")}
									className={`rounded-md border px-3 py-3 text-left text-sm transition-colors ${
										form.invoiceNumberMode === "prefix"
											? "border-[#c8ff62] bg-[#1a2117] text-[#f2efe7]"
											: "border-[#30352f] bg-[#101211] text-[#aaa294] hover:bg-[#151817]"
									}`}
								>
									<span className="block font-medium">Use invoice prefix</span>
									<span className="mt-1 block text-xs text-[#817d72]">
										Keep generated numbers like INV-2026-000001.
									</span>
								</button>
								<button
									type="button"
									onClick={() =>
										updateField("invoiceNumberMode", "business_name")
									}
									className={`rounded-md border px-3 py-3 text-left text-sm transition-colors ${
										form.invoiceNumberMode === "business_name"
											? "border-[#c8ff62] bg-[#1a2117] text-[#f2efe7]"
											: "border-[#30352f] bg-[#101211] text-[#aaa294] hover:bg-[#151817]"
									}`}
								>
									<span className="block font-medium">Use business name</span>
									<span className="mt-1 block text-xs text-[#817d72]">
										Build generated numbers from the business name.
									</span>
								</button>
							</div>
						</Field>
						<Field label="Invoice Prefix" error={errors.invoiceNumberPrefix}>
							<Input
								value={form.invoiceNumberPrefix}
								disabled={form.invoiceNumberMode === "business_name"}
								onChange={(event) =>
									updateField(
										"invoiceNumberPrefix",
										event.target.value
											.toUpperCase()
											.replace(/[^A-Z0-9]/g, "")
											.slice(0, 12),
									)
								}
								className="rounded-md border-[#30352f] bg-[#0f1111] text-[#f2efe7] focus-visible:border-[#c8ff62]"
							/>
						</Field>
						<Field
							label="Next Invoice Number"
							error={errors.nextInvoiceSequence}
						>
							<Input
								type="number"
								min={1}
								value={form.nextInvoiceSequence}
								onChange={(event) =>
									updateField("nextInvoiceSequence", event.target.value)
								}
								className="rounded-md border-[#30352f] bg-[#0f1111] text-[#f2efe7] focus-visible:border-[#c8ff62]"
							/>
						</Field>
						<div className="md:col-span-2">
							<div className="rounded-md border border-[#c8ff62] bg-[#1a2117] px-4 py-3">
								<p className="text-xs font-medium uppercase tracking-[0.14em] text-[#c8ff62]">
									Next invoice number preview
								</p>
								<p className="mt-2 font-mono text-lg font-semibold text-[#f2efe7]">
									{invoicePreviewPrefix(form)}-{new Date().getFullYear()}-
									{String(Number(form.nextInvoiceSequence) || 1).padStart(
										4,
										"0",
									)}
								</p>
							</div>
						</div>
						<Field
							label="Business Address*"
							error={errors.address}
							className="md:col-span-2"
						>
							<Textarea
								value={form.address}
								onChange={(event) => updateField("address", event.target.value)}
								className="min-h-28 rounded-md border-[#30352f] bg-[#0f1111] text-[#f2efe7] focus-visible:border-[#c8ff62]"
							/>
						</Field>
						<Field
							label="Payment Details"
							error={errors.paymentDetails}
							className="md:col-span-2"
						>
							<Textarea
								value={form.paymentDetails}
								onChange={(event) =>
									updateField("paymentDetails", event.target.value)
								}
								placeholder={
									"Bank Name: Zenith Bank\nAccount Name: Velure Studio\nAccount Number: 0123456789"
								}
								className="min-h-28 rounded-md border-[#30352f] bg-[#0f1111] text-[#f2efe7] focus-visible:border-[#c8ff62]"
							/>
						</Field>
					</div>
				</div>

				<div className="flex flex-wrap justify-end gap-3 border-t border-[#30352f] px-5 py-4">
					<Button
						type="button"
						variant="outline"
						onClick={resetForm}
						className="h-10 rounded-md border-[#30352f] bg-transparent px-4 text-sm text-[#d8d1c4] hover:bg-[#20241f]"
					>
						Cancel
					</Button>
					<Button
						type="button"
						disabled={saving}
						onClick={() => {
							void saveChanges();
						}}
						className="h-10 rounded-md bg-[#c8ff62] px-4 text-sm font-medium text-[#0f1111] hover:bg-[#d5ff7a]"
					>
						{saving ? "Saving..." : "Save Changes"}
					</Button>
				</div>
			</section>

			<section className="ui-panel rounded-md border border-[#30352f] bg-[#151817]">
				<div className="border-b border-[#30352f] px-5 py-4">
					<h2 className="text-sm font-medium text-[#f2efe7]">Account info</h2>
				</div>
					<div className="grid gap-3 px-5 py-5 md:grid-cols-2">
						<ReadOnlyItem label="Member Since" value={memberSince} />
					<div className="rounded-md border border-[#30352f] bg-[#101211] px-4 py-3">
						<p className="text-xs text-[#aaa294]">Plan</p>
						<div className="mt-2 flex items-center justify-between gap-3">
							<span className="rounded-sm border border-[#c8ff62] bg-[#1a2117] px-2 py-1 text-xs font-medium text-[#c8ff62]">
								Free Plan
							</span>
							<Button
								asChild
								type="button"
								variant="outline"
								className="h-8 rounded-md border-[#30352f] bg-transparent px-3 text-xs text-[#d8d1c4] hover:bg-[#20241f]"
							>
								<Link to="/pricing">PRO</Link>
							</Button>
						</div>
					</div>
				</div>
			</section>

			<section className="rounded-md border border-[#30352f] bg-[#151817]">
				<div className="border-b border-[#30352f] px-5 py-4">
					<h2 className="text-sm font-medium text-[#f2efe7]">
						Backup and tax notes
					</h2>
				</div>
				<div className="grid gap-3 px-5 py-5 md:grid-cols-2">
					<div className="rounded-md border border-[#30352f] bg-[#101211] px-4 py-3">
						<p className="text-sm font-medium text-[#f2efe7]">
							Your data is yours.
						</p>
						<p className="mt-1 text-sm text-[#aaa294]">
							Export invoices as PDF or CSV anytime. Use Compliance exports for
							invoice CSV, tax summary CSV, and customer ledger CSV.
						</p>
					</div>
					<div className="rounded-md border border-[#30352f] bg-[#101211] px-4 py-3">
							<p className="text-sm font-medium text-[#f2efe7]">Tax disclaimer</p>
							<p className="mt-1 text-sm text-[#aaa294]">
								Velure helps structure invoice data for Nigerian finance
								workflows. Confirm VAT, WHT, and filing treatment with your
								accountant or tax advisor.
							</p>
					</div>
				</div>
			</section>

			<section className="rounded-md border border-[#5d4747] bg-[#151817]">
				<div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5">
					<div>
						<h2 className="text-sm font-medium text-[#efb1b1]">Danger Zone</h2>
						<p className="mt-1 text-sm text-[#aaa294]">
							Permanently remove this account.
						</p>
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
						<AlertDialogContent className="border-[#5d4747] bg-[#151817] text-[#f2efe7]">
							<AlertDialogHeader>
								<AlertDialogTitle className="text-[#efb1b1]">
									Delete account?
								</AlertDialogTitle>
								<AlertDialogDescription className="text-[#aaa294]">
									This cannot be undone. Your workspace, invoices, clients,
									exports, reminders, sessions, and sign-in records will be
									permanently deleted. Type DELETE to confirm.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<Input
								value={deleteConfirm}
								onChange={(event) => setDeleteConfirm(event.target.value)}
								placeholder="DELETE"
								className="rounded-md border-[#5d4747] bg-[#101211] text-[#f2efe7] placeholder:text-[#817d72] focus-visible:border-[#8a5a5a]"
							/>
							<AlertDialogFooter>
								<AlertDialogCancel
									disabled={deletingAccount}
									onClick={() => setDeleteConfirm("")}
									className="border-[#30352f] bg-transparent text-[#d8d1c4] hover:bg-[#20241f]"
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
			<span className="mb-2 block text-xs font-medium text-[#aaa294]">
				{label}
			</span>
			{children}
			{error ? (
				<span className="mt-2 block text-xs text-[#ef9a9a]">{error}</span>
			) : null}
		</div>
	);
}

function ReadOnlyItem({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-md border border-[#30352f] bg-[#101211] px-4 py-3">
			<p className="text-xs text-[#aaa294]">{label}</p>
			<p className="mt-2 truncate text-sm text-[#817d72]">{value}</p>
		</div>
	);
}
