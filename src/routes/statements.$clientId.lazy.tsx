import { useQuery } from "@tanstack/react-query";
import { createLazyFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Callout } from "#/components/redesign/callout";
import { EmptyState } from "#/components/redesign/empty-state";
import { Kpi, KpiStrip } from "#/components/redesign/kpi-strip";
import { Panel } from "#/components/redesign/panel";
import { SegmentedFilter } from "#/components/redesign/segmented-filter";
import {
	StatusPill,
	type StatusPillTone,
} from "#/components/redesign/status-pill";
import { AppLoader } from "#/components/ui/app-loader";
import { Button } from "#/components/ui/button";
import { formatInvoiceDate, formatMoney } from "#/features/invoices/format";
import { useUnifiedAuth } from "#/lib/auth-hook";
import { useSupabaseSession } from "#/lib/supabase-session";
import {
	type CustomerStatementLine,
	getCustomerStatement,
} from "#/server/data/clients";
import { getWorkspaceContext } from "#/server/data/workspaces";

export const Route = createLazyFileRoute("/statements/$clientId")({
	component: CustomerStatementPage,
});

type Period = "all" | "this-year" | "last-12-months";

const PERIOD_OPTIONS = [
	{ value: "all", label: "All time" },
	{ value: "this-year", label: "This year" },
	{ value: "last-12-months", label: "Last 12 months" },
];

/**
 * Issue-date window for a preset, inclusive, `YYYY-MM-DD`. `all` returns an
 * empty window so the server includes every invoice.
 */
function periodWindow(period: Period): { from?: string; to?: string } {
	if (period === "all") return {};
	const now = new Date();
	const to = now.toISOString().slice(0, 10);
	if (period === "this-year") {
		return { from: `${now.getUTCFullYear()}-01-01`, to };
	}
	const start = new Date(now);
	start.setUTCFullYear(start.getUTCFullYear() - 1);
	return { from: start.toISOString().slice(0, 10), to };
}

function statementStatusLabel(status: string) {
	switch (status) {
		case "paid":
			return "Paid";
		case "overdue":
			return "Overdue";
		case "partially-paid":
			return "Partially paid";
		case "unpaid":
			return "Unpaid";
		default:
			return status;
	}
}

function statementStatusTone(status: string): StatusPillTone {
	if (status === "paid") return "ok";
	if (status === "overdue") return "bad";
	if (status === "partially-paid") return "warn";
	return "info";
}

function StatementLineRow({ line }: { line: CustomerStatementLine }) {
	// `overdue` is a balance fact, independent of the derived status: a
	// partially-paid past-due invoice is `partially-paid` by status but still
	// overdue. Prefer the overdue label so the pill matches the red balance.
	const tone: StatusPillTone = line.overdue
		? "bad"
		: statementStatusTone(line.status);
	const label = line.overdue ? "Overdue" : statementStatusLabel(line.status);
	return (
		<tr className="border-b border-rule/60 last:border-0">
			<th
				scope="row"
				className="px-[18px] py-2.5 text-left text-sm font-medium text-ink"
			>
				{line.invoiceNumber || "—"}
			</th>
			<td className="px-[18px] py-2.5 text-sm text-ink-2 whitespace-nowrap">
				{formatInvoiceDate(line.issueDate)}
			</td>
			<td className="px-[18px] py-2.5 text-sm text-ink-2 whitespace-nowrap">
				{formatInvoiceDate(line.dueDate)}
			</td>
			<td className="px-[18px] py-2.5">
				<StatusPill tone={tone}>{label}</StatusPill>
			</td>
			<td className="px-[18px] py-2.5 text-right font-num text-sm tabular-nums text-ink">
				{formatMoney(line.total, line.currency)}
			</td>
			<td className="px-[18px] py-2.5 text-right font-num text-sm tabular-nums text-ink-2">
				{formatMoney(line.paid, line.currency)}
			</td>
			<td
				className={`px-[18px] py-2.5 text-right font-num text-sm font-medium tabular-nums ${
					line.overdue ? "text-danger" : "text-ink"
				}`}
			>
				{formatMoney(line.balance, line.currency)}
			</td>
		</tr>
	);
}

