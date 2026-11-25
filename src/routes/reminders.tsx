import { createFileRoute } from "@tanstack/react-router";
import {
	FeatureGrid,
	MarketingHero,
	MarketingShell,
	SplitSection,
} from "#/components/marketing/MarketingLayout";
import { ReminderQueue } from "#/components/marketing/ReminderQueue";

export const Route = createFileRoute("/reminders")({
	component: RemindersPage,
});

function RemindersPage() {
	return (
		<MarketingShell>
			<MarketingHero
				kicker="Reminders"
				title="Follow up on unpaid invoices without spreadsheets."
				description="Invoicly builds a reminder queue from your rules — pre-due, due date, and overdue — and shows every invoice that needs a nudge, with the customer email gaps called out."
				secondaryTo="/features"
				secondaryLabel="See all features"
			>
				<ReminderQueue />
			</MarketingHero>
			<section className="px-5 pb-4 sm:px-7">
				<div className="mx-auto max-w-6xl">
					<div className="grid grid-cols-1 gap-0 border-t border-[var(--hm-rule)] sm:grid-cols-3">
						{[
							{
								when: "−3d",
								title: "First reminder",
								detail: "Goes out three days before the due date.",
							},
							{
								when: "0d",
								title: "Due date",
								detail: "A plain nudge on the day it falls due.",
							},
							{
								when: "+3d",
								title: "Then every 3 days",
								detail:
									"Pause one invoice or mark it for manual follow-up anytime.",
							},
						].map((row) => (
							<div
								key={row.when}
								className="border-b border-[var(--hm-rule)] py-6 sm:border-l sm:px-6 sm:first:border-l-0 sm:first:pl-0"
							>
								<span className="hm-num text-[15px] font-medium text-[var(--hm-accent)]">
									{row.when}
								</span>
								<b className="mt-1 block font-medium">{row.title}</b>
								<span className="hm-lede mt-1 block text-sm">{row.detail}</span>
							</div>
						))}
					</div>
				</div>
			</section>
			<FeatureGrid
				items={[
					{
						title: "A queue built from your rules.",
						description:
							"Every unpaid invoice with a due date lands in one queue, staged by how close it is to due — no spreadsheet needed to remember who to chase.",
					},
					{
						title: "Polite emails, ready to send.",
						description:
							"Each stage drafts a customer-safe reminder using your configured signature. You review and send each one, so nothing leaves without your say-so.",
					},
					{
						title: "Exceptions stay visible.",
						description:
							"Invoices missing a buyer email are flagged before they reach the queue, and any invoice can be paused or marked for manual follow-up.",
					},
					{
						title: "A record of every run.",
						description:
							"Reminder runs are logged, so you can see what was queued, what was sent, and when — useful when a customer disputes a late fee.",
					},
				]}
			/>
			<SplitSection
				kicker="Automatic sending"
				title="Reminders send themselves, on schedule."
				body="Invoicly's reminder engine runs on a scheduler — pre-due, due-date, and overdue reminders go out automatically while you watch the trail from the queue. It stays inside invoicing, with no legal escalation tools."
				points={[
					"Reminder emails send automatically every 10 minutes once a rule falls due.",
					"Reminders cover payment follow-up only — no debt collection or legal workflows.",
					"Every send stays tied to its invoice, so the trail is always complete.",
				]}
			/>
		</MarketingShell>
	);
}
