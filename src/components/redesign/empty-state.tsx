import type { ReactNode } from "react";
import { cn } from "#/utils";

export type EmptyStateProps = {
	icon?: ReactNode;
	title: ReactNode;
	copy?: ReactNode;
	action?: ReactNode;
	dashed?: boolean;
};

export function EmptyState({
	icon,
	title,
	copy,
	action,
	dashed,
}: EmptyStateProps) {
	return (
		<div
			className={cn(
				"grid place-items-center gap-1.5 px-4 py-8 text-center text-[13px] text-ink-2",
				dashed &&
					"rounded-[var(--hm-r-input)] border border-dashed border-rule",
			)}
		>
			{icon ? (
				<div className="mb-1 grid h-9 w-9 place-items-center rounded-full bg-paper-3 text-ink-2 [&_svg]:h-4 [&_svg]:w-4">
					{icon}
				</div>
			) : null}
			<p className="text-[13.5px] font-medium text-ink">{title}</p>
			{copy ? <div className="max-w-[52ch]">{copy}</div> : null}
			{action ? <div className="mt-2">{action}</div> : null}
		</div>
	);
}
