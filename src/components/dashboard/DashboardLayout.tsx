import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
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
	ShieldCheck,
	Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { RouteTransition } from "#/components/navigation/RouteTransition";
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
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const matchesPathSegment = (pathname: string, path: string) =>
	pathname === path || pathname.startsWith(`${path}/`);

const pendingBusinessNameKey = "velure.pending-business-name";
const SESSION_PROBE_RETRY_DELAYS_MS = [350, 900, 1500] as const;

const wait = (delayMs: number) =>
	new Promise<void>((resolve) => {
		window.setTimeout(resolve, delayMs);
	});

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
		to: "/settings/security",
		icon: ShieldCheck,
		match: (pathname: string) =>
			matchesPathSegment(pathname, "/settings/security"),
		label: "Security",
		description: "Authentication, sessions, and account safety",
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
	const mainRef = useRef<HTMLElement | null>(null);
	const workspaceEnsureAttemptedRef = useRef(false);
	const shouldReduceMotion = useReducedMotion();
	const { data: session, isPending } = authClient.useSession();
	const [verifiedSession, setVerifiedSession] = useState<typeof session | null>(
		null,
	);
	const [sessionProbeComplete, setSessionProbeComplete] = useState(false);
	const {
		isLoading: isConvexAuthLoading,
		isAuthenticated: isConvexAuthenticated,
	} = useConvexAuth();
	const [ensuringWorkspace, setEnsuringWorkspace] = useState(false);
	const effectiveSession = session?.user ? session : verifiedSession;
	const hasSession = Boolean(effectiveSession?.user);
	const workspaces =
		useQuery(
			api.account.listWorkspaces,
			isConvexAuthenticated && hasSession ? {} : "skip",
		) ?? [];
	const workspaceContext = useQuery(
		api.account.getWorkspaceContext,
		isConvexAuthenticated && hasSession ? {} : "skip",
	);
	const setActiveWorkspace = useMutation(api.account.setActiveWorkspace);
	const ensureWorkspaceContext = useMutation(
		api.account.ensureWorkspaceContext,
	);

	useEffect(() => {
		if (location.hash) return;

		mainRef.current?.scrollTo({
			top: 0,
			behavior: shouldReduceMotion ? "auto" : "smooth",
		});
	}, [location.pathname, location.search, location.hash, shouldReduceMotion]);

	useEffect(() => {
		if (session?.user) {
			setVerifiedSession(session);
			setSessionProbeComplete(true);
			return;
		}
		if (!verifiedSession?.user) {
			setSessionProbeComplete(false);
		}
	}, [location.pathname, session, verifiedSession?.user]);

	useEffect(() => {
		if (isPending || session?.user || sessionProbeComplete) return;

		let cancelled = false;
		const probeSession = async () => {
			for (const [
				attemptIndex,
				delayMs,
			] of SESSION_PROBE_RETRY_DELAYS_MS.entries()) {
				if (attemptIndex > 0) {
					await wait(delayMs);
					if (cancelled) return;
				}

				const result = await authClient
					.getSession({ fetchOptions: { throw: false } })
					.catch(() => null);

				if (cancelled) return;
				const data =
					result && typeof result === "object" && "data" in result
						? result.data
						: null;
				const error =
					result && typeof result === "object" && "error" in result
						? result.error
						: null;

				if (data && typeof data === "object" && "user" in data) {
					setVerifiedSession(data as typeof session);
					(
						authClient as typeof authClient & { updateSession?: () => void }
					).updateSession?.();
					setSessionProbeComplete(true);
					return;
				}

				if (error) {
					continue;
				}

				setVerifiedSession((current) => (current?.user ? current : null));
				setSessionProbeComplete(true);
				return;
			}

			if (!cancelled) {
				setVerifiedSession((current) => (current?.user ? current : null));
				setSessionProbeComplete(true);
			}
		};

		void probeSession();

		return () => {
			cancelled = true;
		};
	}, [isPending, session?.user, sessionProbeComplete]);

	useEffect(() => {
		if (
			(isPending && !effectiveSession?.user) ||
			!isConvexAuthenticated ||
			!effectiveSession?.user ||
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
		effectiveSession?.user,
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
	const verifyingSession =
		!waitingForInitialSession &&
		!hasSession &&
		!session?.user &&
		!sessionProbeComplete;

	if (
		waitingForInitialSession ||
		verifyingSession ||
		isConvexAuthLoading ||
		waitingForConvexAuth ||
		ensuringWorkspace ||
		needsWorkspaceBootstrap
	) {
		return (
			<div className="flex h-screen w-full items-center justify-center bg-[#0f1111]">
				<Loader2 className="h-8 w-8 animate-spin text-[#c8ff62]" />
			</div>
		);
	}

	if (!effectiveSession?.user) {
		return (
			<div className="flex h-screen w-full items-center justify-center bg-[#0f1111] px-6">
				<div className="w-full max-w-md border border-[#30352f] bg-[#151817] p-6 text-center">
					<h1 className="text-2xl font-semibold text-[#f2efe7]">
						Authentication required
					</h1>
					<p className="mt-2 text-sm text-[#a7a095]">
						Sign in with email and password to access your workspace.
					</p>
					<Button
						asChild
						className="mt-5 h-10 rounded-none bg-[#c8ff62] px-4 text-sm font-medium text-[#0f1111] hover:bg-[#d7ff82]"
					>
						<Link to="/auth">Go to sign in</Link>
					</Button>
				</div>
			</div>
		);
	}

	const userInitial =
		effectiveSession.user.name?.charAt(0)?.toUpperCase() ?? "U";
	const activeWorkspace = workspaces.find((workspace) => workspace.isActive);
	const workspaceLabel =
		workspaceContext?.name ?? activeWorkspace?.name ?? "Select workspace";
	const canSwitchWorkspace = workspaces.length > 1;
	const invoicesActive = invoiceTypeItems.some((item) =>
		item.match(location.pathname),
	);
	const switchWorkspace = async (workspaceId: Id<"workspaces">) => {
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
		<div className="vl-ledger-bg flex h-screen overflow-hidden text-[#f2efe7]">
			<aside className="ui-stagger-1 hidden h-screen w-[260px] shrink-0 border-r border-[#30352f] bg-[#101211]/96 shadow-[inset_-1px_0_0_rgba(242,239,231,0.02)] lg:flex lg:flex-col">
				<div className="border-b border-[#30352f] px-5 py-5">
					<Link to="/invoices" className="flex items-center gap-3">
						<span className="flex h-8 w-8 items-center justify-center border border-[#c8ff62]/45 bg-[#1a2117] text-xs font-bold text-[#c8ff62]">
							V
						</span>
						<div>
							<p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#f2efe7]">
								Velure
							</p>
							<p className="text-xs text-[#817d72]">Operations workspace</p>
						</div>
					</Link>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								className="mt-4 flex h-10 w-full items-center justify-between gap-2 border border-[#30352f] bg-[#0f1111] px-3 text-left text-sm text-[#f2efe7] transition-colors hover:border-[#3f5130] hover:bg-[#1a2117]"
							>
								<span className="flex min-w-0 items-center gap-2">
									<Building2 className="h-4 w-4 shrink-0 text-[#c8ff62]" />
									<span className="truncate">{workspaceLabel}</span>
								</span>
								<ChevronsUpDown className="h-4 w-4 shrink-0 text-[#817d72]" />
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="start"
							className="min-w-[240px] border-[#30352f] bg-[#171a18] p-1 text-[#f2efe7]"
						>
							<div className="px-2 py-2 text-xs font-medium uppercase tracking-[0.08em] text-[#817d72]">
								Workspace
							</div>
							{workspaces.length === 0 ? (
								<DropdownMenuItem disabled className="text-[#817d72]">
									No workspace available
								</DropdownMenuItem>
							) : (
								workspaces.map((workspace) => (
									<DropdownMenuItem
										key={workspace.id}
										disabled={!canSwitchWorkspace && workspace.isActive}
										className="gap-2 focus:bg-[#1a2117]"
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
										<span className="text-xs text-[#817d72]">
											{workspace.role}
										</span>
									</DropdownMenuItem>
								))
							)}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
					<nav className="space-y-6">
						<div className="space-y-1">
							<Link
								to="/invoices"
								className={`flex w-full items-start gap-3 border px-3 py-3 text-left transition-[background-color,border-color,color] duration-200 ${
									invoicesActive
										? "border-[#c8ff62] bg-[#1a2117] shadow-[inset_3px_0_0_#c8ff62]"
										: "border-transparent text-[#beb6a8] hover:border-[#30352f] hover:bg-[#1b2019]"
								}`}
							>
								<LayoutGrid
									className={`mt-0.5 h-4 w-4 shrink-0 ${
										invoicesActive ? "text-[#c8ff62]" : "text-[#817d72]"
									}`}
								/>
								<div className="min-w-0 flex-1">
									<p
										className={`text-sm font-medium ${
											invoicesActive ? "text-[#f2efe7]" : "text-[#d8d1c4]"
										}`}
									>
										Invoices
									</p>
									<p className="mt-1 text-xs leading-5 text-[#817d72]">
										Standard and pro-forma documents
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
										className={`flex items-start gap-3 border px-3 py-3 transition-[background-color,border-color,color] duration-200 ${
											active
												? "border-[#c8ff62] bg-[#1a2117] shadow-[inset_3px_0_0_#c8ff62]"
												: "border-transparent text-[#beb6a8] hover:border-[#30352f] hover:bg-[#1b2019]"
										}`}
									>
										<Icon
											className={`mt-0.5 h-4 w-4 shrink-0 ${
												active ? "text-[#c8ff62]" : "text-[#817d72]"
											}`}
										/>
										<div className="min-w-0">
											<p
												className={`text-sm font-medium ${
													active ? "text-[#f2efe7]" : "text-[#d8d1c4]"
												}`}
											>
												{item.label}
											</p>
											<p className="mt-1 text-xs leading-5 text-[#817d72]">
												{item.description}
											</p>
										</div>
									</Link>
								);
							})}
						</div>

						<div className="border-t border-[#30352f] pt-4">
							<p className="px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-[#817d72]">
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
												className="flex cursor-not-allowed items-start gap-3 border border-transparent px-3 py-3 text-[#77726b] opacity-70"
												title="Coming soon"
											>
												<Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#687458]" />
												<div className="min-w-0 flex-1">
													<div className="flex items-center gap-2">
														<p className="text-sm font-medium text-[#a9a39a]">
															{item.label}
														</p>
														<span className="rounded-sm border border-[#3f5130] bg-[#1a2117] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-[#c8ff62]">
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
											className={`flex items-start gap-3 border px-3 py-3 transition-[background-color,border-color,color] duration-200 ${
												active
													? "border-[#c8ff62] bg-[#1a2117] shadow-[inset_3px_0_0_#c8ff62]"
													: "border-transparent text-[#beb6a8] hover:border-[#30352f] hover:bg-[#1b2019]"
											}`}
										>
											<Icon
												className={`mt-0.5 h-4 w-4 shrink-0 ${
													active ? "text-[#c8ff62]" : "text-[#817d72]"
												}`}
											/>
											<div className="min-w-0">
												<p
													className={`text-sm font-medium ${
														active ? "text-[#f2efe7]" : "text-[#d8d1c4]"
													}`}
												>
													{item.label}
												</p>
												<p className="mt-1 text-xs leading-5 text-[#817d72]">
													{item.description}
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

			<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
				<header className="shrink-0 border-b border-[#30352f] bg-[#0f1111]/92 backdrop-blur-md">
					<div className="flex h-14 items-center justify-between gap-4 px-4 lg:px-8">
						<div className="min-w-0">
							<p className="truncate text-[10px] font-bold uppercase tracking-[0.22em] text-[#c8ff62]">
								Active workspace
							</p>
							<p className="mt-0.5 truncate text-sm font-semibold text-[#f2efe7]">
								{workspaceLabel}
							</p>
							<p className="truncate text-xs text-[#817d72]">
								{effectiveSession.user.email}
							</p>
						</div>

						<div className="flex items-center gap-2">
							<ThemeToggle className="h-9 w-9 border border-[#30352f] bg-[#151817] text-[#beb6a8] hover:border-[#3f5130] hover:bg-[#1a2117] hover:text-[#f2efe7]" />
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="h-9 w-9 border border-[#30352f] bg-[#151817] text-[#beb6a8] hover:border-[#3f5130] hover:bg-[#1a2117] hover:text-[#f2efe7]"
							>
								<Bell className="h-4 w-4" />
							</Button>
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<button
										type="button"
										title="Open user menu"
										className="flex h-9 w-9 items-center justify-center border border-[#c8ff62]/45 bg-[#151817] text-sm font-medium text-[#f2efe7] hover:bg-[#1a2117]"
									>
										<Avatar className="h-9 w-9">
											<AvatarImage
												src={effectiveSession.user.image ?? undefined}
												alt={effectiveSession.user.name ?? "User"}
											/>
											<AvatarFallback className="bg-transparent text-sm font-bold text-[#f2efe7]">
												{userInitial}
											</AvatarFallback>
										</Avatar>
									</button>
								</DropdownMenuTrigger>
								<DropdownMenuContent
									align="end"
									className="min-w-[220px] border-[#30352f] bg-[#171a18] p-1 text-[#f2efe7]"
								>
									<div className="px-2 py-2 text-sm">
										<p className="truncate font-medium text-[#f2efe7]">
											{effectiveSession.user.name ?? "User"}
										</p>
										<p className="truncate text-xs text-[#817d72]">
											{effectiveSession.user.email}
										</p>
									</div>
									<DropdownMenuSeparator className="bg-[#30352f]" />
									<DropdownMenuItem asChild className="focus:bg-[#1a2117]">
										<Link to="/invoices">Invoices</Link>
									</DropdownMenuItem>
									<DropdownMenuItem asChild className="focus:bg-[#1a2117]">
										<Link to="/clients">Clients</Link>
									</DropdownMenuItem>
									<DropdownMenuItem asChild className="focus:bg-[#1a2117]">
										<Link to="/settings/compliance">Compliance</Link>
									</DropdownMenuItem>
									<DropdownMenuItem asChild className="focus:bg-[#1a2117]">
										<Link to="/settings/collections">Payment reminders</Link>
									</DropdownMenuItem>
									<DropdownMenuItem asChild className="focus:bg-[#1a2117]">
										<Link to="/settings/security">Security</Link>
									</DropdownMenuItem>
									<DropdownMenuSeparator className="bg-[#30352f]" />
									<DropdownMenuItem
										className="text-[#d48f8f] focus:bg-[#2a1f1f] focus:text-[#efb1b1]"
										onClick={() => {
											setVerifiedSession(null);
											setSessionProbeComplete(true);
											void authClient.signOut();
										}}
									>
										Log out
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</div>

					<div className="flex gap-2 overflow-x-auto border-t border-[#30352f] px-4 py-3 lg:hidden">
						<Link
							to="/invoices"
							className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm whitespace-nowrap transition-[background-color,border-color,color] duration-200 ${
								location.pathname === "/invoices"
									? "border-[#c8ff62] bg-[#1a2117] text-[#f2efe7]"
									: "border-[#30352f] bg-[#171a18] text-[#beb6a8]"
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
											? "border-[#c8ff62] bg-[#1a2117] text-[#f2efe7]"
											: "border-[#30352f] bg-[#171a18] text-[#beb6a8]"
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
