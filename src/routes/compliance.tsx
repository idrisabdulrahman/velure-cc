import { createFileRoute } from "@tanstack/react-router";
import {
  FeatureGrid,
  MarketingHero,
  MarketingShell,
  MetricsStrip,
  SplitSection,
} from "#/components/marketing/MarketingLayout";

export const Route = createFileRoute("/compliance")({
  component: CompliancePage,
});

function CompliancePage() {
  return (
    <MarketingShell>
      <MarketingHero
        kicker="Compliance"
        title="Practical tax context for Nigerian invoices."
        description="Velure helps Nigerian businesses keep invoice data structured for VAT, WHT, customer records, exports, and accountant review."
      />
      <FeatureGrid
        items={[
          {
            title: "Nigeria tax rules",
            description:
              "Set business identity, TIN, CAC RC number, seller tax status, and base currency for cleaner invoice records.",
          },
          {
            title: "VAT",
            description:
              "Velure supports Nigeria VAT fields so teams can show tax treatment clearly on invoices. Add VAT where applicable, keep tax labels visible, and store tax snapshots with invoice records.",
          },
          {
            title: "WHT for freelancers and SMEs",
            description:
              "Withholding Tax is usually deducted by the paying customer and remitted to tax authorities. Velure helps show WHT deductions so expected payment and invoice total are easier to reconcile.",
          },
          {
            title: "NRS positioning",
            description:
              "Velure is built to organize invoice data cleanly for Nigerian finance workflows, accountant review, and future reporting requirements.",
          },
          {
            title: "Invoice numbering",
            description:
              "Use sequential invoice numbers, keep year context, avoid duplicates, and do not reuse canceled invoice numbers for new work.",
          },
          {
            title: "Cross-border review",
            description:
              "Foreign-currency invoices can carry settlement notices and warnings before customer delivery.",
          },
        ]}
      />
      <MetricsStrip
        metrics={[
          { value: "7.5%", label: "Nigeria VAT default" },
          { value: "WHT", label: "deduction support" },
          { value: "CSV", label: "accountant exports" },
        ]}
      />
      <section className="border-b border-[#2a2a2a] bg-[#101010]">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-14 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#c8ff00]">
              Accountant workflow
            </p>
            <h2 className="mt-4 text-4xl font-black tracking-[-0.03em] text-white">
              Works alongside your accountant.
            </h2>
            <p className="mt-4 text-base leading-8 text-[#c9d2bf]">
              Velure does not replace professional review. It gives your accountant cleaner records
              to work with.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {[
              "Export-ready formats for QuickBooks and Xero workflows.",
              "CSV exports for invoice lists, tax summaries, and customer ledgers.",
              "Clear VAT, WHT, customer, and due-date fields.",
              "Readable records for monthly close and tax review.",
            ].map((item) => (
              <div key={item} className="border border-[#2a2a2a] bg-[#1a1a1a] p-4">
                <p className="text-sm leading-7 text-white">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="border-b border-[#2a2a2a] bg-[#0f0f0f]">
        <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[#c8ff00]">
            Backup and export
          </p>
          <h2 className="mt-4 max-w-3xl text-4xl font-black tracking-[-0.03em] text-white">
            Your data is yours.
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-8 text-[#c9d2bf]">
            Export invoices as PDF or CSV anytime. Use exports for backups, accountant review,
            customer records, and monthly finance review.
          </p>
        </div>
      </section>
      <SplitSection
        kicker="Finance review"
        title="Compliance support, not legal advice."
        body="Velure helps structure invoice data for Nigerian finance workflows. Teams should still review tax treatment with their accountant or tax advisor."
        points={[
          "Flag missing seller or buyer tax IDs.",
          "Show manual tax and WHT override warnings.",
          "Export tax summaries for accountant review.",
          "Keep compliance snapshots attached to invoices.",
        ]}
      />
      <section className="bg-[#0f0f0f]">
        <div className="mx-auto grid max-w-7xl gap-4 px-5 py-10 md:grid-cols-2 lg:px-8">
          <aside className="border border-[#3b3b2a] bg-[#16180f] p-5">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-[#c8ff00]">
              Invoice validity note
            </p>
            <p className="mt-3 text-sm leading-7 text-[#c9d2bf]">
              Velure helps create structured invoices. Validity still depends on correct business
              details, accurate tax treatment, customer agreement, and applicable local rules.
            </p>
          </aside>

          <aside className="border border-[#3b3b2a] bg-[#16180f] p-5">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-[#c8ff00]">
              Tax advice note
            </p>
            <p className="mt-3 text-sm leading-7 text-[#c9d2bf]">
              Velure is software, not tax advice. Confirm VAT, WHT, NRS, and reporting decisions
              with your accountant or tax advisor.
            </p>
          </aside>
        </div>
      </section>
    </MarketingShell>
  );
}
