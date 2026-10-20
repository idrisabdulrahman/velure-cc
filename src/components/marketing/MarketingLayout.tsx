import { Link } from "@tanstack/react-router";
import {
	ArrowRight,
	BadgeCheck,
	Banknote,
	BellRing,
	BookOpenCheck,
	Building2,
	Check,
	FileText,
	LockKeyhole,
	Plug,
	ReceiptText,
	ShieldCheck,
	Users,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useMarketingMotion } from "#/components/marketing/useMarketingMotion";

export type MarketingFeature = {
	title: string;
	description: string;
};

export type MarketingMetric = {
	value: string;
	label: string;
};

const navItems = [
	{ to: "/features", label: "Features" },
	{ to: "/pricing", label: "Pricing" },
] as const;

// The nav row, verbatim from design/landing.html: Features · Reminders ·
// Compliance · Security. It mixes route links and section anchors, so it can't
// be one of the two shape-typed lists above.
//
// `navItems` still carries Pricing, but only for the footer — the mock's nav
// has four links and a fifth changes the row's rhythm. They route through `/`
// where they're anchors, so the nav also works from /features and /pricing.
const primaryNav = [
	{ label: "Features", to: "/features" },
	{ label: "Reminders", hash: "reminders" },
	{ label: "Compliance", hash: "compliance" },
	{ label: "Security", hash: "security" },
] as const;

// Footer topics. Security and Compliance are real landing sections;
// Small business and Enterprise used to be, until SolutionsTrack was removed
// to match design/landing.html (which has no solutions section) — their links
// would now be dead anchors, so they are gone with it.
const sectionLinks = [
	{ hash: "compliance", label: "Compliance" },
	{ hash: "security", label: "Security" },
] as const;

const iconMap = {
	invoices: ReceiptText,
	clients: Users,
	reminders: BellRing,
	compliance: BookOpenCheck,
	security: ShieldCheck,
	integrations: Plug,
	exports: FileText,
	cash: Banknote,
	enterprise: Building2,
	lock: LockKeyhole,
};

const iconList = Object.values(iconMap);

export function MarketingShell({ children }: { children: ReactNode }) {
	useMarketingMotion();
	return (
		<div className="hm min-h-screen">
			<MarketingNav />
			<main>{children}</main>
			<MarketingFooter />
		</div>
	);
}

export function Wordmark() {
	return (
		<Link to="/" className="block">
			{/*
				Horizontal lockup (Level V symbol + Velure wordmark), cropped to
				its ink so the asset sizes directly. Height is in em so the logo
				tracks the app's persisted text-size setting.

				The `.hm` marketing scope is dark in both theme directions
				(design.md, "Marketing scope"), so this is the light master —
				paper #FCF8F5 + warm red, the kit's `-reversed` artwork exported
				as public/velure-lockup-horizontal-light.svg. The ink lockup on
				`#0a0706` would be invisible here. Masters and guidelines:
				design/brand/kit/ and design/brand/guidelines.md.
			*/}
			<img
				src="/velure-lockup-horizontal-light.svg"
				alt="Velure"
				width={464}
				height={110}
				// object-contain: if a narrow viewport squeezes the box, the
				// lockup scales down as a whole instead of squashing.
				className="w-auto object-contain"
				style={{ height: "1.9em" }}
			/>
		</Link>
	);
}

export function MarketingNav() {
	return (
		<header
			id="nav"
			className="sticky top-0 z-40 backdrop-blur"
			style={{
				borderBottom: "1px solid var(--hm-rule)",
				background: "color-mix(in oklab, var(--hm-paper) 88%, transparent)",
			}}
		>
			<div className="mx-auto flex min-h-16 w-full max-w-7xl items-center gap-5 px-5 py-3 lg:px-8">
				<Wordmark />

				<nav className="mx-auto hidden items-center gap-1 lg:flex">
					{primaryNav.map((item) => (
						<Link
							key={item.label}
							to={"to" in item ? item.to : "/"}
							hash={"hash" in item ? item.hash : undefined}
							className="hm-navlink rounded-full px-3 py-2 transition-colors hover:text-[var(--hm-ink)]"
						>
							{item.label}
						</Link>
					))}
				</nav>

				<div className="ml-auto flex items-center gap-2 lg:ml-0">
					<Link to="/auth" className="hm-label hidden px-3 py-2 sm:block">
						Sign in
					</Link>
					<Link to="/auth" className="hm-btn hm-btn--primary">
						Open app
						<ArrowRight className="h-4 w-4" />
					</Link>
				</div>
			</div>

			<details className="px-5 pb-3 lg:hidden">
				{/* design/landing.html has no mobile menu — it drops `.nav-links`
				    outright. We keep one so section links stay reachable under
				    1024px, sized to a 44px touch target instead of the reference's
				    28px `.eyebrow` chip. */}
				<summary className="hm-label inline-flex min-h-11 w-fit cursor-pointer list-none items-center rounded-full border border-[var(--hm-accent-line)] bg-[var(--hm-accent-soft)] px-4 text-[var(--hm-accent-on-soft)]">
					Menu
				</summary>
				<div className="mt-3 grid gap-1">
					{primaryNav.map((item) => (
						<Link
							key={item.label}
							to={"to" in item ? item.to : "/"}
							hash={"hash" in item ? item.hash : undefined}
							className="hm-navlink flex min-h-11 items-center rounded-lg px-3 hover:bg-[var(--hm-paper-3)]"
						>
							{item.label}
						</Link>
					))}
				</div>
			</details>
		</header>
	);
}

