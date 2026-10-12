import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "#/components/ui/chart";
import { cn } from "#/utils";

export type ColumnChartSeries = {
	key: string;
	label: string;
	/** Chart-token color, e.g. "var(--chart-1)". No hex. */
	color: string;
};

export type ColumnChartProps = {
	/** Row per category; must include a `label` field plus one number per series key. */
	data: Array<Record<string, string | number>>;
	series: Array<ColumnChartSeries>;
	height?: number;
	hideable?: boolean;
};

export function ColumnChart({
	data,
	series,
	height = 230,
	hideable,
}: ColumnChartProps) {
	const [hidden, setHidden] = useState<Set<string>>(new Set());

	const config = useMemo<ChartConfig>(
		() =>
			Object.fromEntries(
				series.map((s) => [s.key, { label: s.label, color: s.color }]),
			),
		[series],
	);

	function toggle(key: string) {
		setHidden((prev) => {
			const next = new Set(prev);
			if (next.has(key)) {
				next.delete(key);
			} else {
				next.add(key);
			}
			return next;
		});
	}

	return (
		<div>
			<div
				className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2"
				role={hideable ? "group" : undefined}
				aria-label={hideable ? "Toggle chart series" : undefined}
			>
				{series.map((s) =>
					hideable ? (
						<button
							key={s.key}
							type="button"
							aria-pressed={!hidden.has(s.key)}
							onClick={() => toggle(s.key)}
							className={cn(
								"inline-flex items-center gap-1.5 rounded-[var(--hm-r-input)] px-1 py-0.5",
								hidden.has(s.key) && "opacity-50",
							)}
						>
							<span
								className="inline-block h-2 w-2 rounded-[3px]"
								style={{ backgroundColor: s.color }}
								aria-hidden="true"
							/>
							{s.label}
						</button>
					) : (
						<span key={s.key} className="inline-flex items-center gap-1.5">
							<span
								className="inline-block h-2 w-2 rounded-[3px]"
								style={{ backgroundColor: s.color }}
								aria-hidden="true"
							/>
							{s.label}
						</span>
					),
				)}
			</div>
			<ChartContainer
				config={config}
				style={{ height }}
				className="aspect-auto min-h-0 w-full [&_.recharts-cartesian-axis-tick_text]:font-num [&_.recharts-cartesian-axis-tick_text]:tabular-nums"
			>
				<BarChart
					accessibilityLayer
					data={data}
					margin={{ top: 18, right: 4, bottom: 0, left: 4 }}
				>
					<CartesianGrid vertical={false} stroke="var(--chart-grid)" />
					<XAxis
						dataKey="label"
						tickLine={false}
						axisLine={false}
						tickMargin={10}
						minTickGap={16}
						tick={{ fontSize: 11 }}
					/>
					<YAxis
						tickLine={false}
						axisLine={false}
						width={56}
						tick={{ fontSize: 11 }}
						tickFormatter={(value: number) =>
							value >= 1_000_000
								? `${Math.round(value / 1_000_000)}M`
								: value >= 1_000
									? `${Math.round(value / 1_000)}k`
									: String(value)
						}
					/>
					<ChartTooltip
						cursor={{ fill: "var(--chart-tooltip-background)" }}
						content={<ChartTooltipContent />}
					/>
					{series.map((s) => (
						<Bar
							key={s.key}
							dataKey={s.key}
							name={s.label}
							fill={`var(--color-${s.key})`}
							hide={hidden.has(s.key)}
							isAnimationActive={false}
							radius={[6, 6, 0, 0]}
							maxBarSize={38}
						/>
					))}
				</BarChart>
			</ChartContainer>
		</div>
	);
}
