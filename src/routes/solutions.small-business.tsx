import { createFileRoute } from "@tanstack/react-router";
import {
  FeatureGrid,
  MarketingHero,
  MarketingShell,
  MetricsStrip,
  SplitSection,
} from "#/components/marketing/MarketingLayout";

export const Route = createFileRoute("/solutions/small-business")({
  component: SmallBusinessPage,
});

function SmallBusinessPage() {
  return (
    <MarketingShell>
      <MarketingHero
        kicker="Small business"
        title="Look organized before finance gets complicated."
        description="Create professional invoices in minutes, keep clients and payment terms in one place, and stop losing unpaid work inside chat threads."
      />
      <FeatureGrid
        items={[
          {
            title: "Fast invoice creation",
            description:
              "Build polished invoices with customer details, due dates, line items, taxes, and payment notes.",
          },
          {
            title: "Client memory",
            description:
              "Keep clients, payment terms, and invoice history in one place so repeat work starts faster.",
          },
          {
            title: "Payment follow-up",
            description:
              "Send payment reminders automatically instead of manually checking every unpaid invoice.",
          },
        ]}
      />
      <MetricsStrip
        metrics={[
          { value: "₦", label: "local pricing" },
          { value: "PDF", label: "download ready" },
          { value: "VAT", label: "Nigeria-ready" },
        ]}
      />
      <SplitSection
        kicker="Owner workflow"
        title="Less admin, cleaner payment habits."
        body="Velure gives small teams a finance workspace before they hire finance staff."
        points={[
          "Track unpaid invoices without spreadsheets.",
          "Use saved client details for repeat billing.",
          "Export clean records for accountants.",
          "Add VAT and WHT context when needed.",
        ]}
      />
    </MarketingShell>
  );
}
