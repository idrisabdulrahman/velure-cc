import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
	BellRing,
	Building2,
	ChartNoAxesCombined,
	Check,
	ChevronsUpDown,
	FileText,
	LayoutGrid,
	Menu,
	Repeat2,
	Scale,
	Search,
	Settings,
	Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProfileDropdown } from "#/components/dashboard/profile-dropdown";
import { CommandPalette } from "#/components/global-search/command-palette";
import { RouteTransition } from "#/components/navigation/RouteTransition";
import { TextSizeToggle } from "#/components/text-size/text-size-toggle";
import { ThemeToggle } from "#/components/theme/theme-toggle";
import { AppLoader } from "#/components/ui/app-loader";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { toast } from "#/components/ui/use-toast";
import { authClient } from "#/lib/auth-client";
import { useDashboardAuth, useWorkspaceActions } from "#/lib/auth-hook";
import { useSupabaseSession } from "#/lib/supabase-session";
import { listClients } from "#/server/data/clients";
import {
	type InvoiceListArgs,
	listSummary as listInvoiceSummary,
} from "#/server/data/invoices";
import { listProducts } from "#/server/data/products";
import { getCollectionOverview } from "#/server/data/reminders";

const matchesPathSegment = (pathname: string, path: string) =>
	pathname === path || pathname.startsWith(`${path}/`);

const pendingBusinessNameKey = "velure.pending-business-name";

// Same default filter shapes the pages use, so the layout's count queries
// share the pages' React Query cache instead of fetching twice.
const defaultInvoiceArgs: InvoiceListArgs = {
	q: "",
	status: "all",
	type: "all",
	documentType: "all",
	customer: undefined,
	dueDateFrom: undefined,
	dueDateTo: undefined,
};

type InvoiceTypeItem = {
	to: "/invoices";
	icon: LucideIcon;
	match: (pathname: string) => boolean;
	label: string;
	description: string;
};

const invoiceTypeItems: InvoiceTypeItem[] = [
	{
		to: "/invoices",
		icon: FileText,
		match: (pathname: string) =>
			matchesPathSegment(pathname, "/invoices") &&
			!matchesPathSegment(pathname, "/invoices/products"),
		label: "Invoices",
		description: "Standard and pro-forma documents",
	},
];

const navItems = [
	{
		to: "/clients",
		icon: Users,
		match: (pathname: string) => matchesPathSegment(pathname, "/clients"),
		label: "Clients",
		description: "Manage contacts and billing terms",
	},
	{
		to: "/reports",
		icon: ChartNoAxesCombined,
		match: (pathname: string) => matchesPathSegment(pathname, "/reports"),
		label: "Reports",
		description: "Revenue and cash-flow clarity",
	},
	{
		to: "/invoices/products",
		icon: FileText,
		match: (pathname: string) =>
			matchesPathSegment(pathname, "/invoices/products"),
		label: "Products",
		description: "Review invoice line-item totals",
	},
];

const settingsItems = [
	{
		to: "/settings/compliance",
		icon: Scale,
		match: (pathname: string) =>
			matchesPathSegment(pathname, "/settings/compliance"),
		label: "Compliance",
		description: "Business identity, tax rules, and exports",
	},
	{
		to: "/settings/collections",
		icon: BellRing,
		match: (pathname: string) =>
			matchesPathSegment(pathname, "/settings/collections"),
		label: "Payment reminders",
		description: "Customer reminder emails and manual review",
	},
	{
		to: "/settings/recurring",
		icon: Repeat2,
		match: (pathname: string) =>
			matchesPathSegment(pathname, "/settings/recurring"),
		label: "Recurring billing",
		description: "Scheduled invoice generation",
	},
	{
		to: "/settings",
		icon: Settings,
		match: (pathname: string) => pathname === "/settings",
		label: "General",
		description: "Business profile and account plan",
	},
] as const;

function CountBadge({ count }: { count: number | undefined }) {
	if (count === undefined) return null;
	return (
		<span className="ml-auto shrink-0 font-num text-[11px] tabular-nums text-ink-3">
			{count}
		</span>
	);
}

