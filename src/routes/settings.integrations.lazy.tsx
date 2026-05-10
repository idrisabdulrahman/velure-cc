import { createLazyFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { CreditCard, FileSpreadsheet, Lock, ReceiptText } from "lucide-react";

export const Route = createLazyFileRoute("/settings/integrations")({
  component: IntegrationsSettingsPage,
});

const upcomingIntegrations = [
  {
    title: "Paystack",
    body: "Collect invoice payments from public invoice pages.",
    icon: <CreditCard className="h-5 w-5" />,
  },
  {
    title: "QuickBooks",
    body: "Send invoice and customer records to your accounting workspace.",
    icon: <ReceiptText className="h-5 w-5" />,
  },
  {
    title: "Xero",
    body: "Keep sales records export-ready for accountant review.",
    icon: <FileSpreadsheet className="h-5 w-5" />,
  },
];

function IntegrationsSettingsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-[-0.02em] text-[#ece7de]">Integrations</h1>
        <p className="mt-2 max-w-2xl text-sm text-[#a29b90]">
          Connect Velure with payment and accounting tools. This area is not open yet.
        </p>
      </div>

      <section className="rounded-md border border-[#2b2d30] bg-[#17191b] p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[#2b2d30] bg-[#121314] text-[#a7bc62]">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-medium text-[#ece7de]">Coming soon</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[#a29b90]">
              Integrations are being prepared for a later release. For now, use PDF and CSV exports
              from Compliance when you need to share records with your accountant.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          {upcomingIntegrations.map((integration) => (
            <IntegrationCard key={integration.title} {...integration} />
          ))}
        </div>
      </section>
    </div>
  );
}

function IntegrationCard({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-md border border-[#2b2d30] bg-[#121314] px-4 py-4 opacity-70">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[#8a857d]">{icon}</div>
        <span className="rounded-sm border border-[#2b2d30] bg-[#17191b] px-2 py-1 text-xs text-[#8a857d]">
          Soon
        </span>
      </div>
      <p className="mt-4 text-sm font-medium text-[#ece7de]">{title}</p>
      <p className="mt-1 text-xs leading-5 text-[#a29b90]">{body}</p>
    </div>
  );
}
