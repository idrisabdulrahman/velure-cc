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
			"QuickBooks, Xero, and Slack sync",
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
				description="Start with clean invoices. Upgrade when reminders, compliance exports, and accounting sync become daily operations."
			>
				<div className="space-y-5">
					<div className="border border-[#2a2a2a] bg-[#101010] p-4">
						<p className="text-xs uppercase tracking-[0.22em] text-[#8fa078]">
							Billing cycle
						</p>
						<div className="mt-4 grid grid-cols-2 border border-[#2a2a2a]">
							<button
								type="button"
								onClick={() => setAnnual(false)}
								className={`px-4 py-3 text-sm font-black ${
									annual
										? "bg-[#101010] text-[#9daa90]"
										: "bg-[#c8ff00] text-[#0f0f0f]"
								}`}
							>
								Monthly
							</button>
							<button
								type="button"
								onClick={() => setAnnual(true)}
								className={`px-4 py-3 text-sm font-black ${
									annual
										? "bg-[#c8ff00] text-[#0f0f0f]"
										: "bg-[#101010] text-[#9daa90]"
								}`}
							>
								Annual
							</button>
						</div>
						<p className="mt-3 text-sm text-[#c9d2bf]">Annual saves 20%.</p>
					</div>
					<div className="grid grid-cols-3 gap-2">
						{plans.map((plan) => (
							<div key={plan.name} className="bg-[#c8ff00] p-3 text-[#0f0f0f]">
								<p className="text-xs font-black uppercase">{plan.name}</p>
								<p className="mt-2 text-lg font-black">
									{money(annual ? plan.annual : plan.monthly)}
								</p>
							</div>
						))}
					</div>
				</div>
			</MarketingHero>

			<section className="border-b border-[#2a2a2a]">
				<div className="mx-auto grid max-w-7xl gap-4 px-5 py-14 lg:grid-cols-3 lg:px-8">
					{plans.map((plan) => (
						<article
							key={plan.name}
							className={`border p-6 ${
								plan.featured
									? "border-[#c8ff00] bg-[#1d240f]"
									: "border-[#2a2a2a] bg-[#1a1a1a]"
							}`}
						>
							<p className="text-sm font-black uppercase tracking-[0.18em] text-[#c8ff00]">
								{plan.name}
							</p>
							<p className="mt-5 text-5xl font-black text-white">
								{money(annual ? plan.annual : plan.monthly)}
							</p>
							<p className="mt-2 text-sm text-[#9daa90]">per month</p>
							<p className="mt-5 min-h-14 text-sm leading-7 text-[#c9d2bf]">
								{plan.blurb}
							</p>
							<Button className="mt-6 h-11 w-full bg-[#c8ff00] font-black text-[#0f0f0f] hover:bg-[#d7ff3d]">
								Start {plan.name}
							</Button>
							<div className="mt-6 space-y-3">
								{plan.features.map((feature) => (
									<div key={feature} className="flex gap-3 text-sm text-white">
										<Check className="mt-0.5 h-4 w-4 shrink-0 text-[#c8ff00]" />
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
				body="Velure pricing maps to actual finance work: invoice volume, reminders, exports, integrations, and team control."
				points={[
					"Starter handles professional invoice creation and client records.",
					"Growth adds reminders, exports, and accounting sync.",
					"Enterprise adds roles, onboarding, and custom workflows.",
					"All plans keep Velure's dark, focused billing workspace.",
				]}
			/>
		</MarketingShell>
	);
}
