import { Link } from "@tanstack/react-router";
import { LogOut, Settings } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "#/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";

type ProfileDropdownProps = {
	name: string | null | undefined;
	email: string | null | undefined;
	image: string | null | undefined;
	onSignOut: () => void | Promise<void>;
};

/**
 * Header user menu. Adapted from @kokonutui/profile-dropdown — its shell
 * (grouped items, hairline hover borders, glass content panel) with the
 * registry's Next-only imports, `dark:` variants, purple/pink avatar ring, and
 * 16px radius replaced per design.md: tokens only, no dark: variants, 12px
 * card ceiling. Glass on the content panel is the overlay allowance.
 *
 * Route items are deliberately absent — Invoices / Clients / Compliance /
 * Payment reminders are all sidebar destinations, and duplicating navigation
 * in the avatar menu is the thing this replaced.
 */
export function ProfileDropdown({
	name,
	email,
	image,
	onSignOut,
}: ProfileDropdownProps) {
	const displayName = name ?? "User";
	const initial = name?.charAt(0)?.toUpperCase() ?? "U";

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					title="Open user menu"
					className="flex h-9 w-9 items-center justify-center rounded-[var(--hm-r-card)] border border-brand/45 bg-paper-2 text-sm font-medium text-ink transition-colors hover:bg-brand-soft"
				>
					<Avatar className="h-9 w-9">
						<AvatarImage src={image ?? undefined} alt={displayName} />
						<AvatarFallback className="bg-transparent text-sm font-bold text-ink">
							{initial}
						</AvatarFallback>
					</Avatar>
				</button>
			</DropdownMenuTrigger>

			<DropdownMenuContent
				align="end"
				sideOffset={6}
				className="w-64 rounded-[var(--hm-r-card)] border-rule bg-paper/95 p-2 text-ink shadow-[var(--hm-shadow-lift)] backdrop-blur-md"
			>
				<div className="px-2 py-2">
					<p className="truncate text-sm font-medium leading-tight text-ink">
						{displayName}
					</p>
					{email ? (
						<p className="truncate text-xs leading-tight text-ink-3">{email}</p>
					) : null}
				</div>

				<DropdownMenuSeparator className="my-2 bg-rule" />

				<DropdownMenuItem asChild>
					<Link
						to="/settings"
						className="group flex cursor-pointer items-center gap-2 rounded-[var(--hm-r-input)] border border-transparent p-3 transition-colors hover:border-rule hover:bg-paper-2 focus:bg-brand-soft"
					>
						<Settings className="h-4 w-4 text-ink-3 group-hover:text-ink" />
						<span className="text-sm font-medium leading-tight">Settings</span>
					</Link>
				</DropdownMenuItem>

				<DropdownMenuSeparator className="my-2 bg-rule" />

				<DropdownMenuItem
					onClick={onSignOut}
					className="group flex cursor-pointer items-center gap-2 rounded-[var(--hm-r-input)] border border-transparent bg-danger-soft p-3 text-danger transition-colors hover:border-danger-line focus:bg-danger-soft focus:text-danger"
				>
					<LogOut className="h-4 w-4" />
					<span className="text-sm font-medium leading-tight">Log out</span>
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
