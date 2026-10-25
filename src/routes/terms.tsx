import { createFileRoute } from "@tanstack/react-router";
import { MarketingShell } from "#/components/marketing/MarketingLayout";

export const Route = createFileRoute("/terms")({
	component: TermsPage,
});

function TermsPage() {
	return (
		<MarketingShell>
			<main className="mx-auto max-w-4xl px-6 py-20 text-ink">
				<h1 className="text-4xl font-semibold tracking-[-0.03em]">Terms</h1>
				<div className="mt-8 space-y-6 text-sm leading-7 text-ink-3">
					<section className="rounded-md border border-rule bg-paper-2 p-5">
						<h2 className="text-base font-medium text-ink">Product use</h2>
						<p className="mt-2">
							Velure helps businesses create invoices, manage clients, send
							reminders, and export finance records. You are responsible for
							account access, invoice accuracy, and lawful use of the service.
						</p>
					</section>
					<section className="rounded-md border border-rule bg-paper-2 p-5">
						<h2 className="text-base font-medium text-ink">
							Invoice and tax disclaimer
						</h2>
						<p className="mt-2">
							Velure provides invoice formatting and calculation support. It
							does not replace legal, tax, or accounting advice. Confirm VAT,
							WHT, NRS, and record-keeping requirements with your accountant or
							tax adviser.
						</p>
					</section>
					<section className="rounded-md border border-rule bg-paper-2 p-5">
						<h2 className="text-base font-medium text-ink">Payments</h2>
						<p className="mt-2">
							Payment collection may route through third-party providers such as
							Paystack. Provider fees, settlement timing, chargebacks, and
							payment disputes are handled under the provider terms.
						</p>
					</section>
				</div>
			</main>
		</MarketingShell>
	);
}
