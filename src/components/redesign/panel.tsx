import type { ReactNode } from "react";
import { cn } from "#/lib/utils.ts";

export interface PanelHeaderProps {
	title?: string;
	sub?: string;
	actions?: ReactNode;
}

export function PanelHeader({ title, sub, actions }: PanelHeaderProps) {
	if (!title && !sub && !actions) return null;
	return (
		<div className="flex items-center justify-between gap-3 border-b border-rule/60 px-[18px] py-[14px]">
			<div className="min-w-0">
				{title ? (
					<h3 className="truncate text-sm font-medium text-ink">{title}</h3>
				) : null}
				{sub ? (
					<p className="mt-0.5 truncate text-xs text-ink-3">{sub}</p>
				) : null}
			</div>
			{actions ? (
				<div className="flex flex-none items-center gap-2">{actions}</div>
			) : null}
		</div>
	);
}

export interface PanelProps {
	title?: string;
	sub?: string;
	actions?: ReactNode;
	children: ReactNode;
	className?: string;
}

export function Panel({
	title,
	sub,
	actions,
	children,
	className,
}: PanelProps) {
	return (
		<section
			className={cn(
				"min-w-0 overflow-hidden rounded-lg border border-rule bg-paper",
				className,
			)}
		>
			<PanelHeader title={title} sub={sub} actions={actions} />
			<div className="p-[18px]">{children}</div>
		</section>
	);
}
