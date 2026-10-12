import { useQuery } from "@tanstack/react-query";
import { createLazyFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowRight,
	CalendarClock,
	Check,
	FileText,
	Users,
} from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Callout } from "#/components/redesign/callout";
import { EmptyState } from "#/components/redesign/empty-state";
import { Kpi, KpiStrip } from "#/components/redesign/kpi-strip";
import { ListRow } from "#/components/redesign/list-row";
import { Panel } from "#/components/redesign/panel";
import { SegmentedFilter } from "#/components/redesign/segmented-filter";
import { StatusPill } from "#/components/redesign/status-pill";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
} from "#/components/ui/chart";
import { monthYearFmt } from "#/components/ui/chart-format";
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
import { useUnifiedAuth } from "#/lib/auth-hook";
import { useSupabaseSession } from "#/lib/supabase-session";
import { cn } from "#/lib/utils.ts";
import { getRevenueCashFlow } from "#/server/data/reports";
import type { PeriodPreset } from "#/utils/date";
import { PERIOD_OPTIONS, resolvePeriod } from "#/utils/date";

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

const barChartConfig = {
	billedAmount: {
		label: "Billed",
		color: "var(--color-info)",
	},
	collectedAmount: {
		label: "Collected",
		color: "var(--color-ok)",
	},
} satisfies ChartConfig;

type RechartsTooltipItem = {
	payload: Record<string, number | string | undefined>;
};

function ChartTooltipRow({
	label,
	value,
	color,
}: {
	label: string;
	value: string;
	color: string;
}) {
	return (
		<div className="flex w-full items-center justify-between gap-6 leading-none">
			<span className="flex items-center gap-1.5 text-ink-3">
				<span
					className="h-2 w-2 shrink-0 rounded-full"
					style={{ backgroundColor: color }}
				/>
				{label}
			</span>
			<span className="font-num font-medium text-ink tabular-nums">
				{value}
			</span>
		</div>
	);
}

function RevenueTooltip({
	active,
	payload,
	currency,
}: {
	active?: boolean;
	payload?: RechartsTooltipItem[];
	currency: string;
}) {
	if (!active || !payload?.length) return null;
	const point = payload[0]?.payload ?? {};
	return (
		<div className="border-rule bg-paper grid min-w-[10rem] items-start gap-1.5 rounded-[var(--hm-r-input)] border px-2.5 py-1.5 text-xs shadow-xl">
			<div className="font-medium text-ink">{String(point.label ?? "")}</div>
			<div className="grid gap-1.5">
				<ChartTooltipRow
					label="Billed"
					value={formatMoney(Number(point.billedAmount ?? 0), currency)}
					color="var(--color-info)"
				/>
				<ChartTooltipRow
					label="Collected"
					value={formatMoney(Number(point.collectedAmount ?? 0), currency)}
					color="var(--color-ok)"
				/>
			</div>
		</div>
	);
}

