import { Link } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";

/**
 * Single source of truth for the two naira tiers. The homepage pricing
 * section (getinboxzero.com-style: heading, frequency toggle, tier cards)
 * and the /pricing page both read from here so the numbers and the honest
 * feature lists can never drift apart.
 */
export const plans = [
	{
		name: "Starter",
		monthly: 12000,
		annual: 9600,
		featured: false,
		blurb: "For founders and operators issuing invoices weekly.",
		features: [
			"Client records and payment terms",
			"PDF download and public invoice links",
			"VAT and WHT fields on every invoice",
			"Payment tracking and invoice history",
		],
	},
	{
		name: "Growth",
		monthly: 32000,
		annual: 25600,
		featured: true,
		blurb: "For teams that want to get paid without chasing.",
		features: [
			"Everything in Starter",
			"Collect invoice payments by bank transfer (NGN, in pilot)",
			"Recurring invoices on a schedule",
			"Payment reminders (sent automatically)",
			"Tax summary and customer ledger CSV exports",
		],
	},
] as const;

export function money(value: number) {
	return `₦${new Intl.NumberFormat("en-NG").format(value)}`;
}

/** Annual/monthly pill toggle — the getinboxzero.com pattern (active pill is
 * filled ink; the saving badge sits beside it). */
export function PricingToggle({
	annual,
	onChange,
}: {
	annual: boolean;
	onChange: (annual: boolean) => void;
}) {
	return (
		<div className="flex justify-center" data-fade-scroll>
			<div className="flex items-center gap-1 rounded-full border border-[var(--hm-rule)] bg-[var(--hm-paper-2)] p-1">
				<button
					type="button"
					onClick={() => onChange(false)}
					className={`rounded-full px-4 py-1.5 text-[13.5px] font-medium transition-colors duration-150 ${
						annual ? "text-[var(--hm-ink-2)]" : "bg-[var(--hm-ink)] text-white"
					}`}
				>
					Monthly
				</button>
				<button
					type="button"
					onClick={() => onChange(true)}
					className={`rounded-full px-4 py-1.5 text-[13.5px] font-medium transition-colors duration-150 ${
						annual ? "bg-[var(--hm-ink)] text-white" : "text-[var(--hm-ink-2)]"
					}`}
				>
					Annual
				</button>
			</div>
			<span className="ml-2.5 self-center rounded-full border border-[var(--hm-ok-line)] bg-[var(--hm-ok-soft)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--hm-ok)]">
				Annual saves 20%
			</span>
		</div>
	);
}

/** Tier cards — one real trial CTA per plan (the reference site gives every
 * card a button; the featured plan gets the filled pill, the rest white).
 * Cards stay on white with a soft shadow; only the badge and the CTA mark
 * the featured tier. */
export function PricingCards({ annual }: { annual: boolean }) {
	return (
		<div className="mx-auto mt-10 grid max-w-[980px] gap-4 md:grid-cols-2">
			{plans.map((plan) => (
				<article
					key={plan.name}
					data-fade-scroll
					className="relative flex min-w-0 flex-col rounded-[18px] border border-[var(--hm-rule)] bg-[var(--hm-paper)] p-7 shadow-[0_2px_16px_0_rgba(0,0,0,0.05)]"
				>
					<div className="flex items-center justify-between">
						<h3 className="hm-display text-lg font-medium">{plan.name}</h3>
						<div className="flex items-center gap-2">
							{annual ? (
								<span className="rounded-full border border-[var(--hm-info-line)] bg-[var(--hm-info-soft)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--hm-info)]">
									Save 20%
								</span>
							) : null}
							{plan.featured ? (
								<span className="rounded-full border border-[var(--hm-ok-line)] bg-[var(--hm-ok-soft)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--hm-ok)]">
									Popular
								</span>
							) : null}
						</div>
					</div>
					<p className="mt-1.5 max-w-[42ch] text-[13.5px] leading-6 text-[var(--hm-ink-2)]">
						{plan.blurb}
					</p>
					<p className="mt-6 text-[2.5rem] font-medium leading-none tracking-[-0.02em]">
						{money(annual ? plan.annual : plan.monthly)}
						<span className="hm-display ml-1.5 text-[13px] font-normal tracking-normal text-[var(--hm-ink-3)]">
							/ month
						</span>
					</p>
					<p className="mt-2 text-xs text-[var(--hm-ink-3)]">
						{annual ? "billed annually" : "billed monthly"} · every plan starts
						with a 3-day free trial
					</p>
					<div className="mt-7 border-t border-[var(--hm-rule-soft)] pt-6">
						<Link
							to="/auth"
							search={{ mode: "sign-up" }}
							className={`hm-btn hm-btn--xl w-full ${
								plan.featured ? "hm-btn--primary" : "hm-btn--ghost"
							}`}
						>
							Try 3 days free
							<ArrowRight className="h-4 w-4" />
						</Link>
					</div>
					<div className="mt-6 space-y-2.5">
						{plan.features.map((feature) => (
							<div
								key={feature}
								className="flex gap-2.5 text-[13.5px] leading-6 text-[var(--hm-ink-2)]"
							>
								<Check
									className="mt-1 h-4 w-4 shrink-0 text-[var(--hm-accent)]"
									aria-hidden="true"
								/>
								<span>{feature}</span>
							</div>
						))}
					</div>
				</article>
			))}
		</div>
	);
}

/**
 * Homepage pricing section — the getinboxzero.com pattern: centered heading,
 * one-line reassurance, annual/monthly toggle, then a tier card per plan
 * with its own trial CTA.
 */
export function PricingSection() {
	const [annual, setAnnual] = useState(true);

	return (
		<section className="px-5 py-[90px] sm:px-7">
			<div className="mx-auto max-w-[1152px]">
				<div className="mx-auto max-w-[46ch] text-center">
					<p className="hm-kicker" data-fade-scroll>
						Pricing
					</p>
					<h2
						className="hm-display font-medium mt-[14px] text-[clamp(1.75rem,3.2vw,2.5rem)] leading-[1.12] tracking-[-0.025em]"
						data-fade-scroll
					>
						Try Invoicly free, then pick a plan.
					</h2>
					<p className="hm-lede mx-auto mt-3.5">
						Two plans, naira pricing. Every plan starts with a 3-day free trial.
						No credit card required.
					</p>
				</div>

				<div className="mt-9">
					<PricingToggle annual={annual} onChange={setAnnual} />
				</div>
				<PricingCards annual={annual} />

				<p className="mt-6 text-center text-[13.5px] text-[var(--hm-ink-3)]">
					<Link
						to="/pricing"
						className="underline decoration-[var(--hm-rule)] underline-offset-4 transition-colors hover:text-[var(--hm-ink)]"
					>
						Full pricing details
					</Link>
					<span className="mx-2">·</span>
					Nothing is billed inside Invoicly yet; bank transfer collection is in
					pilot.
				</p>
			</div>
		</section>
	);
}
