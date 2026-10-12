import { cn } from "#/lib/utils.ts";

export interface SegmentedOption {
	value: string;
	label: string;
	count?: string | number;
}

export interface SegmentedFilterProps {
	options: SegmentedOption[];
	value: string;
	onChange: (value: string) => void;
	className?: string;
}

export function SegmentedFilter({
	options,
	value,
	onChange,
	className,
}: SegmentedFilterProps) {
	return (
		<div
			className={cn(
				"inline-flex gap-0.5 rounded-md border border-rule/60 bg-paper-2 p-[3px]",
				className,
			)}
		>
			{options.map((opt) => {
				const active = opt.value === value;
				return (
					<button
						key={opt.value}
						type="button"
						aria-pressed={active}
						onClick={() => onChange(opt.value)}
						className={cn(
							"inline-flex h-7 items-center gap-[7px] rounded-md px-3 text-[13px] font-medium transition-colors duration-150 ease-out",
							active
								? "bg-paper-3 text-ink shadow-sm ring-1 ring-rule"
								: "text-ink-2 hover:text-ink",
						)}
					>
						{opt.label}
						{opt.count !== undefined ? (
							<i className="font-num text-[11px] whitespace-nowrap tabular-nums not-italic text-ink-3">
								{opt.count}
							</i>
						) : null}
					</button>
				);
			})}
		</div>
	);
}
