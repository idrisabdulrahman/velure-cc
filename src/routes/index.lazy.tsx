import { createLazyFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowRight,
	Banknote,
	BellRing,
	CreditCard,
	FileDown,
	FileText,
	Mail,
	Receipt,
	ShieldCheck,
	Users,
} from "lucide-react";
import { useEffect } from "react";
import { ThemeToggle } from "#/components/theme/theme-toggle";
import { Button } from "#/components/ui/button";
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

function LandingPage() {
	const navigate = useNavigate();
	const { data: session, isPending: sessionPending } = authClient.useSession();

	useEffect(() => {
		if (!sessionPending && session?.user) {
			void navigate({ to: "/invoices", replace: true });
		}
	}, [navigate, session?.user, sessionPending]);

	if (sessionPending || session?.user) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-[#0f1111]">
				<div className="h-9 w-9 animate-pulse border border-[#343832] bg-[#181b1b]" />
			</div>
		);
	}

	return (
		<div className="min-h-screen overflow-hidden bg-[#0f1111] text-[#f2efe7]">
			<header className="fixed inset-x-0 top-0 z-40 border-b border-[#2b302b]/90 bg-[#0f1111]/88 backdrop-blur-md">
				<div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-5 md:px-8">
					<Link
						to="/"
						className="group flex items-center gap-3 text-sm font-semibold text-[#f2efe7]"
					>
						<span className="flex h-8 w-8 items-center justify-center border border-[#c8ff62]/45 bg-[#171b16] text-xs font-bold text-[#c8ff62] transition-colors group-hover:bg-[#c8ff62] group-hover:text-[#0f1111]">
							V
						</span>
						<span className="tracking-[0.18em] uppercase">Velure</span>
					</Link>
					<nav className="hidden items-center gap-7 text-xs font-semibold uppercase tracking-[0.16em] text-[#817d72] md:flex">
						<a href="#features" className="hover:text-[#f2efe7]">
							Features
						</a>
						<a href="#workflow" className="hover:text-[#f2efe7]">
							Workflow
						</a>
						<a href="#security" className="hover:text-[#f2efe7]">
							Security
						</a>
					</nav>
					<div className="flex items-center gap-2">
						<ThemeToggle className="h-9 w-9 border border-[#30352f] bg-[#161918] text-[#d8d1c4]- hover:bg-[#20241f] hover:text-[#f2efe7]" />
						<Button
							asChild
							variant="ghost"
							className="h-9 border border-[#30352f] bg-[#161918] px-4 text-sm text-[#d8d1c4] hover:bg-[#20241f]"
						>
							<Link to="/auth">Sign in</Link>
						</Button>
						<Button
							asChild
							className="h-9 bg-[#c8ff62] px-4 text-sm font-bold text-[#0f1111] hover:bg-[#d5ff7a]"
						>
							<Link to="/auth">Open app</Link>
						</Button>
					</div>
				</div>
			</header>

			<main>
				<section className="relative min-h-[92svh] border-b border-[#2b302b] pt-16">
					<div className="absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:48px_48px]" />
					<div className="absolute inset-y-16 right-0 hidden w-[56vw] border-l border-[#2b302b] bg-[#141715] lg:block" />
					<div className="absolute top-[12%] right-[3vw] hidden w-[46vw] max-w-[760px] lg:block">
						<InvoiceDesk />
					</div>

					<div className="relative z-10 mx-auto grid w-full max-w-7xl gap-8 px-5 py-12 md:px-8 lg:min-h-[calc(92svh-4rem)] lg:grid-cols-[0.78fr_1.22fr] lg:items-center lg:py-0">
						<div className="max-w-3xl">
							<p className="inline-flex border border-[#c8ff62]/35 bg-[#182015] px-3 py-2 text-xs font-bold uppercase tracking-[0.18em] text-[#c8ff62]">
								Invoice operations for small business
							</p>
							<h1 className="mt-6 max-w-3xl text-[58px] font-bold leading-[0.86] tracking-[-0.045em] text-[#f2efe7] md:text-[88px] lg:text-[104px]">
								Send the bill. Track the trail.
							</h1>
							<p className="mt-7 max-w-xl text-xl leading-8 text-[#aaa294]">
								Velure turns invoices, clients, tax lines, reminders, PDFs, and
								exports into one tight workspace for Nigerian businesses.
							</p>
							<div className="mt-8 flex flex-wrap gap-3">
								<Button
									asChild
									className="h-12 bg-[#c8ff62] px-5 text-sm font-bold text-[#0f1111] hover:bg-[#d5ff7a]"
								>
									<Link to="/auth">
										Open workspace
										<ArrowRight className="ml-2 h-4 w-4" />
									</Link>
								</Button>
								<Button
									asChild
									variant="ghost"
									className="h-12 border border-[#30352f] bg-[#161918] px-5 text-sm text-[#d8d1c4] hover:bg-[#20241f]"
								>
									<a href="#features">See the system</a>
								</Button>
							</div>
							<div className="mt-10 grid max-w-2xl border border-[#30352f] bg-[#141715]/95 md:grid-cols-3">
								<Metric value="7.5%" label="VAT-ready invoices" />
								<Metric value="₦420k" label="Paid in the ledger" />
								<Metric value="PDF/CSV" label="Exports anytime" />
							</div>
						</div>

						<div className="relative lg:hidden">
							<InvoiceDesk />
						</div>
					</div>

					<div className="relative z-10 border-t border-[#2b302b] bg-[#101211]/95">
						<div className="mx-auto grid w-full max-w-7xl px-5 md:grid-cols-4 md:px-8">
							{checkpoints.map((item, index) => (
								<div
									key={item}
									className="flex items-center gap-3 border-b border-[#2b302b] py-4 text-sm text-[#beb6a8] md:border-r md:border-b-0 md:px-4 md:last:border-r-0"
								>
									<span className="font-mono text-xs text-[#c8ff62]">
										0{index + 1}
									</span>
									<span>{item}</span>
								</div>
							))}
						</div>
					</div>
				</section>

				<section
					id="features"
					className="border-b border-[#2b302b] bg-[#121514]"
				>
					<div className="mx-auto grid w-full max-w-7xl gap-8 px-5 py-16 md:px-8 lg:grid-cols-[0.84fr_1.16fr] lg:py-20">
						<div>
							<p className="text-xs font-bold uppercase tracking-[0.2em] text-[#c8ff62]">
								What feels different
							</p>
							<h2 className="mt-5 max-w-lg text-5xl font-bold leading-[0.92] tracking-[-0.04em] text-[#f2efe7] md:text-6xl">
								Not another dead invoice list.
							</h2>
							<p className="mt-5 max-w-md text-lg leading-8 text-[#aaa294]">
								The page is built around what happens after an invoice leaves
								your desk: payment, reminders, tax records, and clean exports.
							</p>
						</div>
						<div className="grid gap-3 md:grid-cols-2">
							{featureCards.map((feature) => (
								<FeatureCard key={feature.title} {...feature} />
							))}
						</div>
					</div>
				</section>

				<section
					id="workflow"
					className="border-b border-[#2b302b] bg-[#0f1111]"
				>
					<div className="mx-auto grid w-full max-w-7xl gap-8 px-5 py-16 md:px-8 lg:grid-cols-[1.12fr_0.88fr]">
						<div className="border border-[#30352f] bg-[#151817]">
							<div className="grid border-b border-[#30352f] px-5 py-4 text-xs font-bold uppercase tracking-[0.14em] text-[#817d72] md:grid-cols-[160px_1fr_140px]">
								<span>Launch flow</span>
								<span className="hidden md:block">What happens</span>
								<span className="hidden md:block">Owner</span>
							</div>
							<FlowRow
								step="01"
								title="Set business defaults"
								detail="Company name, logo, TIN, payment terms, currency, and invoice naming."
								owner="Founder"
							/>
							<FlowRow
								step="02"
								title="Send invoice"
								detail="Client, line items, VAT/WHT, public page, PDF, and Paystack checkout."
								owner="Ops"
							/>
							<FlowRow
								step="03"
								title="Keep records"
								detail="Status changes, reminders, paid dates, references, and export history."
								owner="Finance"
							/>
						</div>

						<div className="relative overflow-hidden border border-[#30352f] bg-[#c8ff62] p-6 text-[#0f1111]">
							<div className="absolute top-0 right-0 h-full w-24 border-l border-[#0f1111]/20 bg-[#0f1111]/8" />
							<p className="max-w-xs text-4xl font-bold leading-[0.96] tracking-[-0.04em]">
								Start with one invoice. Keep the whole finance trail.
							</p>
							<p className="mt-5 max-w-sm text-base leading-7 text-[#26310f]">
								Create the first invoice, send the link, collect payment, and
								export the record when your accountant asks.
							</p>
							<Button
								asChild
								className="mt-8 h-11 border border-[#0f1111] bg-[#0f1111] px-5 text-sm font-bold text-[#f2efe7] hover:bg-[#20241f]"
							>
								<Link to="/auth">Open app</Link>
							</Button>
						</div>
					</div>
				</section>

				<section id="security" className="bg-[#121514]">
					<div className="mx-auto grid w-full max-w-7xl gap-4 px-5 py-12 md:grid-cols-3 md:px-8">
						<TrustItem icon={ShieldCheck} title="Private by workspace" />
						<TrustItem icon={Mail} title="Email/password first" />
						<TrustItem icon={CreditCard} title="Public invoices by token" />
					</div>
				</section>
			</main>
		</div>
	);
}

