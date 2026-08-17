import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import type { LucideIcon } from "lucide-react";
import {
	AlertTriangle,
	BadgePercent,
	BanknoteArrowDown,
	Download,
	FileWarning,
	ReceiptText,
	UsersRound,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { RowsEmptyGuard } from "#/components/ui/rows-empty-guard";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Skeleton } from "#/components/ui/skeleton";
import { Textarea } from "#/components/ui/textarea";
import { toast } from "#/components/ui/use-toast";
import {
	classifyNigeriaRuleSetVersion,
	formatNigerianDate,
	NIGERIA_AUTHORITY_LABEL,
	NIGERIA_TAX_RULE_SET_VERSION,
	NIGERIA_VAT_RATE,
	resolveNigeriaRuleSet,
	SELLER_TAX_STATUS_OPTIONS,
	WITHHOLDING_CATEGORY_OPTIONS,
} from "#/features/compliance/nigeria";
import { formatInvoiceDate, formatMoney } from "#/features/invoices/format";
import type { PeriodPreset } from "#/utils/date";
import { PERIOD_OPTIONS, resolvePeriod } from "#/utils/date";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

type ComplianceFormErrors = Partial<{
	taxId: string;
	rcNumber: string;
	baseCurrency: string;
	invoiceNumberPrefix: string;
	nextInvoiceSequence: string;
	defaultPaymentTermsDays: string;
	profileName: string;
	profileLabel: string;
	profileRate: string;
}>;

const WARNING_LABELS: Record<string, string> = {
	missing_seller_tax_id: "Missing seller TIN",
	missing_buyer_tax_id: "Missing buyer TIN",
	cross_border_review: "Cross-border review",
	reverse_charge_review: "Reverse charge review",
	unknown_jurisdiction: "Unknown jurisdiction",
	domestic_vat_not_applied: "Domestic VAT not applied",
	missing_workspace_tax_status: "Missing tax status",
	manual_tax_override: "Manual VAT override",
	manual_wht_override: "Manual WHT override",
	legacy_wht_mapping: "Legacy WHT mapping",
};

const DASHBOARD_SKELETON_KEYS = ["vat", "wht", "warnings", "exports"] as const;

function formatCount(value: number) {
	return new Intl.NumberFormat("en-NG").format(
		Number.isFinite(value) ? value : 0,
	);
}

function formatExportDate(value: number | null | undefined) {
	if (!value) return "No exports yet";
	return formatInvoiceDate(value);
}

function formatExportKind(value: string) {
	if (value === "invoices_csv") return "Invoice report";
	if (value === "tax_summary_csv") return "Tax summary";
	if (value === "customer_ledger_csv") return "Customer balance report";
	return value
		.split("_")
		.filter(Boolean)
		.map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
		.join(" ");
}

function formatExportDisplayName(record: { kind: string; createdAt?: number }) {
	const label = formatExportKind(record.kind);
	const date = formatExportDate(record.createdAt);
	return date === "No exports yet" ? label : `${label} - ${date}`;
}

