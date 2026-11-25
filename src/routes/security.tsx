import { createFileRoute } from "@tanstack/react-router";
import { FileText, Hash, Link2, LockKeyhole, Users } from "lucide-react";
import {
	MarketingHero,
	MarketingShell,
	SplitSection,
} from "#/components/marketing/MarketingLayout";

export const Route = createFileRoute("/security")({
	component: SecurityPage,
});

const securityRows = [
	{
		icon: Hash,
		title: "Invoice numbers",
		detail:
			"Issued numbers are unique within a workspace and stay assigned after cancellation.",
	},
	{
		icon: Users,
		title: "Viewer access",
		detail: "Viewers can read workspace records without changing them.",
	},
	{
		icon: FileText,
		title: "Invoice activity",
		detail:
			"When an invoice is created, edited, sent or canceled, a record shows who did it and when.",
	},
	{
		icon: LockKeyhole,
		title: "Workspace access",
		detail: "Private billing records require sign-in and workspace membership.",
	},
] as const;

function SecurityPage() {
	return (
		<MarketingShell>
			<MarketingHero
				kicker="Security"
				title="Know who can access an invoice."
				description="Your team and your customers access invoices in different ways. Here is what each can see, and what stays private."
				secondaryTo="/compliance"
				secondaryLabel="Compliance approach"
			/>
			<section className="px-5 pb-4 sm:px-7">
				<div className="mx-auto grid max-w-6xl gap-10 border-t border-[var(--hm-rule)] pt-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-[72px]">
					<div className="border-l-2 border-[var(--hm-accent)] pl-4 self-start">
						<h3 className="flex items-center gap-2.5 text-[16px] font-medium">
							<Link2
								className="h-4 w-4 text-[var(--hm-accent)]"
								aria-hidden="true"
							/>
							When you share an invoice
						</h3>
						<p className="mt-2 max-w-[46ch] text-[16px] leading-[1.55] text-[var(--hm-ink)]">
							Anyone with its random link can view that invoice without signing
							in. Links do not expire automatically, and you cannot revoke one
							from the app yet.
						</p>
					</div>
					<dl className="m-0 border-t border-[var(--hm-rule)]">
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
								<dd className="m-0 text-[16px] leading-[1.55] text-[var(--hm-ink)]">
									{row.detail}
								</dd>
							</div>
						))}
					</dl>
				</div>
			</section>
			<SplitSection
				kicker="Trust boundary"
				title="Private by default, shared on purpose."
				body="Invoicly separates the internal billing workspace from what a customer sees. Records stay behind sign-in; public pages carry only what you chose to send."
				points={[
					"Private billing records require sign-in and workspace membership.",
					"Public invoice pages are reachable only through their random link.",
					"Every material change to an invoice is recorded with who and when.",
				]}
			/>
		</MarketingShell>
	);
}
