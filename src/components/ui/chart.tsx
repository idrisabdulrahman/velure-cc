import * as React from "react";
import * as RechartsPrimitive from "recharts";

import { cn } from "../../utils";

// shadcn chart wrapper (Recharts v3). Token-driven: series colors come from
// `chartConfig` as `var(--chart-N)` and resolve through the `--chart-*`
// bridge in `src/styles.css`. No hex, no `dark:` overrides here.
const THEMES = { light: "", dark: ".dark" } as const;

export type ChartConfig = {
	[k in string]: {
		label?: React.ReactNode;
		icon?: React.ComponentType;
	} & (
		| { color?: string; theme?: never }
		| { color?: never; theme: Record<keyof typeof THEMES, string> }
	);
};

type ChartContextProps = {
	config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
	const context = React.useContext(ChartContext);

	if (!context) {
		throw new Error("useChart must be used within a <ChartContainer />");
	}

	return context;
}

function ChartContainer({
	id,
	className,
	children,
	config,
	...props
}: React.ComponentProps<"div"> & {
	config: ChartConfig;
	children: React.ComponentProps<
		typeof RechartsPrimitive.ResponsiveContainer
	>["children"];
}) {
	const uniqueId = React.useId();
	const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`;

	return (
		<ChartContext.Provider value={{ config }}>
			<div
				data-slot="chart"
				data-chart={chartId}
				className={cn(
					"[&_.recharts-cartesian-axis-tick_text]:fill-ink-3",
					"[&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-rule",
					"[&_.recharts-curve.recharts-tooltip-cursor]:stroke-rule",
					"[&_.recharts-polar-grid_[stroke='#ccc']]:stroke-rule",
					"[&_.recharts-radial-bar-background-sector]:fill-paper-3",
					"[&_.recharts-rectangle.recharts-tooltip-cursor]:fill-paper-3",
					"[&_.recharts-reference-line_[stroke='#ccc']]:stroke-rule",
					"flex aspect-video justify-center text-xs",
					className,
				)}
				{...props}
			>
				<ChartStyle id={chartId} config={config} />
				<RechartsPrimitive.ResponsiveContainer>
					{children}
				</RechartsPrimitive.ResponsiveContainer>
			</div>
		</ChartContext.Provider>
	);
}

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
	const colorConfig = Object.entries(config).filter(
		([, itemConfig]) => itemConfig.theme || itemConfig.color,
	);

	if (!colorConfig.length) {
		return null;
	}

	const cssText = Object.entries(THEMES)
		.map(
			([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
	.map(([key, itemConfig]) => {
		const color =
			itemConfig.theme?.[theme as keyof typeof itemConfig.theme] ||
			itemConfig.color;
		return color ? `  --color-${key}: ${color};` : null;
	})
	.join("\n")}
}
`,
		)
		.join("\n");

	return <style>{cssText}</style>;
};

const ChartTooltip = RechartsPrimitive.Tooltip;

export type ChartTooltipItem = {
	name?: string | number;
	value?: string | number | Array<string | number>;
	dataKey?: string | number;
	color?: string;
	payload?: Record<string, unknown>;
};

export type ChartTooltipContentProps = React.ComponentProps<"div"> & {
	active?: boolean;
	payload?: ChartTooltipItem[];
	label?: unknown;
	hideLabel?: boolean;
	hideIndicator?: boolean;
	indicator?: "line" | "dot" | "dashed";
	nameKey?: string;
	labelKey?: string;
	labelClassName?: string;
	color?: string;
	labelFormatter?: (
		value: React.ReactNode,
		payload: ChartTooltipItem[] | undefined,
	) => React.ReactNode;
	formatter?: (
		value: ChartTooltipItem["value"],
		name: ChartTooltipItem["name"],
		item: ChartTooltipItem,
		index: number,
		payload: Record<string, unknown> | undefined,
	) => React.ReactNode;
};

