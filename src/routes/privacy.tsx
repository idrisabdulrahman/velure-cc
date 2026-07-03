import { createFileRoute } from "@tanstack/react-router";
import { MarketingShell } from "#/components/marketing/MarketingLayout";

export const Route = createFileRoute("/privacy")({
	component: PrivacyPage,
});

function PrivacyPage() {
	return (
		<MarketingShell>
			<main className="mx-auto max-w-4xl px-6 py-20 text-[#f2efe7]">
				<h1 className="text-4xl font-semibold tracking-[-0.03em]">
					Privacy policy
				</h1>
				<div className="mt-8 space-y-6 text-sm leading-7 text-[#aaa294]">
					<section className="rounded-md border border-[#30352f] bg-[#171a18] p-5">
						<h2 className="text-base font-medium text-[#f2efe7]">
							Data we store
						</h2>
						<p className="mt-2">
							Velure stores account profile data, client records, invoices, tax
							fields, payment details you enter, and export history needed to
							run the product.
						</p>
					</section>
					<section className="rounded-md border border-[#30352f] bg-[#171a18] p-5">
						<h2 className="text-base font-medium text-[#f2efe7]">
							How data is used
						</h2>
						<p className="mt-2">
							Data is used to create invoices, generate PDFs, send invoice
							emails, prepare exports, and keep your workspace secure. We do not
							sell customer or invoice data.
						</p>
					</section>
					<section className="rounded-md border border-[#30352f] bg-[#171a18] p-5">
						<h2 className="text-base font-medium text-[#f2efe7]">
							Exports and deletion
						</h2>
						<p className="mt-2">
							Your data is yours. Export invoices as PDF or CSV anytime. Account
							deletion removes workspace data subject to operational backup
							windows and legal retention needs.
						</p>
					</section>
				</div>
			</main>
		</MarketingShell>
	);
}
