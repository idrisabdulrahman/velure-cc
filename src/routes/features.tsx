import { createFileRoute } from "@tanstack/react-router";
import {
	FeatureGrid,
	LedgerPreview,
	MarketingHero,
	MarketingShell,
	MetricsStrip,
	SplitSection,
} from "#/components/marketing/MarketingLayout";

export const Route = createFileRoute("/features")({
	component: FeaturesPage,
});

function FeaturesPage() {
	return (
		<MarketingShell>
			<MarketingHero
				kicker="Features"
				title="Invoice operations without spreadsheet debt."
				description="Create professional invoices in minutes, track unpaid invoices without spreadsheets, and keep every client record close to the money it affects."
			>
				<LedgerPreview />
			</MarketingHero>
			<FeatureGrid
				items={[
					{
						title: "Create professional invoices in minutes.",
						description:
							"Compose line items, taxes, due dates, customer details, payment notes, and branded PDF output from one focused editor.",
					},
					{
						title: "Track unpaid invoices without spreadsheets.",
						description:
							"Search, filter, duplicate, and update statuses from one ledger-style workspace built for weekly finance work.",
					},
					{
						title: "Send payment reminders automatically.",
						description:
							"Queue pre-due, due-date, and overdue reminders. Escalate stubborn invoices to your team through Slack.",
					},
					{
						title: "Nigeria-ready VAT and WHT support.",
						description:
							"Model VAT, WHT deductions, TIN checks, CAC RC fields, and foreign-currency notices before invoices leave your team.",
					},
					{
						title:
							"Keep clients, payment terms, and invoice history in one place.",
						description:
							"Store client contacts, billing terms, tax IDs, currency, internal notes, and invoice history together.",
					},
					{
						title: "Accounting connection points.",
						description:
							"Prepare cleaned invoice and client records for QuickBooks or Xero import when finance needs system-of-record continuity.",
					},
				]}
			/>
			<MetricsStrip
				metrics={[
					{ value: "1", label: "billing command center" },
					{ value: "3", label: "reminder stages" },
					{ value: "NG", label: "tax-first setup" },
				]}
			/>
			<SplitSection
				kicker="Workflow"
				title="Built around invoice movement."
				body="Velure treats invoicing as an operating loop: create, validate, send, follow up, export, sync. Small enough for owners, structured enough for finance teams."
				points={[
					"Draft and duplicate repeat invoices without rebuilding client context.",
					"See paid, open, overdue, draft, canceled, and scheduled work clearly.",
					"Generate accountant-ready CSV exports for tax summaries and ledgers.",
					"Keep public invoice links separate from internal workspace controls.",
				]}
			/>
		</MarketingShell>
	);
}
