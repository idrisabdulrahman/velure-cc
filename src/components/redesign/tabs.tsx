import { cn } from "#/lib/utils.ts";

export interface TabOption {
	value: string;
	label: string;
	count?: string | number;
}

export interface TabsProps {
	tabs: TabOption[];
	value: string;
	onChange: (value: string) => void;
	className?: string;
}

export function Tabs({ tabs, value, onChange, className }: TabsProps) {
	return (
		<div
			role="tablist"
			className={cn(
				"flex gap-[26px] overflow-x-auto border-b border-rule",
				className,
			)}
		>
			{tabs.map((tab) => {
				const active = tab.value === value;
				return (
					<button
						key={tab.value}
						type="button"
						role="tab"
						aria-selected={active}
						onClick={() => onChange(tab.value)}
						className={cn(
							"relative inline-flex h-11 flex-none items-center gap-2 text-[13.5px] font-medium whitespace-nowrap transition-colors duration-150 ease-out",
							active ? "text-ink" : "text-ink-2 hover:text-ink",
						)}
					>
						{tab.label}
						{tab.count !== undefined ? (
							<span className="rounded-full bg-paper-3 px-1.5 py-px font-num text-[11px] whitespace-nowrap tabular-nums text-ink-2">
								{tab.count}
							</span>
						) : null}
						{active ? (
							<span
								aria-hidden="true"
								className="absolute inset-x-0 -bottom-px h-0.5 rounded-sm bg-brand"
							/>
						) : null}
					</button>
				);
			})}
		</div>
	);
}
