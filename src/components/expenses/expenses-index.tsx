import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pencil, Plus, ReceiptText, Undo2 } from "lucide-react";
import { useState } from "react";
import { DatePicker } from "#/components/navigation/DatePicker";
import { EmptyState } from "#/components/redesign/empty-state";
import { FormField } from "#/components/redesign/form-field";
import { Kpi, KpiStrip } from "#/components/redesign/kpi-strip";
import { Panel } from "#/components/redesign/panel";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { PanelLoader } from "#/components/ui/panel-loader";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Spinner } from "#/components/ui/spinner";
import { Textarea } from "#/components/ui/textarea";
import { toast } from "#/components/ui/use-toast";
import { formatInvoiceDate, formatMoney } from "#/features/invoices/format";
import { useUnifiedAuth } from "#/lib/auth-hook";
import { useSupabaseSession } from "#/lib/supabase-session";
import {
	createExpense,
	type ExpenseInput,
	type ExpenseRecord,
	getExpenseTotals,
	listExpenseCategories,
	listExpenses,
	updateExpense,
	voidExpense,
} from "#/server/data/expenses";

/**
 * WP-C — expense log UI. Log and categorise only; no ledger surface.
 * Totals come from the same money helper the data layer uses.
 */

type FormState = {
	amount: string;
	categoryCode: string;
	incurredOn: string;
	note: string;
};

const emptyForm = (): FormState => ({
	amount: "",
	categoryCode: "",
	incurredOn: new Date().toISOString().slice(0, 10),
	note: "",
});

