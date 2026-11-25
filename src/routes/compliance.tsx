import { createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import {
	MarketingHero,
	MarketingShell,
	SplitSection,
} from "#/components/marketing/MarketingLayout";

export const Route = createFileRoute("/compliance")({
	component: CompliancePage,
});

const whtRows = [
	{ category: "Professional fees", resident: "5%", nonResident: "10%" },
	{ category: "Technical services", resident: "5%", nonResident: "10%" },
	{ category: "Rent", resident: "10%", nonResident: "10%" },
	{ category: "Dividends", resident: "10%", nonResident: "10%" },
	{ category: "Interest", resident: "10%", nonResident: "10%" },
	{ category: "Commission", resident: "5%", nonResident: "10%" },
];

function CompliancePage() {
	return (
		<MarketingShell>
			<MarketingHero
				kicker="Compliance"
				title="Nigeria-ready invoices, without pretending to be the tax authority."
				description="Invoicly structures VAT, WHT, and tax-ID fields into every invoice and keeps the records your accountant needs — and it is honest about what it does not do."
				secondaryTo="/security"
				secondaryLabel="How access works"
			/>
			<section className="px-5 pb-6 sm:px-7">
				<div className="mx-auto grid max-w-6xl items-center gap-10 border-t border-[var(--hm-rule)] pt-14 lg:grid-cols-2 lg:gap-16">
					<div>
						<p className="text-[clamp(5rem,11vw,9rem)] font-medium leading-[0.85] tracking-[-0.07em]">
							7.5
							<sup className="relative top-[0.12em] ml-[0.04em] align-top text-[0.34em] tracking-[-0.02em] text-[var(--hm-accent)]">
								%
							</sup>
						</p>
						<p className="hm-lede mt-3.5 max-w-[46ch] text-[15px]">
							Nigeria standard VAT, applied by default to taxable supplies.
						</p>
					</div>
					<div className="max-w-[520px] overflow-hidden rounded-[14px] border border-[var(--hm-rule)] bg-[var(--hm-paper-2)]">
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
								<span className="hm-num text-right">{row.nonResident}</span>
							</div>
						))}
					</div>
				</div>
			</section>
			<SplitSection
				kicker="Finance review"
				title="Compliance support, not legal advice."
				body="Invoicly helps structure invoice data for Nigerian finance workflows. Confirm VAT, WHT, and filing treatment with your accountant or tax advisor."
				points={[
					"Flag missing seller or buyer tax IDs.",
					"Show manual tax and WHT override warnings.",
					"Export tax summaries for accountant review.",
					"Keep compliance snapshots attached to invoices.",
				]}
			/>
			<section className="px-5 pb-4 sm:px-7">
				<div className="mx-auto max-w-6xl border-t border-[var(--hm-rule)] pt-10">
					<ul className="m-0 max-w-[76ch] list-none space-y-3 p-0 text-[15px] leading-[1.6] text-[var(--hm-ink-2)]">
						<li className="flex gap-3">
							<Check
								className="mt-1 h-4 w-4 shrink-0 text-[var(--hm-accent)]"
								aria-hidden="true"
							/>
							<span>
								Invoicly is not an NRS-certified e-invoicing provider. It does
								not submit invoices to the NRS, and it cannot get invoices
								cleared through the MBS.
							</span>
						</li>
					</ul>
				</div>
			</section>
		</MarketingShell>
	);
}
