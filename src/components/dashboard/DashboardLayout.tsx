import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import { Bell, FileText, LayoutGrid, Loader2, Settings, Users } from "lucide-react";
import { authClient } from "#/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar";
import { Button } from "#/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { RouteTransition } from "#/components/navigation/RouteTransition";

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

export function DashboardLayout() {
  const location = useLocation();
  const mainRef = useRef<HTMLElement | null>(null);
  const shouldReduceMotion = useReducedMotion();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (location.hash) return;

    mainRef.current?.scrollTo({
      top: 0,
      behavior: shouldReduceMotion ? "auto" : "smooth",
    });
  }, [location.pathname, location.search, location.hash, shouldReduceMotion]);

  if (isPending) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#121314]">
        <Loader2 className="h-8 w-8 animate-spin text-[#a7bc62]" />
      </div>
    );
  }

  if (!session?.user) {
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
    <div className="flex min-h-screen bg-[#121314] text-[#ece7de]">
      <aside className="ui-stagger-1 hidden w-[252px] shrink-0 border-r border-[#2b2d30] bg-[#17191b] lg:flex lg:flex-col">
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

        <nav className="flex-1 px-3 py-4">
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
        </nav>

        <div className="border-t border-[#2b2d30] p-3">
          <Link
            to="/settings/security"
            className="flex items-center gap-3 rounded-md px-3 py-3 text-sm text-[#b7b1a7] hover:bg-[#1b1e20]"
          >
            <Settings className="h-4 w-4 text-[#8a857d]" />
            Security
          </Link>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-[#2b2d30] bg-[#121314]/95 backdrop-blur-sm">
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

        <main ref={mainRef} className="min-w-0 overflow-y-auto px-4 py-5 lg:px-8 lg:py-8">
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
