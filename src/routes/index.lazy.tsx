import { createLazyFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowRight,
	Banknote,
	BellRing,
	BookOpenCheck,
	Building2,
	CreditCard,
	FileDown,
	FileText,
	LockKeyhole,
	Mail,
	Receipt,
	ShieldCheck,
	Users,
} from "lucide-react";
import { type CSSProperties, useEffect, useRef } from "react";
import {
	FeatureGrid,
	MarketingFooter,
	MarketingNav,
	SplitSection,
} from "#/components/marketing/MarketingLayout";
import { useLandingMotion } from "#/components/marketing/useLandingMotion";
import { authClient } from "#/lib/auth-client";

export const Route = createLazyFileRoute("/")({
	component: LandingPage,
});

const invoiceRows = [
	{
		number: "VEL-2026-0142",
		client: "Northline Studio",
		amount: "₦420,000",
		status: "Paid",
	},
	{
		number: "VEL-2026-0143",
		client: "Aster Retail",
		amount: "₦180,000",
		status: "Unpaid",
	},
	{
		number: "VEL-2026-0144",
		client: "Field Ledger",
		amount: "₦86,000",
		status: "Draft",
	},
];

const featureCards = [
	{
		icon: Receipt,
		title: "Invoices that collect",
		description:
			"Public invoice links, Paystack checkout, PDF generation, and customer-safe views in one flow.",
	},
	{
		icon: Users,
		title: "Client records stay close",
		description:
			"Keep emails, TIN, payment terms, notes, and invoice history beside the work that needs them.",
	},
	{
		icon: BellRing,
		title: "Follow-ups without noise",
		description:
			"Schedule reminders through Resend while manual exceptions stay visible for the finance owner.",
	},
	{
		icon: FileDown,
		title: "Accountant-ready exports",
		description:
			"Download invoice CSV, tax summary CSV, customer ledgers, or styled invoice PDFs when needed.",
	},
];

const checkpoints = [
	"Create the invoice from business defaults",
	"Show VAT and WHT before sending",
	"Collect with Paystack from the public page",
	"Export clean records when accounts ask",
];

const flowSteps = [
	{
		step: "01",
		title: "Set business defaults",
		detail:
			"Company name, logo, TIN, payment terms, currency, and invoice naming.",
		owner: "Founder",
	},
	{
		step: "02",
		title: "Send invoice",
		detail:
			"Client, line items, VAT/WHT, public page, PDF, and Paystack checkout.",
		owner: "Ops",
	},
	{
		step: "03",
		title: "Keep records",
		detail:
			"Status changes, reminders, paid dates, references, and export history.",
		owner: "Finance",
	},
];

// ── Folded from /solutions/small-business and /solutions/enterprise ──
const solutionPanels = [
	{
		id: "small-business",
		icon: Building2,
		kicker: "Small business",
		title: "Look organized before finance gets complicated.",
		body: "Create professional invoices in minutes, keep clients and payment terms in one place, and stop losing unpaid work inside chat threads.",
		points: [
			"Track unpaid invoices without spreadsheets.",
			"Use saved client details for repeat billing.",
			"Export clean records for accountants.",
			"Add VAT and WHT context when needed.",
		],
	},
	{
		id: "enterprise",
		icon: LockKeyhole,
		kicker: "Enterprise",
		title: "Invoice control for teams with real process.",
		body: "Centralize invoice records, tax context, reminder escalation, and accounting continuity so finance teams operate without scattered handoffs.",
		points: [
			"Separate workspace data by membership.",
			"Keep export runs retryable and errors readable.",
			"Give viewers access without write authority.",
			"Prepare exports for accountants and partners.",
		],
	},
];

// ── Folded from /security ──
const securityCards = [
	{
		title: "Encryption in transit",
		description:
			"Production traffic runs over HTTPS. Data moves between browser, app, and backend through encrypted transport.",
	},
	{
		title: "Session management",
		description:
			"Sessions, password reset, and Google sign-in are handled by Better Auth infrastructure, not hand-rolled logic.",
	},
	{
		title: "Workspace access",
		description:
			"Invoices, clients, and products are scoped to workspace membership. Users only see data for organizations they belong to.",
	},
	{
		title: "No cross-workspace leaks",
		description:
			"Mutations validate workspace ownership before writes. Viewer roles cannot write operational records.",
	},
];