function ReportsIndex() {
	const authState = useUnifiedAuth();
	const userId = authState.data?.user?.id;
	const { client } = useSupabaseSession(userId);
	const [, startTransition] = useTransition();
	const [period, setPeriod] = useState<PeriodPreset>("last-6-months");
	const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
	const [chartMode, setChartMode] = useState<"monthly" | "cumulative">(
		"monthly",
	);
	const [visibleSeries, setVisibleSeries] = useState({
		billedAmount: true,
		collectedAmount: true,
	});
	const window = useMemo(() => resolvePeriod(period), [period]);
	const { data: report, isPending: isLoading } = useQuery({
		queryKey: [
			"supabase-revenue-report",
			userId ?? "none",
			window.from,
			window.to,
		],
		queryFn: () => {
			if (!client || !userId) return null;
			return getRevenueCashFlow(client, userId, {
				from: window.from,
				to: window.to,
				limit: 8,
			});
		},
		enabled: Boolean(client && userId),
	});
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
	// Bucket labels are "YYYY-MM"; the bar chart needs short display labels.
	const chartData = useMemo(() => {
		const rows = timeline.map((point) => {
			const date = new Date(`${point.key}-01T00:00:00`);
			return {
				label: Number.isNaN(date.getTime())
					? point.key
					: monthYearFmt.format(date),
				billedAmount: point.billedAmount,
				collectedAmount: point.collectedAmount,
			};
		});
		if (chartMode === "cumulative") {
			let billed = 0;
			let collected = 0;
			return rows.map((row) => {
				billed += row.billedAmount;
				collected += row.collectedAmount;
				return { ...row, billedAmount: billed, collectedAmount: collected };
			});
		}
		return rows;
	}, [timeline, chartMode]);
	const topCustomers = useMemo(
		() =>
			(report?.topCustomers ?? [])
				.filter((customer) => customer.currency === currency)
				.slice()
				.sort((a, b) => b.billedAmount - a.billedAmount),
		[report, currency],
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
	const topCustomer = topCustomers[0];
	const topShare =
		summary.billedAmount > 0 && topCustomer
			? topCustomer.billedAmount / summary.billedAmount
			: 0;
	const maxProductRevenue = topProducts.reduce(
		(max, product) => Math.max(max, product.revenue),
		0,
	);

	return (
		<div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-6">
			<header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
				<div>
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
					<KpiStrip>
						<Kpi
							label="Billed"
							value={formatCompactMoney(summary.billedAmount, currency)}
							sub={`${summary.invoiceCount} invoices`}
							tone="info"
						/>
						<Kpi
							label="Collected"
							value={formatCompactMoney(summary.collectedAmount, currency)}
							sub={`${formatPercent(summary.collectionRate)} collection rate`}
							tone="ok"
						/>
						<Kpi
							label="Outstanding"
							value={formatCompactMoney(summary.outstandingAmount, currency)}
							sub={`${summary.openInvoiceCount} open invoices`}
							tone="warn"
						/>
						<Kpi
							label="Overdue"
							value={formatCompactMoney(summary.overdueAmount, currency)}
							sub={`${summary.overdueInvoiceCount} overdue invoices`}
							tone="danger"
						/>
					</KpiStrip>

					<InsightCallout
						currency={currency}
						billedAmount={summary.billedAmount}
						collectedAmount={summary.collectedAmount}
						collectionRate={summary.collectionRate}
						topCustomerName={topCustomer?.customerName}
						topShare={topShare}
					/>

					<Panel
						title="Revenue visualization"
						sub={`${formatInvoiceDate(window.from)} – ${formatInvoiceDate(window.to)}`}
					>
						<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
							<div className="flex flex-wrap items-center gap-2">
								{(
									[
										["billedAmount", "Billed", "var(--color-info)"],
										["collectedAmount", "Collected", "var(--color-ok)"],
									] as const
								).map(([key, label, color]) => {
									const active = visibleSeries[key];
									return (
										<button
											key={key}
											type="button"
											onClick={() =>
												setVisibleSeries((current) => ({
													...current,
													[key]: !current[key],
												}))
											}
											className={cn(
												"inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
												active
													? "border-rule bg-paper-3 text-ink"
													: "border-transparent text-ink-3",
											)}
											aria-pressed={active}
										>
											<span
												aria-hidden="true"
												className="h-2 w-2 rounded-full"
												style={{
													backgroundColor: color,
													opacity: active ? 1 : 0.3,
												}}
											/>
											{label}
										</button>
									);
								})}
							</div>
							<SegmentedFilter
								options={[
									{ value: "monthly", label: "Monthly" },
									{ value: "cumulative", label: "Cumulative" },
								]}
								value={chartMode}
								onChange={(value) =>
									setChartMode(value as "monthly" | "cumulative")
								}
							/>
						</div>
						<ChartContainer
							config={barChartConfig}
							className="aspect-[16/6] min-h-[240px] w-full"
						>
							<BarChart
								accessibilityLayer
								data={chartData}
								margin={{ left: 8, right: 12, top: 8, bottom: 0 }}
							>
								<CartesianGrid vertical={false} stroke="var(--chart-grid)" />
								<XAxis
									dataKey="label"
									tickLine={false}
									axisLine={false}
									tickMargin={12}
									minTickGap={16}
									tick={{ fontSize: 12 }}
								/>
								<YAxis
									tickLine={false}
									axisLine={false}
									width={64}
									tick={{ fontSize: 12 }}
									tickFormatter={(value: number) =>
										formatCompactMoney(value, currency)
									}
								/>
								<ChartTooltip
									cursor={{ fill: "var(--chart-scale-01)" }}
									content={<RevenueTooltip currency={currency} />}
								/>
								{visibleSeries.billedAmount && (
									<Bar
										dataKey="billedAmount"
										fill="var(--color-billedAmount)"
										radius={4}
										maxBarSize={38}
									/>
								)}
								{visibleSeries.collectedAmount && (
									<Bar
										dataKey="collectedAmount"
										fill="var(--color-collectedAmount)"
										radius={4}
										maxBarSize={38}
									/>
								)}
							</BarChart>
						</ChartContainer>
					</Panel>

					<section className="grid gap-4 xl:grid-cols-3">
						<Panel title="Top customers" sub="Billed">
							<RowsEmptyGuard show={topCustomers.length === 0}>
								<div>
									{topCustomers.map((customer) => {
										const share =
											summary.billedAmount > 0
												? (customer.billedAmount / summary.billedAmount) * 100
												: 0;
										return (
											<ListRow
												key={`${customer.currency}:${customer.customerName}`}
												icon={<Users />}
												tint="accent"
												title={customer.customerName}
												subtitle={`${customer.invoiceCount} invoice${customer.invoiceCount === 1 ? "" : "s"} · all open`}
												amount={
													<span className="block text-right">
														<span className="block text-ink">
															{formatMoney(customer.billedAmount, currency)}
														</span>
														<span className="mt-1 block text-xs text-ink-3">
															{formatPercent(share / 100)}
														</span>
													</span>
												}
												barPercent={share}
												barTone="accent"
											/>
										);
									})}
								</div>
							</RowsEmptyGuard>
							<div className="px-1 pt-3">
								<Link
									to="/invoices"
									className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-hi underline-offset-2 hover:underline"
								>
									Assign customers to invoices
									<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
								</Link>
							</div>
						</Panel>

						<Panel title="Late payers" sub="Overdue">
							{latePayers.length === 0 ? (
								<EmptyState
									icon={<Check />}
									title="No late payers"
									copy="Nothing is past due in this period."
								/>
							) : (
								<div>
									{latePayers.map((customer) => (
										<ListRow
											key={`${customer.currency}:${customer.customerName}`}
											icon={<CalendarClock />}
											tint="warn"
											title={customer.customerName}
											subtitle={`${compactNumber(customer.averageDaysOverdue)} days avg · ${customer.overdueInvoiceCount} invoices`}
											amount={
												<span className="text-ink">
													{formatMoney(customer.overdueAmount, currency)}
												</span>
											}
										/>
									))}
								</div>
							)}
						</Panel>

						<Panel title="Product revenue" sub="Line items">
							<RowsEmptyGuard show={topProducts.length === 0}>
								<div>
									{topProducts.map((product) => (
										<ListRow
											key={`${product.currency}:${product.productId ?? product.name}`}
											icon={<FileText />}
											tint="info"
											title={product.name}
											subtitle={`${product.invoiceCount} invoice${product.invoiceCount === 1 ? "" : "s"} · ${compactNumber(product.quantitySold)} sold`}
											amount={
												<span className="text-ink">
													{formatMoney(product.revenue, currency)}
												</span>
											}
											barPercent={
												maxProductRevenue > 0
													? (product.revenue / maxProductRevenue) * 100
													: 0
											}
											barTone="info"
										/>
									))}
								</div>
							</RowsEmptyGuard>
						</Panel>
					</section>

					<Panel title="Open invoices" sub={currency}>
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
												<td className="font-num py-3 pr-4 text-right font-medium text-ink tabular-nums">
													{formatMoney(invoice.balance, currency)}
												</td>
												<td className="py-3 text-right">
													<StatusPill
														tone={invoice.daysOverdue > 0 ? "bad" : "ok"}
													>
														{invoice.daysOverdue > 0
															? `${invoice.daysOverdue} days overdue`
															: invoice.status}
													</StatusPill>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</RowsEmptyGuard>
					</Panel>
				</>
			)}
		</div>
	);
}

