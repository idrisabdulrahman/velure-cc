import { createFileRoute } from "@tanstack/react-router";
import {
	FeatureGrid,
	MarketingHero,
	MarketingShell,
	MetricsStrip,
	SplitSection,
} from "#/components/marketing/MarketingLayout";

export const Route = createFileRoute("/solutions/enterprise")({
	component: EnterprisePage,
});

function EnterprisePage() {
	return (
		<MarketingShell>
			<MarketingHero
				kicker="Enterprise"
				title="Invoice control for teams with real process."
				description="Centralize invoice records, tax context, reminder escalation, and accounting sync so finance teams can operate without scattered handoffs."
			/>
			<FeatureGrid
				items={[
					{
						title: "Workspace roles",
						description:
							"Invite owners, members, and viewers so invoice operations stay inside controlled workspaces.",
					},
					{
						title: "Compliance exports",
						description:
							"Generate tax summary, invoice, customer ledger, and normalized accounting exports for review.",
					},
					{
						title: "Accounting continuity",
						description:
							"Connect QuickBooks or Xero and keep sync history visible when records fail or need configuration.",
					},
					{
						title: "Payment reminder review",
						description:
							"Move overdue invoices from customer reminders to internal Slack review when thresholds are crossed.",
					},
				]}
			/>
			<MetricsStrip
				metrics={[
					{ value: "RBAC", label: "workspace roles" },
					{ value: "CSV", label: "export posture" },
					{ value: "API", label: "integration ready" },
				]}
			/>
			<SplitSection
				kicker="Control"
				title="Cleaner boundaries for finance operations."
				body="Enterprise teams need traceability, workspace isolation, and reviewable records. Velure is built toward that operating model."
				points={[
					"Separate workspace data by membership.",
					"Keep sync errors readable and retryable.",
					"Give viewers access without write authority.",
					"Prepare exports for accountants and external partners.",
				]}
			/>
		</MarketingShell>
	);
}
