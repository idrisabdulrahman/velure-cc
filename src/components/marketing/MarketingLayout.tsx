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

// Topics folded into landing-page sections — reachable from the footer as
// hash anchors on the home route (the standalone pages now redirect here).
const sectionLinks = [
	{ hash: "small-business", label: "Small business" },
	{ hash: "enterprise", label: "Enterprise" },
	{ hash: "security", label: "Security" },
	{ hash: "compliance", label: "Compliance" },
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
		<Link to="/" className="flex items-center gap-2.5">
			<span
				className="flex h-8 w-8 items-center justify-center text-sm font-extrabold"
				style={{
					borderRadius: "10px",
					background: "var(--hm-accent)",
					color: "var(--hm-accent-ink)",
					fontFamily: "var(--hm-font-display)",
				}}
			>
				V
			</span>
			<span className="hm-title text-lg">Velure</span>
		</Link>
	);
}

export function MarketingNav() {
	return (
		<header
			className="sticky top-0 z-40 backdrop-blur"
			style={{
				borderBottom: "1px solid var(--hm-rule)",
				background: "color-mix(in oklab, var(--hm-paper) 88%, transparent)",
			}}
		>
			<div className="mx-auto flex min-h-16 w-full max-w-7xl items-center gap-5 px-5 py-3 lg:px-8">
				<Wordmark />

				<nav className="mx-auto hidden items-center gap-1 lg:flex">
					{navItems.map((item) => (
						<Link
							key={item.to}
							to={item.to}
							className="hm-label rounded-full px-3 py-2 transition-colors hover:bg-[var(--hm-paper-2)] hover:text-[var(--hm-ink)]"
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
				<summary className="hm-chip w-fit cursor-pointer list-none">
					Menu
				</summary>
				<div className="mt-3 grid gap-1">
					{navItems.map((item) => (
						<Link
							key={item.to}
							to={item.to}
							className="hm-label flex min-h-11 items-center rounded-lg px-3 hover:bg-[var(--hm-paper-2)]"
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
		<footer className="hm-rule-t relative isolate overflow-hidden">
			<div className="hm-wash hm-wash--footer" aria-hidden="true" />
			<div className="relative mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-20">
				<p
					data-fade-scroll
					className="hm-display max-w-[38ch] text-[clamp(1.75rem,4vw,2.75rem)]"
				>
					Send the invoice, then stop wondering where it went.
				</p>
				<div className="mt-8 flex flex-wrap items-center gap-4">
					<Link to="/auth" className="hm-btn hm-btn--primary">
						Open app
						<ArrowRight className="h-4 w-4" />
					</Link>
					<Wordmark />
				</div>

				<div className="hm-rule-t mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 pt-5">
					{navItems.map((item) => (
						<Link key={item.to} to={item.to} className="hm-label">
							{item.label}
						</Link>
					))}
					{sectionLinks.map((item) => (
						<Link key={item.hash} to="/" hash={item.hash} className="hm-label">
							{item.label}
						</Link>
					))}
					<Link to="/privacy" className="hm-label">
						Privacy
					</Link>
					<Link to="/terms" className="hm-label">
						Terms
					</Link>
					<span
						className="hm-label sm:ml-auto"
						style={{ color: "var(--hm-ink-3)" }}
					>
						Velure 2026 · Invoicing for Nigerian businesses
					</span>
				</div>
			</div>
		</footer>
	);
}
