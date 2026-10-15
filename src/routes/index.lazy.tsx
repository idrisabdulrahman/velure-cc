import { createLazyFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowRight,
	BarChart3,
	BellRing,
	Check,
	FileDown,
	FileText,
	Hash,
	KeyRound,
	Link2,
	LockKeyhole,
	Mail,
	PlayCircle,
	Receipt,
	ShieldCheck,
	Users,
} from "lucide-react";
import { useEffect, useRef } from "react";
import {
	MarketingFooter,
	MarketingNav,
} from "#/components/marketing/MarketingLayout";
import { useLandingMotion } from "#/components/marketing/useLandingMotion";
import { authClient } from "#/lib/auth-client";

export const Route = createLazyFileRoute("/")({
	component: LandingPage,
});

/* The mock's hero window, bento cards and reminder queue all render sample
 * invoices. They are illustrative product UI, so every one of them carries an
 * explicit sample note — no mock figure ships unlabelled (and none of them is
 * presented as a product claim). The compliance figures below are the app's
 * real seeded tax rule set, so they need no such note. */
function SampleNote() {
	return (
		<p className="mt-3 text-center text-[12px] text-[var(--hm-ink-3)]">
			Sample data shown for illustration.
		</p>
	);
}

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

const securityRows = [
	{
		icon: Users,
		title: "Role model",
		detail:
			"Owner, member, viewer. Viewer roles cannot write operational records.",
	},
	{
		icon: LockKeyhole,
		title: "Server-side checks",
		detail: "Membership is verified before data access.",
	},
	{
		icon: ShieldCheck,
		title: "No cross-workspace leaks",
		detail: "Mutations validate workspace ownership before writes.",
	},
	{
		icon: KeyRound,
		title: "Sign-in",
		detail: "Password reset and OAuth handled by Better Auth.",
	},
	{
		icon: Hash,
		title: "Invoice numbering",
		detail:
			"Sequential numbers with year context, no duplicates, and no reuse of canceled invoice numbers.",
	},
	{
		icon: FileText,
		title: "Your records",
		detail: "Exportable records support backup and audit workflows.",
	},
] as const;

const bentoTiles = [
	{
		className: "lg:col-span-4",
		title: "Invoices that collect",
		description:
			"Public invoice links, Paystack checkout, PDF generation, and customer-safe views in one flow.",
	},
	{
		className: "lg:col-span-2",
		title: "Client records stay close",
		description:
			"Emails, TIN, payment terms, notes, and invoice history beside the work that needs them.",
	},
	{
		className: "lg:col-span-2",
		title: "Follow-ups without noise",
		description:
			"Schedule reminders through Resend while manual exceptions stay visible for the finance owner.",
	},
	{
		className: "lg:col-span-4",
		title: "Accountant-ready exports",
		description:
			"Download invoice CSV, tax summary CSV, customer ledgers, or styled invoice PDFs when needed.",
	},
] as const;