export function MarketingHero({
	kicker,
	title,
	description,
	secondaryTo = "/pricing",
	secondaryLabel = "View pricing",
	children,
}: {
	kicker: string;
	title: string;
	description: string;
	secondaryTo?: "/pricing" | "/features" | "/security";
	secondaryLabel?: string;
	children?: ReactNode;
}) {
	return (
		<section className="relative isolate overflow-hidden">
			<div className="hm-wash" aria-hidden="true" />
			<div className="relative mx-auto grid w-full max-w-7xl items-center gap-10 px-5 py-16 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14 lg:px-8 lg:py-24">
				<div className="hm-reveal">
					<p className="hm-label hm-label--accent">{kicker}</p>
					<h1 className="hm-display mt-4 text-[clamp(2.5rem,7vw,4.25rem)]">
						{title}
					</h1>
					<p className="hm-lede mt-5 max-w-xl text-lg">{description}</p>
					<div className="mt-8 flex flex-wrap gap-3">
						<Link to="/auth" className="hm-btn hm-btn--primary">
							Create workspace
							<ArrowRight className="h-4 w-4" />
						</Link>
						<Link to={secondaryTo} className="hm-btn hm-btn--ghost">
							{secondaryLabel}
						</Link>
					</div>
				</div>
				<div
					className="hm-reveal hm-card hm-card--raised p-4 lg:p-5"
					style={{ "--hm-i": 1 } as CSSProperties}
				>
					{children ?? <LedgerPreview />}
				</div>
			</div>
		</section>
	);
}

export function LedgerPreview() {
	const rows = [
		["INV-2026-000184", "Aster Retail", "₦820,000"],
		["INV-2026-000185", "Northline Studio", "₦410,500"],
		["INV-2026-000186", "Field Ledger", "₦96,000"],
	];

	return (
		<div className="space-y-4">
			<div
				className="flex items-center justify-between pb-4"
				style={{ borderBottom: "1px solid var(--hm-rule)" }}
			>
				<div>
					<p className="hm-label">Billing command</p>
					<p className="hm-title hm-num mt-1 text-2xl">₦1.32m open</p>
				</div>
				<BadgeCheck
					className="h-7 w-7"
					style={{ color: "var(--hm-accent)" }}
					aria-hidden="true"
				/>
			</div>

			<div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)] gap-2">
				<span className="hm-label text-xs">Invoice</span>
				<span className="hm-label text-xs">Client</span>
				<span className="hm-label text-right text-xs">Amount</span>
			</div>

			<div className="space-y-2">
				{rows.map((row) => (
					<div
						key={row[0]}
						className="hm-card hm-card--soft grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)] items-center gap-2 px-3 py-2.5 text-sm"
					>
						<span className="hm-num truncate font-medium">{row[0]}</span>
						<span className="hm-lede truncate text-sm">{row[1]}</span>
						<span className="hm-num text-right font-semibold">{row[2]}</span>
					</div>
				))}
			</div>

			<div className="grid grid-cols-5 items-end gap-2 pt-1">
				{[64, 42, 78, 50, 92].map((height, index) => (
					<div key={height} className="flex h-24 items-end">
						<div
							className="w-full"
							style={{
								height: `${height}%`,
								borderRadius: "6px 6px 2px 2px",
								background:
									index === 4 ? "var(--hm-accent)" : "var(--hm-accent-soft)",
							}}
						/>
					</div>
				))}
			</div>
		</div>
	);
}

