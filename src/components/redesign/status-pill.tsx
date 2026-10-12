import { cn } from "#/lib/utils.ts";

export type StatusPillTone = "ok" | "warn" | "bad" | "info" | "mute";

const TONE_CLS: Record<StatusPillTone, string> = {
	ok: "bg-ok-soft text-ok",
	warn: "bg-warn-soft text-warn",
	bad: "bg-danger-soft text-danger",
	info: "bg-info-soft text-info",
	mute: "bg-paper-3 text-ink-2",
};

export interface StatusPillProps {
	tone?: StatusPillTone;
	children: string;
	className?: string;
}

export function StatusPill({
	tone = "mute",
	children,
	className,
}: StatusPillProps) {
	return (
		<span
			className={cn(
				"inline-flex h-[22px] items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium whitespace-nowrap",
				TONE_CLS[tone],
				className,
			)}
		>
			<span
				aria-hidden="true"
				className="size-1.5 flex-none rounded-full bg-current"
			/>
			{children}
		</span>
	);
}