function ReminderBadge({ count }: { count: number | undefined }) {
	if (count === undefined) return null;
	if (count === 0) {
		return (
			<span className="ml-auto shrink-0 font-num text-[11px] tabular-nums text-ink-3">
				0
			</span>
		);
	}
	return (
		<span className="ml-auto shrink-0 rounded-full bg-warn-soft px-2 py-0.5 font-num text-[11px] tabular-nums text-warn">
			{count}
		</span>
	);
}

export function DashboardLayout() {
	const location = useLocation();
	const navigate = useNavigate();
	const mainRef = useRef<HTMLElement | null>(null);
	const workspaceEnsureAttemptedRef = useRef(false);
	const shouldReduceMotion = useReducedMotion();
	const [ensuringWorkspace, setEnsuringWorkspace] = useState(false);
	const [navOpen, setNavOpen] = useState(false);
	const [paletteOpen, setPaletteOpen] = useState(false);

	// Use unified auth hook
	const {
		data: session,
		isPending,
		isConvexAuthenticated,
		workspaces,
		workspaceContext,
		workspaceQueriesPending,
		canUseSupabase,
	} = useDashboardAuth();

	const sessionUserId = session?.user?.id;
	const { client: supabaseClient } = useSupabaseSession(sessionUserId);
	const canCount = Boolean(supabaseClient && sessionUserId);

	const { data: invoiceCount } = useQuery({
		queryKey: [
			"supabase-invoices",
			"summary",
			sessionUserId,
			defaultInvoiceArgs,
		],
		queryFn: () => {
			if (!supabaseClient || !sessionUserId)
				throw new Error("Supabase session unavailable.");
			return listInvoiceSummary(
				supabaseClient,
				sessionUserId,
				defaultInvoiceArgs,
			);
		},
		// Same cache entry the invoices page reads; derive the count so the
		// stored shape never changes.
		select: (summary) =>
			summary.currencySummaries.reduce(
				(total, item) => total + item.totalCount,
				0,
			),
		enabled: canCount,
		staleTime: 60_000,
	});

	const { data: clientCount } = useQuery({
		queryKey: ["supabase-clients", sessionUserId ?? "none", ""],
		queryFn: () => {
			if (!supabaseClient || !sessionUserId)
				throw new Error("Supabase session unavailable.");
			return listClients(supabaseClient, sessionUserId, {
				q: "",
				status: "all",
			});
		},
		select: (rows) => rows.length,
		enabled: canCount,
		staleTime: 60_000,
	});

	const { data: productCount } = useQuery({
		queryKey: ["products", sessionUserId, "", "all", "all"],
		queryFn: () => {
			if (!supabaseClient || !sessionUserId)
				throw new Error("Supabase session unavailable.");
			return listProducts(supabaseClient, sessionUserId, {
				q: "",
				type: "all",
				status: "all",
			});
		},
		select: (rows) => rows.length,
		enabled: canCount,
		staleTime: 60_000,
	});

	const { data: reminderCount } = useQuery({
		queryKey: ["supabase-collection-overview", sessionUserId ?? "none", 3],
		queryFn: () => {
			if (!supabaseClient || !sessionUserId)
				throw new Error("Supabase session unavailable.");
			return getCollectionOverview(supabaseClient, sessionUserId, {
				daysBeforeDue: 3,
			});
		},
		select: (overview) => overview.stats.actionableCount,
		enabled: canCount,
		staleTime: 60_000,
	});

	const counts = useMemo(
		() => ({
			"/invoices": invoiceCount,
			"/clients": clientCount,
			"/invoices/products": productCount,
			"/settings/collections": reminderCount,
		}),
		[clientCount, invoiceCount, productCount, reminderCount],
	);

	const hasSession = Boolean(session?.user);
	const { setActive: setActiveWorkspace, ensure: ensureWorkspaceContext } =
		useWorkspaceActions();

	useEffect(() => {
		if (location.hash) return;

		mainRef.current?.scrollTo({
			top: 0,
			behavior: shouldReduceMotion ? "auto" : "smooth",
		});
	}, [location.pathname, location.search, location.hash, shouldReduceMotion]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setPaletteOpen(true);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	useEffect(() => {
		if (
			isPending ||
			!isConvexAuthenticated ||
			!hasSession ||
			workspaceQueriesPending ||
			workspaceContext !== null ||
			workspaceEnsureAttemptedRef.current
		) {
			return;
		}

		workspaceEnsureAttemptedRef.current = true;
		setEnsuringWorkspace(true);
		const pendingBusinessName =
			typeof window !== "undefined"
				? window.sessionStorage.getItem(pendingBusinessNameKey)?.trim()
				: undefined;
		ensureWorkspaceContext({
			businessName: pendingBusinessName || undefined,
		})
			.then(() => {
				if (typeof window !== "undefined") {
					window.sessionStorage.removeItem(pendingBusinessNameKey);
				}
			})
			.catch((error) => {
				toast({
					title: "Could not prepare workspace",
					description: error instanceof Error ? error.message : "Unknown error",
					variant: "error",
				});
			})
			.finally(() => setEnsuringWorkspace(false));
	}, [
		hasSession,
		ensureWorkspaceContext,
		isConvexAuthenticated,
		isPending,
		workspaceContext,
		workspaceQueriesPending,
	]);

	const waitingForInitialSession = isPending && !hasSession;
	// Genuine first-time bootstrap only: reads settled through a live bridge
	// and there is no workspace at all. A null context on its own also covers
	// transient/refetch states for returning users, which must never wear the
	// provisioning label.
	const needsWorkspaceBootstrap =
		!waitingForInitialSession &&
		isConvexAuthenticated &&
		hasSession &&
		canUseSupabase &&
		!workspaceQueriesPending &&
		workspaceContext === null &&
		workspaces.length === 0 &&
		!workspaceEnsureAttemptedRef.current;
	const waitingForSupabaseSession =
		!waitingForInitialSession && hasSession && !isConvexAuthenticated;

	if (
		waitingForInitialSession ||
		isPending ||
		waitingForSupabaseSession ||
		workspaceQueriesPending ||
		ensuringWorkspace ||
		needsWorkspaceBootstrap
	) {
		// The provisioning claim is reserved for actual first-time workspace
		// creation; every other wait is a bare spinner.
		const isProvisioning = ensuringWorkspace || needsWorkspaceBootstrap;
		return (
			<div className="hm-app flex h-dvh w-full items-center justify-center bg-paper">
				<AppLoader
					label={isProvisioning ? "Setting up your workspace" : null}
				/>
			</div>
		);
	}

	if (!session?.user) {
		return null;
	}

	const activeWorkspace = workspaces.find((workspace) => workspace.isActive);
	const workspaceLabel =
		workspaceContext?.name ?? activeWorkspace?.name ?? "Select workspace";
	const canSwitchWorkspace = workspaces.length > 1;
	const invoicesActive = invoiceTypeItems.some((item) =>
		item.match(location.pathname),
	);
	const activePageLabel =
		invoiceTypeItems.find((item) => item.match(location.pathname))?.label ??
		[...navItems, ...settingsItems].find((item) =>
			item.match(location.pathname),
		)?.label ??
		"Workspace";
	const ownerInitial = (session.user.name ?? session.user.email ?? "?")
		.slice(0, 1)
		.toUpperCase();
	const switchWorkspace = async (workspaceId: string) => {
		if (activeWorkspace?.id === workspaceId) return;

		try {
			await setActiveWorkspace({ workspaceId });
			toast({ title: "Workspace switched", variant: "success" });
		} catch (error) {
			toast({
				title: "Could not switch workspace",
				description: error instanceof Error ? error.message : "Unknown error",
				variant: "error",
			});
		}
	};

	const navLinkClass = (active: boolean) =>
		`relative flex w-full items-center gap-3 rounded-[var(--hm-r-input)] px-3 py-2 text-left transition-[background-color,color] duration-200 ${
			active
				? "bg-[linear-gradient(90deg,var(--hm-accent-soft),transparent_95%)] before:absolute before:bottom-2 before:left-0 before:top-2 before:w-0.5 before:rounded-full before:bg-brand"
				: "border border-transparent text-ink-3 hover:border-rule hover:bg-paper-3"
		}`;

	return (
		<div className="hm-app flex h-dvh min-h-0 overflow-hidden text-ink">
			{navOpen ? (
				<button
					type="button"
					aria-label="Close navigation"
					onClick={() => setNavOpen(false)}
					className="fixed inset-0 z-30 bg-[var(--hm-scrim)] lg:hidden"
				/>
			) : null}
			<aside
				className={`fixed inset-y-0 left-0 z-40 flex h-full min-h-0 w-[240px] shrink-0 flex-col border-r border-rule bg-paper transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0 ${
					navOpen ? "translate-x-0" : "-translate-x-full"
				}`}
			>
				<div className="border-b border-rule px-5 py-5">
					<Link
						to="/invoices"
						onClick={() => setNavOpen(false)}
						className="flex items-center gap-3"
					>
						<span className="flex h-8 w-8 items-center justify-center rounded-[var(--hm-r-input)] border border-brand/45 bg-brand-soft text-xs font-bold text-brand">
							V
						</span>
						<div>
							<p className="text-[11px] font-bold uppercase tracking-[0.24em] text-ink">
								Velure
							</p>
							<p className="text-xs text-ink-3">Operations workspace</p>
						</div>
					</Link>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								className="mt-4 flex h-10 w-full items-center justify-between gap-2 rounded-[var(--hm-r-btn)] border border-rule bg-paper px-3 text-left text-sm text-ink transition-colors hover:border-brand-line hover:bg-brand-soft"
							>
								<span className="flex min-w-0 items-center gap-2">
									<Building2 className="h-4 w-4 shrink-0 text-brand" />
									<span className="truncate">{workspaceLabel}</span>
								</span>
								<ChevronsUpDown className="h-4 w-4 shrink-0 text-ink-3" />
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="start"
							className="min-w-[240px] border-rule bg-paper-2 p-1 text-ink"
						>
							<div className="px-2 py-2 text-xs font-medium uppercase tracking-[0.08em] text-ink-3">
								Workspace
							</div>
							{workspaces.length === 0 ? (
								<DropdownMenuItem disabled className="text-ink-3">
									No workspace available
								</DropdownMenuItem>
							) : (
								workspaces.map((workspace) => (
									<DropdownMenuItem
										key={workspace.id}
										disabled={!canSwitchWorkspace && workspace.isActive}
										className="gap-2 focus:bg-brand-soft"
										onClick={() => {
											void switchWorkspace(workspace.id);
										}}
									>
										<Check
											className={`h-4 w-4 ${
												workspace.isActive ? "opacity-100" : "opacity-0"
											}`}
										/>
										<span className="min-w-0 flex-1 truncate">
											{workspace.name}
										</span>
										<span className="text-xs text-ink-3">{workspace.role}</span>
									</DropdownMenuItem>
								))
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
					<nav className="space-y-4" aria-label="Primary">
						<div>
							<p className="px-3 pb-1 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
								Workspace
							</p>
							<div className="space-y-0.5">
								<Link
									to="/invoices"
									onClick={() => setNavOpen(false)}
									className={navLinkClass(invoicesActive)}
								>
									<LayoutGrid
										className={`h-4 w-4 shrink-0 ${
											invoicesActive ? "text-brand" : "text-ink-3"
										}`}
									/>
									<span
										className={`min-w-0 flex-1 truncate text-sm font-medium ${
											invoicesActive ? "text-ink" : "text-ink-2"
										}`}
									>
										Invoices
									</span>
									<CountBadge count={counts["/invoices"]} />
								</Link>

								{navItems.map((item) => {
									const Icon = item.icon;
									const active = item.match(location.pathname);

									return (
										<Link
											key={item.to}
											to={item.to}
											onClick={() => setNavOpen(false)}
											className={navLinkClass(active)}
										>
											<Icon
												className={`h-4 w-4 shrink-0 ${
													active ? "text-brand" : "text-ink-3"
												}`}
											/>
											<span
												className={`min-w-0 flex-1 truncate text-sm font-medium ${
													active ? "text-ink" : "text-ink-2"
												}`}
											>
												{item.label}
											</span>
											{item.to === "/clients" ? (
												<CountBadge count={counts["/clients"]} />
											) : item.to === "/invoices/products" ? (
												<CountBadge count={counts["/invoices/products"]} />
											) : null}
										</Link>
									);
								})}
							</div>
						</div>

						<div className="border-t border-rule pt-3">
							<p className="px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
								Settings
							</p>
							<div className="mt-1 space-y-0.5">
								{settingsItems.map((item) => {
									const Icon = item.icon;
									const active = item.match(location.pathname);
									const disabled = "disabled" in item && item.disabled;

									if (disabled) {
										return (
											<div
												key={item.to}
												aria-disabled="true"
												className="flex cursor-not-allowed items-center gap-3 rounded-[var(--hm-r-btn)] border border-transparent px-3 py-2 text-ink-3 opacity-70"
												title="Coming soon"
											>
												<Icon className="h-4 w-4 shrink-0 text-ink-3" />
												<div className="min-w-0 flex-1">
													<div className="flex items-center gap-2">
														<p className="text-sm font-medium text-ink-3">
															{item.label}
														</p>
														<span className="rounded-sm border border-brand-line bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-brand">
															Soon
														</span>
													</div>
												</div>
											</div>
										);
									}

									return (
										<Link
											key={item.to}
											to={item.to}
											title={item.description}
											onClick={() => setNavOpen(false)}
											className={navLinkClass(active)}
										>
											<Icon
												className={`h-4 w-4 shrink-0 ${
													active ? "text-brand" : "text-ink-3"
												}`}
											/>
											<span
												className={`min-w-0 flex-1 truncate text-sm font-medium ${
													active ? "text-ink" : "text-ink-2"
												}`}
											>
												{item.label}
											</span>
											{item.to === "/settings/collections" ? (
												<ReminderBadge
													count={counts["/settings/collections"]}
												/>
											) : null}
										</Link>
									);
								})}
							</div>
						</div>
					</nav>
				</div>

				<div className="flex items-center gap-3 border-t border-rule px-5 py-3">
					<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-brand-line bg-brand-soft text-[11px] font-semibold text-brand">
						{ownerInitial}
					</span>
					<div className="min-w-0">
						<p className="truncate text-[13px] font-medium text-ink">
							{session.user.name ?? "Owner"}
						</p>
						<p className="truncate text-xs text-ink-3">{workspaceLabel}</p>
					</div>
				</div>
			</aside>

			<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				<header className="shrink-0 border-b border-rule bg-paper/92 backdrop-blur-md">
					<div className="flex h-14 items-center justify-between gap-4 px-4 lg:px-7">
						<div className="flex min-w-0 items-center gap-3">
							<button
								type="button"
								aria-label="Open navigation"
								onClick={() => setNavOpen(true)}
								className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--hm-r-btn)] border border-rule bg-paper-2 text-ink-3 transition-colors hover:border-brand-line hover:bg-brand-soft hover:text-ink lg:hidden"
							>
								<Menu className="h-4 w-4" />
							</button>
							<p className="truncate text-[13px] text-ink-3">
								<span className="truncate">{workspaceLabel}</span>
								<span className="mx-2">/</span>
								<span className="font-medium text-ink">{activePageLabel}</span>
							</p>
						</div>

						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => setPaletteOpen(true)}
								className="hidden h-[34px] w-[260px] items-center gap-2.5 rounded-[var(--hm-r-input)] border border-rule bg-paper px-3 pl-3 text-left text-[13px] text-ink-3 transition-colors hover:border-brand-line hover:text-ink-2 md:flex"
							>
								<Search className="h-4 w-4 shrink-0" />
								<span className="flex-1 truncate">Search or jump to…</span>
								<kbd className="rounded-md border border-rule bg-paper-2 px-1.5 py-0.5 font-num text-[11px]">
									⌘K
								</kbd>
							</button>
							<TextSizeToggle className="h-9 w-9 rounded-[var(--hm-r-btn)] border border-rule bg-paper-2 text-ink-3 hover:border-brand-line hover:bg-brand-soft hover:text-ink" />
							<ThemeToggle className="h-9 w-9 rounded-[var(--hm-r-btn)] border border-rule bg-paper-2 text-ink-3 hover:border-brand-line hover:bg-brand-soft hover:text-ink" />
							<ProfileDropdown
								name={session.user.name}
								email={session.user.email}
								image={session.user.image}
								onSignOut={async () => {
									await authClient.signOut();
									await navigate({ to: "/auth" });
								}}
							/>
						</div>
					</div>
				</header>

				<main
					ref={mainRef}
					className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-10 lg:px-7 lg:py-7 lg:pb-12"
				>
					<div className="mx-auto w-full max-w-[1180px]">
						<RouteTransition routeKey={location.pathname}>
							<Outlet />
						</RouteTransition>
					</div>
				</main>
			</div>
			<CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
		</div>
	);
}
