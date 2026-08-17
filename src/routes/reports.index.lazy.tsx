import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createLazyFileRoute } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import {
	ArrowDownRight,
	Banknote,
	CalendarClock,
	LineChart as LineChartIcon,
	ReceiptText,
	Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState, useTransition } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { RowsEmptyGuard } from "#/components/ui/rows-empty-guard";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Skeleton } from "#/components/ui/skeleton";
import {
	formatCompactMoney,
	formatInvoiceDate,
	formatMoney,
} from "#/features/invoices/format";
import type { PeriodPreset } from "#/utils/date";
import { PERIOD_OPTIONS, resolvePeriod } from "#/utils/date";
import { api } from "../../convex/_generated/api";

export const Route = createLazyFileRoute("/reports/")({
	component: ReportsIndex,
});

type CurrencySummary = {
	currency: string;
	billedAmount: number;
	collectedAmount: number;
	outstandingAmount: number;
	overdueAmount: number;
	invoiceCount: number;
	paidInvoiceCount: number;
	openInvoiceCount: number;
	overdueInvoiceCount: number;
	averageInvoiceValue: number;
	collectionRate: number;
};

type ChartTooltipPayload = {
	dataKey?: string | number;
	value?: number | string;
	payload?: Record<string, unknown>;
};

const METRIC_SKELETON_KEYS = ["billed", "collected", "outstanding", "overdue"];
const TABLE_SKELETON_KEYS = ["customers", "late-payers", "products"];

function formatPercent(value: number) {
	return `${Math.round(value * 100)}%`;
}

function compactNumber(value: number) {
	return new Intl.NumberFormat("en-NG", {
		maximumFractionDigits: 1,
	}).format(Number.isFinite(value) ? value : 0);
}