// WHT rows — identical to the `ng-2026-q1` seed in
// supabase/migrations/20260815140902_phase_a5_tax_rule_sets.sql, as is the
// 7.5% VAT figure above. Real reference data, not copywriting.
const whtRows = [
	{ category: "Goods / materials", resident: "2%", nonResident: "0%" },
	{ category: "General services", resident: "2%", nonResident: "5%" },
	{ category: "Professional fees", resident: "5%", nonResident: "10%" },
] as const;

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
						{/* ── 1 · HERO ── */}
						<header
							id="top"
							className="relative isolate overflow-hidden pt-[150px] sm:pt-[150px]"
						>
							<div className="hm-wash" aria-hidden="true" />
							<div
								className="pointer-events-none absolute inset-0 -z-[1]"
								aria-hidden="true"
								style={{
									backgroundImage:
										"repeating-linear-gradient(90deg,transparent 0 calc(100%/6 - 1px),rgba(255,255,255,.035) calc(100%/6 - 1px) calc(100%/6))",
									WebkitMaskImage:
										"linear-gradient(180deg,#000 0,#000 40%,transparent 92%)",
									maskImage:
										"linear-gradient(180deg,#000 0,#000 40%,transparent 92%)",
								}}
							/>

							<div className="relative mx-auto grid w-full max-w-[1160px] justify-items-center px-5 text-center sm:px-7">
								<span className="hm-chip w-fit" data-fade-scroll>
									Invoice operations for small business
								</span>
								<h1
									data-split
									className="hm-display font-medium mt-[26px] text-[clamp(2.875rem,8.2vw,6.5rem)] leading-[0.98] tracking-[-0.05em]"
								>
									Send the bill.
									<br />
									<span className="text-[var(--hm-ink-2)]">
										Track the trail.
									</span>
								</h1>
								<p className="hm-lede mx-auto mt-[26px] max-w-[54ch] text-[clamp(1rem,1.6vw,1.1875rem)]">
									Velure turns invoices, clients, tax lines, reminders, PDFs,
									and exports into one tight workspace for Nigerian businesses.
								</p>
								<div className="mt-[34px] flex flex-wrap justify-center gap-3">
									<Link
										to="/auth"
										data-magnetic
										className="hm-btn hm-btn--primary hm-btn--xl"
									>
										Open workspace
										<ArrowRight className="h-4 w-4" />
									</Link>
									<a
										href="#features"
										className="hm-btn hm-btn--ghost hm-btn--xl"
									>
										<PlayCircle className="h-4 w-4" />
										See the system
									</a>
								</div>
							</div>

							<HeroStage />
						</header>

						{/* ── 2 · TRAIL STRIP ── */}
						<section className="px-5 pb-[90px] pt-11 sm:px-7">
							<ol className="relative mx-auto grid max-w-[1160px] gap-7 pt-[30px] sm:grid-cols-2 lg:grid-cols-4">
								<span
									aria-hidden="true"
									className="absolute inset-x-0 top-[5px] hidden h-px sm:block"
									style={{
										background:
											"linear-gradient(90deg,var(--hm-accent-line),var(--hm-rule) 30%,var(--hm-rule) 85%,transparent)",
									}}
								/>
								{checkpoints.map((item, index) => (
									<li key={item} data-fade-scroll className="relative">
										<span
											aria-hidden="true"
											className="absolute -top-[30px] left-0 hidden h-[11px] w-[11px] rounded-full border-2 border-[var(--hm-accent)] bg-[var(--hm-paper)] sm:block"
										/>
										<span className="hm-num text-xs text-[var(--hm-accent)]">
											0{index + 1}
										</span>
										<p className="mt-2 max-w-[26ch] text-[15px]">{item}</p>
									</li>
								))}
							</ol>
						</section>

						{/* ── 3 · BENTO ── */}
						<section id="features" className="px-5 py-[110px] sm:px-7">
							<div className="mx-auto max-w-[1160px]">
								<div className="mb-[46px] grid items-end gap-10 lg:grid-cols-[1.05fr_1fr]">
									<div>
										<p className="hm-kicker" data-fade-scroll>
											What feels different
										</p>
										<h2
											className="hm-display font-medium mt-[14px] text-[clamp(2rem,4.6vw,3.5rem)] leading-[1.04] tracking-[-0.035em]"
											data-fade-scroll
										>
											Not another
											<br />
											dead invoice list.
										</h2>
									</div>
									<p className="hm-lede text-[17px] lg:mb-1" data-fade-scroll>
										Velure is built around what happens after an invoice leaves
										your desk: payment, reminders, tax records, and clean
										exports.
									</p>
								</div>

								<div className="grid gap-3.5 lg:grid-cols-6">
									{bentoTiles.map((tile, index) => (
										<article
											key={tile.title}
											data-fade-scroll
											className={`hm-card hm-card--lift flex min-h-[280px] flex-col p-6 ${tile.className}`}
										>
											<h3 className="hm-title font-medium leading-[1.55] text-xl">
												{tile.title}
											</h3>
											<p className="hm-lede mt-2 max-w-[40ch] text-[14.5px]">
												{tile.description}
											</p>
											<div className="mt-auto pt-[22px]">
												<TileVisual index={index} />
											</div>
										</article>
									))}
								</div>
							</div>
						</section>

						{/* ── 4 · REMINDERS ── */}
						<section id="reminders" className="px-5 py-[110px] sm:px-7">
							<div className="mx-auto grid max-w-[1160px] items-center gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
								<ReminderQueue />
								<div>
									<p className="hm-kicker" data-fade-scroll>
										Payment reminders
									</p>
									<h2
										className="hm-display font-medium mt-[14px] text-[clamp(2rem,4.6vw,3.5rem)] leading-[1.04] tracking-[-0.035em]"
										data-fade-scroll
									>
										Polite by default.
										<br />
										Visible when it isn't.
									</h2>
									<p
										className="hm-lede mt-[18px] max-w-[46ch] text-[17px]"
										data-fade-scroll
									>
										Find unpaid invoices, queue polite customer emails, and move
										exceptions into internal review. It stays inside invoicing,
										with no legal escalation tools.
									</p>
									<div className="mt-[34px]">
										{[
											{
												when: "−3d",
												title: "First reminder",
												detail: "Goes out three days before the due date.",
											},
											{
												when: "0d",
												title: "Due date",
												detail: "A plain nudge on the day it falls due.",
											},
											{
												when: "+3d",
												title: "Then every 3 days",
												detail:
													"Pause one invoice or mark it for manual follow-up anytime.",
											},
										].map((row) => (
											<div
												key={row.when}
												data-fade-scroll
												className="grid grid-cols-[64px_1fr] items-baseline gap-4 border-t border-[var(--hm-rule-soft)] py-4 last:border-b"
											>
												<span className="hm-num text-[15px] font-medium text-[var(--hm-accent)]">
													{row.when}
												</span>
												<div>
													<b className="block font-medium">{row.title}</b>
													<span className="hm-lede text-sm">{row.detail}</span>
												</div>
											</div>
										))}
									</div>
								</div>
							</div>
						</section>

						{/* ── 5 · COMPLIANCE DIPTYCH ── */}
						<section id="compliance" className="grid lg:grid-cols-2">
							<div className="flex flex-col justify-center bg-[var(--hm-paper-2)] px-5 py-[70px] sm:px-7 lg:py-[90px] lg:pl-[max(1.75rem,calc((100vw-1160px)/2+1.75rem))] lg:pr-14">
								{/* design/landing.html `.big` is display *sans* at 500, not the
								    numeral role — the reference sets `font: 500 … var(--sans)`.
								    Money elsewhere still uses `.hm-num`. */}
								<p
									data-fade-scroll
									className="text-[clamp(6rem,15vw,12.5rem)] font-medium leading-[0.85] tracking-[-0.07em]"
								>
									7.5
									<sup className="relative top-[0.12em] ml-[0.04em] align-top text-[0.34em] tracking-[-0.02em] text-[var(--hm-accent)]">
										%
									</sup>
								</p>
								<p
									className="hm-lede mt-3.5 max-w-[46ch] text-[15px]"
									data-fade-scroll
								>
									Nigeria standard VAT, applied by default to taxable supplies.
								</p>

								<div
									data-fade-scroll
									className="mt-11 max-w-[480px] overflow-hidden rounded-[14px] border border-[var(--hm-rule)] bg-[var(--hm-paper)]"
								>
									<div className="grid grid-cols-[1fr_70px_100px] gap-2.5 px-4 py-2.5 hm-caps">
										<span>WHT category</span>
										<span className="text-right">Resident</span>
										<span className="text-right">Non-resident</span>
									</div>
									{whtRows.map((row) => (
										<div
											key={row.category}
											className="grid grid-cols-[1fr_70px_100px] items-center gap-2.5 border-t border-[var(--hm-rule-soft)] px-4 py-[11px] text-[13px]"
										>
											<span>{row.category}</span>
											<span className="hm-num text-right">{row.resident}</span>
											<span className="hm-num text-right">
												{row.nonResident}
											</span>
										</div>
									))}
								</div>
							</div>

							<div
								className="flex flex-col justify-center px-5 py-[70px] text-[#fff3ee] sm:px-7 lg:py-[90px] lg:pl-16 lg:pr-[max(1.75rem,calc((100vw-1160px)/2+1.75rem))]"
								style={{
									backgroundImage: "linear-gradient(160deg,#c23a2e,#a82e24)",
								}}
							>
								<p className="hm-kicker text-[#ffd6cc]" data-fade-scroll>
									Finance review
								</p>
								<h2
									className="hm-display font-medium mt-[14px] text-[clamp(2rem,4.6vw,3.5rem)] leading-[1.04] tracking-[-0.035em] text-white"
									data-fade-scroll
								>
									Compliance support,
									<br />
									not legal advice.
								</h2>
								<ul className="mt-[34px] max-w-[480px]">
									{[
										"Flag missing seller or buyer tax IDs.",
										"Show manual tax and WHT override warnings.",
										"Export tax summaries for accountant review.",
										"Keep compliance snapshots attached to invoices.",
									].map((item) => (
										<li
											key={item}
											data-fade-scroll
											className="flex items-start gap-3.5 border-t border-white/[0.22] py-3.5 text-[15.5px] last:border-b"
										>
											<Check className="mt-[3px] h-[18px] w-[18px] shrink-0 text-white" />
											{item}
										</li>
									))}
								</ul>
								<p
									className="mt-[26px] max-w-[46ch] text-sm text-[#ffd6cc]"
									data-fade-scroll
								>
									Velure helps structure invoice data for Nigerian finance
									workflows. Confirm VAT, WHT, and filing treatment with your
									accountant or tax advisor.
								</p>
							</div>
						</section>

						{/* ── 6 · LAUNCH FLOW ── */}
						<section className="px-5 py-[110px] sm:px-7">
							<div className="mx-auto grid max-w-[1160px] items-stretch gap-10 lg:grid-cols-[1.2fr_1fr] lg:gap-14">
								<div>
									<p className="hm-kicker" data-fade-scroll>
										Launch flow
									</p>
									<h2
										className="hm-display font-medium mt-[14px] mb-9 text-[clamp(2rem,4.6vw,3.5rem)] leading-[1.04] tracking-[-0.035em]"
										data-fade-scroll
									>
										Look organized before
										<br />
										finance gets complicated.
									</h2>
									{flowSteps.map((flow) => (
										<div
											key={flow.step}
											data-fade-scroll
											className="grid grid-cols-[44px_1fr_auto] items-baseline gap-4 border-t border-[var(--hm-rule)] py-6 transition-all last:border-b hover:pl-2"
										>
											<span className="hm-num text-[13px] text-[var(--hm-accent)]">
												{flow.step}
											</span>
											<div>
												<h3 className="hm-title font-medium leading-[1.55] text-[22px]">
													{flow.title}
												</h3>
												<p className="hm-lede mt-1 text-[14.5px]">
													{flow.detail}
												</p>
											</div>
											<span className="hidden rounded-full border border-[var(--hm-rule)] px-2.5 py-[3px] text-xs text-[var(--hm-ink-3)] sm:inline-block">
												{flow.owner}
											</span>
										</div>
									))}
								</div>

								<div
									data-fade-scroll
									className="flex flex-col justify-end gap-[22px] rounded-[20px] border border-[var(--hm-accent-line)] p-[34px]"
									style={{
										backgroundImage:
											"radial-gradient(420px 300px at 100% 0,rgba(229,72,59,.22),transparent 70%)",
										backgroundColor: "var(--hm-paper-2)",
									}}
								>
									<h3 className="hm-display font-medium text-[clamp(1.625rem,3vw,2.25rem)] leading-[1.1] tracking-[-0.03em]">
										Start with one invoice. Keep the whole finance trail.
									</h3>
									<p className="hm-lede max-w-[38ch] text-[15px]">
										Create the first one, send the link, collect payment, and
										export the record when your accountant asks.
									</p>
									<div>
										<Link
											to="/auth"
											data-magnetic
											className="hm-btn hm-btn--primary w-fit"
										>
											Create workspace
											<ArrowRight className="h-4 w-4" />
										</Link>
									</div>
								</div>
							</div>
						</section>

						{/* ── 7 · SECURITY ── */}
						<section id="security" className="px-5 py-[110px] pt-10 sm:px-7">
							<div className="mx-auto grid max-w-[1160px] gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-[72px]">
								<div>
									<p className="hm-kicker" data-fade-scroll>
										Security
									</p>
									<h2
										className="hm-display font-medium mt-[14px] text-[clamp(2rem,4.6vw,3.5rem)] leading-[1.04] tracking-[-0.035em]"
										data-fade-scroll
									>
										Built to keep billing data controlled.
									</h2>
									<p
										className="hm-lede mt-[18px] max-w-[46ch] text-[17px]"
										data-fade-scroll
									>
										Access is authenticated, workspace-scoped, and designed
										around plain operational controls finance users can
										understand.
									</p>
									<div className="mt-[34px] flex flex-wrap gap-2.5">
										{[
											{ icon: ShieldCheck, label: "Private by workspace" },
											{ icon: Mail, label: "Email/password first" },
											{ icon: Link2, label: "Public invoices by token" },
										].map((chip) => (
											<span
												key={chip.label}
												data-fade-scroll
												className="inline-flex h-[34px] items-center gap-2.5 rounded-full border border-[var(--hm-rule)] bg-[var(--hm-paper-2)] px-3.5 text-[13px]"
											>
												<chip.icon
													className="h-[15px] w-[15px] text-[var(--hm-accent)]"
													aria-hidden="true"
												/>
												{chip.label}
											</span>
										))}
									</div>
								</div>

								<dl
									className="m-0 border-t border-[var(--hm-rule)]"
									data-fade-scroll
								>
									{securityRows.map((row) => (
										<div
											key={row.title}
											className="grid gap-1.5 border-b border-[var(--hm-rule)] py-5 sm:grid-cols-[200px_1fr] sm:gap-[22px]"
										>
											<dt className="flex items-center gap-2.5 font-medium">
												<row.icon
													className="h-4 w-4 text-[var(--hm-accent)]"
													aria-hidden="true"
												/>
												{row.title}
											</dt>
											<dd className="hm-lede m-0 text-[15px]">{row.detail}</dd>
										</div>
									))}
								</dl>
							</div>
						</section>
					</main>

					<MarketingFooter />
				</div>
			</div>
		</div>
	);
}