function ChartTooltipContent({
	active,
	payload,
	className,
	indicator = "dot",
	hideLabel = false,
	hideIndicator = false,
	label,
	labelFormatter,
	labelClassName,
	formatter,
	color,
	nameKey,
	labelKey,
}: ChartTooltipContentProps) {
	const { config } = useChart();

	const tooltipLabel = React.useMemo(() => {
		if (hideLabel || !payload?.length) {
			return null;
		}

		const [item] = payload;
		const key = `${labelKey || item?.dataKey || item?.name || "value"}`;
		const itemConfig = getPayloadConfigFromPayload(config, item, key);
		const value =
			!labelKey && typeof label === "string"
				? (config[label as keyof typeof config]?.label ?? label)
				: itemConfig?.label;

		if (labelFormatter) {
			return (
				<div className={cn("font-medium", labelClassName)}>
					{labelFormatter(value, payload)}
				</div>
			);
		}

		if (!value) {
			return null;
		}

		return <div className={cn("font-medium", labelClassName)}>{value}</div>;
	}, [
		label,
		labelFormatter,
		payload,
		hideLabel,
		labelClassName,
		config,
		labelKey,
	]);

	if (!active || !payload?.length) {
		return null;
	}

	const nestLabel = payload.length === 1 && indicator !== "dot";

	return (
		<div
			className={cn(
				"border-rule bg-paper grid min-w-[8rem] items-start gap-1.5 rounded-[var(--hm-r-input)] border px-2.5 py-1.5 text-xs shadow-xl",
				className,
			)}
		>
			{!nestLabel ? tooltipLabel : null}
			<div className="grid gap-1.5">
				{payload.map((item, index) => {
					const key = `${nameKey || item.name || item.dataKey || "value"}`;
					const itemConfig = getPayloadConfigFromPayload(config, item, key);
					const indicatorColor =
						color ||
						(item.payload != null &&
						typeof item.payload === "object" &&
						"fill" in item.payload
							? String((item.payload as Record<string, unknown>).fill ?? "")
							: "") ||
						item.color;

					return (
						<div
							key={item.dataKey}
							className={cn(
								"[&>svg]:text-ink-3 flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5",
								indicator === "dot" && "items-center",
							)}
						>
							{formatter && item?.value !== undefined && item.name ? (
								formatter(item.value, item.name, item, index, item.payload)
							) : (
								<>
									{itemConfig?.icon ? (
										<itemConfig.icon />
									) : (
										!hideIndicator && (
											<div
												className={cn(
													"shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)",
													{
														"h-2.5 w-2.5": indicator === "dot",
														"w-1": indicator === "line",
														"w-0 border-[1.5px] border-dashed bg-transparent":
															indicator === "dashed",
														"my-0.5": nestLabel && indicator === "dashed",
													},
												)}
												style={
													{
														"--color-bg": indicatorColor,
														"--color-border": indicatorColor,
													} as React.CSSProperties
												}
											/>
										)
									)}
									<div
										className={cn(
											"flex flex-1 justify-between leading-none",
											nestLabel ? "items-end" : "items-center",
										)}
									>
										<div className="grid gap-1.5">
											{nestLabel ? tooltipLabel : null}
											<span className="text-ink-3">
												{itemConfig?.label || item.name}
											</span>
										</div>
										{item.value && (
											<span className="text-ink font-num font-medium tabular-nums">
												{Number(item.value).toLocaleString()}
											</span>
										)}
									</div>
								</>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

const ChartLegend = RechartsPrimitive.Legend;

export type ChartLegendItem = {
	value?: string | number;
	dataKey?: string | number;
	color?: string;
};

function ChartLegendContent({
	className,
	hideIcon = false,
	payload,
	verticalAlign = "bottom",
	nameKey,
}: React.ComponentProps<"div"> & {
	payload?: ChartLegendItem[];
	verticalAlign?: "top" | "bottom" | "middle";
	hideIcon?: boolean;
	nameKey?: string;
}) {
	const { config } = useChart();

	if (!payload?.length) {
		return null;
	}

	return (
		<div
			className={cn(
				"flex items-center justify-center gap-4",
				verticalAlign === "top" ? "pb-3" : "pt-3",
				className,
			)}
		>
			{payload.map((item) => {
				const key = `${nameKey || item.dataKey || "value"}`;
				const itemConfig = getPayloadConfigFromPayload(config, item, key);

				return (
					<div
						key={item.value}
						className="[&>svg]:text-ink-3 flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3"
					>
						{itemConfig?.icon && !hideIcon ? (
							<itemConfig.icon />
						) : (
							<div
								className="h-2 w-2 shrink-0 rounded-[2px]"
								style={{
									backgroundColor: item.color,
								}}
							/>
						)}
						{itemConfig?.label}
					</div>
				);
			})}
		</div>
	);
}

// Helper to extract item config from a payload.
function getPayloadConfigFromPayload(
	config: ChartConfig,
	payload: unknown,
	key: string,
) {
	if (typeof payload !== "object" || payload === null) {
		return undefined;
	}

	const payloadPayload =
		"payload" in payload &&
		typeof payload.payload === "object" &&
		payload.payload !== null
			? payload.payload
			: undefined;

	let configLabelKey: string = key;

	if (key in config || (payloadPayload && configLabelKey in payloadPayload)) {
		// no-op, key already direct
	} else if (payloadPayload && "dataKey" in payload) {
		configLabelKey = String(payload.dataKey);
	} else if ("name" in payload) {
		configLabelKey = String(payload.name);
	}

	if (configLabelKey in config) {
		return config[configLabelKey];
	}

	if (payloadPayload && configLabelKey in payloadPayload) {
		const nested = (payloadPayload as Record<string, unknown>)[configLabelKey];
		if (typeof nested === "string") {
			return config[nested];
		}
	}

	return config[key];
}

export {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
	ChartLegend,
	ChartLegendContent,
	ChartStyle,
};