function InsightCallout({
	currency,
	billedAmount,
	collectedAmount,
	collectionRate,
	topCustomerName,
	topShare,
}: {
	currency: string;
	billedAmount: number;
	collectedAmount: number;
	collectionRate: number;
	topCustomerName?: string;
	topShare: number;
}) {
	if (billedAmount <= 0) {
		return (
			<Callout tone="info" title="No revenue in this period.">
				<p>
					Invoices issued in the selected period will show up here once they are
					created.
				</p>
			</Callout>
		);
	}
	if (collectedAmount <= 0) {
		return (
			<Callout tone="info" title="Nothing has been collected yet.">
				<p>
					{topCustomerName
						? `${topCustomerName} alone is ${formatPercent(topShare)} of what you have billed, with ${formatMoney(billedAmount, currency)} still outstanding.`
						: `${formatMoney(billedAmount, currency)} is still outstanding across this period.`}
				</p>
				<Link
					to="/settings/collections"
					className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-brand-hi underline-offset-2 hover:underline"
				>
					Open payment reminders
					<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
				</Link>
			</Callout>
		);
	}
	return (
		<Callout
			tone="info"
			title={`${formatPercent(collectionRate)} collected so far.`}
		>
			<p>
				{topCustomerName
					? `${topCustomerName} is ${formatPercent(topShare)} of billed revenue at ${formatMoney(billedAmount, currency)}.`
					: `${formatMoney(collectedAmount, currency)} of ${formatMoney(billedAmount, currency)} billed has been collected.`}
			</p>
			<Link
				to="/settings/collections"
				className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-brand-hi underline-offset-2 hover:underline"
			>
				Open payment reminders
				<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
			</Link>
		</Callout>
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