function downloadExportContent(record: { fileName: string; content: string }) {
	const extension = record.fileName.split(".").pop()?.toLowerCase();
	const mimeType =
		extension === "json" ? "application/json" : "text/csv;charset=utf-8";
	const blob = new Blob([record.content], { type: mimeType });
	const url = window.URL.createObjectURL(blob);
	const link = document.createElement("a");

	link.href = url;
	link.download = record.fileName;
	document.body.appendChild(link);
	link.click();
	link.remove();
	window.URL.revokeObjectURL(url);
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
export const Route = createFileRoute("/settings/compliance")({
	beforeLoad: ({ context }) => {
		// Fire-and-forget: warm the cache without blocking the transition.
		void Promise.all([
			context.queryClient.prefetchQuery(
				convexQuery(api.compliance.getWorkspaceSettings, {}),
			),
			context.queryClient.prefetchQuery(
				convexQuery(api.compliance.listTaxProfiles, {}),
			),
			context.queryClient.prefetchQuery(
				convexQuery(api.compliance.listExportHistory, {}),
			),
		]).catch(() => undefined);
	},
	component: ComplianceSettingsPage,
});

function ComplianceSettingsPage() {
	const { data: workspace } = useQuery(
		convexQuery(api.compliance.getWorkspaceSettings, {}),
	);
	const [dashboardPeriod, setDashboardPeriod] =
		useState<PeriodPreset>("last-6-months");
	const [selectedDashboardCurrency, setSelectedDashboardCurrency] = useState<
		string | null
	>(null);
	const dashboardWindow = useMemo(
		() => resolvePeriod(dashboardPeriod),
		[dashboardPeriod],
	);
	const { data: complianceDashboard } = useQuery(
		convexQuery(api.compliance.getComplianceDashboard, {
			from: dashboardWindow.from,
			to: dashboardWindow.to,
			limit: 8,
		}),
	);
	const { data: taxProfilesRaw } = useQuery(
		convexQuery(api.compliance.listTaxProfiles, {}),
	);
	const taxProfiles = (taxProfilesRaw ?? []) as Array<{
		_id: string;
		name: string;
		label: string;
		taxTreatment: string;
		rate: number;
		isDefault: boolean;
	}>;
	const { data: exportsHistoryRaw } = useQuery(
		convexQuery(api.compliance.listExportHistory, {}),
	);
	const exportsHistory = (exportsHistoryRaw ?? []) as Array<{
		_id: Id<"invoice_exports">;
		kind: string;
		status: string;
		fileName: string;
		content: string;
		createdAt: number;
	}>;
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
	const ruleSetStatus = classifyNigeriaRuleSetVersion(form.taxRuleSetVersion);
	const effectiveRuleSet = resolveNigeriaRuleSet(form.taxRuleSetVersion);

	const visibleExports = exportsHistory.filter(
		(record) => record.kind !== "normalized_accounting",
	);
	const isDashboardLoading = complianceDashboard === undefined;
	const dashboardCurrencies =
		complianceDashboard?.currencySummaries.map((item) => item.currency) ?? [];
	const dashboardCurrency =
		selectedDashboardCurrency &&
		dashboardCurrencies.includes(selectedDashboardCurrency)
			? selectedDashboardCurrency
			: (complianceDashboard?.primaryCurrency.currency ?? "NGN");
	const dashboardSummary =
		complianceDashboard?.currencySummaries.find(
			(item) => item.currency === dashboardCurrency,
		) ??
		complianceDashboard?.primaryCurrency ??
		createEmptyDashboardSummary(dashboardCurrency);
	const dashboardMonthly =
		complianceDashboard?.monthly.filter(
			(item) => item.currency === dashboardCurrency,
		) ?? [];
	const dashboardCustomers =
		complianceDashboard?.customerContexts.filter(
			(item) => item.currency === dashboardCurrency,
		) ?? [];
	const dashboardReviewInvoices =
		complianceDashboard?.invoicesNeedingReview.filter(
			(item) => item.currency === dashboardCurrency,
		) ?? [];

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
				(workspace as { sellerTaxStatus?: string }).sellerTaxStatus ??
				"vat_registered",
			taxRuleSetVersion:
				(workspace as { taxRuleSetVersion?: string }).taxRuleSetVersion ??
				NIGERIA_TAX_RULE_SET_VERSION,
			atrsEnvironment:
				(workspace as { atrs?: { environment?: string } }).atrs?.environment ??
				"sandbox",
			atrsCredentialsConfigured:
				(workspace as { atrs?: { credentialsConfigured?: boolean } }).atrs
					?.credentialsConfigured ?? false,
			reminderSignature: workspace.reminderSignature ?? "Velure Finance Team",
			remindersEnabled: workspace.remindersEnabled,
			logoUrl: workspace.logoUrl ?? "",
			paymentDetails: workspace.paymentDetails ?? "",
			defaultPaymentTermsDays: workspace.defaultPaymentTermsDays ?? 14,
			invoiceNumberPrefix: workspace.invoiceNumberPrefix ?? "INV",
			nextInvoiceSequence: workspace.nextInvoiceSequence ?? 1,
		});
	}, [workspace]);

	return (
		<div className="mx-auto max-w-6xl space-y-6">
			<div>
				<h1 className="text-3xl font-semibold tracking-[-0.02em] text-ink">
					Compliance
				</h1>
				<p className="mt-2 text-sm text-ink-3">
					Keep business identity, Nigeria VAT settings, WHT notes, and
					accountant-ready exports in one place.
				</p>
			</div>

			<section className="rounded-md border border-rule bg-paper-2 p-5">
				<div className="flex flex-col gap-4 border-b border-rule pb-5 lg:flex-row lg:items-end lg:justify-between">
					<div>
						<p className="text-[11px] font-bold uppercase tracking-[0.22em] text-brand">
							Nigerian compliance dashboard
						</p>
						<h2 className="mt-2 text-2xl font-semibold tracking-normal text-ink">
							VAT, WHT, and review visibility
						</h2>
						<p className="mt-2 max-w-3xl text-sm leading-6 text-ink-3">
							Informational summary from workspace invoices and exports. Use it
							to prepare accountant review, not to file taxes directly.
						</p>
					</div>

					<div className="flex flex-col gap-3 sm:flex-row">
						<Select
							value={dashboardPeriod}
							onValueChange={(value) =>
								setDashboardPeriod(value as PeriodPreset)
							}
						>
							<SelectTrigger className="h-10 w-full rounded-md border-rule bg-paper text-ink sm:w-[170px]">
								<SelectValue />
							</SelectTrigger>
							<SelectContent className="border-rule bg-paper-2 text-ink">
								{PERIOD_OPTIONS.map((item) => (
									<SelectItem key={item.value} value={item.value}>
										{item.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Select
							value={dashboardCurrency}
							onValueChange={(value) => setSelectedDashboardCurrency(value)}
							disabled={dashboardCurrencies.length <= 1}
						>
							<SelectTrigger className="h-10 w-full rounded-md border-rule bg-paper text-ink sm:w-[120px]">
								<SelectValue />
							</SelectTrigger>
							<SelectContent className="border-rule bg-paper-2 text-ink">
								{(dashboardCurrencies.length > 0
									? dashboardCurrencies
									: [dashboardCurrency]
								).map((item) => (
									<SelectItem key={item} value={item}>
										{item}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>

				{isDashboardLoading ? (
					<ComplianceDashboardSkeleton />
				) : (
					<div className="mt-5 space-y-4">
						<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
							<DashboardMetric
								icon={BadgePercent}
								label="VAT summary"
								value={formatMoney(
									dashboardSummary.vatAmount,
									dashboardCurrency,
								)}
								detail={`${formatCount(dashboardSummary.taxableInvoiceCount)} taxable invoices`}
								tone="brand"
							/>
							<DashboardMetric
								icon={BanknoteArrowDown}
								label="WHT deductions"
								value={formatMoney(
									dashboardSummary.whtAmount,
									dashboardCurrency,
								)}
								detail={`${formatMoney(dashboardSummary.netPayable, dashboardCurrency)} net payable`}
								tone="amber"
							/>
							<DashboardMetric
								icon={FileWarning}
								label="Review flags"
								value={formatCount(dashboardSummary.warningCount)}
								detail={`${formatCount(dashboardSummary.manualOverrideCount)} manual overrides`}
								tone="rose"
							/>
							<DashboardMetric
								icon={Download}
								label="Exports"
								value={formatCount(
									complianceDashboard?.exports.readyCount ?? 0,
								)}
								detail={formatExportDate(
									complianceDashboard?.exports.lastGeneratedAt,
								)}
								tone="cyan"
							/>
						</div>

						<div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
							<DashboardPanel
								title="Monthly obligations"
								label={`${formatInvoiceDate(dashboardWindow.from)} - ${formatInvoiceDate(dashboardWindow.to)}`}
							>
								<RowsEmptyGuard show={dashboardMonthly.length === 0}>
									<div className="overflow-x-auto">
										<table className="w-full min-w-[620px] text-left text-sm">
											<thead className="border-b border-rule text-xs uppercase tracking-[0.08em] text-ink-3">
												<tr>
													<th className="py-3 pr-4 font-medium">Month</th>
													<th className="py-3 pr-4 text-right font-medium">
														VAT
													</th>
													<th className="py-3 pr-4 text-right font-medium">
														WHT
													</th>
													<th className="py-3 pr-4 text-right font-medium">
														Invoices
													</th>
													<th className="py-3 text-right font-medium">Flags</th>
												</tr>
											</thead>
											<tbody className="divide-y divide-rule">
												{dashboardMonthly.map((month) => (
													<tr
														key={`${month.currency}:${month.key}`}
														className="text-ink-2"
													>
														<td className="py-3 pr-4 font-medium text-ink">
															{month.label}
														</td>
														<td className="py-3 pr-4 text-right">
															{formatMoney(month.vatAmount, dashboardCurrency)}
														</td>
														<td className="py-3 pr-4 text-right">
															{formatMoney(month.whtAmount, dashboardCurrency)}
														</td>
														<td className="py-3 pr-4 text-right">
															{formatCount(month.invoiceCount)}
														</td>
														<td className="py-3 text-right">
															{formatCount(month.warningCount)}
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</RowsEmptyGuard>
							</DashboardPanel>

							<DashboardPanel title="Warning mix" label="Current period">
								<RowsEmptyGuard
									show={(complianceDashboard?.warnings.length ?? 0) === 0}
								>
									<div className="divide-y divide-rule">
										{(complianceDashboard?.warnings ?? []).map((warning) => (
											<DashboardRow
												key={warning.code}
												icon={AlertTriangle}
												name={WARNING_LABELS[warning.code] ?? warning.code}
												primary={formatCount(warning.count)}
												secondary="invoices"
												tone="rose"
											/>
										))}
									</div>
								</RowsEmptyGuard>
							</DashboardPanel>
						</div>

						<div className="grid gap-4 xl:grid-cols-3">
							<DashboardPanel title="Client context" label={dashboardCurrency}>
								<RowsEmptyGuard show={dashboardCustomers.length === 0}>
									<div className="divide-y divide-rule">
										{dashboardCustomers.map((customer) => (
											<DashboardRow
												key={`${customer.currency}:${customer.customerName}`}
												icon={UsersRound}
												name={customer.customerName}
												primary={formatMoney(
													customer.vatAmount + customer.whtAmount,
													dashboardCurrency,
												)}
												secondary={`${formatCount(customer.warningCount)} flags`}
												meta={`${formatCount(customer.invoiceCount)} invoices`}
												tone="brand"
											/>
										))}
									</div>
								</RowsEmptyGuard>
							</DashboardPanel>

							<DashboardPanel title="Needs review" label="Invoices">
								<RowsEmptyGuard show={dashboardReviewInvoices.length === 0}>
									<div className="divide-y divide-rule">
										{dashboardReviewInvoices.map((invoice) => (
											<DashboardRow
												key={invoice.id}
												icon={ReceiptText}
												name={invoice.invoiceNumber}
												primary={invoice.customerName}
												secondary={`${formatCount(invoice.warnings.length)} flags`}
												meta={formatInvoiceDate(invoice.issueDate)}
												tone="amber"
											/>
										))}
									</div>
								</RowsEmptyGuard>
							</DashboardPanel>

							<DashboardPanel title="Export audit" label="Recent">
								<RowsEmptyGuard
									show={(complianceDashboard?.exports.recent.length ?? 0) === 0}
								>
									<div className="divide-y divide-rule">
										{(complianceDashboard?.exports.recent ?? []).map(
											(record) => (
												<DashboardRow
													key={record.id}
													icon={Download}
													name={formatExportDisplayName(record)}
													primary={record.status}
													secondary={formatExportKind(record.kind)}
													meta={formatExportDate(record.createdAt)}
													tone="cyan"
												/>
											),
										)}
									</div>
								</RowsEmptyGuard>
							</DashboardPanel>
						</div>
					</div>
				)}
			</section>

			<section className="rounded-md border border-rule bg-paper-2 p-5">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h2 className="text-sm font-medium text-ink">Business identity</h2>
						<p className="mt-1 max-w-2xl text-xs leading-5 text-ink-3">
							Read-only here. Edit business identity, invoice defaults, and
							payment details from General Settings.
						</p>
					</div>
					<Button
						asChild
						type="button"
						variant="outline"
						className="h-9 rounded-md border-rule bg-transparent px-3 text-xs text-ink-2 hover:bg-paper-3"
					>
						<Link to="/settings">Edit in General Settings</Link>
					</Button>
				</div>
				<div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
					<ReadOnlyComplianceItem label="Workspace" value={form.name} />
					<ReadOnlyComplianceItem
						label="Registered name"
						value={form.legalName || form.name}
					/>
					<ReadOnlyComplianceItem label="Finance email" value={form.email} />
					<ReadOnlyComplianceItem label="Phone" value={form.phone} />
					<ReadOnlyComplianceItem label="TIN" value={form.taxId} />
					<ReadOnlyComplianceItem label="CAC RC Number" value={form.rcNumber} />
					<ReadOnlyComplianceItem
						label="Base currency"
						value={form.baseCurrency}
					/>
					<ReadOnlyComplianceItem
						label="Seller tax status"
						value={
							SELLER_TAX_STATUS_OPTIONS.find(
								(option) => option.value === form.sellerTaxStatus,
							)?.label ?? form.sellerTaxStatus
						}
					/>
				</div>
				<div className="mt-3 grid gap-3 lg:grid-cols-3">
					<ReadOnlyComplianceItem
						label="Registered address"
						value={form.address}
						className="lg:col-span-2"
					/>
					<ReadOnlyComplianceItem
						label="Invoice defaults"
						value={`${form.invoiceNumberPrefix || "INV"} / next ${form.nextInvoiceSequence} / ${form.defaultPaymentTermsDays} days`}
					/>
					<ReadOnlyComplianceItem
						label="Payment details"
						value={form.paymentDetails}
						className="lg:col-span-3"
					/>
				</div>
				<p className="mt-3 text-xs text-ink-3">
					CSV exports are for spreadsheets and accountants. Connected accounting
					apps will be added later.
				</p>
				<p className="mt-1 text-xs text-ink-3">
					Velure helps structure invoice data for Nigerian finance workflows.
					Confirm VAT, WHT, and filing treatment with your accountant or tax
					advisor.
				</p>
				<p className="mt-1 text-xs text-brand">
					{NIGERIA_AUTHORITY_LABEL} is now the federal revenue authority.
					Standard VAT remains {NIGERIA_VAT_RATE}% for taxable supplies where
					VAT applies.
				</p>
			</section>

			<section className="rounded-md border border-rule bg-paper-2 p-5">
				<div>
					<h2 className="text-sm font-medium text-ink">Tax settings</h2>
					<p className="mt-1 max-w-2xl text-xs leading-5 text-ink-3">
						Use VAT settings for invoice display. Use WHT fields only when a
						customer deducts tax at source or your accountant asks you to show
						expected deductions.
					</p>
				</div>
				{ruleSetStatus !== "current" ? (
					<div
						className={`mt-3 rounded-md border px-4 py-3 text-xs leading-5 ${
							ruleSetStatus === "unknown"
								? "border-danger-line/35 bg-danger-soft text-danger"
								: "border-warn-line/35 bg-warn-soft text-warn"
						}`}
					>
						{ruleSetStatus === "legacy_alias" ? (
							<p>
								This workspace still stores the legacy rule-set id{" "}
								<span className="font-medium">{form.taxRuleSetVersion}</span>.
								It resolves to the current rules and is normalized on the next
								settings save.
							</p>
						) : ruleSetStatus === "superseded" ? (
							<p>
								This workspace is pinned to the superseded rule set{" "}
								<span className="font-medium">{form.taxRuleSetVersion}</span>.
								Review whether new invoices should use the current rules.
							</p>
						) : (
							<p>
								This workspace stores the unrecognized rule-set version{" "}
								<span className="font-medium">{form.taxRuleSetVersion}</span>.
								Verify it in General Settings before relying on computed taxes.
							</p>
						)}
					</div>
				) : null}
				<div className="mt-4 grid gap-3 md:grid-cols-2">
					<div className="rounded-md border border-rule bg-paper px-4 py-3">
						<p className="text-sm font-medium text-ink">VAT profile</p>
						<p className="mt-1 text-xs text-ink-3">
							Nigeria standard VAT is {NIGERIA_VAT_RATE}% for taxable supplies.
							Businesses below registration threshold or exempt supplies should
							not charge VAT by default.
						</p>
					</div>
					<div className="rounded-md border border-rule bg-paper px-4 py-3">
						<p className="text-sm font-medium text-ink">WHT deduction</p>
						<p className="mt-1 text-xs text-ink-3">
							WHT is not an extra charge. It is usually deducted by the paying
							customer and remitted to the tax authority under category-based
							deduction rules.
						</p>
					</div>
				</div>
				<div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					<Input
						value={profileForm.name}
						onChange={(event) => {
							setProfileForm((current) => ({
								...current,
								name: event.target.value,
							}));
							setErrors((current) => ({ ...current, profileName: undefined }));
						}}
						placeholder="Profile name"
						aria-invalid={Boolean(errors.profileName)}
						className={`${errors.profileName ? "border-danger" : "border-rule"} bg-paper`}
					/>
					<Input
						value={profileForm.label}
						onChange={(event) => {
							setProfileForm((current) => ({
								...current,
								label: event.target.value,
							}));
							setErrors((current) => ({ ...current, profileLabel: undefined }));
						}}
						placeholder="Tax label"
						aria-invalid={Boolean(errors.profileLabel)}
						className={`${errors.profileLabel ? "border-danger" : "border-rule"} bg-paper`}
					/>
					<Input
						type="number"
						step="0.5"
						value={profileForm.rate}
						onChange={(event) => {
							setProfileForm((current) => ({
								...current,
								rate: Number(event.target.value) || 0,
							}));
							setErrors((current) => ({ ...current, profileRate: undefined }));
						}}
						placeholder="Rate"
						aria-invalid={Boolean(errors.profileRate)}
						className={`${errors.profileRate ? "border-danger" : "border-rule"} bg-paper`}
					/>
				</div>
				{errors.profileName || errors.profileLabel || errors.profileRate ? (
					<div className="mt-3 space-y-1 text-xs text-danger">
						{errors.profileName ? <p>{errors.profileName}</p> : null}
						{errors.profileLabel ? <p>{errors.profileLabel}</p> : null}
						{errors.profileRate ? <p>{errors.profileRate}</p> : null}
					</div>
				) : null}
				<Textarea
					value={profileForm.notes}
					onChange={(event) =>
						setProfileForm((current) => ({
							...current,
							notes: event.target.value,
						}))
					}
					placeholder="Notes"
					className="mt-4 border-rule bg-paper"
				/>
				<div className="mt-4 flex flex-wrap gap-3">
					<Button
						type="button"
						onClick={async () => {
							const nextErrors = validateTaxProfile(profileForm);
							setErrors((current) => ({ ...current, ...nextErrors }));
							if (Object.keys(nextErrors).length > 0) return;
							await saveTaxProfile({
								name: profileForm.name,
								jurisdictionCode: profileForm.jurisdictionCode as
									| "NG"
									| "NGN"
									| "GH"
									| "KE"
									| "ZA"
									| "US"
									| "GB"
									| "EU"
									| "OTHER",
								taxTreatment: profileForm.taxTreatment as
									| "none"
									| "exclusive_rate"
									| "inclusive_rate"
									| "reverse_charge"
									| "exempt"
									| "zero_rated",
								rate: profileForm.rate,
								label: profileForm.label,
								isDefault: profileForm.isDefault,
								active: profileForm.active,
								notes: profileForm.notes || undefined,
							});
							toast({ title: "Tax profile saved", variant: "success" });
						}}
						className="bg-brand text-brand-ink hover:bg-brand-hi"
					>
						Save VAT profile
					</Button>
					<Button
						type="button"
						variant="outline"
						className="border-rule bg-transparent"
						onClick={async () => {
							const result = await createExport({ kind: "tax_summary_csv" });
							downloadExportContent(result);
							toast({
								title: "Tax summary generated",
								description: "Download started.",
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
							className="rounded-md border border-rule bg-paper px-4 py-3"
						>
							<div className="flex items-center justify-between gap-3">
								<div>
									<p className="text-sm font-medium text-ink">{profile.name}</p>
									<p className="text-xs text-ink-3">
										{profile.label} • {profile.taxTreatment} • {profile.rate}%
									</p>
								</div>
								{profile.isDefault ? (
									<span className="text-xs text-brand">Default</span>
								) : null}
							</div>
						</div>
					))}
				</div>

				<div className="mt-6">
					<div className="rounded-md border border-rule bg-paper px-4 py-3">
						<div className="flex flex-wrap items-baseline justify-between gap-2">
							<p className="text-sm font-medium text-ink">
								{effectiveRuleSet.label}
							</p>
							<span className="text-xs text-ink-3">{effectiveRuleSet.id}</span>
						</div>
						<p className="mt-1 text-xs text-ink-3">
							{effectiveRuleSet.authority} • effective{" "}
							{formatNigerianDate(effectiveRuleSet.effectiveFrom)}
						</p>
						<p className="mt-1 text-xs text-ink-3">
							Standard VAT is {effectiveRuleSet.vatRate}% for taxable supplies.
							WHT rates below are deducted at source by the paying customer.
						</p>
					</div>
					<div className="mt-3 overflow-x-auto rounded-md border border-rule bg-paper">
						<table className="w-full min-w-[560px] text-left text-sm">
							<thead className="border-b border-rule text-xs uppercase tracking-[0.08em] text-ink-3">
								<tr>
									<th className="py-2.5 pl-4 pr-4 font-medium">WHT category</th>
									<th className="py-2.5 pr-4 text-right font-medium">
										Resident
									</th>
									<th className="py-2.5 pr-4 text-right font-medium">
										Non-resident
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-rule">
								{WITHHOLDING_CATEGORY_OPTIONS.map((option) => {
									const table = effectiveRuleSet.withholdingRates[option.value];
									return (
										<tr key={option.value} className="text-ink-2">
											<td className="py-2.5 pl-4 pr-4">
												<p className="font-medium text-ink">{option.label}</p>
												<p className="mt-0.5 text-xs text-ink-3">
													{option.description}
												</p>
											</td>
											<td className="py-2.5 pr-4 text-right">
												{table.resident}%
											</td>
											<td className="py-2.5 pr-4 text-right">
												{table.nonResident}%
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
					<p className="mt-3 text-xs text-ink-3">
						Rule sets are versioned. {NIGERIA_AUTHORITY_LABEL} changes are
						applied by adding a new rule set; invoices keep the rule set they
						were computed under.
					</p>
				</div>
			</section>

			<section className="rounded-md border border-rule bg-paper-2 p-5">
				<div className="grid gap-4 xl:grid-cols-[1fr_auto] xl:items-start">
					<div>
						<h2 className="text-sm font-medium text-ink">Exports</h2>
						<p className="mt-1 text-sm text-ink-3">
							Your data is yours. Export invoices as PDF or CSV anytime.
							Downloadable CSV reports cover invoicing, customer balances, and
							tax review.
						</p>
					</div>
					<div className="flex flex-wrap gap-2 xl:w-[430px] xl:justify-end">
						<Button
							type="button"
							variant="outline"
							className="h-10 min-w-[190px] rounded-md border-rule bg-paper px-3 text-xs font-semibold tracking-[0.02em] text-ink-2 hover:bg-paper-3 hover:text-ink"
							onClick={async () => {
								const result = await createExport({ kind: "invoices_csv" });
								downloadExportContent(result);
								toast({
									title: "Invoice report generated",
									description: "Download started.",
									variant: "success",
								});
							}}
						>
							Invoice CSV
						</Button>
						<Button
							type="button"
							variant="outline"
							className="h-10 min-w-[190px] rounded-md border-rule bg-paper px-3 text-xs font-semibold tracking-[0.02em] text-ink-2 hover:bg-paper-3 hover:text-ink"
							onClick={async () => {
								const result = await createExport({
									kind: "customer_ledger_csv",
								});
								downloadExportContent(result);
								toast({
									title: "Customer balance report generated",
									description: "Download started.",
									variant: "success",
								});
							}}
						>
							Customer ledger
						</Button>
					</div>
				</div>
				<div className="mt-3 grid gap-3 md:grid-cols-2">
					<div className="rounded-md border border-rule bg-paper px-4 py-3">
						<p className="text-sm font-medium text-ink">Invoice list CSV</p>
						<p className="mt-1 text-xs text-ink-3">
							One row per invoice with totals, due dates, status, and tax
							amounts.
						</p>
					</div>
					<div className="rounded-md border border-rule bg-paper px-4 py-3">
						<p className="text-sm font-medium text-ink">Customer balance CSV</p>
						<p className="mt-1 text-xs text-ink-3">
							A customer-focused ledger showing invoice history and outstanding
							amounts.
						</p>
					</div>
				</div>

				<div className="mt-4 space-y-3">
					{visibleExports.map((record) => (
						<div
							key={record._id}
							className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-rule bg-paper px-4 py-3"
						>
							<div>
								<p className="text-sm font-medium text-ink">
									{formatExportDisplayName(record)}
								</p>
								<p className="text-xs text-ink-3">
									{formatExportKind(record.kind)} • {record.status} •{" "}
									{record.fileName}
								</p>
							</div>
							<div className="flex gap-2">
								<Button
									type="button"
									variant="outline"
									className="border-rule bg-transparent"
									onClick={() => downloadExportContent(record)}
								>
									Download
								</Button>
								<Button
									type="button"
									variant="outline"
									className="border-rule bg-transparent"
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
						<div className="rounded-md border border-dashed border-rule bg-paper px-4 py-6 text-sm text-ink-3">
							No downloadable exports yet. Generate an invoice list, customer
							balance report, or tax summary.
						</div>
					) : null}
				</div>
			</section>
		</div>
	);
}

function createEmptyDashboardSummary(currency: string) {
	return {
		currency,
		invoiceCount: 0,
		taxableInvoiceCount: 0,
		taxableBase: 0,
		vatAmount: 0,
		whtAmount: 0,
		grossAmount: 0,
		netPayable: 0,
		warningCount: 0,
		manualOverrideCount: 0,
		missingBuyerTaxIdCount: 0,
	};
}

function ReadOnlyComplianceItem({
	label,
	value,
	className = "",
}: {
	label: string;
	value?: string | number | null;
	className?: string;
}) {
	const displayValue =
		value === undefined || value === null || String(value).trim().length === 0
			? "Not set"
			: String(value);

	return (
		<div
			className={`rounded-md border border-rule bg-paper px-4 py-3 ${className}`}
		>
			<p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-3">
				{label}
			</p>
			<p className="mt-2 whitespace-pre-wrap text-sm text-ink">
				{displayValue}
			</p>
		</div>
	);
}

function DashboardMetric({
	icon: Icon,
	label,
	value,
	detail,
	tone = "brand",
}: {
	icon: LucideIcon;
	label: string;
	value: string;
	detail: string;
	tone?: "brand" | "amber" | "rose" | "cyan";
}) {
	const toneClass = {
		brand: "border-brand/35 bg-brand-soft text-brand",
		amber: "border-warn-line/35 bg-warn-soft text-warn",
		rose: "border-danger-line/35 bg-danger-soft text-danger",
		cyan: "border-info-line/35 bg-info-soft text-info",
	}[tone];

	return (
		<div className="rounded-md border border-rule bg-paper p-4">
			<div className="flex items-center justify-between gap-3">
				<p className="text-xs font-medium uppercase tracking-[0.1em] text-ink-3">
					{label}
				</p>
				<span
					className={`flex h-8 w-8 items-center justify-center border ${toneClass}`}
				>
					<Icon className="h-4 w-4" />
				</span>
			</div>
			<p className="mt-4 truncate text-2xl font-semibold tracking-normal text-ink">
				{value}
			</p>
			<p className="mt-2 text-sm text-ink-3">{detail}</p>
		</div>
	);
}

function DashboardPanel({
	title,
	label,
	children,
}: {
	title: string;
	label: string;
	children: ReactNode;
}) {
	return (
		<section className="rounded-md border border-rule bg-paper">
			<div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
				<h3 className="text-sm font-semibold text-ink">{title}</h3>
				<span className="text-xs font-medium uppercase tracking-[0.08em] text-ink-3">
					{label}
				</span>
			</div>
			<div className="p-4">{children}</div>
		</section>
	);
}

function DashboardRow({
	icon: Icon,
	name,
	primary,
	secondary,
	meta,
	tone = "brand",
}: {
	icon: LucideIcon;
	name: string;
	primary: string;
	secondary: string;
	meta?: string;
	tone?: "brand" | "amber" | "rose" | "cyan";
}) {
	const toneClass = {
		brand: "border-brand/35 bg-brand-soft text-brand",
		amber: "border-warn-line/35 bg-warn-soft text-warn",
		rose: "border-danger-line/35 bg-danger-soft text-danger",
		cyan: "border-info-line/35 bg-info-soft text-info",
	}[tone];

	return (
		<div className="flex items-center gap-3 py-3">
			<span
				className={`flex h-9 w-9 shrink-0 items-center justify-center border ${toneClass}`}
			>
				<Icon className="h-4 w-4" />
			</span>
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-medium text-ink">{name}</p>
				{meta ? <p className="mt-1 text-xs text-ink-3">{meta}</p> : null}
			</div>
			<div className="max-w-[48%] text-right">
				<p className="truncate text-sm font-semibold text-ink">{primary}</p>
				<p className="mt-1 truncate text-xs text-ink-3">{secondary}</p>
			</div>
		</div>
	);
}

function ComplianceDashboardSkeleton() {
	return (
		<div className="mt-5 space-y-4">
			<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
				{DASHBOARD_SKELETON_KEYS.map((key) => (
					<Skeleton key={key} className="h-32 rounded-md bg-paper-3" />
				))}
			</div>
			<div className="grid gap-4 xl:grid-cols-2">
				<Skeleton className="h-72 rounded-md bg-paper-3" />
				<Skeleton className="h-72 rounded-md bg-paper-3" />
			</div>
		</div>
	);
}
