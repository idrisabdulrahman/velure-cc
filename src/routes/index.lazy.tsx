import { createLazyFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Check, FileText, Receipt, Users } from "lucide-react";
import { useEffect } from "react";
import { Button } from "#/components/ui/button";
import { authClient } from "#/lib/auth-client";

export const Route = createLazyFileRoute("/")({
  component: LandingPage,
});

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
      <header className="border-b border-[#2b2d30]">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-3 text-sm font-medium">
            <span className="flex h-8 w-8 items-center justify-center rounded-sm border border-[#3a3d41] bg-[#17191b]">
              V
            </span>
            Velure
          </Link>
          <div className="flex items-center gap-3">
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
          <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[1.1fr_0.9fr] lg:py-24">
            <div className="max-w-2xl">
              <h1 className="text-4xl font-semibold tracking-[-0.03em] text-[#ece7de] lg:text-5xl">
                Create invoices, keep clients organized, and stop chasing scattered records.
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-[#a29b90]">
                Velure is a straightforward workspace for teams that need clear billing history,
                quick edits, and a client list that stays usable as volume grows.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button
                  asChild
                  className="h-10 rounded-md bg-[#a7bc62] px-4 text-sm font-medium text-[#121314] hover:bg-[#b5c97a]"
                >
                  <Link to="/auth">
                    Open workspace
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  className="h-10 rounded-md border border-[#2b2d30] bg-[#17191b] px-4 text-sm text-[#d5d0c7] hover:bg-[#1d2023]"
                >
                  <Link to="/auth">Sign in</Link>
                </Button>
              </div>
            </div>

            <div className="ui-stagger-1 rounded-md border border-[#2b2d30] bg-[#17191b]">
              <div className="border-b border-[#2b2d30] px-5 py-4">
                <p className="text-sm font-medium text-[#ece7de]">Invoices this week</p>
              </div>
              <div className="divide-y divide-[#2b2d30]">
                <PreviewRow
                  number="INV-2048"
                  client="Northline Studio"
                  amount="$4,250.00"
                  status="Paid"
                />
                <PreviewRow
                  number="INV-2049"
                  client="Aster Retail"
                  amount="$1,980.00"
                  status="Unpaid"
                />
                <PreviewRow
                  number="INV-2050"
                  client="Field Ledger"
                  amount="$860.00"
                  status="Draft"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-[#2b2d30]">
          <div className="mx-auto grid w-full max-w-6xl gap-4 px-6 py-12 md:grid-cols-3">
            <FeatureCard
              icon={Receipt}
              title="Invoices stay editable"
              description="Create, duplicate, preview, and update status without jumping across multiple tools."
            />
            <FeatureCard
              icon={Users}
              title="Clients stay attached to the work"
              description="Billing terms, contacts, and account details stay close to the invoices they affect."
            />
            <FeatureCard
              icon={FileText}
              title="Product totals stay visible"
              description="Review which line items are used most often and how much revenue they generate."
            />
          </div>
        </section>

        <section>
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-12 lg:grid-cols-[1fr_320px]">
            <div className="rounded-md border border-[#2b2d30] bg-[#17191b]">
              <div className="border-b border-[#2b2d30] px-5 py-4">
                <p className="text-sm font-medium text-[#ece7de]">What this app is built for</p>
              </div>
              <div className="space-y-4 px-5 py-5 text-sm leading-7 text-[#b7b1a7]">
                <ChecklistItem text="Teams that need a single place to manage invoices and clients." />
                <ChecklistItem text="Frequent edits, status changes, and quick public invoice sharing." />
                <ChecklistItem text="A calmer interface that feels like product software, not a marketing mockup." />
              </div>
            </div>

            <div className="rounded-md border border-[#2b2d30] bg-[#17191b] p-5">
              <p className="text-sm font-medium text-[#ece7de]">Start using it</p>
              <p className="mt-2 text-sm leading-6 text-[#a29b90]">
                Sign in to open the full workspace and continue from the invoices dashboard.
              </p>
              <Button
                asChild
                className="mt-5 h-10 w-full rounded-md bg-[#a7bc62] text-sm font-medium text-[#121314] hover:bg-[#b5c97a]"
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
  return (
    <div className="grid grid-cols-[1fr_auto] gap-4 px-5 py-4">
      <div>
        <p className="text-sm font-medium text-[#ece7de]">{number}</p>
        <p className="mt-1 text-sm text-[#a29b90]">{client}</p>
      </div>
      <div className="text-right">
        <p className="text-sm font-medium text-[#ece7de]">{amount}</p>
        <p className="mt-1 text-sm text-[#8f9e66]">{status}</p>
      </div>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Receipt;
  title: string;
  description: string;
}) {
  return (
    <div className="ui-panel rounded-md border border-[#2b2d30] bg-[#17191b] p-5">
      <Icon className="h-5 w-5 text-[#a7bc62]" />
      <p className="mt-4 text-base font-medium text-[#ece7de]">{title}</p>
      <p className="mt-2 text-sm leading-6 text-[#a29b90]">{description}</p>
    </div>
  );
}

function ChecklistItem({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3">
      <Check className="mt-1 h-4 w-4 shrink-0 text-[#a7bc62]" />
      <p>{text}</p>
    </div>
  );
}
