import type { ReactNode } from "react";
import { cn } from "#/lib/utils.ts";

export type KpiTone = "brand" | "ok" | "warn" | "danger" | "info" | "mute";

const TONE_DOT: Record<KpiTone, string> = {
	brand: "bg-brand",
	ok: "bg-ok",
	warn: "bg-warn",
	danger: "bg-danger",
	info: "bg-info",
	mute: "bg-ink-3",
};

export interface KpiProps {
	label: string;
	value: string;
	sub?: string;
	tone?: KpiTone;
	selected?: boolean;
	onClick?: () => void;
}

export function Kpi({
	label,
	value,
	sub,
	tone = "mute",
	selected,
	onClick,
}: KpiProps) {
	const inner = (
		<>
			<span className="flex items-center gap-2 text-xs text-ink-2">
				<span
					aria-hidden="true"
					className={cn("size-[7px] flex-none rounded-full", TONE_DOT[tone])}
				/>
				<span className="min-w-0 truncate">{label}</span>
			</span>
			<span className="mt-[11px] block font-num text-2xl font-medium tracking-tight whitespace-nowrap tabular-nums text-ink">
				{value}
			</span>
			{sub ? (
				<span className="mt-[7px] block text-xs text-ink-3">{sub}</span>
			) : null}
			{selected ? (
				<span
					aria-hidden="true"
					className="absolute inset-x-[18px] bottom-0 h-0.5 rounded-sm bg-brand"
				/>
			) : null}
		</>
	);
	const cls = cn(
		"relative min-w-0 bg-paper px-[18px] py-4 text-left",
		onClick &&
			"cursor-pointer transition-colors duration-150 ease-out hover:bg-paper-2",
		selected && "bg-gradient-to-b from-brand-soft to-transparent",
	);
	if (onClick) {
		return (
			<button
				type="button"
				onClick={onClick}
				aria-pressed={selected}
				className={cls}
			>
				{inner}
			</button>
		);
	}
	return <div className={cls}>{inner}</div>;
}

export interface KpiStripProps {
	children: ReactNode;
	className?: string;
}

export function KpiStrip({ children, className }: KpiStripProps) {
	return (
		<div
			className={cn(
				"grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-rule bg-rule/60 md:grid-cols-2 xl:grid-cols-4",
				className,
			)}
		>
			{children}
		</div>
	);
}
