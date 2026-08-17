import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useReducedMotion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
	Bell,
	BellRing,
	Building2,
	ChartNoAxesCombined,
	Check,
	ChevronsUpDown,
	FileText,
	LayoutGrid,
	Loader2,
	Repeat2,
	Scale,
	Settings,
	Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { RouteTransition } from "#/components/navigation/RouteTransition";
import { TextSizeToggle } from "#/components/text-size/text-size-toggle";
import { ThemeToggle } from "#/components/theme/theme-toggle";
import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { toast } from "#/components/ui/use-toast";
import { authClient } from "#/lib/auth-client";
import { useDashboardAuth, useWorkspaceActions } from "#/lib/auth-hook";

const matchesPathSegment = (pathname: string, path: string) =>
	pathname === path || pathname.startsWith(`${path}/`);

const pendingBusinessNameKey = "velure.pending-business-name";

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

export function DashboardLayout() {
	const location = useLocation();
	const navigate = useNavigate();
	const mainRef = useRef<HTMLElement | null>(null);
	const workspaceEnsureAttemptedRef = useRef(false);
	const shouldReduceMotion = useReducedMotion();
	const [ensuringWorkspace, setEnsuringWorkspace] = useState(false);

	// Use unified auth hook
	const {
		data: session,
		isPending,
		isConvexAuthenticated,
		workspaces,
		workspaceContext,
	} = useDashboardAuth();

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
		if (
			isPending ||
			!isConvexAuthenticated ||
			!hasSession ||
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
	]);

	const waitingForInitialSession = isPending && !hasSession;
	const needsWorkspaceBootstrap =
		!waitingForInitialSession &&
		isConvexAuthenticated &&
		hasSession &&
		workspaceContext === null &&
		!workspaceEnsureAttemptedRef.current;
	const waitingForConvexAuth =
		!waitingForInitialSession && hasSession && !isConvexAuthenticated;

	if (
		waitingForInitialSession ||
		isPending ||
		waitingForConvexAuth ||
		ensuringWorkspace ||
		needsWorkspaceBootstrap
	) {
		return (
			<div className="hm-app flex h-dvh w-full items-center justify-center bg-paper">
				<Loader2 className="h-8 w-8 animate-spin text-brand" />
			</div>
		);
	}

	if (!session?.user) {
		return null;
	}

	const userInitial = session.user.name?.charAt(0)?.toUpperCase() ?? "U";
	const activeWorkspace = workspaces.find((workspace) => workspace.isActive);
	const workspaceLabel =
		workspaceContext?.name ?? activeWorkspace?.name ?? "Select workspace";
	const canSwitchWorkspace = workspaces.length > 1;
	const invoicesActive = invoiceTypeItems.some((item) =>
		item.match(location.pathname),
	);
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

	return (
		<div className="hm-app vl-ledger-bg flex h-dvh min-h-0 overflow-hidden text-ink">
			<aside className="ui-stagger-1 hidden h-full min-h-0 w-[260px] shrink-0 rounded-[var(--hm-r-card)] border border-r-0 border-l-0 border-rule bg-paper/96 shadow-[inset_-1px_0_0_rgba(242,239,231,0.02)] lg:flex lg:flex-col">
				<div className="border-b border-rule px-5 py-5">
					<Link to="/invoices" className="flex items-center gap-3">
						<span className="flex h-8 w-8 items-center justify-center border border-brand/45 bg-brand-soft text-xs font-bold text-brand">
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
								className="mt-4 flex h-10 w-full items-center justify-between gap-2 rounded-[var(--hm-r-card)] border border-rule bg-paper px-3 text-left text-sm text-ink transition-colors hover:border-brand-line hover:bg-brand-soft"
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
					<nav className="space-y-4">
						<div className="space-y-0.5">
							<Link
								to="/invoices"
								className={`flex w-full items-center gap-3 rounded-[var(--hm-r-card)] border px-3 py-2 text-left transition-[background-color,border-color,color] duration-200 ${
									invoicesActive
										? "border-brand bg-brand-soft shadow-[inset_3px_0_0_var(--color-brand)]"
										: "border-transparent text-ink-3 hover:border-rule hover:bg-paper-3"
								}`}
							>
								<LayoutGrid
									className={`h-4 w-4 shrink-0 ${
										invoicesActive ? "text-brand" : "text-ink-3"
									}`}
								/>
								<div className="min-w-0 flex-1">
									<p
										className={`text-sm font-medium ${
											invoicesActive ? "text-ink" : "text-ink-2"
										}`}
									>
										Invoices
									</p>
								</div>
							</Link>

							{navItems.map((item) => {
								const Icon = item.icon;
								const active = item.match(location.pathname);

								return (
									<Link
										key={item.to}
										to={item.to}
										className={`flex items-center gap-3 rounded-[var(--hm-r-card)] border px-3 py-2 transition-[background-color,border-color,color] duration-200 ${
											active
												? "border-brand bg-brand-soft shadow-[inset_3px_0_0_var(--color-brand)]"
												: "border-transparent text-ink-3 hover:border-rule hover:bg-paper-3"
										}`}
									>
										<Icon
											className={`h-4 w-4 shrink-0 ${
												active ? "text-brand" : "text-ink-3"
											}`}
										/>
										<div className="min-w-0">
											<p
												className={`text-sm font-medium ${
													active ? "text-ink" : "text-ink-2"
												}`}
											>
												{item.label}
											</p>
										</div>
									</Link>
								);
							})}
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
												className="flex cursor-not-allowed items-center gap-3 rounded-[var(--hm-r-card)] border border-transparent px-3 py-2 text-ink-3 opacity-70"
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
											className={`flex items-center gap-3 rounded-[var(--hm-r-card)] border px-3 py-2 transition-[background-color,border-color,color] duration-200 ${
												active
													? "border-brand bg-brand-soft shadow-[inset_3px_0_0_var(--color-brand)]"
													: "border-transparent text-ink-3 hover:border-rule hover:bg-paper-2"
											}`}
										>
											<Icon
												className={`h-4 w-4 shrink-0 ${
													active ? "text-brand" : "text-ink-3"
												}`}
											/>
											<div className="min-w-0">
												<p
													className={`text-sm font-medium ${
														active ? "text-ink" : "text-ink-2"
													}`}
												>
													{item.label}
												</p>
											</div>
										</Link>
									);
								})}
							</div>
						</div>
					</nav>
				</div>
			</aside>

			<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
				<header className="shrink-0 rounded-[var(--hm-r-card)] border border-rule border-b-0 border-t-0 bg-paper/92 backdrop-blur-md">
					<div className="flex h-14 items-center justify-between gap-4 px-4 lg:px-8">
						<div className="min-w-0">
							<p className="truncate text-[10px] font-bold uppercase tracking-[0.22em] text-brand">
								Active workspace
							</p>
							<p className="mt-0.5 truncate text-sm font-semibold text-ink">
								{workspaceLabel}
							</p>
							<p className="truncate text-xs text-ink-3">
								{session.user.email}
							</p>
						</div>

						<div className="flex items-center gap-2">
							<TextSizeToggle className="h-9 w-9 rounded-[var(--hm-r-card)] border border-rule bg-paper-2 text-ink-3 hover:border-brand-line hover:bg-brand-soft hover:text-ink" />
							<ThemeToggle className="h-9 w-9 rounded-[var(--hm-r-card)] border border-rule bg-paper-2 text-ink-3 hover:border-brand-line hover:bg-brand-soft hover:text-ink" />
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="h-9 w-9 rounded-[var(--hm-r-card)] border border-rule bg-paper-2 text-ink-3 hover:border-brand-line hover:bg-brand-soft hover:text-ink"
							>
								<Bell className="h-4 w-4" />
							</Button>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<button
										type="button"
										title="Open user menu"
										className="flex h-9 w-9 items-center justify-center rounded-[var(--hm-r-card)] border border-brand/45 bg-paper-2 text-sm font-medium text-ink hover:bg-brand-soft"
									>
										<Avatar className="h-9 w-9">
											<AvatarImage
												src={session.user.image ?? undefined}
												alt={session.user.name ?? "User"}
											/>
											<AvatarFallback className="bg-transparent text-sm font-bold text-ink">
												{userInitial}
											</AvatarFallback>
										</Avatar>
									</button>
								</DropdownMenuTrigger>
								<DropdownMenuContent
									align="end"
									className="min-w-[220px] border-rule bg-paper-2 p-1 text-ink"
								>
									<div className="px-2 py-2 text-sm">
										<p className="truncate font-medium text-ink">
											{session.user.name ?? "User"}
										</p>
										<p className="truncate text-xs text-ink-3">
											{session.user.email}
										</p>
									</div>
									<DropdownMenuSeparator className="bg-rule" />
									<DropdownMenuItem asChild className="focus:bg-brand-soft">
										<Link to="/invoices">Invoices</Link>
									</DropdownMenuItem>
									<DropdownMenuItem asChild className="focus:bg-brand-soft">
										<Link to="/clients">Clients</Link>
									</DropdownMenuItem>
									<DropdownMenuItem asChild className="focus:bg-brand-soft">
										<Link to="/settings/compliance">Compliance</Link>
									</DropdownMenuItem>
									<DropdownMenuItem asChild className="focus:bg-brand-soft">
										<Link to="/settings/collections">Payment reminders</Link>
									</DropdownMenuItem>
									<DropdownMenuSeparator className="bg-rule" />
									<DropdownMenuItem
										className="text-danger focus:bg-danger-soft focus:text-danger"
										onClick={async () => {
											await authClient.signOut();
											await navigate({ to: "/auth" });
										}}
									>
										Log out
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</div>

					<div className="flex gap-2 overflow-x-auto border-t border-rule px-4 py-3 lg:hidden">
						<Link
							to="/invoices"
							className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm whitespace-nowrap transition-[background-color,border-color,color] duration-200 ${
								location.pathname === "/invoices"
									? "border-brand bg-brand-soft text-ink"
									: "border-rule bg-paper-2 text-ink-3"
							}`}
						>
							<LayoutGrid className="h-4 w-4" />
							Invoices
						</Link>
						{navItems.map((item) => {
							const Icon = item.icon;
							const active = item.match(location.pathname);

							return (
								<Link
									key={item.to}
									to={item.to}
									className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm whitespace-nowrap transition-[background-color,border-color,color] duration-200 ${
										active
											? "border-brand bg-brand-soft text-ink"
											: "border-rule bg-paper-2 text-ink-3"
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
					className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-10 lg:px-8 lg:py-6 lg:pb-12"
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