/* ── Hero stage: the product window, two floating notifications, and an
 * explicit sample-data note (design/landing.html `.stage`). ── */
function HeroStage() {
	const kpis = [
		{ label: "Open", value: "₦4.5M", color: "var(--hm-warn)" },
		{ label: "Overdue", value: "₦0.8M", color: "var(--hm-accent)" },
		{ label: "Paid", value: "₦2.1M", color: "var(--hm-ok)" },
		{ label: "Drafts", value: "3", color: "var(--hm-info)" },
	];
	const rows = [
		{
			no: "INV-2026-0042",
			who: "Adaeze Foods Ltd",
			status: "Sent",
			tone: "warn",
			due: "21/10/2026",
			amount: "₦2,418,750",
		},
		{
			no: "INV-2026-0041",
			who: "Kwara Solar Supply",
			status: "Overdue",
			tone: "bad",
			due: "12/09/2026",
			amount: "₦812,500",
		},
		{
			no: "INV-2026-0038",
			who: "Ilorin Print Works",
			status: "Paid",
			tone: "ok",
			due: "02/10/2026",
			amount: "₦620,000",
		},
		{
			no: "INV-2026-0037",
			who: "No customer yet",
			status: "Draft",
			tone: "mute",
			due: "28/10/2026",
			amount: "₦0",
		},
	] as const;

	return (
		<div className="relative mx-auto mt-[76px] max-w-[1060px] px-5 sm:px-7">
			<div
				data-fade-scroll
				className="absolute -left-4 top-[340px] z-[3] hidden max-w-[300px] items-start gap-3 rounded-[14px] border border-[var(--hm-rule)] bg-[var(--hm-paper-3)]/95 p-4 text-[13px] shadow-[0_24px_60px_rgba(0,0,0,.6)] backdrop-blur-md xl:flex"
			>
				<span className="grid h-8 w-8 flex-none place-items-center rounded-[9px] bg-[var(--hm-ok-soft)] text-[var(--hm-ok)]">
					<Check className="h-4 w-4" />
				</span>
				<div>
					<b className="block font-medium text-[13.5px]">Paid with Paystack</b>
					<span className="hm-num mt-0.5 block text-xs text-[var(--hm-ink-2)]">
						₦620,000 · INV-2026-0038 · just now
					</span>
				</div>
			</div>
			<div
				data-fade-scroll
				className="absolute -right-4 top-[400px] z-[3] hidden max-w-[300px] items-start gap-3 rounded-[14px] border border-[var(--hm-rule)] bg-[var(--hm-paper-3)]/95 p-4 text-[13px] shadow-[0_24px_60px_rgba(0,0,0,.6)] backdrop-blur-md xl:flex"
			>
				<span className="grid h-8 w-8 flex-none place-items-center rounded-[9px] bg-[var(--hm-warn-soft)] text-[var(--hm-warn)]">
					<BellRing className="h-4 w-4" />
				</span>
				<div>
					<b className="block font-medium text-[13.5px]">Reminder queued</b>
					<span className="mt-0.5 block text-xs leading-[1.4] text-[var(--hm-ink-2)]">
						3 days before due · sent to the customer by email
					</span>
				</div>
			</div>

			<div
				data-fade-scroll
				className="overflow-hidden rounded-[18px] border border-[var(--hm-rule)] shadow-[0_40px_120px_rgba(0,0,0,.65)]"
				style={{
					backgroundImage: "linear-gradient(180deg,var(--hm-paper-2),#0d0908)",
					transform: "perspective(1600px) rotateX(6deg)",
					transformOrigin: "50% 100%",
					WebkitMaskImage: "linear-gradient(180deg,#000 55%,transparent 100%)",
					maskImage: "linear-gradient(180deg,#000 55%,transparent 100%)",
				}}
			>
				<div className="flex h-[42px] items-center gap-[7px] border-b border-[var(--hm-rule-soft)] px-4 text-xs text-[var(--hm-ink-3)]">
					<i className="h-[9px] w-[9px] rounded-full bg-[var(--hm-paper-4)]" />
					<i className="h-[9px] w-[9px] rounded-full bg-[var(--hm-paper-4)]" />
					<i className="h-[9px] w-[9px] rounded-full bg-[var(--hm-paper-4)]" />
					<span className="ml-2.5">velure · Sample workspace</span>
				</div>
				<div className="grid min-h-[430px] sm:grid-cols-[170px_1fr]">
					<aside className="hidden gap-0.5 border-r border-[var(--hm-rule-soft)] p-2.5 text-[12.5px] text-[var(--hm-ink-2)] sm:grid sm:content-start">
						<b className="px-2.5 pb-1.5 pt-2.5 hm-caps hm-caps--side">
							Workspace
						</b>
						<span className="relative flex h-[30px] items-center gap-2.5 rounded-[7px] bg-[linear-gradient(90deg,var(--hm-accent-soft),transparent)] px-2.5 text-[var(--hm-ink)]">
							<span
								aria-hidden="true"
								className="absolute inset-y-[7px] left-0 w-0.5 rounded-sm bg-[var(--hm-accent)]"
							/>
							<Receipt className="h-3.5 w-3.5" /> Invoices
						</span>
						<span className="flex h-[30px] items-center gap-2.5 rounded-[7px] px-2.5">
							<Users className="h-3.5 w-3.5" /> Clients
						</span>
						<span className="flex h-[30px] items-center gap-2.5 rounded-[7px] px-2.5">
							<BarChart3 className="h-3.5 w-3.5" /> Reports
						</span>
						<b className="px-2.5 pb-1.5 pt-2.5 hm-caps hm-caps--side">
							Settings
						</b>
						<span className="flex h-[30px] items-center gap-2.5 rounded-[7px] px-2.5">
							<ShieldCheck className="h-3.5 w-3.5" /> Compliance
						</span>
						<span className="flex h-[30px] items-center gap-2.5 rounded-[7px] px-2.5">
							<BellRing className="h-3.5 w-3.5" /> Reminders
						</span>
					</aside>

					<div className="p-5 sm:p-[22px]">
						<div className="mb-4 flex items-center justify-between">
							<b className="text-xl font-medium tracking-[-0.02em]">Invoices</b>
							<span className="inline-flex h-7 items-center rounded-[7px] bg-[var(--hm-accent)] px-3 text-xs font-medium text-white">
								New invoice
							</span>
						</div>

						<div className="grid grid-cols-2 overflow-hidden rounded-xl border border-[var(--hm-rule)] bg-[var(--hm-paper-2)] sm:grid-cols-4">
							{kpis.map((kpi, index) => (
								<div
									key={kpi.label}
									className={`p-3.5 ${index > 0 ? "border-l border-[var(--hm-rule-soft)]" : ""} ${index > 1 ? "border-t border-[var(--hm-rule-soft)] sm:border-t-0" : ""}`}
								>
									<small className="flex items-center gap-[7px] text-[11px] text-[var(--hm-ink-2)]">
										<i
											className="h-1.5 w-1.5 rounded-full"
											style={{ background: kpi.color }}
										/>
										{kpi.label}
									</small>
									<b className="hm-num mt-[7px] block text-lg font-medium tracking-[-0.02em]">
										{kpi.value}
									</b>
								</div>
							))}
						</div>

						<div className="mt-3.5 overflow-hidden rounded-xl border border-[var(--hm-rule)] bg-[var(--hm-paper-2)]">
							<div className="grid grid-cols-[1.4fr_1fr] gap-3 border-b border-[var(--hm-rule-soft)] px-4 py-2 hm-caps sm:grid-cols-[1.5fr_1fr_1fr_1fr]">
								<span>Invoice</span>
								<span>Status</span>
								<span className="hidden sm:block">Due</span>
								<span className="hidden text-right sm:block">Amount</span>
							</div>
							{rows.map((row) => (
								<div
									key={row.no}
									className="grid grid-cols-[1.4fr_1fr] items-center gap-3 border-b border-[var(--hm-rule-soft)] px-4 py-[11px] text-[12.5px] last:border-b-0 sm:grid-cols-[1.5fr_1fr_1fr_1fr]"
								>
									<span className="hm-num truncate text-xs">
										{row.no}
										<small className="block truncate text-[11.5px] text-[var(--hm-ink-3)]">
											{row.who}
										</small>
									</span>
									<StatusPill tone={row.tone}>{row.status}</StatusPill>
									<span className="hm-num hidden sm:block">{row.due}</span>
									<span className="hm-num hidden text-right sm:block">
										{row.amount}
									</span>
								</div>
							))}
						</div>
					</div>
				</div>
			</div>
			<SampleNote />
		</div>
	);
}

