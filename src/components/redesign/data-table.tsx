import type { ReactNode } from "react";
import { Checkbox } from "#/components/ui/checkbox";
import { cn } from "#/utils";

export type DataTableAlign = "left" | "center" | "right";

export type DataTableColumn<T> = {
	key: string;
	header: ReactNode;
	align?: DataTableAlign;
	render: (row: T) => ReactNode;
};

export type DataTableProps<T> = {
	columns: Array<DataTableColumn<T>>;
	rows: Array<T>;
	keyOf: (row: T) => string;
	selected: Set<string>;
	onToggle: (id: string) => void;
	onToggleAll?: () => void;
	bulkBar?: ReactNode;
	toolbar?: ReactNode;
	footer?: ReactNode;
	rowActions?: (row: T) => ReactNode;
	emptyState?: ReactNode;
};

const alignClass: Record<DataTableAlign, string> = {
	left: "text-left",
	center: "text-center",
	right: "text-right",
};

export function DataTable<T>({
	columns,
	rows,
	keyOf,
	selected,
	onToggle,
	onToggleAll,
	bulkBar,
	toolbar,
	footer,
	rowActions,
	emptyState,
}: DataTableProps<T>) {
	const allSelected =
		rows.length > 0 && rows.every((row) => selected.has(keyOf(row)));
	const someSelected =
		rows.length > 0 &&
		rows.some((row) => selected.has(keyOf(row))) &&
		!allSelected;
	const actionColCount = rowActions ? 1 : 0;
	const colSpan = columns.length + 1 + actionColCount;

	return (
		<div>
			{toolbar ? (
				<div className="flex flex-wrap items-center gap-2.5 border-rule border-b px-3.5 py-3">
					{toolbar}
				</div>
			) : null}
			{bulkBar ? (
				<div className="flex items-center gap-3 border-brand-line border-b bg-brand-soft px-3.5 py-2.5 text-[13px] text-ink">
					{bulkBar}
				</div>
			) : null}
			<div className="overflow-x-auto">
				<table className="w-full border-collapse">
					<thead>
						<tr>
							<th className="w-[44px] py-0 pr-0 pl-3.5" scope="col">
								{onToggleAll ? (
									<Checkbox
										checked={
											allSelected
												? true
												: someSelected
													? "indeterminate"
													: false
										}
										onCheckedChange={onToggleAll}
										aria-label="Select all rows"
									/>
								) : null}
							</th>
							{columns.map((col) => (
								<th
									key={col.key}
									scope="col"
									className={cn(
										"h-[38px] px-3.5 font-medium text-[11px] tracking-[0.08em] whitespace-nowrap text-ink-3 uppercase",
										alignClass[col.align ?? "left"],
									)}
								>
									{col.header}
								</th>
							))}
							{rowActions ? <th scope="col" aria-label="Row actions" /> : null}
						</tr>
					</thead>
					<tbody>
						{rows.length === 0 && emptyState ? (
							<tr>
								<td colSpan={colSpan}>{emptyState}</td>
							</tr>
						) : (
							rows.map((row) => {
								const id = keyOf(row);
								const isSelected = selected.has(id);
								return (
									<tr
										key={id}
										aria-selected={isSelected}
										className={cn(
											"group border-rule border-b transition-colors last:border-b-0 hover:bg-paper-2",
											isSelected && "bg-brand-soft hover:bg-brand-soft",
										)}
									>
										<td className="w-[44px] py-3 pr-0 pl-3.5">
											<Checkbox
												checked={isSelected}
												onCheckedChange={() => onToggle(id)}
												aria-label={`Select row ${id}`}
											/>
										</td>
										{columns.map((col) => (
											<td
												key={col.key}
												className={cn(
													"px-3.5 py-3 align-middle",
													alignClass[col.align ?? "left"],
												)}
											>
												{col.render(row)}
											</td>
										))}
										{rowActions ? (
											<td className="px-3.5 py-3 text-right align-middle whitespace-nowrap">
												<span className="inline-flex gap-0.5 opacity-40 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-within:opacity-100">
													{rowActions(row)}
												</span>
											</td>
										) : null}
									</tr>
								);
							})
						)}
					</tbody>
				</table>
			</div>
			{footer ? (
				<div className="flex items-center justify-between gap-3 border-rule border-t px-4 py-3 text-xs text-ink-3">
					{footer}
				</div>
			) : null}
		</div>
	);
}
