import { createLazyFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Banknote,
  Check,
  CreditCard,
  FileDown,
  FileText,
  Mail,
  Receipt,
  Users,
} from "lucide-react";
import { useEffect } from "react";
import { Button } from "#/components/ui/button";
import { authClient } from "#/lib/auth-client";

export const Route = createLazyFileRoute("/")({
  component: LandingPage,
});

const invoices = [
  {
    number: "VEL-2026-0142",
    client: "Northline Studio",
    amount: "₦420,000",
    status: "Paid",
  },
  {
    number: "VEL-2026-0143",
    client: "Aster Retail",
    amount: "₦180,000",
    status: "Unpaid",
  },
  {
    number: "VEL-2026-0144",
    client: "Field Ledger",
    amount: "₦86,000",
    status: "Draft",
  },
];

function LandingPage() {
  const navigate = useNavigate();
  const { data: session, isPending: sessionPending } = authClient.useSession();

  useEffect(() => {
    if (!sessionPending && session?.user) {
      void navigate({ to: "/invoices", replace: true });
    }
  }, [navigate, session?.user, sessionPending]);

  if (sessionPending || session?.user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#121314]">
        <div className="h-8 w-8 animate-pulse rounded-md border border-[#2b2d30] bg-[#17191b]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#121314] text-[#ece7de]">
      <header className="border-b border-[#2b2d30] bg-[#121314]">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-5 md:px-8">
          <Link to="/" className="flex items-center gap-3 text-sm font-medium text-[#ece7de]">
            <span className="flex h-8 w-8 items-center justify-center rounded-sm border border-[#3a3d41] bg-[#202327]">
              V
            </span>
            Velure
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-[#8a857d] md:flex">
            <Link to="/features" className="hover:text-[#ece7de]">
              Features
            </Link>
            <Link to="/pricing" className="hover:text-[#ece7de]">
              Pricing
            </Link>
            <Link to="/security" className="hover:text-[#ece7de]">
              Security
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <Button
              asChild
              variant="ghost"
              className="h-9 rounded-md border border-[#2b2d30] bg-[#17191b] px-4 text-sm text-[#d5d0c7] hover:bg-[#1d2023]"
            >
              <Link to="/auth">Sign in</Link>
            </Button>
            <Button
              asChild
              className="h-9 rounded-md bg-[#a7bc62] px-4 text-sm font-medium text-[#121314] hover:bg-[#b5c97a]"
            >
              <Link to="/auth">Open app</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="border-b border-[#2b2d30]">
          <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 py-12 md:px-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(520px,1.05fr)] lg:py-16">
            <div className="flex min-h-[560px] flex-col justify-center">
              <h1 className="max-w-[760px] text-[56px] font-semibold leading-[0.92] tracking-[-0.045em] text-[#ece7de] md:text-[76px] lg:text-[88px]">
                Velure invoice workspace.
              </h1>
              <p className="mt-7 max-w-xl text-xl leading-8 text-[#a29b90]">
                Create professional invoices in minutes, collect with Paystack, keep client records
                clean, and stop chasing scattered billing files.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button
                  asChild
                  className="h-11 rounded-md bg-[#a7bc62] px-5 text-sm font-medium text-[#121314] hover:bg-[#b5c97a]"
                >
                  <Link to="/auth">
                    Open workspace
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  className="h-11 rounded-md border border-[#2b2d30] bg-[#17191b] px-5 text-sm text-[#d5d0c7] hover:bg-[#1d2023]"
                >
                  <Link to="/features">See what it handles</Link>
                </Button>
              </div>
              <div className="mt-10 grid max-w-xl grid-cols-3 border border-[#2b2d30] bg-[#17191b]">
                <Metric value="VAT" label="Nigeria-ready" />
                <Metric value="WHT" label="Clearly shown" />
                <Metric value="PDF/CSV" label="Export anytime" />
              </div>
            </div>

            <div className="flex min-h-[560px] items-center">
              <ProductPreview />
            </div>
          </div>
        </section>

        <section className="border-b border-[#2b2d30]">
          <div className="mx-auto grid w-full max-w-7xl gap-0 px-5 py-0 md:px-8 lg:grid-cols-4">
            <FeatureBlock
              icon={Receipt}
              title="Invoices that collect"
              description="Add Paystack checkout to public invoice pages so customers can move from viewing to paying."
            />
            <FeatureBlock
              icon={Users}
              title="Clients stay organized"
              description="Keep email, payment terms, TIN, notes, and invoice history close to each client."
            />
            <FeatureBlock
              icon={Mail}
              title="Reminders run quietly"
              description="Schedule payment follow-ups through Resend and keep manual exceptions visible."
            />
            <FeatureBlock
              icon={FileDown}
              title="Exports for accountants"
              description="Download invoice CSV, tax summary CSV, customer ledger CSV, or styled invoice PDFs."
            />
          </div>
        </section>

        <section className="border-b border-[#2b2d30]">
          <div className="mx-auto grid w-full max-w-7xl gap-8 px-5 py-14 md:px-8 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <h2 className="max-w-xl text-4xl font-semibold leading-none tracking-[-0.035em] text-[#ece7de] md:text-5xl">
                Built for small businesses that need payment, tax, and records in one place.
              </h2>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <ChecklistItem text="Create professional invoices in minutes." />
              <ChecklistItem text="Track unpaid invoices without spreadsheets." />
              <ChecklistItem text="Send payment reminders automatically." />
              <ChecklistItem text="Nigeria-ready VAT and WHT support." />
              <ChecklistItem text="Keep clients, payment terms, and invoice history together." />
              <ChecklistItem text="Export invoices as PDF or CSV anytime." />
            </div>
          </div>
        </section>

        <section>
          <div className="mx-auto grid w-full max-w-7xl gap-8 px-5 py-14 md:px-8 lg:grid-cols-[1fr_360px]">
            <div className="rounded-md border border-[#2b2d30] bg-[#17191b]">
              <div className="grid border-b border-[#2b2d30] md:grid-cols-[220px_1fr_160px]">
                <div className="px-5 py-4 text-sm font-medium text-[#ece7de]">Launch flow</div>
                <div className="hidden px-5 py-4 text-sm text-[#8a857d] md:block">What happens</div>
                <div className="hidden px-5 py-4 text-sm text-[#8a857d] md:block">Owner</div>
              </div>
              <FlowRow
                step="1"
                title="Set business defaults"
                detail="Company name, logo, TIN, payment terms, currency, and invoice numbering."
                owner="Founder"
              />
              <FlowRow
                step="2"
                title="Create invoice"
                detail="Client, line items, VAT/WHT, public invoice page, PDF, and Paystack checkout."
                owner="Ops"
              />
              <FlowRow
                step="3"
                title="Follow up"
                detail="Email reminders, status changes, paid date, payment reference, and export history."
                owner="Finance"
              />
            </div>

            <div className="rounded-md border border-[#2b2d30] bg-[#17191b] p-5">
              <p className="text-2xl font-semibold tracking-[-0.03em] text-[#ece7de]">
                Start with invoices. Keep the finance trail.
              </p>
              <p className="mt-3 text-sm leading-6 text-[#a29b90]">
                Open Velure, create the first invoice, send the link, and export records when your
                accountant asks.
              </p>
              <Button
                asChild
                className="mt-6 h-11 w-full rounded-md bg-[#a7bc62] text-sm font-medium text-[#121314] hover:bg-[#b5c97a]"
              >
                <Link to="/auth">Open app</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function ProductPreview() {
  return (
    <div className="w-full rounded-md border border-[#2b2d30] bg-[#17191b]">
      <div className="flex items-center justify-between border-b border-[#2b2d30] px-5 py-4">
        <div>
          <p className="text-sm font-medium text-[#ece7de]">Invoice preview</p>
          <p className="mt-1 text-xs text-[#8a857d]">Public page + payment collection</p>
        </div>
        <span className="font-mono text-sm text-[#a7bc62]">NGN</span>
      </div>

      <div className="grid gap-0 lg:grid-cols-[1fr_260px]">
        <div className="bg-[#f3eee6] p-6 text-[#0f0f0f]">
          <div className="flex items-start justify-between gap-6 border-b border-[#c9c2b7] pb-6">
            <div>
              <p className="text-3xl font-semibold tracking-[-0.04em]">Invoice</p>
              <p className="mt-2 font-mono text-sm">VEL-2026-0143</p>
            </div>
            <div className="text-right text-sm">
              <p>Aster Retail</p>
              <p className="mt-1 text-[#5d5a53]">Due 15 May 2026</p>
            </div>
          </div>

          <div className="divide-y divide-[#d5cec2]">
            <PaperRow item="Monthly brand retainer" qty="1" total="₦150,000" />
            <PaperRow item="Product photography" qty="2" total="₦30,000" />
          </div>

          <div className="ml-auto mt-6 w-full max-w-[260px] space-y-2 text-sm">
            <SummaryLine label="Subtotal" value="₦180,000" />
            <SummaryLine label="VAT 7.5%" value="₦13,500" />
            <SummaryLine label="WHT" value="-₦9,000" />
            <div className="flex justify-between border-t border-[#c9c2b7] pt-3 text-lg font-semibold">
              <span>Net payable</span>
              <span>₦184,500</span>
            </div>
          </div>
        </div>

        <div className="border-t border-[#2b2d30] bg-[#121314] p-5 lg:border-l lg:border-t-0">
          <div className="flex h-full flex-col justify-between gap-6">
            <div>
              <div className="flex h-11 items-center gap-3 rounded-md border border-[#41463b] bg-[#20241e] px-3 text-sm text-[#a7bc62]">
                <CreditCard className="h-4 w-4" />
                Paystack checkout ready
              </div>
              <div className="mt-5 space-y-3">
                {invoices.map((invoice) => (
                  <PreviewRow key={invoice.number} {...invoice} />
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 border border-[#2b2d30]">
              <MiniStat icon={Banknote} label="Open" value="₦266k" />
              <MiniStat icon={FileText} label="Paid" value="₦420k" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="border-r border-[#2b2d30] px-4 py-3 last:border-r-0">
      <p className="font-mono text-sm text-[#a7bc62]">{value}</p>
      <p className="mt-1 text-xs text-[#8a857d]">{label}</p>
    </div>
  );
}

function PaperRow({ item, qty, total }: { item: string; qty: string; total: string }) {
  return (
    <div className="grid grid-cols-[1fr_48px_96px] gap-4 py-4 text-sm">
      <span>{item}</span>
      <span className="text-right text-[#5d5a53]">{qty}</span>
      <span className="text-right font-medium">{total}</span>
    </div>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-[#5d5a53]">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function PreviewRow({
  number,
  client,
  amount,
  status,
}: {
  number: string;
  client: string;
  amount: string;
  status: string;
}) {
  const tone =
    status === "Paid"
      ? "text-[#a7bc62]"
      : status === "Unpaid"
        ? "text-[#e5c078]"
        : "text-[#8a857d]";
  return (
    <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-[#2b2d30] py-3 last:border-b-0">
      <div>
        <p className="text-sm font-medium text-[#ece7de]">{number}</p>
        <p className="mt-1 text-xs text-[#8a857d]">{client}</p>
      </div>
      <div className="text-right">
        <p className="text-sm font-medium text-[#ece7de]">{amount}</p>
        <p className={`mt-1 text-xs ${tone}`}>{status}</p>
      </div>
    </div>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Banknote;
  label: string;
  value: string;
}) {
  return (
    <div className="border-r border-[#2b2d30] p-3 last:border-r-0">
      <Icon className="h-4 w-4 text-[#a7bc62]" />
      <p className="mt-3 text-xs text-[#8a857d]">{label}</p>
      <p className="mt-1 font-mono text-sm text-[#ece7de]">{value}</p>
    </div>
  );
}

function FeatureBlock({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Receipt;
  title: string;
  description: string;
}) {
  return (
    <div className="border-b border-[#2b2d30] bg-[#17191b] p-5 md:border-r md:last:border-r-0 lg:border-b-0">
      <Icon className="h-5 w-5 text-[#a7bc62]" />
      <p className="mt-5 text-lg font-medium tracking-[-0.02em] text-[#ece7de]">{title}</p>
      <p className="mt-2 text-sm leading-6 text-[#a29b90]">{description}</p>
    </div>
  );
}

function ChecklistItem({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-[#2b2d30] bg-[#17191b] p-4">
      <Check className="mt-1 h-4 w-4 shrink-0 text-[#a7bc62]" />
      <p className="text-sm leading-6 text-[#b7b1a7]">{text}</p>
    </div>
  );
}

function FlowRow({
  step,
  title,
  detail,
  owner,
}: {
  step: string;
  title: string;
  detail: string;
  owner: string;
}) {
  return (
    <div className="grid border-b border-[#2b2d30] last:border-b-0 md:grid-cols-[220px_1fr_160px]">
      <div className="flex items-center gap-3 px-5 py-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-sm border border-[#3a3d41] font-mono text-xs text-[#a7bc62]">
          {step}
        </span>
        <span className="text-sm font-medium text-[#ece7de]">{title}</span>
      </div>
      <div className="px-5 pb-4 text-sm leading-6 text-[#a29b90] md:py-4">{detail}</div>
      <div className="hidden px-5 py-4 text-sm text-[#b7b1a7] md:block">{owner}</div>
    </div>
  );
}