function StatusPill({
	tone,
	children,
}: {
	tone: "warn" | "bad" | "ok" | "info" | "mute";
	children: React.ReactNode;
}) {
	const tones = {
		warn: "text-[var(--hm-warn)] bg-[var(--hm-warn-soft)]",
		bad: "text-[var(--hm-danger)] bg-[var(--hm-danger-soft)]",
		ok: "text-[var(--hm-ok)] bg-[var(--hm-ok-soft)]",
		info: "text-[var(--hm-info)] bg-[var(--hm-info-soft)]",
		mute: "text-[var(--hm-ink-2)] bg-white/5",
	} as const;
	return (
		<span
			className={`inline-flex h-[22px] w-max items-center gap-1.5 rounded-full px-[9px] text-[11.5px] font-medium ${tones[tone]}`}
		>
			<i className="h-1.5 w-1.5 rounded-full bg-current" />
			{children}
		</span>
	);
}

/* ── Bento tile visuals (design/landing.html `.vis`). Each one that shows
 * sample figures carries its own sample note. ── */
function TileVisual({ index }: { index: number }) {
	if (index === 0) {
		return (
			<div className="grid gap-3.5 sm:grid-cols-[1.3fr_1fr]">
				<div className="rounded-xl bg-[#f6f1ec] p-4 text-[#1b1412] shadow-[0_14px_40px_rgba(0,0,0,.5)]">
					<div className="flex items-start justify-between gap-2.5">
						<div className="flex items-center gap-[9px]">
							<span className="grid h-7 w-7 place-items-center rounded-lg bg-[#e5483b] text-[13px] font-semibold text-white">
								F
							</span>
							<div>
								<b className="block text-[12.5px] font-semibold">Fr35No Inc.</b>
								<small className="block text-[10.5px] leading-[1.4] text-[#6d5f58]">
									Ilorin, Kwara State
								</small>
							</div>
						</div>
						<span className="hm-num text-right text-[10px] font-semibold text-[#6d5f58]">
							INVOICE
							<br />
							<span className="text-[#1b1412]">INV-2026-0042</span>
						</span>
					</div>
					<hr className="my-[11px] border-0 border-t border-[#ddd2ca]" />
					<div className="flex justify-between text-[11px] text-[#8f7f75]">
						<span>Bill to</span>
						<span>Due in 14 days</span>
					</div>
					<div className="text-[11px] text-[#3a2f2a]">Adaeze Foods Ltd</div>
					<hr className="my-[11px] border-0 border-t border-[#ddd2ca]" />
					<div className="flex justify-between text-[11px] text-[#3a2f2a]">
						<span>Solar panel 730W × 4</span>
						<span className="hm-num">₦620,000</span>
					</div>
					<div className="flex justify-between text-[11px] text-[#3a2f2a]">
						<span>VAT 7.5%</span>
						<span className="hm-num">₦46,500</span>
					</div>
					<div className="mt-1.5 flex justify-between text-[12.5px] font-semibold">
						<span>Total</span>
						<span className="hm-num">₦666,500</span>
					</div>
					<SampleNote />
				</div>
				<div className="grid content-center gap-3 rounded-xl border border-[var(--hm-rule)] bg-[var(--hm-paper)] p-4">
					<div className="hm-num text-2xl font-medium tracking-[-0.03em]">
						<small className="mb-1.5 block text-xs text-[var(--hm-ink-3)]">
							Amount due
						</small>
						₦666,500
					</div>
					<div className="grid h-[38px] place-items-center rounded-[9px] bg-[var(--hm-accent)] text-[13px] font-medium text-white">
						Pay with Paystack
					</div>
					<div className="flex flex-wrap gap-1.5">
						<span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-[var(--hm-rule)] px-[9px] text-[11.5px] text-[var(--hm-ink-2)]">
							<Link2 className="h-3 w-3" /> Public link
						</span>
						<span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-[var(--hm-rule)] px-[9px] text-[11.5px] text-[var(--hm-ink-2)]">
							<FileDown className="h-3 w-3" /> PDF
						</span>
					</div>
				</div>
			</div>
		);
	}

	if (index === 1) {
		return (
			<div className="grid gap-3 rounded-xl border border-[var(--hm-rule)] bg-[var(--hm-paper)] p-3.5">
				<div className="flex items-center gap-[11px]">
					<span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-[var(--hm-accent-soft)] text-xs font-semibold text-[var(--hm-accent-on-soft)] shadow-[inset_0_0_0_1px_var(--hm-accent-line)]">
						AF
					</span>
					<div>
						<b className="block text-sm font-medium">Adaeze Foods Ltd</b>
						<span className="text-xs text-[var(--hm-ink-2)]">
							accounts@adaezefoods.ng
						</span>
					</div>
				</div>
				<dl className="m-0 grid grid-cols-[auto_1fr] gap-1.5 text-[12.5px]">
					<dt className="text-[var(--hm-ink-3)]">TIN</dt>
					<dd className="hm-num m-0 text-right">12345678-0001</dd>
					<dt className="text-[var(--hm-ink-3)]">Terms</dt>
					<dd className="m-0 text-right">Net 14</dd>
					<dt className="text-[var(--hm-ink-3)]">Invoices</dt>
					<dd className="hm-num m-0 text-right">6</dd>
				</dl>
				<SampleNote />
			</div>
		);
	}

	if (index === 2) {
		return (
			<div className="grid gap-2">
				<div className="flex items-center gap-2.5 rounded-[10px] border border-[var(--hm-rule-soft)] bg-[var(--hm-paper)] px-3 py-2.5 text-[12.5px]">
					<span className="hm-num w-11 text-[11.5px] text-[var(--hm-ink-3)]">
						−3d
					</span>
					<span className="flex-1">First reminder</span>
					<StatusPill tone="ok">Auto</StatusPill>
				</div>
				<div className="flex items-center gap-2.5 rounded-[10px] border border-[var(--hm-rule-soft)] bg-[var(--hm-paper)] px-3 py-2.5 text-[12.5px]">
					<span className="hm-num w-11 text-[11.5px] text-[var(--hm-ink-3)]">
						+3d
					</span>
					<span className="flex-1">Customer promised Friday</span>
					<StatusPill tone="warn">Manual</StatusPill>
				</div>
				<SampleNote />
			</div>
		);
	}

	return (
		<div className="grid gap-2.5 sm:grid-cols-2">
			{(
				[
					{
						ext: "CSV",
						label: "Invoice report",
						sub: "Every invoice with VAT and status",
						tone: "info",
					},
					{
						ext: "CSV",
						label: "Tax summary",
						sub: "VAT and WHT by month",
						tone: "bad",
					},
					{
						ext: "CSV",
						label: "Customer ledger",
						sub: "What each customer owes",
						tone: "ok",
					},
					{
						ext: "PDF",
						label: "Styled invoice",
						sub: "Ready to send or print",
						tone: "warn",
					},
				] as const
			).map((file) => (
				<div
					key={file.label}
					className="flex items-center gap-[11px] rounded-[11px] border border-[var(--hm-rule)] bg-[var(--hm-paper)] px-3.5 py-3 text-[13px] transition-colors hover:border-[var(--hm-accent-line)]"
				>
					<span
						className={`hm-num grid h-8 w-8 flex-none place-items-center rounded-lg text-[10px] font-semibold ${file.tone === "info" ? "bg-[var(--hm-info-soft)] text-[var(--hm-info)]" : file.tone === "bad" ? "bg-[var(--hm-danger-soft)] text-[var(--hm-danger)]" : file.tone === "ok" ? "bg-[var(--hm-ok-soft)] text-[var(--hm-ok)]" : "bg-[var(--hm-warn-soft)] text-[var(--hm-warn)]"}`}
					>
						{file.ext}
					</span>
					<div className="min-w-0">
						{file.label}
						<small className="block truncate text-[11.5px] text-[var(--hm-ink-3)]">
							{file.sub}
						</small>
					</div>
				</div>
			))}
		</div>
	);
}

