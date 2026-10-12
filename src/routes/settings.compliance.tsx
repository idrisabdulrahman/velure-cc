import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
	AlertTriangle,
	Download,
	ReceiptText,
	Search,
	UsersRound,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Kpi, KpiStrip } from "#/components/redesign/kpi-strip";
import { Panel } from "#/components/redesign/panel";
import { StatusPill } from "#/components/redesign/status-pill";
import { Tabs } from "#/components/redesign/tabs";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Progress } from "#/components/ui/progress";
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
import { useUnifiedAuth } from "#/lib/auth-hook";
import { useSupabaseSession } from "#/lib/supabase-session";
import {
	createInvoiceExport,
	getComplianceDashboard,
	getWorkspaceSettings,
	listExportHistory,
	listTaxProfiles,
	retryInvoiceExport,
	saveTaxProfile as saveTaxProfileData,
} from "#/server/data/compliance";
import type { PeriodPreset } from "#/utils/date";
import { PERIOD_OPTIONS, resolvePeriod } from "#/utils/date";

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

type ComplianceTab = "overview" | "tax" | "exports" | "identity";

function exportStatusTone(status: string): "ok" | "warn" | "bad" | "mute" {
	const normalized = status.toLowerCase();
	if (normalized === "ready" || normalized === "completed") return "ok";
	if (normalized === "failed" || normalized === "error") return "bad";
	if (
		normalized === "pending" ||
		normalized === "processing" ||
		normalized === "queued"
	)
		return "warn";
	return "mute";
}

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
	component: ComplianceSettingsPage,
});