// ── Folded from /compliance ──
const complianceCards = [
	{
		title: "Nigeria tax rules",
		description:
			"Set business identity, TIN, CAC RC number, seller tax status, and base currency for cleaner invoice records.",
	},
	{
		title: "VAT",
		description:
			"Show tax treatment clearly on invoices, keep tax labels visible, and store tax snapshots with invoice records.",
	},
	{
		title: "WHT for freelancers and SMEs",
		description:
			"Show withholding tax deductions so expected payment and invoice total are easier to reconcile.",
	},
	{
		title: "Invoice numbering",
		description:
			"Sequential numbers with year context, no duplicates, and no reuse of canceled invoice numbers.",
	},
];

const complianceStats = [
	{
		prefix: "",
		to: 7.5,
		decimals: 1,
		suffix: "%",
		label: "Nigeria VAT default",
	},
	{ prefix: "", to: 3, decimals: 0, suffix: "", label: "reminder stages" },
	{
		prefix: "",
		to: 100,
		decimals: 0,
		suffix: "%",
		label: "export-ready records",
	},
];

function LandingPage() {
	const navigate = useNavigate();
	const { data: session, isPending: sessionPending } = authClient.useSession();
	const containerRef = useRef<HTMLDivElement>(null);

	// The marketing markup (with #smooth-wrapper) only renders once the session
	// is resolved and there's no user — gate motion init on that.
	const ready = !sessionPending && !session?.user;
	useLandingMotion(containerRef, ready);

	useEffect(() => {
		if (!sessionPending && session?.user) {
			void navigate({ to: "/invoices", replace: true });
		}
	}, [navigate, session?.user, sessionPending]);

	if (sessionPending || session?.user) {
		return (
			<div
				className="hm flex min-h-screen items-center justify-center"
				style={{ background: "var(--hm-paper)" }}
			>
				<div
					className="h-9 w-9 animate-pulse"
					style={{
						borderRadius: "var(--hm-r-input)",
						background: "var(--hm-accent-soft)",
					}}
				/>
			</div>
		);
	}

	return (
		<div ref={containerRef} className="hm min-h-screen">
			{/* Nav lives OUTSIDE #smooth-wrapper — ScrollSmoother transforms its
			    content, so a sticky/fixed header must sit above the wrapper. */}
			<MarketingNav />

			<div id="smooth-wrapper">
				<div id="smooth-content">
					<main>
						<section className="relative isolate overflow-hidden">
							<div className="hm-wash" aria-hidden="true" />
							<div className="relative mx-auto grid w-full max-w-7xl items-center gap-12 px-5 py-16 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14 lg:px-8 lg:py-24">
								<div className="hm-reveal">
									<p className="hm-chip hm-label--accent w-fit">
										Invoice operations for small business
									</p>
									<h1
										data-split
										className="hm-display mt-6 text-[clamp(2.75rem,7.5vw,4.75rem)]"
									>
										Send the bill. Track the trail.
									</h1>
									<p className="hm-lede mt-6 max-w-xl text-lg">
										Velure turns invoices, clients, tax lines, reminders, PDFs,
										and exports into one tight workspace for Nigerian
										businesses.
									</p>
									<div className="mt-8 flex flex-wrap gap-3">
										<Link
											to="/auth"
											data-magnetic
											className="hm-btn hm-btn--primary"
										>
											Open workspace
											<ArrowRight className="h-4 w-4" />
										</Link>
										<a href="#features" className="hm-btn hm-btn--ghost">
											See the system
										</a>
									</div>

									<dl className="mt-12 grid gap-6 sm:grid-cols-3">
										<Metric
											index="01"
											value="7.5%"
											label="VAT-ready invoices"
										/>
										<Metric
											index="02"
											value="₦420k"
											label="Paid in the ledger"
										/>
										<Metric
											index="03"
											value="PDF/CSV"
											label="Exports anytime"
										/>
									</dl>
								</div>

								<div
									className="hm-reveal"
									data-speed="0.9"
									style={{ "--hm-i": 1 } as CSSProperties}
								>
									<InvoiceDesk />
								</div>
							</div>

							<div className="hm-rule-t relative">
								<ol className="mx-auto grid w-full max-w-7xl px-5 md:grid-cols-4 lg:px-8">
									{checkpoints.map((item, index) => (
										<li
											key={item}
											data-fade-scroll
											className="hm-rule-t flex min-w-0 items-baseline gap-3 py-4 first:border-t-0 md:border-t-0 md:px-4 md:first:pl-0 md:last:pr-0"
										>
											<span
												className="hm-num text-xs font-semibold"
												style={{ color: "var(--hm-accent)" }}
											>
												0{index + 1}
											</span>
											<span className="text-sm leading-6">{item}</span>
										</li>
									))}
								</ol>
							</div>
						</section>

						<section id="features" className="hm-band hm-rule-t">
							<div className="mx-auto grid w-full max-w-7xl gap-10 px-5 py-16 lg:grid-cols-[minmax(0,0.84fr)_minmax(0,1.16fr)] lg:px-8 lg:py-20">
								<div>
									<p className="hm-label hm-label--accent">
										What feels different
									</p>
									<h2 className="hm-display mt-4 text-[clamp(2rem,4.5vw,3rem)]">
										Not another dead invoice list.
									</h2>
									<p className="hm-lede mt-5 max-w-md">
										The page is built around what happens after an invoice
										leaves your desk: payment, reminders, tax records, and clean
										exports.
									</p>
								</div>
								<div className="grid gap-4 sm:grid-cols-2">
									{featureCards.map((feature) => (
										<FeatureCard key={feature.title} {...feature} />
									))}
								</div>
							</div>
						</section>

						{/* ── Solutions — pinned horizontal track (folded pages) ── */}
						<SolutionsTrack />

						<section id="workflow">
							<div className="mx-auto grid w-full max-w-7xl gap-10 px-5 py-16 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)] lg:px-8 lg:py-20">
								<div>
									<p className="hm-label hm-label--accent">Launch flow</p>
									<ol className="mt-6 space-y-3">
										{flowSteps.map((flow) => (
											<li
												key={flow.step}
												data-fade-scroll
												className="hm-card hm-card--soft p-5"
											>
												<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
													<span
														className="hm-num text-sm font-semibold"
														style={{ color: "var(--hm-accent)" }}
													>
														{flow.step}
													</span>
													<h3 className="hm-title text-lg">{flow.title}</h3>
													<span className="hm-label ml-auto">{flow.owner}</span>
												</div>
												<p className="hm-lede mt-2 text-sm">{flow.detail}</p>
											</li>
										))}
									</ol>
								</div>

								<div
									data-fade-scroll
									className="hm-card hm-card--raised flex flex-col p-6 lg:p-8"
								>
									<p className="hm-display max-w-xs text-[clamp(1.75rem,3.5vw,2.25rem)]">
										Start with one invoice. Keep the whole finance trail.
									</p>
									<p className="hm-lede mt-5 max-w-sm text-sm">
										Create the first invoice, send the link, collect payment,
										and export the record when your accountant asks.
									</p>
									<Link
										to="/auth"
										data-magnetic
										className="hm-btn hm-btn--primary mt-8 w-fit"
									>
										Open app
										<ArrowRight className="h-4 w-4" />
									</Link>
								</div>
							</div>
						</section>

						{/* ── Security — folded from /security ── */}
						<div id="security" className="hm-band hm-rule-t">
							<div className="mx-auto max-w-7xl px-5 pt-16 lg:px-8 lg:pt-20">
								<p className="hm-label hm-label--accent">Security</p>
								<h2 className="hm-display mt-4 max-w-2xl text-[clamp(2rem,4.5vw,3rem)]">
									Built to keep billing data controlled.
								</h2>
								<p className="hm-lede mt-5 max-w-xl">
									Access is authenticated, workspace-scoped, and designed around
									plain operational controls finance users can understand.
								</p>
							</div>
							<FeatureGrid items={securityCards} />
							<SplitSection
								kicker="Operating posture"
								title="Security that finance users can understand."
								body="Velure keeps safety language plain: who can access the workspace, what changed, what exported, and which sync failed."
								points={[
									"Role model: owner, member, viewer.",
									"Server-side membership checks before data access.",
									"Password reset and OAuth handled by Better Auth.",
									"Exportable records support backup and audit workflows.",
								]}
							/>
						</div>

						{/* ── Compliance — folded from /compliance ── */}
						<div id="compliance">
							<div className="mx-auto max-w-7xl px-5 pt-16 lg:px-8 lg:pt-20">
								<p className="hm-label hm-label--accent">Compliance</p>
								<h2 className="hm-display mt-4 max-w-2xl text-[clamp(2rem,4.5vw,3rem)]">
									Practical tax context for Nigerian invoices.
								</h2>
								<p className="hm-lede mt-5 max-w-xl">
									Keep invoice data structured for VAT, WHT, customer records,
									exports, and accountant review.
								</p>
							</div>
							<FeatureGrid items={complianceCards} />
							<section className="hm-band hm-rule-t">
								<div className="mx-auto grid max-w-7xl gap-8 px-5 py-12 sm:grid-cols-3 lg:px-8">
									{complianceStats.map((stat) => (
										<div key={stat.label} data-fade-scroll className="min-w-0">
											<p
												className="hm-num text-4xl font-bold"
												style={{ color: "var(--hm-accent)" }}
												data-count-to={stat.to}
												data-count-decimals={stat.decimals}
												data-count-prefix={stat.prefix}
												data-count-suffix={stat.suffix}
											>
												{stat.prefix}
												{stat.to.toFixed(stat.decimals)}
												{stat.suffix}
											</p>
											<p className="hm-label mt-2">{stat.label}</p>
										</div>
									))}
								</div>
							</section>
							<SplitSection
								kicker="Finance review"
								title="Compliance support, not legal advice."
								body="Velure helps structure invoice data for Nigerian finance workflows. Confirm VAT, WHT, and filing treatment with your accountant or tax advisor."
								points={[
									"Flag missing seller or buyer tax IDs.",
									"Show manual tax and WHT override warnings.",
									"Export tax summaries for accountant review.",
									"Keep compliance snapshots attached to invoices.",
								]}
								reverse
							/>
						</div>

						<section className="hm-band hm-rule-t">
							<div className="mx-auto grid w-full max-w-7xl gap-4 px-5 py-12 md:grid-cols-3 lg:px-8">
								<TrustItem icon={ShieldCheck} title="Private by workspace" />
								<TrustItem icon={Mail} title="Email/password first" />
								<TrustItem icon={CreditCard} title="Public invoices by token" />
							</div>
						</section>
					</main>

					<MarketingFooter />
				</div>
			</div>
		</div>
	);
}

