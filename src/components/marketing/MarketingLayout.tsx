import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  BadgeCheck,
  Banknote,
  BellRing,
  BookOpenCheck,
  Building2,
  Check,
  FileText,
  LockKeyhole,
  Plug,
  ReceiptText,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "#/components/ui/button";

export type MarketingFeature = {
  title: string;
  description: string;
};

export type MarketingMetric = {
  value: string;
  label: string;
};

const navItems = [
  { to: "/features", label: "Features" },
  { to: "/pricing", label: "Pricing" },
  { to: "/solutions/small-business", label: "Small business" },
  { to: "/solutions/enterprise", label: "Enterprise" },
  { to: "/security", label: "Security" },
  { to: "/compliance", label: "Compliance" },
] as const;

const iconMap = {
  invoices: ReceiptText,
  clients: Users,
  reminders: BellRing,
  compliance: BookOpenCheck,
  security: ShieldCheck,
  integrations: Plug,
  exports: FileText,
  cash: Banknote,
  enterprise: Building2,
  lock: LockKeyhole,
};

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0f0f0f] text-white">
      <MarketingNav />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  );
}

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-[#2a2a2a] bg-[#0f0f0f]/95 backdrop-blur">
      <div className="mx-auto flex min-h-16 w-full max-w-7xl items-center justify-between gap-5 px-5 py-3 lg:px-8">
        <Link to="/" className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center border border-[#c8ff00]/45 bg-[#151515] text-sm font-black text-[#c8ff00]">
            V
          </span>
          <span className="text-sm font-black uppercase tracking-[0.24em] text-white">Velure</span>
        </Link>

        <nav className="hidden items-center gap-1 xl:flex">
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#a9b59a] hover:bg-[#1a1a1a] hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Button
            asChild
            variant="ghost"
            className="hidden h-10 border border-[#2a2a2a] bg-[#151515] px-4 text-sm text-white hover:bg-[#1f1f1f] sm:inline-flex"
          >
            <Link to="/auth">Sign in</Link>
          </Button>
          <Button
            asChild
            className="h-10 bg-[#c8ff00] px-4 text-sm font-black text-[#0f0f0f] hover:bg-[#d7ff3d]"
          >
            <Link to="/auth">
              Open app
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

export function MarketingHero({
  kicker,
  title,
  description,
  children,
}: {
  kicker: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <section className="border-b border-[#2a2a2a]">
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-24">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.28em] text-[#c8ff00]">{kicker}</p>
          <h1 className="mt-5 max-w-4xl text-5xl font-black leading-[0.95] tracking-[-0.04em] text-white md:text-7xl">
            {title}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-[#c9d2bf]">{description}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              asChild
              className="h-11 bg-[#c8ff00] px-5 text-sm font-black text-[#0f0f0f] hover:bg-[#d7ff3d]"
            >
              <Link to="/auth">
                Create workspace
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              className="h-11 border border-[#313131] bg-[#1a1a1a] px-5 text-sm text-white hover:bg-[#222]"
            >
              <Link to="/pricing">View pricing</Link>
            </Button>
          </div>
        </div>
        <div className="border border-[#2a2a2a] bg-[#1a1a1a] p-4 lg:p-5">
          {children ?? <LedgerPreview />}
        </div>
      </div>
    </section>
  );
}

export function LedgerPreview() {
  const rows = [
    ["INV-2026-000184", "Aster Retail", "₦820,000", "Paid"],
    ["INV-2026-000185", "Northline Studio", "₦410,500", "Unpaid"],
    ["INV-2026-000186", "Field Ledger", "₦96,000", "Draft"],
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-[#2a2a2a] pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[#8fa078]">Billing command</p>
          <p className="mt-1 text-2xl font-black text-white">₦1.32m open</p>
        </div>
        <BadgeCheck className="h-8 w-8 text-[#c8ff00]" />
      </div>
      <div className="grid grid-cols-4 gap-2 text-[11px] uppercase tracking-[0.16em] text-[#78826f]">
        <span>Invoice</span>
        <span>Client</span>
        <span className="text-right">Amount</span>
        <span className="text-right">State</span>
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <div
            key={row[0]}
            className="grid grid-cols-4 gap-2 border border-[#2a2a2a] bg-[#101010] px-3 py-3 text-sm"
          >
            <span className="font-semibold text-white">{row[0]}</span>
            <span className="truncate text-[#c9d2bf]">{row[1]}</span>
            <span className="text-right text-white">{row[2]}</span>
            <span className="text-right text-[#c8ff00]">{row[3]}</span>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-2 pt-2">
        {[64, 42, 78, 50, 92].map((height) => (
          <div key={height} className="flex h-28 items-end bg-[#111]">
            <div className="w-full bg-[#c8ff00]" style={{ height: `${height}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function FeatureGrid({ items }: { items: MarketingFeature[] }) {
  return (
    <section className="border-b border-[#2a2a2a]">
      <div className="mx-auto grid w-full max-w-7xl gap-4 px-5 py-14 md:grid-cols-2 lg:grid-cols-3 lg:px-8">
        {items.map((item, index) => {
          const Icon = Object.values(iconMap)[index % Object.values(iconMap).length];
          return (
            <article key={item.title} className="border border-[#2a2a2a] bg-[#1a1a1a] p-5">
              <Icon className="h-5 w-5 text-[#c8ff00]" />
              <h2 className="mt-5 text-xl font-black text-white">{item.title}</h2>
              <p className="mt-3 text-sm leading-7 text-[#b8c3ad]">{item.description}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function SplitSection({
  kicker,
  title,
  body,
  points,
}: {
  kicker: string;
  title: string;
  body: string;
  points: string[];
}) {
  return (
    <section className="border-b border-[#2a2a2a]">
      <div className="mx-auto grid w-full max-w-7xl gap-8 px-5 py-14 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[#c8ff00]">{kicker}</p>
          <h2 className="mt-4 text-4xl font-black tracking-[-0.03em] text-white">{title}</h2>
          <p className="mt-4 text-base leading-8 text-[#c9d2bf]">{body}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {points.map((point) => (
            <div key={point} className="flex gap-3 border border-[#2a2a2a] bg-[#1a1a1a] p-4">
              <Check className="mt-1 h-4 w-4 shrink-0 text-[#c8ff00]" />
              <p className="text-sm leading-6 text-white">{point}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function MetricsStrip({ metrics }: { metrics: MarketingMetric[] }) {
  return (
    <section className="border-b border-[#2a2a2a] bg-[#121212]">
      <div className="mx-auto grid max-w-7xl gap-px border-x border-[#2a2a2a] bg-[#2a2a2a] md:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="bg-[#0f0f0f] p-6">
            <p className="text-4xl font-black text-[#c8ff00]">{metric.value}</p>
            <p className="mt-2 text-sm uppercase tracking-[0.16em] text-[#9daa90]">
              {metric.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-[#2a2a2a] bg-[#0b0b0b]">
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 md:grid-cols-[1fr_1.4fr] lg:px-8">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.24em] text-white">Velure</p>
          <p className="mt-3 max-w-sm text-sm leading-7 text-[#9daa90]">
            Create invoices, keep clients organized, and stop chasing scattered records.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {navItems.slice(0, 6).map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="border border-[#242424] bg-[#111] px-3 py-3 text-xs uppercase tracking-[0.14em] text-[#c9d2bf] hover:border-[#c8ff00] hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </footer>
  );
}
