import { createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useState } from "react";
import {
	MarketingHero,
	MarketingShell,
	SplitSection,
} from "#/components/marketing/MarketingLayout";
import { Button } from "#/components/ui/button";

export const Route = createFileRoute("/pricing")({
	component: PricingPage,
});

const plans = [
	{
		name: "Starter",
		monthly: 12000,
		annual: 9600,
		featured: false,
		blurb: "For founders and operators issuing invoices weekly.",
		features: [
			"100 invoices per month",
			"Client records and payment terms",
			"PDF download and public invoice links",
			"Basic VAT and WHT fields",
		],
	},
	{
		name: "Growth",
		monthly: 32000,
		annual: 25600,
		blurb: "For teams chasing payments and exporting finance records.",
		features: [
			"Unlimited invoices",
			"Automatic payment reminders",
			"Tax summary and customer ledger exports",
			"QuickBooks and Xero connection points",
		],
		featured: true,
	},
	{
		name: "Enterprise",
		monthly: 95000,
		annual: 76000,
		featured: false,
		blurb: "For multi-person finance teams needing control.",
		features: [
			"Workspace members and roles",
			"Compliance setup review",
			"Priority support and onboarding",
			"Custom export and approval workflows",
		],
	},
] as const;

function money(value: number) {
	return `₦${new Intl.NumberFormat("en-NG").format(value)}`;
}

function PricingPage() {
	const [annual, setAnnual] = useState(true);

	return (
		<MarketingShell>
			<MarketingHero
				kicker="Pricing"
				title="Naira pricing for serious billing work."
				description="Start with clean invoices. Upgrade when reminders, compliance exports, and accounting exports become daily operations."
				secondaryTo="/features"
				secondaryLabel="See the system"
			>
				<div className="space-y-5">
					<div className="rounded-[var(--hm-r-card)] border border-rule bg-paper-2 p-4">
						<p className="text-xs uppercase tracking-[0.22em] text-ink-3">
							Billing cycle
						</p>
						<div className="mt-4 grid grid-cols-2 overflow-hidden rounded-[var(--hm-r-card)] border border-rule">
							<button
								type="button"
								onClick={() => setAnnual(false)}
								className={`px-4 py-3 text-sm font-black transition-colors duration-150 ease-out ${
									annual ? "bg-paper text-ink-3" : "bg-brand text-brand-ink"
								}`}
							>
								Monthly
							</button>
							<button
								type="button"
								onClick={() => setAnnual(true)}
								className={`px-4 py-3 text-sm font-black transition-colors duration-150 ease-out ${
									annual ? "bg-brand text-brand-ink" : "bg-paper text-ink-3"
								}`}
							>
								Annual
							</button>
						</div>
						<p className="mt-3 text-sm text-ink-2">Annual saves 20%.</p>
					</div>
					<div className="grid grid-cols-3 gap-2">
						{plans.map((plan) => (
							<div key={plan.name} className="bg-brand p-3 text-brand-ink">
								<p className="text-xs font-black uppercase">{plan.name}</p>
								<p className="mt-2 text-lg font-black">
									{money(annual ? plan.annual : plan.monthly)}
								</p>
							</div>
						))}
					</div>
				</div>
			</MarketingHero>

			<section className="border-b border-rule">
				<div className="mx-auto grid max-w-7xl gap-4 px-5 py-14 lg:grid-cols-3 lg:px-8">
					{plans.map((plan) => (
						<article
							key={plan.name}
							className={`rounded-[var(--hm-r-card)] border p-6 ${
								plan.featured
									? "border-brand bg-brand-soft"
									: "border-rule bg-paper-2"
							}`}
						>
							<p className="text-sm font-black uppercase tracking-[0.18em] text-brand">
								{plan.name}
							</p>
							<p className="mt-5 text-5xl font-black text-ink">
								{money(annual ? plan.annual : plan.monthly)}
							</p>
							<p className="mt-2 text-sm text-ink-3">per month</p>
							<p className="mt-5 min-h-14 text-sm leading-7 text-ink-2">
								{plan.blurb}
							</p>
							<Button className="mt-6 h-11 w-full bg-brand font-black text-brand-ink hover:bg-brand-hi">
								Start {plan.name}
							</Button>
							<div className="mt-6 space-y-3">
								{plan.features.map((feature) => (
									<div key={feature} className="flex gap-3 text-sm text-ink-2">
										<Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
										<span>{feature}</span>
									</div>
								))}
							</div>
						</article>
					))}
				</div>
			</section>
			<SplitSection
				kicker="Plan fit"
				title="Pay for operational weight, not decoration."
				body="Velure pricing maps to actual finance work: invoice volume, reminders, exports, accounting connection points, and team control."
				points={[
					"Starter handles professional invoice creation and client records.",
					"Growth adds reminders, exports, and accounting connection points.",
					"Enterprise adds roles, onboarding, and custom workflows.",
					"All plans keep Velure's dark, focused billing workspace.",
				]}
			/>
		</MarketingShell>
	);
}
