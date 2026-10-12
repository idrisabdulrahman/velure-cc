import type { ReactNode } from "react";
import { cn } from "#/utils";

export type ListRowTint = "accent" | "info" | "warn" | "ok";
export type ListRowBarTone = "accent" | "info" | "ok";

export type ListRowProps = {
	icon: ReactNode;
	tint: ListRowTint;
	title: ReactNode;
	subtitle?: ReactNode;
	amount?: ReactNode;
	barPercent?: number;
	barTone?: ListRowBarTone;
};

const tintClass: Record<ListRowTint, string> = {
	accent: "bg-brand-soft text-brand-hi",
	info: "bg-info-soft text-info",
	warn: "bg-warn-soft text-warn",
	ok: "bg-ok-soft text-ok",
};

const barClass: Record<ListRowBarTone, string> = {
	accent: "bg-brand",
	info: "bg-info",
	ok: "bg-ok",
};

export function ListRow({
	icon,
	tint,
	title,
	subtitle,
	amount,
	barPercent,
	barTone = "accent",
}: ListRowProps) {
	const clamped =
		barPercent === undefined
			? undefined
			: Math.min(100, Math.max(0, barPercent));
	return (
		<div className="flex items-center gap-3 border-rule border-b px-4.5 py-3 last:border-b-0">
			<div
				className={cn(
					"grid h-8 w-8 flex-none place-items-center rounded-[9px] [&_svg]:h-4 [&_svg]:w-4",
					tintClass[tint],
				)}
				aria-hidden="true"
			>
				{icon}
			</div>
			<div className="min-w-0 flex-1">
				<p className="truncate text-[13.5px] font-medium text-ink">{title}</p>
				{subtitle ? (
					<p className="mt-px truncate text-xs text-ink-3">{subtitle}</p>
				) : null}
				{clamped !== undefined ? (
					<div
						role="progressbar"
						aria-valuenow={Math.round(clamped)}
						aria-valuemin={0}
						aria-valuemax={100}
						className="mt-2 h-[3px] overflow-hidden rounded-full bg-paper-3"
					>
						<div
							className={cn("h-full rounded-full", barClass[barTone])}
							style={{ width: `${clamped}%` }}
						/>
					</div>
				) : null}
			</div>
			{amount !== undefined ? (
				<div className="font-num text-[13px] whitespace-nowrap tabular-nums">
					{amount}
				</div>
			) : null}
		</div>
	);
}