function csvCell(value: string | number | null) {
	const text = value === null ? "" : String(value);
	return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildExpenseCsv(
	rows: ExpenseRecord[],
	categoryName: Map<string, string>,
) {
	const header = ["date", "category", "amount", "currency", "note"];
	const lines = rows.map((row) =>
		[
			row.incurredOn,
			categoryName.get(row.categoryCode) ?? row.categoryCode,
			row.amount,
			row.currency,
			row.note ?? "",
		]
			.map(csvCell)
			.join(","),
	);
	return [header.join(","), ...lines].join("\n");
}

export function ExpensesIndex() {
	const authState = useUnifiedAuth();
	const userId = authState.data?.user?.id;
	const { client: supabaseClient } = useSupabaseSession(userId);
	const queryClient = useQueryClient();
	const canRead = Boolean(supabaseClient && userId);

	const [form, setForm] = useState<FormState>(emptyForm);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const categoriesQuery = useQuery({
		queryKey: ["expense-categories"],
		queryFn: () => {
			if (!supabaseClient) throw new Error("Supabase session unavailable.");
			return listExpenseCategories(supabaseClient);
		},
		enabled: canRead,
		staleTime: 5 * 60_000,
	});

	const expensesQuery = useQuery({
		queryKey: ["expenses", userId ?? "none"],
		queryFn: () => {
			if (!supabaseClient || !userId)
				throw new Error("Supabase session unavailable.");
			return listExpenses(supabaseClient, userId);
		},
		enabled: canRead,
	});

	const totalsQuery = useQuery({
		queryKey: ["expense-totals", userId ?? "none"],
		queryFn: () => {
			if (!supabaseClient || !userId)
				throw new Error("Supabase session unavailable.");
			return getExpenseTotals(supabaseClient, userId);
		},
		enabled: canRead,
	});

	const categories = categoriesQuery.data ?? [];
	const expenses = expensesQuery.data ?? [];
	const totals = totalsQuery.data ?? null;
	const categoryName = new Map(
		categories.map((entry) => [entry.code, entry.name]),
	);

	const refresh = async () => {
		await queryClient.invalidateQueries({ queryKey: ["expenses"] });
		await queryClient.invalidateQueries({ queryKey: ["expense-totals"] });
	};

	const onSubmit = async () => {
		if (!supabaseClient || !userId) return;
		const input: ExpenseInput = {
			amount: Number(form.amount),
			categoryCode: form.categoryCode,
			incurredOn: form.incurredOn,
			note: form.note.trim() ? form.note.trim() : undefined,
		};
		setBusy(true);
		try {
			if (editingId) {
				await updateExpense(supabaseClient, userId, editingId, input);
				toast({ title: "Expense updated", variant: "success" });
			} else {
				await createExpense(supabaseClient, userId, input);
				toast({ title: "Expense logged", variant: "success" });
			}
			setForm(emptyForm());
			setEditingId(null);
			await refresh();
		} catch (error) {
			toast({
				title: editingId ? "Could not update expense" : "Could not log expense",
				description: error instanceof Error ? error.message : "Unknown error",
				variant: "error",
			});
		} finally {
			setBusy(false);
		}
	};

	const onEdit = (row: ExpenseRecord) => {
		setEditingId(row.id);
		setForm({
			amount: String(row.amount),
			categoryCode: row.categoryCode,
			incurredOn: row.incurredOn,
			note: row.note ?? "",
		});
	};

	const onVoid = async (row: ExpenseRecord) => {
		if (!supabaseClient || !userId) return;
		setBusy(true);
		try {
			await voidExpense(supabaseClient, userId, row.id);
			toast({ title: "Expense voided", variant: "success" });
			if (editingId === row.id) {
				setEditingId(null);
				setForm(emptyForm());
			}
			await refresh();
		} catch (error) {
			toast({
				title: "Could not void expense",
				description: error instanceof Error ? error.message : "Unknown error",
				variant: "error",
			});
		} finally {
			setBusy(false);
		}
	};

	const onExport = () => {
		if (expenses.length === 0) return;
		const csv = buildExpenseCsv(expenses, categoryName);
		const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `expenses-${new Date().toISOString().slice(0, 10)}.csv`;
		link.click();
		URL.revokeObjectURL(url);
	};

	const currency = totals?.currency ?? "NGN";
	const thisMonth = new Date().toISOString().slice(0, 7);
	const monthTotal =
		totals?.byMonth.find((entry) => entry.month === thisMonth)?.total ?? 0;

	if (!canRead) return null;
	if (expensesQuery.isPending && categoriesQuery.isPending) {
		return <PanelLoader label="Loading expenses" />;
	}

	return (
		<div className="mx-auto flex h-full w-full max-w-7xl flex-col gap-6">
			<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
				<div>
					<h1 className="text-3xl font-semibold tracking-[-0.02em] text-ink">
						Expenses
					</h1>
					<p className="mt-2 text-sm text-ink-3">
						Log and categorise business expenses. This is a spending record, not
						a ledger.
					</p>
				</div>
				<Button
					variant="outline"
					className="h-10 rounded-md px-4 text-sm"
					onClick={onExport}
					disabled={expenses.length === 0}
				>
					<Download className="mr-2 h-4 w-4" />
					Export CSV
				</Button>
			</div>

			<KpiStrip>
				<Kpi
					label="Total logged"
					value={formatMoney(totals?.total ?? 0, currency)}
					sub={`${totals?.count ?? 0} expenses`}
					tone="brand"
				/>
				<Kpi
					label="This month"
					value={formatMoney(monthTotal, currency)}
					tone="info"
				/>
				<Kpi
					label="Categories used"
					value={String(totals?.byCategory.length ?? 0)}
					tone="mute"
				/>
			</KpiStrip>

			<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
				<Panel
					title="Expense log"
					sub={`${expenses.length} active ${expenses.length === 1 ? "entry" : "entries"}`}
				>
					{expensesQuery.isPending ? (
						<PanelLoader label="Loading expense log" />
					) : expenses.length === 0 ? (
						<EmptyState
							icon={<ReceiptText />}
							title="No expenses yet"
							copy="Log your first expense with the form beside this list."
							dashed
						/>
					) : (
						<ul className="divide-y divide-rule/60" aria-label="Expenses">
							{expenses.map((row) => (
								<li
									key={row.id}
									className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
								>
									<div className="min-w-0">
										<p className="truncate text-sm font-medium text-ink">
											{categoryName.get(row.categoryCode) ?? row.categoryCode}
										</p>
										<p className="mt-0.5 truncate text-xs text-ink-3">
											{formatInvoiceDate(row.incurredOn)}
											{row.note ? ` · ${row.note}` : ""}
										</p>
									</div>
									<div className="flex flex-none items-center gap-2">
										<span className="font-num text-sm tabular-nums text-ink">
											{formatMoney(row.amount, row.currency)}
										</span>
										<Button
											variant="ghost"
											size="icon"
											aria-label={`Edit ${categoryName.get(row.categoryCode) ?? row.categoryCode} expense`}
											onClick={() => onEdit(row)}
										>
											<Pencil className="h-4 w-4" />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											aria-label={`Void ${categoryName.get(row.categoryCode) ?? row.categoryCode} expense`}
											onClick={() => void onVoid(row)}
										>
											<Undo2 className="h-4 w-4" />
										</Button>
									</div>
								</li>
							))}
						</ul>
					)}
				</Panel>

				<Panel
					title={editingId ? "Edit expense" : "Log an expense"}
					sub={editingId ? "Changes apply to the selected entry." : undefined}
				>
					<form
						className="flex flex-col gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							void onSubmit();
						}}
					>
						<FormField label="Amount">
							<Input
								type="number"
								inputMode="decimal"
								step="0.01"
								min="0.01"
								required
								value={form.amount}
								onChange={(event) =>
									setForm((prev) => ({ ...prev, amount: event.target.value }))
								}
								placeholder="0.00"
							/>
						</FormField>
						<FormField label="Category">
							<Select
								value={form.categoryCode}
								onValueChange={(value) =>
									setForm((prev) => ({ ...prev, categoryCode: value }))
								}
							>
								<SelectTrigger aria-label="Expense category">
									<SelectValue placeholder="Select a category" />
								</SelectTrigger>
								<SelectContent>
									{categories.map((entry) => (
										<SelectItem key={entry.code} value={entry.code}>
											{entry.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</FormField>
						<DatePicker
							label="Date"
							value={form.incurredOn}
							onChange={(value) =>
								setForm((prev) => ({ ...prev, incurredOn: value }))
							}
						/>
						<FormField label="Note" hint="Optional">
							<Textarea
								value={form.note}
								onChange={(event) =>
									setForm((prev) => ({ ...prev, note: event.target.value }))
								}
								placeholder="What was this for?"
								rows={3}
							/>
						</FormField>
						<div className="flex items-center gap-2">
							<Button
								type="submit"
								className="h-10 rounded-md bg-brand px-4 text-sm font-medium text-brand-ink hover:bg-brand-hi"
								disabled={
									busy || form.amount.trim() === "" || !form.categoryCode
								}
							>
								{editingId ? (
									"Save changes"
								) : (
									<>
										<Plus className="mr-2 h-4 w-4" />
										Log expense
									</>
								)}
							</Button>
							{editingId ? (
								<Button
									type="button"
									variant="ghost"
									className="h-10 rounded-md px-4 text-sm"
									onClick={() => {
										setEditingId(null);
										setForm(emptyForm());
									}}
								>
									Cancel
								</Button>
							) : null}
							{busy ? <Spinner /> : null}
						</div>
					</form>
				</Panel>
			</div>
		</div>
	);
}
