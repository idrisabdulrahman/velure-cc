import { CircleAlert, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "#/components/ui/button";
import { cn } from "#/utils";

export type CalloutTone = "warn" | "info" | "bad";

export type CalloutProps = {
	tone: CalloutTone;
	title?: ReactNode;
	children: ReactNode;
	action?: {
		label: string;
		onClick: () => void;
	};
};

const toneClass: Record<CalloutTone, string> = {
	warn: "border-warn-line bg-warn-soft",
	info: "border-info-line bg-info-soft",
	bad: "border-danger-line bg-danger-soft",
};

const iconClass: Record<CalloutTone, string> = {
	warn: "text-warn",
	info: "text-info",
	bad: "text-danger",
};

export function Callout({ tone, title, children, action }: CalloutProps) {
	const Icon =
		tone === "warn" ? TriangleAlert : tone === "info" ? Info : CircleAlert;
	return (
		<div
			role={tone === "bad" ? "alert" : "note"}
			className={cn(
				"flex gap-3 rounded-[var(--hm-r-input)] border p-3.5",
				toneClass[tone],
			)}
		>
			<Icon
				className={cn("mt-px h-[18px] w-[18px] shrink-0", iconClass[tone])}
				aria-hidden="true"
			/>
			<div className="min-w-0 flex-1">
				{title ? (
					<p className="text-[13px] font-medium text-ink">{title}</p>
				) : null}
				<div className="text-[13px] text-ink-2">{children}</div>
				{action ? (
					<div className="mt-2.5">
						<Button variant="outline" size="sm" onClick={action.onClick}>
							{action.label}
						</Button>
					</div>
				) : null}
			</div>
		</div>
	);
}
