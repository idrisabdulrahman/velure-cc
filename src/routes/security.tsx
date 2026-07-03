import { createFileRoute } from "@tanstack/react-router";
import {
	FeatureGrid,
	MarketingHero,
	MarketingShell,
	SplitSection,
} from "#/components/marketing/MarketingLayout";

export const Route = createFileRoute("/security")({
	component: SecurityPage,
});

function SecurityPage() {
	return (
		<MarketingShell>
			<MarketingHero
				kicker="Security"
				title="Built to keep billing data controlled."
				description="Velure handles invoices, clients, payment terms, and tax context. Access is authenticated, workspace-scoped, and designed around plain operational controls."
			/>
			<FeatureGrid
				items={[
					{
						title: "Encryption in transit",
						description:
							"Production Velure traffic should run over HTTPS. Data moves between browser, app, and backend through encrypted transport.",
					},
					{
						title: "Encryption at rest",
						description:
							"Billing records are stored in managed infrastructure with provider-level protections for data at rest.",
					},
					{
						title: "Session management",
						description:
							"User sessions are managed through Better Auth. Password reset, Google sign-in, and session cookies are handled by auth infrastructure, not hand-rolled logic.",
					},
					{
						title: "Workspace access",
						description:
							"Invoices, clients, and products are scoped to workspace membership. Users should only see data for organizations they belong to.",
					},
					{
						title: "2FA roadmap",
						description:
							"Two-factor authentication is planned for teams that need stronger account protection before finance work can be accessed.",
					},
					{
						title: "Account safety",
						description:
							"Use strong passwords, keep admin access limited, and remove members who no longer need workspace access.",
					},
					{
						title: "No cross-workspace leaks",
						description:
							"Mutations validate workspace ownership before writes. Viewer roles cannot write operational records.",
					},
					{
						title: "Integration controls",
						description:
							"QuickBooks, Xero, and Slack connections store sync status and errors instead of hiding failures.",
					},
				]}
			/>
			<section className="border-b border-[#2a2a2a] bg-[#101010]">
				<div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
					<p className="text-xs font-black uppercase tracking-[0.24em] text-[#c8ff00]">
						Backup and export
					</p>
					<h2 className="mt-4 max-w-3xl text-4xl font-black tracking-[-0.03em] text-white">
						Your data is yours.
					</h2>
					<p className="mt-4 max-w-2xl text-base leading-8 text-[#c9d2bf]">
						Export invoices as PDF or CSV anytime. Use exports for backups,
						accountant review, customer records, and internal finance checks.
					</p>
				</div>
			</section>
			<SplitSection
				kicker="Operating posture"
				title="Security that finance users can understand."
				body="Velure keeps safety language plain: who can access the workspace, what changed, what exported, and which sync failed."
				points={[
					"Role model: owner, member, viewer.",
					"Server-side membership checks before data access.",
					"Password reset and OAuth handled by Better Auth.",
					"Exportable records support backup and audit workflows.",
				]}
			/>
			<section className="bg-[#0f0f0f]">
				<div className="mx-auto grid max-w-7xl gap-4 px-5 py-10 md:grid-cols-2 lg:px-8">
					<aside className="border border-[#3b3b2a] bg-[#16180f] p-5">
						<p className="text-sm font-black uppercase tracking-[0.18em] text-[#c8ff00]">
							Invoice validity note
						</p>
						<p className="mt-3 text-sm leading-7 text-[#c9d2bf]">
							Velure helps create structured invoices. Validity still depends on
							correct business details, accurate tax treatment, customer
							agreement, and applicable local rules.
						</p>
					</aside>

					<aside className="border border-[#3b3b2a] bg-[#16180f] p-5">
						<p className="text-sm font-black uppercase tracking-[0.18em] text-[#c8ff00]">
							Tax advice note
						</p>
						<p className="mt-3 text-sm leading-7 text-[#c9d2bf]">
							Velure is software, not tax advice. Confirm VAT, WHT, FIRS, and
							reporting decisions with your accountant or tax advisor.
						</p>
					</aside>
				</div>
			</section>
		</MarketingShell>
	);
}
