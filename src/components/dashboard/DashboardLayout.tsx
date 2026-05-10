import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { useConvexAuth } from "convex/react";
import { useReducedMotion } from "framer-motion";
import {
  Bell,
  BellRing,
  FileText,
  LayoutGrid,
  Loader2,
  Plug,
  Scale,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { RouteTransition } from "#/components/navigation/RouteTransition";
import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar";
import { Button } from "#/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { authClient } from "#/lib/auth-client";

const navItems = [
  {
    to: "/invoices",
    icon: LayoutGrid,
    match: (pathname: string) => pathname.startsWith("/invoices"),
    label: "Invoices",
    description: "List, filter, and edit documents",
  },
  {
    to: "/clients",
    icon: Users,
    match: (pathname: string) => pathname.startsWith("/clients"),
    label: "Clients",
    description: "Manage contacts and billing terms",
  },
  {
    to: "/invoices/products",
    icon: FileText,
    match: (pathname: string) => pathname.startsWith("/invoices/products"),
    label: "Products",
    description: "Review invoice line-item totals",
  },
];

const settingsItems = [
  {
    to: "/settings",
    icon: Settings,
    match: (pathname: string) => pathname === "/settings",
    label: "General",
    description: "Business profile and account plan",
  },
  {
    to: "/settings/compliance",
    icon: Scale,
    match: (pathname: string) => pathname.startsWith("/settings/compliance"),
    label: "Compliance",
    description: "Business identity, tax rules, and exports",
  },
  {
    to: "/settings/collections",
    icon: BellRing,
    match: (pathname: string) => pathname.startsWith("/settings/collections"),
    label: "Collections",
    description: "Email reminders and manual follow-up",
  },
  {
    to: "/settings/integrations",
    icon: Plug,
    match: (pathname: string) => pathname.startsWith("/settings/integrations"),
    label: "Integrations",
    description: "Payment and accounting apps",
    disabled: true,
  },
  {
    to: "/settings/security",
    icon: ShieldCheck,
    match: (pathname: string) => pathname.startsWith("/settings/security"),
    label: "Security",
    description: "Authentication, sessions, and account safety",
  },
] as const;

export function DashboardLayout() {
  const location = useLocation();
  const mainRef = useRef<HTMLElement | null>(null);
  const shouldReduceMotion = useReducedMotion();
  const { data: session, isPending } = authClient.useSession();
  const { isLoading: isConvexAuthLoading, isAuthenticated: isConvexAuthenticated } =
    useConvexAuth();

  useEffect(() => {
    if (location.hash) return;

    mainRef.current?.scrollTo({
      top: 0,
      behavior: shouldReduceMotion ? "auto" : "smooth",
    });
  }, [location.pathname, location.search, location.hash, shouldReduceMotion]);

  if (isPending || isConvexAuthLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#121314]">
        <Loader2 className="h-8 w-8 animate-spin text-[#a7bc62]" />
      </div>
    );
  }

  if (!session?.user || !isConvexAuthenticated) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#121314] px-6">
        <div className="w-full max-w-md rounded-md border border-[#2b2d30] bg-[#181a1d] p-6 text-center">
          <h1 className="text-2xl font-semibold text-[#ece7de]">Authentication required</h1>
          <p className="mt-2 text-sm text-[#a29b90]">
            Sign in with email and password to access your invoices.
          </p>
          <Button
            asChild
            className="mt-5 h-10 rounded-md bg-[#a7bc62] px-4 text-sm font-medium text-[#121314] hover:bg-[#b5c97a]"
          >
            <Link to="/auth">Go to sign in</Link>
          </Button>
        </div>
      </div>
    );
  }

  const userInitial = session.user.name?.charAt(0)?.toUpperCase() ?? "U";

  return (
    <div className="flex h-screen overflow-hidden bg-[#121314] text-[#ece7de]">
      <aside className="ui-stagger-1 hidden h-screen w-[260px] shrink-0 border-r border-[#2b2d30] bg-[#17191b] lg:flex lg:flex-col">
        <div className="border-b border-[#2b2d30] px-5 py-5">
          <Link to="/invoices" className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-sm border border-[#3a3d41] bg-[#202327] text-sm font-semibold text-[#ece7de]">
              V
            </span>
            <div>
              <p className="text-sm font-semibold text-[#ece7de]">Velure</p>
              <p className="text-xs text-[#9d978d]">Operations workspace</p>
            </div>
          </Link>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <nav className="space-y-6">
            <div className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = item.match(location.pathname);

                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`flex items-start gap-3 rounded-md border px-3 py-3 transition-[background-color,border-color,color] duration-200 ${
                      active
                        ? "border-[#41463b] bg-[#20241e]"
                        : "border-transparent text-[#b7b1a7] hover:border-[#2b2d30] hover:bg-[#1b1e20]"
                    }`}
                  >
                    <Icon
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        active ? "text-[#a7bc62]" : "text-[#8a857d]"
                      }`}
                    />
                    <div className="min-w-0">
                      <p
                        className={`text-sm font-medium ${
                          active ? "text-[#ece7de]" : "text-[#d5d0c7]"
                        }`}
                      >
                        {item.label}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[#8a857d]">{item.description}</p>
                    </div>
                  </Link>
                );
              })}
            </div>

            <div className="border-t border-[#2b2d30] pt-4">
              <p className="px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-[#7f7a72]">
                Settings
              </p>
              <div className="mt-2 space-y-1">
                {settingsItems.map((item) => {
                  const Icon = item.icon;
                  const active = item.match(location.pathname);
                  const disabled = "disabled" in item && item.disabled;

                  if (disabled) {
                    return (
                      <div
                        key={item.to}
                        aria-disabled="true"
                        className="flex cursor-not-allowed items-start gap-3 rounded-md border border-transparent px-3 py-3 text-[#77726b] opacity-70"
                        title="Coming soon"
                      >
                        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#6f7860]" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-[#a9a39a]">{item.label}</p>
                            <span className="rounded-sm border border-[#3a3d30] bg-[#20241e] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-[#a7bc62]">
                              Soon
                            </span>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-[#77726b]">
                            {item.description}
                          </p>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={`flex items-start gap-3 rounded-md border px-3 py-3 transition-[background-color,border-color,color] duration-200 ${
                        active
                          ? "border-[#41463b] bg-[#20241e]"
                          : "border-transparent text-[#b7b1a7] hover:border-[#2b2d30] hover:bg-[#1b1e20]"
                      }`}
                    >
                      <Icon
                        className={`mt-0.5 h-4 w-4 shrink-0 ${
                          active ? "text-[#a7bc62]" : "text-[#8a857d]"
                        }`}
                      />
                      <div className="min-w-0">
                        <p
                          className={`text-sm font-medium ${
                            active ? "text-[#ece7de]" : "text-[#d5d0c7]"
                          }`}
                        >
                          {item.label}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-[#8a857d]">{item.description}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </nav>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="shrink-0 border-b border-[#2b2d30] bg-[#121314]/95 backdrop-blur-sm">
          <div className="flex h-14 items-center justify-between gap-4 px-4 lg:px-8">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[#ece7de]">
                {session.user.name ?? "Workspace"}
              </p>
              <p className="truncate text-xs text-[#8a857d]">{session.user.email}</p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-md border border-[#2b2d30] bg-[#17191b] text-[#b7b1a7] hover:bg-[#1d2023] hover:text-[#ece7de]"
              >
                <Bell className="h-4 w-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title="Open user menu"
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-[#2b2d30] bg-[#17191b] text-sm font-medium text-[#ece7de] hover:bg-[#1d2023]"
                  >
                    <Avatar className="h-9 w-9 rounded-md">
                      <AvatarImage
                        src={session.user.image ?? undefined}
                        alt={session.user.name ?? "User"}
                      />
                      <AvatarFallback className="rounded-md bg-transparent text-sm font-medium text-[#ece7de]">
                        {userInitial}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="min-w-[220px] border-[#2b2d30] bg-[#17191b] p-1 text-[#ece7de]"
                >
                  <div className="px-2 py-2 text-sm">
                    <p className="truncate font-medium text-[#ece7de]">
                      {session.user.name ?? "User"}
                    </p>
                    <p className="truncate text-xs text-[#8a857d]">{session.user.email}</p>
                  </div>
                  <DropdownMenuSeparator className="bg-[#2b2d30]" />
                  <DropdownMenuItem asChild className="focus:bg-[#20241e]">
                    <Link to="/invoices">Invoices</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="focus:bg-[#20241e]">
                    <Link to="/clients">Clients</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="focus:bg-[#20241e]">
                    <Link to="/settings/compliance">Compliance</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="focus:bg-[#20241e]">
                    <Link to="/settings/collections">Collections</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild className="focus:bg-[#20241e]">
                    <Link to="/settings/security">Security</Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-[#2b2d30]" />
                  <DropdownMenuItem
                    className="text-[#d48f8f] focus:bg-[#2a1f1f] focus:text-[#efb1b1]"
                    onClick={() => {
                      void authClient.signOut();
                    }}
                  >
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="flex gap-2 overflow-x-auto border-t border-[#2b2d30] px-4 py-3 lg:hidden">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = item.match(location.pathname);

              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm whitespace-nowrap transition-[background-color,border-color,color] duration-200 ${
                    active
                      ? "border-[#41463b] bg-[#20241e] text-[#ece7de]"
                      : "border-[#2b2d30] bg-[#17191b] text-[#b7b1a7]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </header>

        <main
          ref={mainRef}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-5 lg:px-8 lg:py-8"
        >
          <div className="mx-auto w-full max-w-7xl">
            <RouteTransition routeKey={location.pathname}>
              <Outlet />
            </RouteTransition>
          </div>
        </main>
      </div>
    </div>
  );
}