function SolutionsTrack() {
	return (
		<section data-h-track aria-label="Solutions">
			<div data-h-viewport className="hm-h-viewport">
				{solutionPanels.map((panel) => {
					const Icon = panel.icon;
					return (
						<div
							key={panel.id}
							id={panel.id}
							data-panel
							className="hm-h-panel flex items-center"
						>
							<div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:px-8">
								<div data-panel-item>
									<span
										className="flex h-11 w-11 items-center justify-center"
										style={{
											borderRadius: "12px",
											background: "var(--hm-accent-soft)",
											color: "var(--hm-accent-hi)",
										}}
									>
										<Icon className="h-6 w-6" aria-hidden="true" />
									</span>
									<p className="hm-label hm-label--accent mt-6">
										{panel.kicker}
									</p>
									<h2 className="hm-display mt-4 text-[clamp(1.875rem,4vw,2.75rem)]">
										{panel.title}
									</h2>
									<p className="hm-lede mt-5 max-w-md">{panel.body}</p>
									<Link
										to="/auth"
										data-magnetic
										className="hm-btn hm-btn--primary mt-8 w-fit"
									>
										Create workspace
										<ArrowRight className="h-4 w-4" />
									</Link>
								</div>
								<div className="grid gap-3 sm:grid-cols-2">
									{panel.points.map((point) => (
										<div
											key={point}
											data-panel-item
											className="hm-card hm-card--soft flex min-w-0 gap-3 p-4"
										>
											<BookOpenCheck
												className="mt-0.5 h-4 w-4 shrink-0"
												style={{ color: "var(--hm-accent)" }}
												aria-hidden="true"
											/>
											<p className="text-sm leading-6">{point}</p>
										</div>
									))}
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</section>
	);
}

function InvoiceDesk() {
	return (
		<div className="hm-card hm-card--raised overflow-hidden">
			<div className="p-5 sm:p-6">
				<div
					className="flex flex-wrap items-start justify-between gap-4 pb-5"
					style={{ borderBottom: "1px solid var(--hm-rule)" }}
				>
					<div className="min-w-0">
						<p className="hm-title text-3xl">Invoice</p>
						<p className="hm-num mt-1 text-sm">VEL-2026-0143</p>
					</div>
					<div className="min-w-0 text-right text-sm">
						<p className="font-semibold">Aster Retail</p>
						<p className="hm-lede mt-1 text-sm">Due 15 May 2026</p>
					</div>
				</div>

				<div className="mt-1">
					<PaperRow item="Monthly brand retainer" qty="1" total="₦150,000" />
					<PaperRow item="Product photography" qty="2" total="₦30,000" />
					<PaperRow item="Logistics handling" qty="1" total="₦24,000" />
				</div>

				<div className="mt-5 space-y-2 text-sm">
					<SummaryLine label="Subtotal" value="₦204,000" />
					<SummaryLine label="VAT 7.5%" value="₦15,300" />
					<SummaryLine label="WHT" value="-₦10,200" />
					<div className="hm-rule-t flex justify-between pt-3 text-lg font-bold">
						<span>Net payable</span>
						<span className="hm-num">₦209,100</span>
					</div>
				</div>

				<p className="hm-lede mt-5 text-sm">
					Customer sees invoice, downloads PDF, or pays by card.
				</p>
			</div>

			<div
				className="hm-rule-t p-5 sm:p-6"
				style={{ background: "var(--hm-paper-2)" }}
			>
				<p className="hm-chip w-fit" style={{ color: "var(--hm-accent-hi)" }}>
					<CreditCard className="h-4 w-4" aria-hidden="true" />
					Paystack checkout ready
				</p>

				<div className="mt-4">
					{invoiceRows.map((invoice) => (
						<PreviewRow key={invoice.number} {...invoice} />
					))}
				</div>

				<div className="mt-5 grid grid-cols-2 gap-3">
					<MiniStat icon={Banknote} label="Open" value="₦266k" />
					<MiniStat icon={FileText} label="Paid" value="₦420k" />
				</div>
			</div>
		</div>
	);
}

function Metric({
	index,
	value,
	label,
}: {
	index: string;
	value: string;
	label: string;
}) {
	return (
		<div className="hm-rule-t min-w-0 pt-4">
			<span className="hm-num text-xs" style={{ color: "var(--hm-ink-3)" }}>
				{index}
			</span>
			<dd
				className="hm-num mt-2 text-3xl font-bold"
				style={{ color: "var(--hm-accent)" }}
			>
				{value}
			</dd>
			<dt className="hm-label mt-1">{label}</dt>
		</div>
	);
}

function PaperRow({
	item,
	qty,
	total,
}: {
	item: string;
	qty: string;
	total: string;
}) {
	return (
		<div className="hm-rule-t grid grid-cols-[minmax(0,1fr)_2rem_5.5rem] gap-3 py-3 text-sm">
			<span className="min-w-0">{item}</span>
			<span className="hm-num text-right" style={{ color: "var(--hm-ink-3)" }}>
				{qty}
			</span>
			<span className="hm-num text-right font-semibold">{total}</span>
		</div>
	);
}

function SummaryLine({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex justify-between" style={{ color: "var(--hm-ink-2)" }}>
			<span>{label}</span>
			<span className="hm-num">{value}</span>
		</div>
	);
}

function PreviewRow({
	number,
	client,
	amount,
	status,
}: {
	number: string;
	client: string;
	amount: string;
	status: string;
}) {
	const tone =
		status === "Paid"
			? "var(--hm-ok)"
			: status === "Unpaid"
				? "var(--hm-warn)"
				: "var(--hm-ink-3)";
	return (
		<div className="hm-rule-t grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-3">
			<div className="min-w-0">
				<p className="hm-num truncate text-sm font-semibold">{number}</p>
				<p className="hm-lede mt-0.5 truncate text-xs">{client}</p>
			</div>
			<div className="text-right">
				<p className="hm-num text-sm font-semibold">{amount}</p>
				<p className="mt-0.5 text-xs" style={{ color: tone }}>
					{status}
				</p>
			</div>
		</div>
	);
}

function MiniStat({
	icon: Icon,
	label,
	value,
}: {
	icon: typeof Banknote;
	label: string;
	value: string;
}) {
	return (
		<div className="hm-card min-w-0 p-3">
			<Icon
				className="h-4 w-4"
				style={{ color: "var(--hm-accent)" }}
				aria-hidden="true"
			/>
			<p className="hm-label mt-3">{label}</p>
			<p className="hm-num mt-1 text-sm font-semibold">{value}</p>
		</div>
	);
}

function FeatureCard({
	icon: Icon,
	title,
	description,
}: {
	icon: typeof Receipt;
	title: string;
	description: string;
}) {
	return (
		<article data-fade-scroll className="hm-card hm-card--lift min-w-0 p-5">
			<span
				className="flex h-10 w-10 items-center justify-center"
				style={{
					borderRadius: "10px",
					background: "var(--hm-accent-soft)",
					color: "var(--hm-accent-hi)",
				}}
			>
				<Icon className="h-5 w-5" aria-hidden="true" />
			</span>
			<h3 className="hm-title mt-5 text-xl">{title}</h3>
			<p className="hm-lede mt-3 text-sm">{description}</p>
		</article>
	);
}

function TrustItem({
	icon: Icon,
	title,
}: {
	icon: typeof ShieldCheck;
	title: string;
}) {
	return (
		<div
			data-fade-scroll
			className="hm-card hm-card--soft flex min-w-0 items-center gap-3 px-4 py-4"
		>
			<Icon
				className="h-5 w-5 shrink-0"
				style={{ color: "var(--hm-accent)" }}
				aria-hidden="true"
			/>
			<p className="text-sm font-semibold">{title}</p>
		</div>
	);
}