function InvoiceDesk() {
	return (
		<div className="relative">
			<div className="absolute -top-6 left-8 hidden border border-[#30352f] bg-[#0f1111] px-4 py-3 text-xs font-bold uppercase tracking-[0.16em] text-[#c8ff62] shadow-[12px_12px_0_#c8ff62] md:block">
				Live receivables
			</div>
			<div className="grid overflow-hidden border border-[#30352f] bg-[#171a18] shadow-[0_26px_80px_rgba(0,0,0,0.38)] lg:grid-cols-[1fr_260px]">
				<div className="bg-[#f3eee6] p-6 text-[#11140f] md:p-8">
					<div className="flex items-start justify-between gap-6 border-b border-[#c9c2b7] pb-6">
						<div>
							<p className="text-4xl font-bold tracking-[-0.04em]">Invoice</p>
							<p className="mt-2 font-mono text-sm">VEL-2026-0143</p>
						</div>
						<div className="text-right text-sm">
							<p className="font-semibold">Aster Retail</p>
							<p className="mt-1 text-[#686157]">Due 15 May 2026</p>
						</div>
					</div>

					<div className="divide-y divide-[#d5cec2]">
						<PaperRow item="Monthly brand retainer" qty="1" total="₦150,000" />
						<PaperRow item="Product photography" qty="2" total="₦30,000" />
						<PaperRow item="Logistics handling" qty="1" total="₦24,000" />
					</div>

					<div className="mt-6 grid gap-3 md:grid-cols-[1fr_260px] md:items-end">
						<div className="border border-[#c9c2b7] p-4">
							<p className="text-xs font-bold uppercase tracking-[0.14em] text-[#686157]">
								Payment page
							</p>
							<p className="mt-2 text-sm">
								Customer sees invoice, downloads PDF, or pays by card.
							</p>
						</div>
						<div className="space-y-2 text-sm">
							<SummaryLine label="Subtotal" value="₦204,000" />
							<SummaryLine label="VAT 7.5%" value="₦15,300" />
							<SummaryLine label="WHT" value="-₦10,200" />
							<div className="flex justify-between border-t border-[#c9c2b7] pt-3 text-lg font-bold">
								<span>Net payable</span>
								<span>₦209,100</span>
							</div>
						</div>
					</div>
				</div>

				<div className="border-t border-[#30352f] bg-[#101211] p-5 lg:border-t-0 lg:border-l">
					<div className="flex h-full flex-col justify-between gap-6">
						<div>
							<div className="flex h-11 items-center gap-3 border border-[#c8ff62]/35 bg-[#1a2117] px-3 text-sm font-semibold text-[#c8ff62]">
								<CreditCard className="h-4 w-4" />
								Paystack checkout ready
							</div>
							<div className="mt-5 space-y-3">
								{invoiceRows.map((invoice) => (
									<PreviewRow key={invoice.number} {...invoice} />
								))}
							</div>
						</div>
						<div className="grid grid-cols-2 border border-[#30352f]">
							<MiniStat icon={Banknote} label="Open" value="₦266k" />
							<MiniStat icon={FileText} label="Paid" value="₦420k" />
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

function Metric({ value, label }: { value: string; label: string }) {
	return (
		<div className="border-b border-[#30352f] px-4 py-4 last:border-b-0 md:border-r md:border-b-0 md:last:border-r-0">
			<p className="font-mono text-lg text-[#c8ff62]">{value}</p>
			<p className="mt-1 text-sm text-[#8d867a]">{label}</p>
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
		<div className="grid grid-cols-[1fr_48px_96px] gap-4 py-4 text-sm">
			<span>{item}</span>
			<span className="text-right text-[#686157]">{qty}</span>
			<span className="text-right font-semibold">{total}</span>
		</div>
	);
}

function SummaryLine({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex justify-between text-[#686157]">
			<span>{label}</span>
			<span>{value}</span>
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
			? "text-[#c8ff62]"
			: status === "Unpaid"
				? "text-[#e6c67a]"
				: "text-[#817d72]";
	return (
		<div className="grid grid-cols-[1fr_auto] gap-3 border-b border-[#30352f] py-3 last:border-b-0">
			<div>
				<p className="text-sm font-semibold text-[#f2efe7]">{number}</p>
				<p className="mt-1 text-xs text-[#817d72]">{client}</p>
			</div>
			<div className="text-right">
				<p className="text-sm font-semibold text-[#f2efe7]">{amount}</p>
				<p className={`mt-1 text-xs ${tone}`}>{status}</p>
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
		<div className="border-r border-[#30352f] p-3 last:border-r-0">
			<Icon className="h-4 w-4 text-[#c8ff62]" />
			<p className="mt-3 text-xs text-[#817d72]">{label}</p>
			<p className="mt-1 font-mono text-sm text-[#f2efe7]">{value}</p>
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
		<div className="group border border-[#30352f] bg-[#171a18] p-5 transition-colors hover:border-[#c8ff62]/50 hover:bg-[#1b2019]">
			<div className="flex h-10 w-10 items-center justify-center border border-[#c8ff62]/35 bg-[#1a2117] text-[#c8ff62]">
				<Icon className="h-5 w-5" />
			</div>
			<p className="mt-6 text-xl font-bold tracking-[-0.025em] text-[#f2efe7]">
				{title}
			</p>
			<p className="mt-3 text-sm leading-6 text-[#aaa294]">{description}</p>
		</div>
	);
}

function FlowRow({
	step,
	title,
	detail,
	owner,
}: {
	step: string;
	title: string;
	detail: string;
	owner: string;
}) {
	return (
		<div className="grid border-b border-[#30352f] last:border-b-0 md:grid-cols-[160px_1fr_140px]">
			<div className="flex items-center gap-3 px-5 py-4">
				<span className="font-mono text-xs text-[#c8ff62]">{step}</span>
				<span className="text-sm font-semibold text-[#f2efe7]">{title}</span>
			</div>
			<div className="px-5 pb-4 text-sm leading-6 text-[#aaa294] md:py-4">
				{detail}
			</div>
			<div className="hidden px-5 py-4 text-sm text-[#d8d1c4] md:block">
				{owner}
			</div>
		</div>
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
		<div className="flex items-center gap-3 border border-[#30352f] bg-[#171a18] px-4 py-4">
			<Icon className="h-5 w-5 text-[#c8ff62]" />
			<p className="text-sm font-semibold text-[#f2efe7]">{title}</p>
		</div>
	);
}