function StatementHeader({
	sellerName,
	clientName,
	clientEmail,
	generatedAt,
}: {
	sellerName: string;
	clientName: string;
	clientEmail: string;
	generatedAt: string;
}) {
	return (
		<header className="mb-6 flex flex-wrap items-start justify-between gap-4">
			<div className="min-w-0">
				<p className="text-xs uppercase tracking-wide text-ink-3">
					Statement of account
				</p>
				<h1 className="mt-1 truncate text-2xl font-semibold text-ink">
					{clientName}
				</h1>
				{clientEmail ? (
					<p className="mt-0.5 truncate text-sm text-ink-2">{clientEmail}</p>
				) : null}
			</div>
			<div className="text-right text-sm text-ink-2">
				<p className="font-medium text-ink">{sellerName}</p>
				<p className="mt-1">Generated {formatInvoiceDate(generatedAt)}</p>
			</div>
		</header>
	);
}

function CustomerStatementPage() {
	const { clientId } = Route.useParams();
	const navigate = useNavigate();
	const authState = useUnifiedAuth();
	const userId = authState.data?.user?.id;
	const { client, velureUserId } = useSupabaseSession(userId);
	const [period, setPeriod] = useState<Period>("all");
	const range = useMemo(() => periodWindow(period), [period]);

	// Settled absence of a session: this is a standalone (non-DashboardLayout)
	// route, so it carries its own auth redirect instead of rendering nothing.
	const authReturnPath =
		!authState.isPending && !userId && typeof window !== "undefined"
			? window.location.pathname + window.location.search
			: null;
	useEffect(() => {
		if (authReturnPath === null) return;
		void navigate({
			to: "/auth",
			search: { redirect: authReturnPath },
			replace: true,
		});
	}, [authReturnPath, navigate]);

	const { data: workspace } = useQuery({
		queryKey: ["supabase-workspace-context", velureUserId ?? "none"],
		queryFn: () => {
			if (!client || !velureUserId)
				throw new Error("Supabase session unavailable.");
			return getWorkspaceContext(client, velureUserId);
		},
		enabled: Boolean(client && velureUserId),
	});

	const {
		data: statement,
		isPending,
		isError,
	} = useQuery({
		queryKey: [
			"supabase-customer-statement",
			userId ?? "none",
			clientId,
			range.from ?? null,
			range.to ?? null,
		],
		queryFn: () => {
			if (!client || !userId) throw new Error("Supabase session unavailable.");
			return getCustomerStatement(client, userId, clientId, range);
		},
		enabled: Boolean(client && userId),
	});

	if (authReturnPath !== null) return <AppLoader />;
	// `statement === undefined` is "still loading"; `null` is "resolved, not in
	// this workspace". Conflating them spun forever on an unknown client id.
	if (isPending || (statement === undefined && !isError)) {
		return (
			<div className="grid min-h-[100dvh] place-items-center bg-paper-2">
				<AppLoader label="Loading statement" />
			</div>
		);
	}

	const sellerName = workspace?.name ?? "Your business";
	const primary = statement?.primaryTotals;
	const kpiCurrency = primary?.currency ?? statement?.currency ?? "NGN";
	const multiCurrency = (statement?.totalsByCurrency.length ?? 0) > 1;

	return (
		<div className="statement-print min-h-[100dvh] bg-paper-2 text-ink">
			{/* Print legibility: the app theme may be dark, and browsers do not
			    print backgrounds, so force ink on paper for the printed sheet —
			    including the document shell, which sits outside the wrapper. */}
			<style>{`@media print {
        html, body { background: #fff !important; color: #111 !important; }
        .statement-print, .statement-print * {
          color: #111 !important;
          box-shadow: none !important;
        }
        .statement-print { background: #fff !important; }
      }`}</style>

			<div className="sticky top-0 z-10 border-b border-rule bg-paper/90 backdrop-blur print:hidden">
				<div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
					<Button asChild variant="outline" size="sm">
						<Link to="/clients">
							<ArrowLeft className="h-4 w-4" />
							Back to clients
						</Link>
					</Button>
					<div className="flex items-center gap-2">
						<SegmentedFilter
							options={PERIOD_OPTIONS}
							value={period}
							onChange={(value) => setPeriod(value as Period)}
						/>
						<Button
							type="button"
							size="sm"
							onClick={() => window.print()}
							aria-label="Print statement"
						>
							<Printer className="h-4 w-4" />
							Print
						</Button>
					</div>
				</div>
			</div>

			<main className="mx-auto max-w-4xl px-4 py-8">
				{isError ? (
					<Callout tone="bad" title="Statement failed to load">
						Check your connection and try again.
					</Callout>
				) : statement === null ? (
					<EmptyState
						title="Statement unavailable"
						copy="This client is not in your workspace."
						action={
							<Button asChild variant="outline" size="sm">
								<Link to="/clients">Back to clients</Link>
							</Button>
						}
					/>
				) : statement ? (
					<>
						<StatementHeader
							sellerName={sellerName}
							clientName={statement.clientName}
							clientEmail={statement.clientEmail}
							generatedAt={statement.generatedAt}
						/>

						{statement.invoiceCount === 0 ? (
							<EmptyState
								dashed
								title="No invoices in this period"
								copy="There is nothing to show for this client yet. Try a wider period."
							/>
						) : (
							<div className="flex flex-col gap-6">
								<KpiStrip>
									<Kpi
										label="Billed"
										value={formatMoney(primary?.billed ?? 0, kpiCurrency)}
										sub={`${primary?.invoiceCount ?? 0} ${
											(primary?.invoiceCount ?? 0) === 1
												? "invoice"
												: "invoices"
										}`}
										tone="brand"
									/>
									<Kpi
										label="Paid"
										value={formatMoney(primary?.paid ?? 0, kpiCurrency)}
										tone="ok"
									/>
									<Kpi
										label="Outstanding"
										value={formatMoney(primary?.outstanding ?? 0, kpiCurrency)}
										tone="warn"
									/>
									<Kpi
										label="Overdue"
										value={formatMoney(primary?.overdue ?? 0, kpiCurrency)}
										tone="danger"
									/>
								</KpiStrip>

								{multiCurrency ? (
									<Callout tone="info" title="Multiple currencies">
										Amounts are grouped by currency below and are not converted.
									</Callout>
								) : null}

								<div className="flex flex-col gap-4">
									{statement.totalsByCurrency.map((group) => (
										<Panel
											key={group.currency}
											title={`${group.currency} invoices`}
											sub={`${group.invoiceCount} ${
												group.invoiceCount === 1 ? "invoice" : "invoices"
											} · Outstanding ${formatMoney(
												group.outstanding,
												group.currency,
											)}`}
											className="bg-paper"
										>
											<div className="-mx-[18px] -my-[18px] overflow-x-auto">
												<table className="w-full min-w-[720px] border-collapse">
													<caption className="sr-only">
														Invoices for {statement.clientName} in{" "}
														{group.currency}
													</caption>
													<thead>
														<tr className="border-b border-rule text-left text-xs text-ink-3">
															<th
																scope="col"
																className="px-[18px] py-2.5 font-medium"
															>
																Invoice
															</th>
															<th
																scope="col"
																className="px-[18px] py-2.5 font-medium"
															>
																Issued
															</th>
															<th
																scope="col"
																className="px-[18px] py-2.5 font-medium"
															>
																Due
															</th>
															<th
																scope="col"
																className="px-[18px] py-2.5 font-medium"
															>
																Status
															</th>
															<th
																scope="col"
																className="px-[18px] py-2.5 text-right font-medium"
															>
																Total
															</th>
															<th
																scope="col"
																className="px-[18px] py-2.5 text-right font-medium"
															>
																Paid
															</th>
															<th
																scope="col"
																className="px-[18px] py-2.5 text-right font-medium"
															>
																Balance
															</th>
														</tr>
													</thead>
													<tbody>
														{statement.lines
															.filter(
																(line) => line.currency === group.currency,
															)
															.map((line) => (
																<StatementLineRow
																	key={line.id || line.invoiceNumber}
																	line={line}
																/>
															))}
													</tbody>
												</table>
											</div>
										</Panel>
									))}
								</div>

								<p className="text-xs text-ink-3">
									Please quote the invoice number as the payment reference.
								</p>
							</div>
						)}
					</>
				) : null}
			</main>
		</div>
	);
}