/* ── Reminders queue card (design/landing.html `.queue`) ── */
function ReminderQueue() {
	const rows = [
		{
			initials: "KS",
			no: "INV-2026-0041",
			who: "Kwara Solar Supply",
			amount: "₦812,500",
			due: "due 12/09/2026",
			tags: [{ label: "12 days overdue", tone: "bad" as const }],
			selected: true,
		},
		{
			initials: "AF",
			no: "INV-2026-0042",
			who: "Adaeze Foods Ltd",
			amount: "₦2,418,750",
			due: "due 21/10/2026",
			tags: [
				{ label: "Due in 3 days", tone: "mute" as const },
				{ label: "Reminder queued", tone: "info" as const },
			],
			selected: false,
		},
		{
			initials: "?",
			no: "INV-2026-0036",
			who: "No buyer email",
			amount: "₦150,000",
			due: "due 24/10/2026",
			tags: [{ label: "Needs email", tone: "warn" as const }],
			selected: false,
		},
	];

	return (
		<div data-fade-scroll>
			<div className="overflow-hidden rounded-2xl border border-[var(--hm-rule)] bg-[var(--hm-paper-2)] shadow-[0_30px_80px_rgba(0,0,0,.5)]">
				<div className="flex items-center justify-between border-b border-[var(--hm-rule-soft)] px-[18px] py-3.5 text-[13.5px] font-medium">
					Queue
					<span className="text-xs font-normal text-[var(--hm-ink-3)]">
						3 invoices
					</span>
				</div>
				<div className="flex items-center gap-3 border-b border-[var(--hm-rule-soft)] px-[18px] py-3 text-[12.5px] text-[var(--hm-ink-2)]">
					<span
						aria-hidden="true"
						className="relative h-5 w-10 flex-none rounded-full border border-[var(--hm-accent-line)] bg-[var(--hm-accent-soft)]"
					>
						<span className="absolute left-4 top-[2px] h-3.5 w-3.5 rounded-full bg-[var(--hm-accent)]" />
					</span>
					<div>
						<b className="font-medium text-[var(--hm-ink)]">
							Automatic reminders are on
						</b>
						<br />
						First reminder 3 days before due, then every 3 days.
					</div>
				</div>
				{rows.map((row) => (
					<div
						key={row.no}
						className={`relative grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 border-b border-[var(--hm-rule-soft)] px-[18px] py-3.5 last:border-b-0 sm:grid-cols-[auto_minmax(0,1fr)_auto] ${row.selected ? "bg-[linear-gradient(90deg,var(--hm-accent-soft),rgba(229,72,59,.015)_80%)]" : ""}`}
					>
						{row.selected ? (
							<span
								aria-hidden="true"
								className="absolute inset-y-3 left-0 w-0.5 rounded-sm bg-[var(--hm-accent)]"
							/>
						) : null}
						<span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-full bg-[var(--hm-accent-soft)] text-[11px] font-semibold text-[var(--hm-accent-on-soft)] shadow-[inset_0_0_0_1px_var(--hm-accent-line)]">
							{row.initials}
						</span>
						<div className="min-w-0">
							<div className="hm-num text-[12.5px]">{row.no}</div>
							<div className="mt-0.5 text-[12.5px] text-[var(--hm-ink-2)]">
								{row.who}
							</div>
							<div className="mt-2 flex flex-wrap gap-1.5">
								{row.tags.map((tag) => (
									<StatusPill key={tag.label} tone={tag.tone}>
										{tag.label}
									</StatusPill>
								))}
							</div>
						</div>
						<div className="hm-num col-start-2 text-[13px] sm:col-start-3 sm:text-right">
							{row.amount}{" "}
							<small className="mt-0.5 block text-[11.5px] text-[var(--hm-ink-3)] sm:inline sm:mt-0">
								{row.due}
							</small>
						</div>
					</div>
				))}
			</div>
			<SampleNote />
		</div>
	);
}