export function FeatureGrid({ items }: { items: MarketingFeature[] }) {
	return (
		<section className="hm-band">
			<div className="mx-auto grid w-full max-w-7xl gap-4 px-5 py-16 sm:grid-cols-2 lg:grid-cols-3 lg:px-8 lg:py-20">
				{items.map((item, index) => {
					const Icon = iconList[index % iconList.length];
					return (
						<article
							key={item.title}
							data-fade-scroll
							className="hm-card hm-card--lift min-w-0 p-5"
						>
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
							<h2 className="hm-title mt-5 text-xl">{item.title}</h2>
							<p className="hm-lede mt-3 text-sm">{item.description}</p>
						</article>
					);
				})}
			</div>
		</section>
	);
}

export function SplitSection({
	kicker,
	title,
	body,
	points,
	reverse = false,
}: {
	kicker: string;
	title: string;
	body: string;
	points: string[];
	reverse?: boolean;
}) {
	return (
		<section>
			<div className="mx-auto grid w-full max-w-7xl gap-10 px-5 py-16 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:px-8 lg:py-20">
				<div className={reverse ? "lg:order-2" : undefined}>
					<p className="hm-label hm-label--accent">{kicker}</p>
					<h2 className="hm-display mt-4 text-[clamp(1.875rem,4vw,2.75rem)]">
						{title}
					</h2>
					<p className="hm-lede mt-4 max-w-md">{body}</p>
				</div>
				<div
					className={`grid gap-3 sm:grid-cols-2 ${reverse ? "lg:order-1" : ""}`}
				>
					{points.map((point) => (
						<div
							key={point}
							data-fade-scroll
							className="hm-card hm-card--soft flex min-w-0 gap-3 p-4"
						>
							<Check
								className="mt-0.5 h-4 w-4 shrink-0"
								style={{ color: "var(--hm-accent)" }}
								aria-hidden="true"
							/>
							<p className="text-sm leading-6">{point}</p>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

export function MetricsStrip({ metrics }: { metrics: MarketingMetric[] }) {
	return (
		<section className="hm-band hm-rule-t">
			<div className="mx-auto grid max-w-7xl gap-8 px-5 py-12 sm:grid-cols-3 lg:px-8">
				{metrics.map((metric) => (
					<div key={metric.label} data-fade-scroll className="min-w-0">
						<p
							className="hm-num text-4xl font-bold"
							style={{ color: "var(--hm-accent)" }}
						>
							{metric.value}
						</p>
						<p className="hm-label mt-2">{metric.label}</p>
					</div>
				))}
			</div>
		</section>
	);
}

export function MarketingFooter() {
	return (
		<footer
			id="cta"
			className="hm-rule-t relative isolate overflow-hidden px-5 pb-9 pt-[150px] text-center lg:px-8"
		>
			<div className="hm-wash hm-wash--footer" aria-hidden="true" />
			<div className="relative mx-auto max-w-7xl">
				<h2
					data-fade-scroll
					className="hm-display mx-auto max-w-[15ch] text-[clamp(2.375rem,6.4vw,5.25rem)] font-medium leading-none tracking-[-0.045em]"
				>
					Send the invoice,{" "}
					<span style={{ color: "var(--hm-ink-2)" }}>
						then stop wondering where it went.
					</span>
				</h2>
				<div className="mt-10 flex flex-wrap items-center justify-center gap-4">
					<Link
						to="/auth"
						data-magnetic
						className="hm-btn hm-btn--primary hm-btn--xl"
					>
						Open app
						<ArrowRight className="h-4 w-4" />
					</Link>
				</div>

				<div className="mt-[130px] flex flex-wrap items-center gap-x-5 gap-y-4 border-t border-[var(--hm-rule-soft)] py-6 text-left text-[13.5px] text-[var(--hm-ink-3)]">
					<Wordmark />
					<nav className="flex flex-wrap gap-x-[22px] gap-y-2">
						{navItems.map((item) => (
							<Link
								key={item.to}
								to={item.to}
								className="transition-colors hover:text-[var(--hm-ink)]"
							>
								{item.label}
							</Link>
						))}
						{sectionLinks.map((item) => (
							<Link
								key={item.hash}
								to="/"
								hash={item.hash}
								className="transition-colors hover:text-[var(--hm-ink)]"
							>
								{item.label}
							</Link>
						))}
						<Link
							to="/privacy"
							className="transition-colors hover:text-[var(--hm-ink)]"
						>
							Privacy
						</Link>
						<Link
							to="/terms"
							className="transition-colors hover:text-[var(--hm-ink)]"
						>
							Terms
						</Link>
					</nav>
					<span className="sm:ml-auto">
						Velure 2026 · Invoicing for Nigerian businesses
					</span>
				</div>
			</div>
		</footer>
	);
}