function ReportsIndex() {
	const [, startTransition] = useTransition();
	const [period, setPeriod] = useState<PeriodPreset>("last-6-months");
	const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
	const window = useMemo(() => resolvePeriod(period), [period]);
	const { data: report, isPending: isLoading } = useQuery(
		convexQuery(api.reports.getRevenueCashFlow, {
			from: window.from,
			to: window.to,
			limit: 8,
		}),
	);
	const currencies =
		report?.currencySummaries.map((item) => item.currency) ?? [];
	const currency =
		selectedCurrency && currencies.includes(selectedCurrency)
			? selectedCurrency
			: (report?.primaryCurrency.currency ?? "NGN");
	const summary =
		report?.currencySummaries.find((item) => item.currency === currency) ??
		report?.primaryCurrency ??
		createEmptySummary(currency);
	const timeline = (report?.timeline ?? []).filter(
		(point) => point.currency === currency,
	);
	const topCustomers = (report?.topCustomers ?? []).filter(
		(customer) => customer.currency === currency,
	);
	const latePayers = (report?.latePayers ?? []).filter(
		(customer) => customer.currency === currency,
	);
	const topProducts = (report?.topProducts ?? []).filter(
		(product) => product.currency === currency,
	);
	const openInvoices = (report?.openInvoices ?? []).filter(
		(invoice) => invoice.currency === currency,
	);

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 lg:px-8">
			<header className="flex flex-col gap-4 border-b border-rule pb-5 lg:flex-row lg:items-end lg:justify-between">
				<div>
					<div className="mb-3 inline-flex items-center gap-2 rounded-md border border-brand-line bg-brand-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-brand">
						<LineChartIcon className="h-3.5 w-3.5" />
						Reports
					</div>
					<h1 className="text-3xl font-semibold tracking-[-0.02em] text-ink">
						Revenue and cash flow
					</h1>
					<p className="mt-2 max-w-xl text-sm text-ink-3">
						Track billed revenue, collections, open balances, and product
						concentration from invoice activity.
					</p>
				</div>

				<div className="flex flex-col gap-3 sm:flex-row">
					<Select
						value={period}
						onValueChange={(value) =>
							startTransition(() => setPeriod(value as PeriodPreset))
						}
					>
						<SelectTrigger className="h-10 w-full rounded-md border-rule bg-paper-2 text-ink sm:w-[170px]">
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
						value={currency}
						onValueChange={(value) => setSelectedCurrency(value)}
						disabled={currencies.length <= 1}
					>
						<SelectTrigger className="h-10 w-full rounded-md border-rule bg-paper-2 text-ink sm:w-[120px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent className="border-rule bg-paper-2 text-ink">
							{(currencies.length > 0 ? currencies : [currency]).map((item) => (
								<SelectItem key={item} value={item}>
									{item}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</header>

			{isLoading ? (
				<ReportsSkeleton />
			) : (
				<>
					<section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
						<MetricPanel
							icon={ReceiptText}
							label="Billed"
							value={formatMoney(summary.billedAmount, currency)}
							detail={`${summary.invoiceCount} invoices`}
						/>
						<MetricPanel
							icon={Banknote}
							label="Collected"
							value={formatMoney(summary.collectedAmount, currency)}
							detail={`${formatPercent(summary.collectionRate)} collection rate`}
							tone="brand"
						/>
						<MetricPanel
							icon={ArrowDownRight}
							label="Outstanding"
							value={formatMoney(summary.outstandingAmount, currency)}
							detail={`${summary.openInvoiceCount} open invoices`}
							tone="amber"
						/>
						<MetricPanel
							icon={CalendarClock}
							label="Overdue"
							value={formatMoney(summary.overdueAmount, currency)}
							detail={`${summary.overdueInvoiceCount} overdue invoices`}
							tone="rose"
						/>
					</section>

					<section className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
						<ReportPanel
							title="Monthly movement"
							label={`${formatInvoiceDate(window.from)} - ${formatInvoiceDate(window.to)}`}
						>
							<div className="h-[320px]">
								<ResponsiveContainer width="100%" height="100%">
									<LineChart
										data={timeline}
										margin={{ left: 0, right: 16, top: 10 }}
									>
										<CartesianGrid
											stroke="var(--color-rule)"
											strokeDasharray="4 4"
										/>
										<XAxis
											dataKey="label"
											stroke="var(--color-ink-3)"
											fontSize={12}
											tickLine={false}
											axisLine={false}
										/>
										<YAxis
											stroke="var(--color-ink-3)"
											fontSize={12}
											tickLine={false}
											axisLine={false}
											tickFormatter={(value) =>
												formatCompactMoney(Number(value), currency)
											}
										/>
										<Tooltip
											cursor={{ stroke: "var(--color-brand)", strokeWidth: 1 }}
											content={<MovementTooltip currency={currency} />}
										/>
										<Line
											type="monotone"
											dataKey="billedAmount"
											stroke="#8bd5ff"
											strokeWidth={2}
											dot={false}
										/>
										<Line
											type="monotone"
											dataKey="collectedAmount"
											stroke="var(--color-brand)"
											strokeWidth={2}
											dot={false}
										/>
									</LineChart>
								</ResponsiveContainer>
							</div>
						</ReportPanel>

						<ReportPanel title="Customer concentration" label={currency}>
							<div className="h-[320px]">
								<ResponsiveContainer width="100%" height="100%">
									<BarChart data={topCustomers.slice(0, 5)} layout="vertical">
										<CartesianGrid
											stroke="var(--color-rule)"
											strokeDasharray="4 4"
										/>
										<XAxis
											type="number"
											stroke="var(--color-ink-3)"
											fontSize={12}
											tickLine={false}
											axisLine={false}
											tickFormatter={(value) =>
												formatCompactMoney(Number(value), currency)
											}
										/>
										<YAxis
											type="category"
											dataKey="customerName"
											stroke="var(--color-ink-3)"
											fontSize={12}
											tickLine={false}
											axisLine={false}
											width={112}
										/>
										<Tooltip
											cursor={{
												fill: "color-mix(in srgb, var(--color-brand) 8%, transparent)",
											}}
											content={
												<CustomerConcentrationTooltip currency={currency} />
											}
										/>
										<Bar
											dataKey="billedAmount"
											fill="var(--color-info)"
											radius={2}
										/>
									</BarChart>
								</ResponsiveContainer>
							</div>
						</ReportPanel>
					</section>

					<section className="grid gap-4 xl:grid-cols-3">
						<ReportPanel title="Top customers" label="Billed">
							<RowsEmptyGuard show={topCustomers.length === 0}>
								<div className="divide-y divide-rule">
									{topCustomers.map((customer) => (
										<CustomerRow
											key={`${customer.currency}:${customer.customerName}`}
											name={customer.customerName}
											primary={formatMoney(customer.billedAmount, currency)}
											secondary={`${formatMoney(customer.outstandingAmount, currency)} open`}
											meta={`${customer.invoiceCount} invoices`}
										/>
									))}
								</div>
							</RowsEmptyGuard>
						</ReportPanel>

						<ReportPanel title="Late payers" label="Overdue">
							<RowsEmptyGuard show={latePayers.length === 0}>
								<div className="divide-y divide-rule">
									{latePayers.map((customer) => (
										<CustomerRow
											key={`${customer.currency}:${customer.customerName}`}
											name={customer.customerName}
											primary={formatMoney(customer.overdueAmount, currency)}
											secondary={`${compactNumber(customer.averageDaysOverdue)} days avg`}
											meta={`${customer.overdueInvoiceCount} invoices`}
											tone="rose"
										/>
									))}
								</div>
							</RowsEmptyGuard>
						</ReportPanel>

						<ReportPanel title="Product revenue" label="Line items">
							<RowsEmptyGuard show={topProducts.length === 0}>
								<div className="divide-y divide-rule">
									{topProducts.map((product) => (
										<CustomerRow
											key={`${product.currency}:${product.productId ?? product.name}`}
											name={product.name}
											primary={formatMoney(product.revenue, currency)}
											secondary={`${compactNumber(product.quantitySold)} sold`}
											meta={`${product.invoiceCount} invoices`}
											tone="cyan"
										/>
									))}
								</div>
							</RowsEmptyGuard>
						</ReportPanel>
					</section>

					<ReportPanel title="Open invoices" label={currency}>
						<RowsEmptyGuard show={openInvoices.length === 0}>
							<div className="overflow-x-auto">
								<table className="w-full min-w-[760px] text-left text-sm">
									<thead className="border-b border-rule text-xs uppercase tracking-[0.08em] text-ink-3">
										<tr>
											<th className="py-3 pr-4 font-medium">Invoice</th>
											<th className="py-3 pr-4 font-medium">Customer</th>
											<th className="py-3 pr-4 font-medium">Due</th>
											<th className="py-3 pr-4 text-right font-medium">
												Balance
											</th>
											<th className="py-3 text-right font-medium">Status</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-rule">
										{openInvoices.map((invoice) => (
											<tr key={invoice.id} className="text-ink-2">
												<td className="py-3 pr-4 font-medium text-ink">
													{invoice.invoiceNumber}
												</td>
												<td className="py-3 pr-4">{invoice.customerName}</td>
												<td className="py-3 pr-4">
													{formatInvoiceDate(invoice.dueDate)}
												</td>
												<td className="py-3 pr-4 text-right font-medium text-ink">
													{formatMoney(invoice.balance, currency)}
												</td>
												<td className="py-3 text-right">
													<span
														className={`inline-flex border px-2 py-1 text-xs font-medium ${
															invoice.daysOverdue > 0
																? "border-danger-line/40 bg-danger-soft text-danger"
																: "border-brand-line bg-brand-soft text-brand"
														}`}
													>
														{invoice.daysOverdue > 0
															? `${invoice.daysOverdue} days overdue`
															: invoice.status}
													</span>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</RowsEmptyGuard>
					</ReportPanel>
				</>
			)}
		</div>
	);
}

function createEmptySummary(currency: string): CurrencySummary {
	return {
		currency,
		billedAmount: 0,
		collectedAmount: 0,
		outstandingAmount: 0,
		overdueAmount: 0,
		invoiceCount: 0,
		paidInvoiceCount: 0,
		openInvoiceCount: 0,
		overdueInvoiceCount: 0,
		averageInvoiceValue: 0,
		collectionRate: 0,
	};
}

function MovementTooltip({
	active,
	payload,
	label,
	currency,
}: {
	active?: boolean;
	payload?: ChartTooltipPayload[];
	label?: string;
	currency: string;
}) {
	if (!active || !payload?.length) return null;

	return (
		<div className="min-w-[210px] rounded-md border border-rule bg-paper/95 px-3 py-3 text-xs shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur-md">
			<p className="mb-2 font-medium text-ink">{label}</p>
			<div className="space-y-2">
				{payload.map((entry) => {
					const isCollected = entry.dataKey === "collectedAmount";
					return (
						<div
							key={String(entry.dataKey)}
							className="flex items-center justify-between gap-4"
						>
							<span className="inline-flex items-center gap-2 text-ink-3">
								<span
									className={`h-2 w-2 rounded-full ${
										isCollected ? "bg-brand" : "bg-info"
									}`}
								/>
								{isCollected ? "Collected" : "Billed"}
							</span>
							<span className="font-medium text-ink">
								{formatMoney(Number(entry.value ?? 0), currency)}
							</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function CustomerConcentrationTooltip({
	active,
	payload,
	currency,
}: {
	active?: boolean;
	payload?: ChartTooltipPayload[];
	currency: string;
}) {
	if (!active || !payload?.length) return null;

	const point = payload[0]?.payload ?? {};
	const customerName = String(point.customerName ?? "Unknown customer");
	const billedAmount = Number(point.billedAmount ?? payload[0]?.value ?? 0);
	const outstandingAmount = Number(point.outstandingAmount ?? 0);
	const invoiceCount = Number(point.invoiceCount ?? 0);

	return (
		<div className="min-w-[230px] rounded-md border border-rule bg-paper/95 px-3 py-3 text-xs shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur-md">
			<p className="font-medium text-ink">{customerName}</p>
			<div className="mt-2 space-y-2">
				<div className="flex items-center justify-between gap-4">
					<span className="text-ink-3">Billed</span>
					<span className="font-medium text-info">
						{formatMoney(billedAmount, currency)}
					</span>
				</div>
				<div className="flex items-center justify-between gap-4">
					<span className="text-ink-3">Open</span>
					<span className="font-medium text-ink">
						{formatMoney(outstandingAmount, currency)}
					</span>
				</div>
				<div className="flex items-center justify-between gap-4">
					<span className="text-ink-3">Invoices</span>
					<span className="text-ink-2">{invoiceCount}</span>
				</div>
			</div>
		</div>
	);
}

function MetricPanel({
	icon: Icon,
	label,
	value,
	detail,
	tone = "neutral",
}: {
	icon: LucideIcon;
	label: string;
	value: string;
	detail: string;
	tone?: "neutral" | "brand" | "amber" | "rose";
}) {
	const toneClass = {
		neutral: "text-info border-info-line/35 bg-info-soft",
		brand: "text-brand border-brand/35 bg-brand-soft",
		amber: "text-warn border-warn-line/35 bg-warn-soft",
		rose: "text-danger border-danger-line/35 bg-danger-soft",
	}[tone];

	return (
		<div className="ui-panel rounded-md border border-rule bg-paper-2 p-4">
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

function ReportPanel({
	title,
	label,
	children,
}: {
	title: string;
	label: string;
	children: ReactNode;
}) {
	return (
		<section className="ui-panel rounded-md border border-rule bg-paper-2">
			<div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3">
				<h2 className="text-sm font-semibold text-ink">{title}</h2>
				<span className="text-xs font-medium uppercase tracking-[0.08em] text-ink-3">
					{label}
				</span>
			</div>
			<div className="p-4">{children}</div>
		</section>
	);
}

function CustomerRow({
	name,
	primary,
	secondary,
	meta,
	tone = "brand",
}: {
	name: string;
	primary: string;
	secondary: string;
	meta: string;
	tone?: "brand" | "rose" | "cyan";
}) {
	const Icon =
		tone === "rose" ? ArrowDownRight : tone === "cyan" ? ReceiptText : Users;
	const iconClass =
		tone === "rose"
			? "border-danger-line/35 bg-danger-soft text-danger"
			: tone === "cyan"
				? "border-info-line/35 bg-info-soft text-info"
				: "border-brand/35 bg-brand-soft text-brand";

	return (
		<div className="flex items-center gap-3 py-3">
			<span
				className={`flex h-9 w-9 shrink-0 items-center justify-center border ${iconClass}`}
			>
				<Icon className="h-4 w-4" />
			</span>
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-medium text-ink">{name}</p>
				<p className="mt-1 text-xs text-ink-3">{meta}</p>
			</div>
			<div className="text-right">
				<p className="text-sm font-semibold text-ink">{primary}</p>
				<p className="mt-1 text-xs text-ink-3">{secondary}</p>
			</div>
		</div>
	);
}

function ReportsSkeleton() {
	return (
		<div className="space-y-4">
			<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
				{METRIC_SKELETON_KEYS.map((key) => (
					<Skeleton key={key} className="h-32 rounded-md bg-paper-3" />
				))}
			</div>
			<Skeleton className="h-[380px] rounded-md bg-paper-3" />
			<div className="grid gap-4 xl:grid-cols-3">
				{TABLE_SKELETON_KEYS.map((key) => (
					<Skeleton key={key} className="h-72 rounded-md bg-paper-3" />
				))}
			</div>
		</div>
	);
}
