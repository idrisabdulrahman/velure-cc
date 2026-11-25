import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
	MarketingShell,
	SplitSection,
} from "#/components/marketing/MarketingLayout";
import {
	PricingCards,
	PricingToggle,
} from "#/components/marketing/PricingSection";

export const Route = createFileRoute("/pricing")({
	component: PricingPage,
});

/** getinboxzero.com's /pricing shape: centered heading + reassurance line +
 * frequency toggle + tier cards, each card carrying its own trial CTA. */
function PricingPage() {
	const [annual, setAnnual] = useState(true);

	return (
		<MarketingShell>
			<section className="px-5 pb-16 pt-[64px] sm:px-7">
				<div className="mx-auto max-w-[46ch] text-center">
					<h1
						className="hm-display font-medium text-[clamp(1.875rem,3.6vw,2.75rem)] leading-[1.12] tracking-[-0.025em]"
						data-fade-scroll
					>
						Try Invoicly free, then pick a plan.
					</h1>
					<p className="hm-lede mx-auto mt-4">
						Naira pricing, two plans. No hidden fees. Cancel anytime.
					</p>
				</div>
				<div className="mt-8">
					<PricingToggle annual={annual} onChange={setAnnual} />
				</div>
				<PricingCards annual={annual} />
				<p className="mt-6 text-center text-sm font-medium text-[var(--hm-ink-2)]">
					Every plan starts with a 3-day free trial. No credit card required.
				</p>
				<p className="mx-auto mt-3 max-w-[64ch] text-center text-[13.5px] leading-6 text-[var(--hm-ink-3)]">
					No plan is billed inside Invoicly yet and no limits are enforced.
					Everything listed above is built and running today. Bank transfer
					collection is in pilot and switches on per workspace as Bachs accounts
					are verified. QuickBooks and Xero connections are coming later.
				</p>
			</section>
			<SplitSection
				kicker="Plan fit"
				title="Pay for operational weight, not decoration."
				body="Invoicly pricing maps to actual finance work: invoicing, getting paid, and the records that back it up."
				points={[
					"Starter handles professional invoices: clients, VAT and WHT, PDFs, and public invoice links.",
					"Growth adds the money part: bank transfer collection, recurring invoices, payment reminders, and CSV exports.",
					"Both plans run in the same focused billing workspace.",
				]}
			/>
		</MarketingShell>
	);
}
