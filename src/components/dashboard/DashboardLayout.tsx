import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import {
	Bell,
	FileText,
	LayoutGrid,
	Loader2,
	Search,
	Settings,
	Users,
} from "lucide-react";
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
		label: "Dashboard",
	},
	{
		to: "/clients",
		icon: Users,
		match: (pathname: string) => pathname.startsWith("/clients"),
		label: "Clients",
	},
	{
		to: "/invoices/products",
		icon: FileText,
		match: (pathname: string) => pathname.startsWith("/invoices/products"),
		label: "Documents",
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
			<div className="flex h-screen w-full items-center justify-center bg-[#050607]">
				<Loader2 className="h-8 w-8 animate-spin text-[#C8FF1A]" />
			</div>
		);
	}

	if (!session?.user) {
		return (
			<div className="flex h-screen w-full items-center justify-center bg-[#050607] px-6">
				<div className="w-full max-w-md rounded-xl border border-[#1A1D22] bg-[#0A0D12] p-6 text-center">
					<p className="font-serif text-3xl italic text-[#F2F3F5]">
						Authentication required
					</p>
					<p className="mt-2 text-sm text-[#8A8F99]">
						Sign in with email and password to access your invoices.
					</p>
					<Button
						asChild
						className="mt-5 h-10 rounded-md bg-[#C8FF1A] px-4 text-xs font-bold tracking-[0.08em] text-[#050607] hover:bg-[#d3ff4f]"
					>
						<Link to="/auth">GO TO SIGN IN</Link>
					</Button>
				</div>
			</div>
		);
	}

	const userInitial = session.user.name?.charAt(0)?.toUpperCase() ?? "U";

	return (
		<div className="flex h-screen w-full flex-col overflow-hidden bg-[#050607]">
			<div className="flex h-14 shrink-0 items-center justify-between border-b border-[#1A1D22] bg-[#0A0D12] px-4 md:px-6">
				<div className="flex items-center gap-2">
					<div className="h-3 w-3 rounded-full bg-red-500/80" />
					<div className="h-3 w-3 rounded-full bg-amber-500/80" />
					<div className="h-3 w-3 rounded-full bg-green-500/80" />
				</div>
				<div className="flex items-center gap-5 text-[#8A8F99]">
					<Search className="h-[18px] w-[18px] cursor-pointer transition-colors hover:text-[#F2F3F5]" />
					<Bell className="h-[18px] w-[18px] cursor-pointer transition-colors hover:text-[#F2F3F5]" />
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<button
								type="button"
								title="Open user menu"
								className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-[#2A351A] bg-[#131C0B] text-xs font-bold text-[#C8FF1A] transition-colors hover:bg-[#18240E]"
							>
								<Avatar className="h-8 w-8 rounded-full">
									<AvatarImage src={session.user.image ?? undefined} alt={session.user.name ?? "User"} />
									<AvatarFallback className="rounded-full bg-transparent text-xs font-bold text-[#C8FF1A]">
										{userInitial}
									</AvatarFallback>
								</Avatar>
							</button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="end"
							className="min-w-[190px] border-[#1A1D22] bg-[#0A0D12] p-1 text-[#EDF0F4]"
						>
							<div className="px-2 py-1.5 text-xs text-[#8A8F99]">
								<p className="truncate text-[#D6DBE3]">{session.user.name ?? "User"}</p>
								<p className="truncate">{session.user.email}</p>
							</div>
							<DropdownMenuSeparator className="bg-[#1A1D22]" />
							<DropdownMenuItem asChild className="text-xs focus:bg-[#18240E] focus:text-[#DFFF62]">
								<Link to="/invoices">Invoices</Link>
							</DropdownMenuItem>
							<DropdownMenuItem asChild className="text-xs focus:bg-[#18240E] focus:text-[#DFFF62]">
								<Link to="/clients">Clients</Link>
							</DropdownMenuItem>
							<DropdownMenuItem asChild className="text-xs focus:bg-[#18240E] focus:text-[#DFFF62]">
								<Link to="/settings/security">Security</Link>
							</DropdownMenuItem>
							<DropdownMenuSeparator className="bg-[#1A1D22]" />
							<DropdownMenuItem
								className="text-xs text-[#FFA8B5] focus:bg-[#2A1319] focus:text-[#FFC5CF]"
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

			<div className="flex flex-1 overflow-hidden">
				<aside className="hidden w-[80px] shrink-0 flex-col items-center gap-6 border-r border-[#1A1D22] bg-[#0A0D12] py-6 md:flex">
					<Link
						to="/invoices"
						className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#C8FF1A] text-sm font-bold text-[#050607]"
					>
						V
					</Link>
					{navItems.map((item) => {
						const Icon = item.icon;
						const active = item.match(location.pathname);

						return (
							<Link
								key={item.to}
								to={item.to}
								aria-label={item.label}
								className={`flex h-11 w-11 items-center justify-center rounded-[10px] border transition-all duration-200 ease-out ${
									active
										? "border-[#C8FF1A66] bg-[#131C0B] shadow-[0_0_20px_rgba(200,255,26,0.18)]"
										: "border-[#1A1D22] bg-[#0D1016] hover:border-[#2A3038]"
								}`}
							>
								<Icon
									className={`h-[18px] w-[18px] ${active ? "text-[#C8FF1A]" : "text-[#626C79]"}`}
								/>
							</Link>
						);
					})}
					<Link
						to="/settings/security"
						aria-label="Settings"
						className="mt-auto flex h-11 w-11 items-center justify-center rounded-[10px] border border-[#1A1D22] bg-[#0D1016]"
					>
						<Settings className="h-[18px] w-[18px] text-[#626C79]" />
					</Link>
				</aside>

				<main
					ref={mainRef}
					className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-[#050607] p-4 md:p-12"
				>
					<div className="mb-4 flex items-center gap-2 md:hidden">
						{navItems.map((item) => {
							const Icon = item.icon;
							const active = item.match(location.pathname);

							return (
								<Link
									key={item.to}
									to={item.to}
									className={`inline-flex h-9 items-center gap-1 rounded-[10px] border px-3 text-xs transition-all ${
										active
											? "border-[#C8FF1A66] bg-[#131C0B] text-[#C8FF1A]"
											: "border-[#1A1D22] bg-[#0D1016] text-[#8A8F99]"
									}`}
								>
									<Icon className="h-3.5 w-3.5" />
									{item.label}
								</Link>
							);
						})}
					</div>
					<div className="mx-auto max-w-6xl w-full">
						<RouteTransition routeKey={location.pathname}>
							<Outlet />
						</RouteTransition>
					</div>
				</main>
			</div>
		</div>
	);
}