function ComplianceSettingsPage() {
	const auth = useUnifiedAuth();
	const { client, velureUserId } = useSupabaseSession(auth.data?.user.id);
	const enabled = Boolean(client && velureUserId);
	const { data: workspace } = useQuery({
		queryKey: ["compliance-workspace", velureUserId],
		queryFn: () => getWorkspaceSettings(client!, velureUserId!),
		enabled,
	});
	const [dashboardPeriod, setDashboardPeriod] =
		useState<PeriodPreset>("last-6-months");
	const [selectedDashboardCurrency, setSelectedDashboardCurrency] = useState<
		string | null
	>(null);
	const [activeTab, setActiveTab] = useState<ComplianceTab>("overview");
	const [whtQuery, setWhtQuery] = useState("");
	const dashboardWindow = useMemo(
		() => resolvePeriod(dashboardPeriod),
		[dashboardPeriod],
	);
	const { data: complianceDashboard } = useQuery({
		queryKey: ["compliance-dashboard", velureUserId, dashboardWindow],
		queryFn: () =>
			getComplianceDashboard(client!, velureUserId!, {
				from: dashboardWindow.from,
				to: dashboardWindow.to,
				limit: 8,
			}),
		enabled,
	});
	const { data: taxProfilesRaw } = useQuery({
		queryKey: ["compliance-tax-profiles", velureUserId],
		queryFn: () => listTaxProfiles(client!, velureUserId!),
		enabled,
	});
	const taxProfiles = (taxProfilesRaw ?? []) as Array<{
		_id: string;
		name: string;
		label: string;
		taxTreatment: string;
		rate: number;
		isDefault: boolean;
	}>;
	const { data: exportsHistoryRaw } = useQuery({
		queryKey: ["compliance-exports", velureUserId],
		queryFn: () => listExportHistory(client!, velureUserId!),
		enabled,
	});
	const exportsHistory = (exportsHistoryRaw ?? []) as Array<{
		_id: string;
		kind: string;
		status: string;
		fileName: string;
		content: string;
		createdAt: number;
	}>;
	const saveTaxProfile = (input: Parameters<typeof saveTaxProfileData>[2]) =>
		saveTaxProfileData(client!, velureUserId!, input);
	const createExport = ({
		kind,
	}: {
		kind: Parameters<typeof createInvoiceExport>[2];
	}) => createInvoiceExport(client!, velureUserId!, kind);
	const retryExport = ({ id }: { id: string }) =>
		retryInvoiceExport(client!, velureUserId!, id);

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
	const whtFilter = whtQuery.trim().toLowerCase();
	const filteredWithholdingOptions = WITHHOLDING_CATEGORY_OPTIONS.filter(
		(option) =>
			whtFilter.length === 0 ||
			`${option.label} ${option.description}`.toLowerCase().includes(whtFilter),
	);
	const identityFields = [
		form.name,
		form.legalName || form.name,
		form.email,
		form.phone,
		form.taxId,
		form.rcNumber,
		form.baseCurrency,
		form.sellerTaxStatus,
	];
	const identityCompleteCount = identityFields.filter(
		(field) => String(field ?? "").trim().length > 0,
	).length;
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
			<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
				<div>
					<h1 className="text-3xl font-semibold tracking-[-0.02em] text-ink">
						Compliance
					</h1>
					<p className="mt-2 max-w-2xl text-sm text-ink-3">
						Keep business identity, Nigeria VAT settings, WHT notes, and
						accountant-ready exports in one place. Informational only: use it to
						prepare for accountant review, not to file taxes directly.
					</p>
				</div>
				<div className="flex flex-col gap-3 sm:flex-row">
					<Select
						value={dashboardPeriod}
						onValueChange={(value) => setDashboardPeriod(value as PeriodPreset)}
					>
						<SelectTrigger
							aria-label="Period"
							className="h-10 w-full rounded-md border-rule bg-paper text-ink sm:w-[170px]"
						>
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
						<SelectTrigger
							aria-label="Currency"
							className="h-10 w-full rounded-md border-rule bg-paper text-ink sm:w-[120px]"
						>
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
				<KpiStrip>
					<Kpi
						label="VAT summary"
						value={formatMoney(dashboardSummary.vatAmount, dashboardCurrency)}
						sub={`${formatCount(dashboardSummary.taxableInvoiceCount)} taxable invoices`}
						tone="brand"
					/>
					<Kpi
						label="WHT deductions"
						value={formatMoney(dashboardSummary.whtAmount, dashboardCurrency)}
						sub={`${formatMoney(dashboardSummary.netPayable, dashboardCurrency)} net payable`}
						tone="warn"
					/>
					<Kpi
						label="Review flags"
						value={formatCount(dashboardSummary.warningCount)}
						sub={`${formatCount(dashboardSummary.manualOverrideCount)} manual overrides`}
						tone="danger"
					/>
					<Kpi
						label="Exports"
						value={formatCount(complianceDashboard?.exports.readyCount ?? 0)}
						sub={formatExportDate(complianceDashboard?.exports.lastGeneratedAt)}
						tone="info"
					/>
				</KpiStrip>
			)}

			<Tabs
				value={activeTab}
				onChange={(value) => setActiveTab(value as ComplianceTab)}
				tabs={[
					{ value: "overview", label: "Overview" },
					{ value: "tax", label: "Tax settings" },
					{
						value: "exports",
						label: "Exports",
						count: formatCount(visibleExports.length),
					},
					{ value: "identity", label: "Business identity" },
				]}
			/>

			{activeTab === "overview" ? (
				<section aria-label="Overview">
					<div className="flex flex-col gap-4">
						<div>
							<p className="text-[11px] font-bold uppercase tracking-[0.22em] text-brand">
								Nigerian compliance dashboard
							</p>
							<h2 className="mt-2 text-2xl font-semibold tracking-normal text-ink">
								VAT, WHT, and review visibility
							</h2>
							<p className="mt-2 max-w-3xl text-sm leading-6 text-ink-3">
								Informational summary from workspace invoices and exports. Use
								it to prepare accountant review, not to file taxes directly.
							</p>
						</div>
					</div>

					{isDashboardLoading ? (
						<ComplianceDashboardSkeleton />
					) : (
						<div className="mt-5 space-y-4">
							<div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
								<Panel
									title="Monthly obligations"
									sub={`${formatInvoiceDate(dashboardWindow.from)} - ${formatInvoiceDate(dashboardWindow.to)}`}
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
														<th className="py-3 text-right font-medium">
															Flags
														</th>
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
															<td className="py-3 pr-4 text-right font-num tabular-nums">
																{formatMoney(
																	month.vatAmount,
																	dashboardCurrency,
																)}
															</td>
															<td className="py-3 pr-4 text-right font-num tabular-nums">
																{formatMoney(
																	month.whtAmount,
																	dashboardCurrency,
																)}
															</td>
															<td className="py-3 pr-4 text-right font-num tabular-nums">
																{formatCount(month.invoiceCount)}
															</td>
															<td className="py-3 text-right font-num tabular-nums">
																{formatCount(month.warningCount)}
															</td>
														</tr>
													))}
												</tbody>
											</table>
										</div>
									</RowsEmptyGuard>
								</Panel>

								<Panel title="Warning mix" sub="Current period">
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
								</Panel>
							</div>

							<div className="grid gap-4 xl:grid-cols-3">
								<Panel title="Client context" sub={dashboardCurrency}>
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
								</Panel>

								<Panel title="Needs review" sub="Invoices">
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
								</Panel>

								<Panel title="Export audit" sub="Recent">
									<RowsEmptyGuard
										show={
											(complianceDashboard?.exports.recent.length ?? 0) === 0
										}
									>
										<div className="divide-y divide-rule">
											{(complianceDashboard?.exports.recent ?? []).map(
												(record) => (
													<DashboardRow
														key={record.id}
														icon={Download}
														name={formatExportDisplayName(record)}
														primary={
															<StatusPill
																tone={exportStatusTone(record.status)}
															>
																{record.status}
															</StatusPill>
														}
														secondary={formatExportKind(record.kind)}
														meta={formatExportDate(record.createdAt)}
														tone="cyan"
													/>
												),
											)}
										</div>
									</RowsEmptyGuard>
								</Panel>
							</div>
						</div>
					)}
				</section>
			) : null}

			{activeTab === "identity" ? (
				<section aria-label="Business identity">
					<Panel
						title="Business identity"
						sub="Read-only here. Edit identity, invoice defaults, and payment details in General settings."
						actions={
							<Button
								asChild
								type="button"
								variant="outline"
								className="h-9 rounded-md border-rule bg-transparent px-3 text-xs text-ink-2 hover:bg-paper-3"
							>
								<Link to="/settings">Edit in General Settings</Link>
							</Button>
						}
					>
						<div>
							<div className="flex items-center justify-between gap-3">
								<span className="text-xs text-ink-3">Profile completeness</span>
								<span className="font-num text-xs tabular-nums text-ink-2">
									{identityCompleteCount} of 8
								</span>
							</div>
							<Progress
								value={(identityCompleteCount / 8) * 100}
								aria-label={`Profile completeness ${identityCompleteCount} of 8`}
								className="mt-2 h-1.5 rounded-full bg-paper-3"
							/>
						</div>
						<div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
							<ReadOnlyComplianceItem label="Workspace" value={form.name} />
							<ReadOnlyComplianceItem
								label="Registered name"
								value={form.legalName || form.name}
							/>
							<ReadOnlyComplianceItem
								label="Finance email"
								value={form.email}
							/>
							<ReadOnlyComplianceItem label="Phone" value={form.phone} />
							<ReadOnlyComplianceItem label="TIN" value={form.taxId} />
							<ReadOnlyComplianceItem
								label="CAC RC Number"
								value={form.rcNumber}
							/>
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
							CSV exports are for spreadsheets and accountants. Connected
							accounting apps will be added later.
						</p>
						<p className="mt-1 text-xs text-ink-3">
							Velure helps structure invoice data for Nigerian finance
							workflows. Confirm VAT, WHT, and filing treatment with your
							accountant or tax advisor.
						</p>
						<p className="mt-1 text-xs text-brand">
							{NIGERIA_AUTHORITY_LABEL} is now the federal revenue authority.
							Standard VAT remains {NIGERIA_VAT_RATE}% for taxable supplies
							where VAT applies.
						</p>
					</Panel>
				</section>
			) : null}

			{activeTab === "tax" ? (
				<section aria-label="Tax settings">
					<Panel
						title="Tax settings"
						sub="Use VAT settings for invoice display. Use WHT fields only when a customer deducts tax at source or your accountant asks you to show expected deductions."
					>
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
										<span className="font-medium">
											{form.taxRuleSetVersion}
										</span>
										. It resolves to the current rules and is normalized on the
										next settings save.
									</p>
								) : ruleSetStatus === "superseded" ? (
									<p>
										This workspace is pinned to the superseded rule set{" "}
										<span className="font-medium">
											{form.taxRuleSetVersion}
										</span>
										. Review whether new invoices should use the current rules.
									</p>
								) : (
									<p>
										This workspace stores the unrecognized rule-set version{" "}
										<span className="font-medium">
											{form.taxRuleSetVersion}
										</span>
										. Verify it in General Settings before relying on computed
										taxes.
									</p>
								)}
							</div>
						) : null}
						<div className="mt-4 grid gap-3 md:grid-cols-2">
							<div className="rounded-md border border-rule bg-paper px-4 py-3">
								<p className="text-sm font-medium text-ink">VAT profile</p>
								<p className="mt-1 text-xs text-ink-3">
									Nigeria standard VAT is {NIGERIA_VAT_RATE}% for taxable
									supplies. Businesses below registration threshold or exempt
									supplies should not charge VAT by default.
								</p>
							</div>
							<div className="rounded-md border border-rule bg-paper px-4 py-3">
								<p className="text-sm font-medium text-ink">WHT deduction</p>
								<p className="mt-1 text-xs text-ink-3">
									WHT is not an extra charge. It is usually deducted by the
									paying customer and remitted to the tax authority under
									category-based deduction rules.
								</p>
							</div>
						</div>
						<div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
							<div className="grid gap-1.5">
								<label
									htmlFor="compliance-profile-name"
									className="text-xs font-medium text-ink-2"
								>
									Profile name
								</label>
								<Input
									id="compliance-profile-name"
									value={profileForm.name}
									onChange={(event) => {
										setProfileForm((current) => ({
											...current,
											name: event.target.value,
										}));
										setErrors((current) => ({
											...current,
											profileName: undefined,
										}));
									}}
									placeholder="Profile name"
									aria-invalid={Boolean(errors.profileName)}
									className={`${errors.profileName ? "border-danger" : "border-rule"} bg-paper`}
								/>
							</div>
							<div className="grid gap-1.5">
								<label
									htmlFor="compliance-profile-label"
									className="text-xs font-medium text-ink-2"
								>
									Tax label
								</label>
								<Input
									id="compliance-profile-label"
									value={profileForm.label}
									onChange={(event) => {
										setProfileForm((current) => ({
											...current,
											label: event.target.value,
										}));
										setErrors((current) => ({
											...current,
											profileLabel: undefined,
										}));
									}}
									placeholder="Tax label"
									aria-invalid={Boolean(errors.profileLabel)}
									className={`${errors.profileLabel ? "border-danger" : "border-rule"} bg-paper`}
								/>
							</div>
							<div className="grid gap-1.5">
								<label
									htmlFor="compliance-profile-rate"
									className="text-xs font-medium text-ink-2"
								>
									Rate (%)
								</label>
								<Input
									id="compliance-profile-rate"
									type="number"
									step="0.5"
									value={profileForm.rate}
									onChange={(event) => {
										setProfileForm((current) => ({
											...current,
											rate: Number(event.target.value) || 0,
										}));
										setErrors((current) => ({
											...current,
											profileRate: undefined,
										}));
									}}
									placeholder="Rate"
									aria-invalid={Boolean(errors.profileRate)}
									className={`${errors.profileRate ? "border-danger" : "border-rule"} bg-paper`}
								/>
							</div>
						</div>
						{errors.profileName || errors.profileLabel || errors.profileRate ? (
							<div className="mt-3 space-y-1 text-xs text-danger">
								{errors.profileName ? <p>{errors.profileName}</p> : null}
								{errors.profileLabel ? <p>{errors.profileLabel}</p> : null}
								{errors.profileRate ? <p>{errors.profileRate}</p> : null}
							</div>
						) : null}
						<div className="grid gap-1.5">
							<label
								htmlFor="compliance-profile-notes"
								className="text-xs font-medium text-ink-2"
							>
								Description
							</label>
							<Textarea
								id="compliance-profile-notes"
								value={profileForm.notes}
								onChange={(event) =>
									setProfileForm((current) => ({
										...current,
										notes: event.target.value,
									}))
								}
								placeholder="Notes"
								className="border-rule bg-paper"
							/>
						</div>
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
									const result = await createExport({
										kind: "tax_summary_csv",
									});
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
											<p className="text-sm font-medium text-ink">
												{profile.name}
											</p>
											<p className="text-xs text-ink-3">
												{profile.label} • {profile.taxTreatment} •{" "}
												{profile.rate}%
											</p>
										</div>
										{profile.isDefault ? (
											<StatusPill tone="ok">Default</StatusPill>
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
									<span className="text-xs text-ink-3">
										{effectiveRuleSet.id}
									</span>
								</div>
								<p className="mt-1 text-xs text-ink-3">
									{effectiveRuleSet.authority} • effective{" "}
									{formatNigerianDate(effectiveRuleSet.effectiveFrom)}
								</p>
								<p className="mt-1 text-xs text-ink-3">
									Standard VAT is {effectiveRuleSet.vatRate}% for taxable
									supplies. WHT rates below are deducted at source by the paying
									customer.
								</p>
							</div>
							<div className="relative mt-3">
								<Search
									aria-hidden="true"
									className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-3"
								/>
								<Input
									value={whtQuery}
									onChange={(event) => setWhtQuery(event.target.value)}
									placeholder="Search WHT categories"
									aria-label="Search WHT categories"
									className="border-rule bg-paper pl-9"
								/>
							</div>
							<div className="mt-3 overflow-x-auto rounded-md border border-rule bg-paper">
								<table className="w-full min-w-[560px] text-left text-sm">
									<thead className="border-b border-rule text-xs uppercase tracking-[0.08em] text-ink-3">
										<tr>
											<th className="py-2.5 pl-4 pr-4 font-medium">
												WHT category
											</th>
											<th className="py-2.5 pr-4 text-right font-medium">
												Resident
											</th>
											<th className="py-2.5 pr-4 text-right font-medium">
												Non-resident
											</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-rule">
										{filteredWithholdingOptions.map((option) => {
											const table =
												effectiveRuleSet.withholdingRates[option.value];
											return (
												<tr key={option.value} className="text-ink-2">
													<td className="py-2.5 pl-4 pr-4">
														<p className="font-medium text-ink">
															{option.label}
														</p>
														<p className="mt-0.5 text-xs text-ink-3">
															{option.description}
														</p>
													</td>
													<td className="py-2.5 pr-4 text-right font-num tabular-nums">
														{table.resident}%
													</td>
													<td className="py-2.5 pr-4 text-right font-num tabular-nums">
														{table.nonResident}%
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
								{filteredWithholdingOptions.length === 0 ? (
									<p className="px-4 py-6 text-center text-sm font-medium text-ink-2">
										No categories match
									</p>
								) : null}
							</div>
							<p className="mt-3 text-xs text-ink-3">
								Rule sets are versioned. {NIGERIA_AUTHORITY_LABEL} changes are
								applied by adding a new rule set; invoices keep the rule set
								they were computed under.
							</p>
						</div>
					</Panel>
				</section>
			) : null}

			{activeTab === "exports" ? (
				<section aria-label="Exports">
					<Panel
						title="Exports"
						sub="Your data is yours. Export invoices as PDF or CSV anytime. Downloadable CSV reports cover invoicing, customer balances, and tax review."
					>
						<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
							<div className="grid gap-3 rounded-md border border-rule bg-paper-2 px-4 py-3">
								<div>
									<p className="text-sm font-medium text-ink">Invoice report</p>
									<p className="mt-1 text-xs text-ink-3">
										Every invoice in the period with VAT and status.
									</p>
								</div>
								<Button
									type="button"
									variant="outline"
									className="border-rule bg-transparent"
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
									<Download className="h-4 w-4" />
									Generate CSV
								</Button>
							</div>
							<div className="grid gap-3 rounded-md border border-rule bg-paper-2 px-4 py-3">
								<div>
									<p className="text-sm font-medium text-ink">
										Customer balance report
									</p>
									<p className="mt-1 text-xs text-ink-3">
										What each customer owes, by invoice.
									</p>
								</div>
								<Button
									type="button"
									variant="outline"
									className="border-rule bg-transparent"
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
									<Download className="h-4 w-4" />
									Generate CSV
								</Button>
							</div>
							<div className="grid gap-3 rounded-md border border-rule bg-paper-2 px-4 py-3">
								<div>
									<p className="text-sm font-medium text-ink">Tax summary</p>
									<p className="mt-1 text-xs text-ink-3">
										VAT and WHT totals by month.
									</p>
								</div>
								<Button
									type="button"
									variant="outline"
									className="border-rule bg-transparent"
									onClick={async () => {
										const result = await createExport({
											kind: "tax_summary_csv",
										});
										downloadExportContent(result);
										toast({
											title: "Tax summary generated",
											description: "Download started.",
											variant: "success",
										});
									}}
								>
									<Download className="h-4 w-4" />
									Generate CSV
								</Button>
							</div>
						</div>

						<div className="mt-4 space-y-3">
							{visibleExports.map((record) => (
								<div
									key={record._id}
									className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-rule bg-paper px-4 py-3"
								>
									<div className="min-w-0 flex-1">
										<p className="truncate text-sm font-medium text-ink">
											{formatExportDisplayName(record)}
										</p>
										<p className="mt-1 text-xs text-ink-3">
											{formatExportKind(record.kind)} • {record.fileName}
										</p>
									</div>
									<StatusPill tone={exportStatusTone(record.status)}>
										{record.status}
									</StatusPill>
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
												toast({
													title: "Export marked ready",
													variant: "success",
												});
											}}
										>
											Retry
										</Button>
									</div>
								</div>
							))}
							{visibleExports.length === 0 ? (
								<div className="rounded-md border border-dashed border-rule bg-paper px-4 py-6 text-sm text-ink-3">
									No downloadable exports yet. Generate an invoice list,
									customer balance report, or tax summary.
								</div>
							) : null}
						</div>
					</Panel>
				</section>
			) : null}
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
			? null
			: String(value);

	return (
		<div
			className={`rounded-md border border-rule bg-paper px-4 py-3 ${className}`}
		>
			<p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-3">
				{label}
			</p>
			{displayValue === null ? (
				<p className="mt-2">
					<StatusPill tone="mute">Not set</StatusPill>
				</p>
			) : (
				<p className="mt-2 whitespace-pre-wrap text-sm text-ink">
					{displayValue}
				</p>
			)}
		</div>
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
	primary: ReactNode;
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
