import { createLazyFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
	Bell,
	CircleDot,
	CreditCard,
	FileText,
	Loader2,
	Play,
	Search,
	ShieldCheck,
	Sparkles,
	Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useId } from "react";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { authClient } from "#/lib/auth-client";

export const Route = createLazyFileRoute("/")({
	component: LandingPage,
});

function LandingPage() {
	const navigate = useNavigate();
	const { data: session, isPending: sessionPending } = authClient.useSession();
	const sectionIdSeed = useId().replace(/:/g, "");
	const interfaceSectionId = `interface-${sectionIdSeed}`;
	const featuresSectionId = `features-${sectionIdSeed}`;
	const pricingSectionId = `pricing-${sectionIdSeed}`;
	const sectionReveal = {
		initial: { opacity: 0, y: 24 },
		whileInView: { opacity: 1, y: 0 },
		viewport: { once: true, amount: 0.2 },
		transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] as const },
	}

	useEffect(() => {
		if (!sessionPending && session?.user) {
			void navigate({ to: "/invoices", replace: true });
		}
	}, [navigate, session?.user, sessionPending]);

	if (sessionPending || session?.user) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-[#050607]">
				<Loader2 className="h-8 w-8 animate-spin text-[#C8FF1A]" />
			</div>
		)
	}

	return (
		<div className="min-h-screen bg-[#050607] text-[#F2F3F5] selection:bg-[#C8FF1A] selection:text-[#050607]">
			<div className="pointer-events-none fixed inset-0 opacity-[0.06] [background:radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.6)_1px,transparent_0)] [background-size:3px_3px]" />

			<header className="sticky top-0 z-50 border-b border-[#1A1D22]/85 bg-[#050607]/90 backdrop-blur-md">
				<div className="mx-auto grid h-16 w-full max-w-[1200px] grid-cols-[1fr_auto_1fr] items-center px-6">
					<Link to="/" className="flex items-center gap-3">
						<span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[#C8FF1A] text-xs font-bold text-[#050607]">
							V
						</span>
						<span className="text-sm font-semibold tracking-[0.02em]">
							Velure
						</span>
					</Link>

					<nav className="hidden items-center gap-8 md:flex">
						<a
							href={`#${featuresSectionId}`}
							className="text-sm text-[#A5AAB4] transition-colors duration-200 hover:text-[#F2F3F5]"
						>
							Features
						</a>
						<a
							href={`#${interfaceSectionId}`}
							className="text-sm text-[#A5AAB4] transition-colors duration-200 hover:text-[#F2F3F5]"
						>
							Interface
						</a>
						<a
							href={`#${pricingSectionId}`}
							className="text-sm text-[#A5AAB4] transition-colors duration-200 hover:text-[#F2F3F5]"
						>
							Pricing
						</a>
					</nav>

					<div className="ml-auto flex items-center gap-3">
						<Link
							to="/auth"
							className="text-sm text-[#A5AAB4] transition-colors duration-200 hover:text-[#F2F3F5]"
						>
							Log In
						</Link>
						<Button
							asChild
							className="h-9 rounded-md bg-[#F2F3F5] px-4 text-[11px] font-bold tracking-[0.09em] text-[#050607] transition-all duration-200 hover:-translate-y-px hover:bg-white"
						>
							<Link to="/auth">START FREE</Link>
						</Button>
					</div>
				</div>
			</header>

			<main>
				<section className="mx-auto grid w-full max-w-[1200px] gap-16 px-6 pb-24 pt-24 lg:grid-cols-12 lg:items-center lg:pt-28">
					<motion.div
						initial={{ opacity: 0, y: 22 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true, amount: 0.35 }}
						transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
						className="space-y-8 lg:col-span-6"
					>
						<Badge className="h-8 rounded-full border border-[#1A1D22] bg-[#0A0D12] px-3 font-medium text-[#B4BAC6] hover:bg-[#0A0D12]">
							<CircleDot className="mr-2 h-3.5 w-3.5 text-[#C8FF1A]" /> V 2.0
							NOW LIVE
						</Badge>

						<h1 className="font-serif text-6xl leading-[0.95] tracking-[-0.03em] text-[#F2F3F5] md:text-7xl">
							<em className="not-italic">The art of</em>
							<br />
							<span className="italic">getting paid.</span>
						</h1>

						<p className="max-w-[560px] text-xl leading-relaxed text-[#8A8F99]">
							Velure is invoicing for creative professionals who treat
							operations like craft. Manage clients, issue premium invoices, and
							keep revenue in focus with a UI designed to look expensive.
						</p>

						<div className="flex flex-wrap items-center gap-3">
							<Button
								asChild
								className="h-12 rounded-[10px] bg-[#C8FF1A] px-6 text-xs font-bold tracking-[0.1em] text-[#050607] shadow-[0_0_28px_rgba(200,255,26,0.26)] transition-all duration-200 hover:-translate-y-px hover:bg-[#D7FF52]"
							>
								<Link to="/invoices/new">CREATE INVOICE</Link>
							</Button>
							<Button
								variant="outline"
								className="h-12 rounded-[10px] border-[#1A1D22] bg-transparent px-6 text-xs font-bold tracking-[0.1em] text-[#D5DBE6] transition-all duration-200 hover:-translate-y-px hover:bg-[#0B0F15]"
							>
								<Play className="mr-1.5 h-3.5 w-3.5" /> WATCH DEMO
							</Button>
						</div>
					</motion.div>

					<motion.div
						initial={{ opacity: 0, x: 34 }}
						whileInView={{ opacity: 1, x: 0 }}
						viewport={{ once: true, amount: 0.35 }}
						transition={{
							duration: 0.6,
							delay: 0.12,
							ease: [0.22, 1, 0.36, 1],
						}}
						className="relative lg:col-span-6"
					>
						<div className="pointer-events-none absolute -inset-x-12 -top-12 bottom-0 bg-[radial-gradient(circle_at_center,rgba(200,255,26,0.08),transparent_65%)]" />

						<div className="absolute -left-4 top-5 -z-10 h-[92%] w-[84%] rotate-[-2.5deg] rounded-xl border border-[#1A1D22] bg-[#0B1A3A]/38" />
						<div className="absolute -right-4 top-8 -z-20 h-[88%] w-[78%] rotate-[2.5deg] rounded-xl border border-[#1A1D22] bg-[#101F43]/30" />

						<motion.div
							whileHover={{ y: -3 }}
							transition={{ duration: 0.18, ease: "easeOut" }}
						>
							<Card className="relative mx-auto max-w-[520px] overflow-hidden rounded-xl border-[#1A1D22] bg-[#0A0D12] text-[#F2F3F5] shadow-[0_30px_70px_rgba(0,0,0,0.55)]">
								<CardContent className="grid gap-7 p-7">
									<div className="flex items-start justify-between">
										<span className="h-3 w-3 rounded-full bg-[#23314F]" />
										<div className="text-right">
											<p className="text-[10px] uppercase tracking-[0.1em] text-[#6D7583]">
												TOTAL DUE
											</p>
											<p className="mt-1 font-serif text-3xl italic text-[#F2F3F5]">
												$12,450.00
											</p>
										</div>
									</div>

									<div className="space-y-3 text-sm">
										<div className="flex items-center justify-between text-[#8A8F99]">
											<span>Billed to</span>
											<span className="text-[#F2F3F5]">Acme Corp</span>
										</div>
										<div className="flex items-center justify-between text-[#8A8F99]">
											<span>Due Date</span>
											<span className="text-[#F2F3F5]">Oct 24, 2026</span>
										</div>
									</div>

									<div className="h-px bg-[#1A1D22]" />

									<Button className="h-11 rounded-[10px] border border-[#2B3A11] bg-[#1A240B] text-xs font-bold tracking-[0.1em] text-[#C8FF1A] hover:bg-[#212E0E]">
										STATUS: PAID
									</Button>
								</CardContent>
							</Card>
						</motion.div>
					</motion.div>
				</section>

				<motion.section
					id={interfaceSectionId}
					className="mx-auto w-full max-w-[1200px] px-6 py-24 md:py-28"
					{...sectionReveal}
				>
					<div className="mb-10 flex flex-wrap items-end justify-between gap-4">
						<div>
							<h2 className="font-serif text-5xl italic tracking-[-0.02em]">
								Command Center
							</h2>
							<p className="mt-3 max-w-[640px] text-lg text-[#8A8F99]">
								One operating view for invoices and clients. Minimal chrome,
								maximum control.
							</p>
						</div>
						<div className="rounded-[10px] border border-[#1A1D22] bg-[#0A0D12] p-1">
							<button
								type="button"
								className="rounded-md bg-[#10150D] px-4 py-2 text-xs font-semibold text-[#C8FF1A]"
							>
								Invoices
							</button>
							<button
								type="button"
								className="rounded-md px-4 py-2 text-xs font-semibold text-[#8A8F99] transition-colors hover:text-[#F2F3F5]"
							>
								Clients
							</button>
						</div>
					</div>

					<Card className="overflow-hidden rounded-xl border-[#1A1D22] bg-[#0A0D12] text-[#F2F3F5] shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
						<CardHeader className="flex flex-row items-center justify-between border-b border-[#1A1D22] bg-[#0C1016] px-5 py-4">
							<div className="flex items-center gap-2">
								<span className="h-2.5 w-2.5 rounded-full bg-[#2D3440]" />
								<span className="h-2.5 w-2.5 rounded-full bg-[#2D3440]" />
								<span className="h-2.5 w-2.5 rounded-full bg-[#2D3440]" />
							</div>
							<div className="flex items-center gap-2">
								<IconGhost icon={<Search className="h-4 w-4" />} />
								<IconGhost icon={<Bell className="h-4 w-4" />} />
								<span className="flex h-8 w-8 items-center justify-center rounded-full border border-[#21342D] bg-[#0E1615]">
									<span className="h-4 w-4 rounded-full bg-[#5EA8FF66]" />
								</span>
							</div>
						</CardHeader>

						<CardContent className="grid min-h-[470px] grid-cols-[78px_1fr] p-0">
							<aside className="border-r border-[#1A1D22] bg-[#0B0F15] p-3">
								<div className="space-y-2">
									<SideIcon
										active
										icon={<Sparkles className="h-[17px] w-[17px]" />}
									/>
									<SideIcon icon={<Users className="h-[17px] w-[17px]" />} />
									<SideIcon icon={<FileText className="h-[17px] w-[17px]" />} />
									<SideIcon
										icon={<CreditCard className="h-[17px] w-[17px]" />}
									/>
								</div>
							</aside>

							<div className="p-6 md:p-8">
								<div className="mb-6 flex flex-wrap items-start justify-between gap-4">
									<div>
										<CardTitle className="font-serif text-3xl italic">
											Recent Invoices
										</CardTitle>
										<p className="mt-2 text-sm text-[#8A8F99]">
											Track payouts and keep cashflow healthy.
										</p>
									</div>
									<Button className="h-10 rounded-[10px] bg-[#C8FF1A] px-4 text-xs font-bold tracking-[0.09em] text-[#050607] hover:bg-[#D7FF52]">
										+ NEW INVOICE
									</Button>
								</div>

								<div className="overflow-hidden rounded-[10px] border border-[#1A1D22] bg-[#0C1118]">
									<div className="grid grid-cols-[1.6fr_1fr_1fr_120px] gap-4 border-b border-[#1A1D22] px-5 py-3 text-[11px] font-semibold tracking-[0.08em] text-[#8A8F99]">
										<span>CLIENT / PROJECT</span>
										<span>DATE</span>
										<span>AMOUNT</span>
										<span>STATUS</span>
									</div>
									{invoiceRows.map((row) => (
										<div
											key={row.id}
											className="group grid grid-cols-[1.6fr_1fr_1fr_120px] items-center gap-4 border-b border-[#1A1D22] px-5 py-4 transition-colors duration-200 hover:bg-[#101722]"
										>
											<div className="flex min-w-0 items-center gap-3">
												<span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#151C27] text-[11px] font-semibold text-[#BFC7D4]">
													{row.initials}
												</span>
												<div className="min-w-0">
													<p className="truncate text-[13px] font-semibold text-[#F2F3F5]">
														{row.client}
													</p>
													<p className="truncate text-xs text-[#8A8F99]">
														{row.project}
													</p>
												</div>
											</div>
											<p className="text-[13px] text-[#8A8F99]">{row.date}</p>
											<p className="text-[13px] font-semibold text-[#F2F3F5]">
												{row.amount}
											</p>
											<div className="flex items-center justify-between gap-2">
												<StatusTag status={row.status} />
												<button
													type="button"
													aria-label="Invoice actions"
													className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#26303D] text-[#6D7684] opacity-0 transition-all duration-200 group-hover:opacity-100 hover:bg-[#161E2B]"
												>
													•••
												</button>
											</div>
										</div>
									))}
								</div>
							</div>
						</CardContent>
					</Card>
				</motion.section>

				<motion.section
					id={featuresSectionId}
					className="mx-auto grid w-full max-w-[1200px] gap-6 px-6 py-24 md:grid-cols-12 md:py-28"
					{...sectionReveal}
				>
					<Card className="rounded-xl border-[#1A1D22] bg-[#0A0D12] text-[#F2F3F5] md:col-span-7">
						<CardContent className="space-y-6 p-7 md:p-8">
							<div>
								<h3 className="font-serif text-4xl italic">
									Export to PDF instantly
								</h3>
								<p className="mt-3 max-w-[520px] text-[#8A8F99]">
									Pixel-clean invoice exports optimized for delivery, printing,
									and legal archiving.
								</p>
							</div>
							<div className="inline-flex items-center gap-2 rounded-full border border-[#1A1D22] bg-[#0D1219] px-3 py-2 text-xs text-[#9EA5B2]">
								<ShieldCheck className="h-3.5 w-3.5 text-[#C8FF1A]" />
								invoice_oct_26.pdf • signed
							</div>
						</CardContent>
					</Card>

					<Card className="rounded-xl border-[#1A1D22] bg-[#0A0D12] text-[#F2F3F5] md:col-span-5">
						<CardContent className="space-y-5 p-7 md:p-8">
							<div>
								<h3 className="font-serif text-4xl italic">CRM Lite</h3>
								<p className="mt-3 text-[#8A8F99]">
									Lightweight relationship management directly inside billing
									workflow.
								</p>
							</div>
							<ul className="space-y-3 text-sm text-[#C7CDD8]">
								<li className="flex items-center gap-2">
									<span className="h-1.5 w-1.5 rounded-full bg-[#C8FF1A]" />
									Client profile snapshots
								</li>
								<li className="flex items-center gap-2">
									<span className="h-1.5 w-1.5 rounded-full bg-[#C8FF1A]" />
									Favorite contacts and terms
								</li>
								<li className="flex items-center gap-2">
									<span className="h-1.5 w-1.5 rounded-full bg-[#C8FF1A]" />
									Invoice history by account
								</li>
							</ul>
						</CardContent>
					</Card>
				</motion.section>

				<motion.section
					id={pricingSectionId}
					className="mx-auto w-full max-w-[1200px] px-6 py-24 md:py-28"
					{...sectionReveal}
				>
					<h2 className="text-center font-serif text-5xl italic tracking-[-0.02em] text-[#F2F3F5]">
						Simple Pricing
					</h2>
					<div className="mt-12 grid gap-6 md:grid-cols-2">
						<motion.div
							initial={{ opacity: 0, y: 12 }}
							whileInView={{ opacity: 1, y: 0 }}
							viewport={{ once: true, margin: "-80px" }}
							transition={{ duration: 0.35, ease: "easeOut" }}
						>
							<PricingCard
								title="Freelancer"
								price="$24"
								description="For independent creatives with recurring invoice flow."
								items={[
									"Unlimited invoices",
									"Client directory",
									"PDF exports",
									"Email support",
								]}
							/>
						</motion.div>
						<motion.div
							initial={{ opacity: 0, y: 12 }}
							whileInView={{ opacity: 1, y: 0 }}
							viewport={{ once: true, margin: "-80px" }}
							transition={{ duration: 0.35, delay: 0.06, ease: "easeOut" }}
						>
							<PricingCard
								title="Studio"
								price="$69"
								description="For teams that need higher velocity and cleaner operations."
								items={[
									"Everything in Freelancer",
									"Team seats",
									"Advanced statuses",
									"Priority support",
								]}
								highlighted
							/>
						</motion.div>
					</div>
				</motion.section>

				<motion.section
					className="mx-auto w-full max-w-[1200px] px-6 pb-24 pt-12 md:pb-28"
					{...sectionReveal}
				>
					<Card className="rounded-xl border-[#1A1D22] bg-[#0A0D12] text-[#F2F3F5]">
						<CardContent className="space-y-8 p-10 text-center md:p-12">
							<h2 className="font-serif text-5xl italic tracking-[-0.02em]">
								Ready to elevate?
							</h2>
							<p className="mx-auto max-w-[620px] text-lg text-[#8A8F99]">
								Get early access to Velure and build a billing operation that
								feels as polished as your creative work.
							</p>
							<div className="mx-auto flex w-full max-w-[560px] flex-col gap-3 sm:flex-row">
								<Input
									type="email"
									placeholder="you@studio.com"
									className="h-12 rounded-[10px] border-[#1A1D22] bg-[#06090E] text-[#F2F3F5] placeholder:text-[#7F8794]"
								/>
								<Button className="h-12 rounded-[10px] bg-[#F2F3F5] px-6 text-xs font-bold tracking-[0.09em] text-[#050607] hover:bg-white">
									GET ACCESS
								</Button>
							</div>
						</CardContent>
					</Card>
				</motion.section>
			</main>

			<motion.footer className="border-t border-[#1A1D22]" {...sectionReveal}>
				<div className="mx-auto grid w-full max-w-[1200px] gap-10 px-6 py-14 md:grid-cols-4">
					<div>
						<div className="mb-3 flex items-center gap-2 text-sm font-semibold">
							<span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-[#C8FF1A] text-[10px] font-bold text-[#050607]">
								V
							</span>
							Velure
						</div>
						<p className="max-w-[240px] text-sm leading-relaxed text-[#8A8F99]">
							Premium invoicing for design-driven teams and independent
							creators.
						</p>
					</div>
					<FooterCol
						title="Product"
						items={["Features", "Interface", "Pricing", "Roadmap"]}
					/>
					<FooterCol
						title="Company"
						items={["About", "Careers", "Contact", "Partners"]}
					/>
					<FooterCol
						title="Legal"
						items={["Privacy", "Terms", "Security", "Cookies"]}
					/>
				</div>
			</motion.footer>
		</div>
	)
}

function IconGhost({ icon }: { icon: ReactNode }) {
	return (
		<button
			type="button"
			className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#1A1D22] bg-[#0D1016] text-[#6D7583] transition-colors duration-200 hover:bg-[#141A23]"
		>
			{icon}
		</button>
	)
}

function SideIcon({
	icon,
	active = false,
}: {
	icon: ReactNode;
	active?: boolean;
}) {
	return (
		<button
			type="button"
			className={`inline-flex h-11 w-11 items-center justify-center rounded-[10px] border transition-all duration-200 ${
				active
					? "border-[#C8FF1A66] bg-[#121A0A] text-[#C8FF1A] shadow-[0_0_20px_rgba(200,255,26,0.2)]"
					: "border-[#1A1D22] bg-[#0D1016] text-[#68707D] hover:border-[#2A313C]"
			}`}
		>
			{icon}
		</button>
	)
}

function StatusTag({ status }: { status: "paid" | "pending" | "draft" }) {
	if (status === "paid") {
		return (
			<Badge className="rounded-full border-[#2A351A] bg-[#131C0B] px-2.5 py-1 text-[10px] font-bold text-[#C8FF1A] hover:bg-[#131C0B]">
				PAID
			</Badge>
		)
	}

	if (status === "pending") {
		return (
			<Badge className="rounded-full border-[#3A2E1A] bg-[#1B150B] px-2.5 py-1 text-[10px] font-bold text-[#F6B35D] hover:bg-[#1B150B]">
				PENDING
			</Badge>
		)
	}

	return (
		<Badge className="rounded-full border-[#2B3038] bg-[#171A20] px-2.5 py-1 text-[10px] font-bold text-[#9BA3AF] hover:bg-[#171A20]">
			DRAFT
		</Badge>
	)
}

function PricingCard({
	title,
	price,
	description,
	items,
	highlighted = false,
}: {
	title: string;
	price: string;
	description: string;
	items: string[];
	highlighted?: boolean;
}) {
	return (
		<Card
			className={`rounded-xl bg-[#0A0D12] text-[#F2F3F5] ${highlighted ? "border-[#C8FF1A66]" : "border-[#1A1D22]"}`}
		>
			<CardContent className="space-y-6 p-7 md:p-8">
				{highlighted ? (
					<Badge className="rounded-full border-[#2D361A] bg-[#171F0B] px-3 py-1 text-[10px] font-bold tracking-[0.09em] text-[#C8FF1A] hover:bg-[#171F0B]">
						MOST POPULAR
					</Badge>
				) : null}
				<div>
					<h3 className="text-2xl font-semibold text-[#F2F3F5]">{title}</h3>
					<p className="mt-2 text-sm text-[#8A8F99]">{description}</p>
				</div>
				<div className="flex items-end gap-2">
					<span className="font-serif text-5xl italic text-[#F2F3F5]">
						{price}
					</span>
					<span className="pb-1 text-sm text-[#8A8F99]">/ month</span>
				</div>
				<ul className="space-y-3 text-sm text-[#C7CDD8]">
					{items.map((item) => (
						<li key={item} className="flex items-center gap-2">
							<span className="h-1.5 w-1.5 rounded-full bg-[#C8FF1A]" />
							{item}
						</li>
					))}
				</ul>
				<Button
					className={`h-11 w-full rounded-[10px] text-xs font-bold tracking-[0.08em] ${
						highlighted
							? "bg-[#C8FF1A] text-[#050607] hover:bg-[#D7FF52]"
							: "border border-[#1A1D22] bg-[#0E131B] text-[#F2F3F5] hover:bg-[#141B25]"
					}`}
				>
					START FREE
				</Button>
			</CardContent>
		</Card>
	)
}

function FooterCol({ title, items }: { title: string; items: string[] }) {
	return (
		<div>
			<h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-[#8A8F99]">
				{title}
			</h4>
			<ul className="mt-4 space-y-2.5 text-sm text-[#C7CDD8]">
				{items.map((item) => (
					<li key={item}>
						<a
							href="/"
							className="transition-colors duration-200 hover:text-[#F2F3F5]"
						>
							{item}
						</a>
					</li>
				))}
			</ul>
		</div>
	)
}

const invoiceRows = [
	{
		id: "1",
		initials: "AC",
		client: "Acme Corp",
		project: "Brand System",
		date: "Oct 24, 2026",
		amount: "$4,200.00",
		status: "paid" as const,
	},
	{
		id: "2",
		initials: "NO",
		client: "Nova Studio",
		project: "Website Retainer",
		date: "Oct 18, 2026",
		amount: "$2,680.00",
		status: "pending" as const,
	},
	{
		id: "3",
		initials: "IR",
		client: "Iris Labs",
		project: "Motion Package",
		date: "Oct 11, 2026",
		amount: "$1,400.00",
		status: "draft" as const,
	},
	{
		id: "4",
		initials: "PL",
		client: "Polar Agency",
		project: "Campaign Design",
		date: "Oct 02, 2026",
		amount: "$3,960.00",
		status: "paid" as const,
	},
];
