import { useMemo, useState } from "react";
import { invoiceTotal } from "../calculate";
import { formatMoney } from "../format";
import type { InvoiceLineItem, InvoiceRecord, InvoiceStatus } from "../types";

type Props = {
	invoice: InvoiceRecord;
	mode: "edit" | "details";
	onClose: () => void;
	onSave: (invoice: InvoiceRecord) => void;
};

export function InvoiceSheet({ invoice, mode, onClose, onSave }: Props) {
	const [draft, setDraft] = useState<InvoiceRecord>(invoice);
	const isReadOnly = mode === "details";

	const total = useMemo(() => invoiceTotal(draft), [draft]);

	const updateLineItem = (
		itemId: string,
		updater: (item: InvoiceLineItem) => InvoiceLineItem,
	) => {
		setDraft((prev) => ({
			...prev,
			lineItems: prev.lineItems.map((item) =>
				item.id === itemId ? updater(item) : item,
			),
		}));
	};

	const updateStatus = (status: InvoiceStatus) => {
		setDraft((prev) => ({ ...prev, status }));
	};

	return (
		<div className="fixed inset-0 z-50 flex justify-end bg-black/50">
			<aside className="h-full w-full max-w-2xl overflow-y-auto border-l border-slate-800 bg-slate-950 p-6">
				<div className="mb-6 flex items-center justify-between">
					<h3 className="text-lg font-semibold">
						{mode === "edit" ? "Edit Invoice" : "Invoice Details"}
					</h3>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800"
					>
						Close
					</button>
				</div>

				<div className="space-y-4">
					<label className="block space-y-1">
						<span className="text-sm text-slate-400">Invoice Number</span>
						<input
							value={draft.invoiceNumber}
							disabled={isReadOnly}
							onChange={(event) =>
								setDraft((prev) => ({
									...prev,
									invoiceNumber: event.target.value,
								}))
							}
							className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2"
						/>
					</label>

					<label className="block space-y-1">
						<span className="text-sm text-slate-400">Customer</span>
						<input
							value={draft.customerName}
							disabled={isReadOnly}
							onChange={(event) =>
								setDraft((prev) => ({
									...prev,
									customerName: event.target.value,
								}))
							}
							className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2"
						/>
					</label>

					<div className="grid grid-cols-1 gap-4 md:grid-cols-3">
						<label className="block space-y-1">
							<span className="text-sm text-slate-400">Issue Date</span>
							<input
								type="date"
								value={draft.issueDate}
								disabled={isReadOnly}
								onChange={(event) =>
									setDraft((prev) => ({
										...prev,
										issueDate: event.target.value,
									}))
								}
								className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2"
							/>
						</label>

						<label className="block space-y-1">
							<span className="text-sm text-slate-400">Due Date</span>
							<input
								type="date"
								value={draft.dueDate}
								disabled={isReadOnly}
								onChange={(event) =>
									setDraft((prev) => ({ ...prev, dueDate: event.target.value }))
								}
								className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2"
							/>
						</label>

						<label className="block space-y-1">
							<span className="text-sm text-slate-400">Status</span>
							<select
								value={draft.status}
								disabled={isReadOnly}
								onChange={(event) =>
									updateStatus(event.target.value as InvoiceStatus)
								}
								className="w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2"
							>
								<option value="draft">draft</option>
								<option value="unpaid">unpaid</option>
								<option value="partially-paid">partially paid</option>
								<option value="paid">paid</option>
								<option value="overdue">overdue</option>
							</select>
						</label>
					</div>

					<div className="space-y-2">
						<p className="text-sm text-slate-400">Line Items</p>
						{draft.lineItems.map((item) => (
							<div
								key={item.id}
								className="grid grid-cols-1 gap-2 rounded-md border border-slate-800 p-3 md:grid-cols-6"
							>
								<input
									value={item.name}
									disabled={isReadOnly}
									onChange={(event) =>
										updateLineItem(item.id, (line) => ({
											...line,
											name: event.target.value,
										}))
									}
									className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 md:col-span-3"
									placeholder="Item name"
								/>
								<input
									type="number"
									min={0}
									value={item.quantity}
									disabled={isReadOnly}
									onChange={(event) =>
										updateLineItem(item.id, (line) => ({
											...line,
											quantity: Number(event.target.value || 0),
										}))
									}
									className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
									placeholder="Qty"
								/>
								<input
									type="number"
									min={0}
									value={item.price}
									disabled={isReadOnly}
									onChange={(event) =>
										updateLineItem(item.id, (line) => ({
											...line,
											price: Number(event.target.value || 0),
										}))
									}
									className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
									placeholder="Price"
								/>
								<div className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm text-slate-300">
									{formatMoney(item.quantity * item.price, draft.currency)}
								</div>
							</div>
						))}
					</div>

					<label className="block space-y-1">
						<span className="text-sm text-slate-400">Notes</span>
						<textarea
							value={draft.notes ?? ""}
							disabled={isReadOnly}
							onChange={(event) =>
								setDraft((prev) => ({ ...prev, notes: event.target.value }))
							}
							className="min-h-20 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2"
						/>
					</label>
				</div>

				<div className="mt-6 flex items-center justify-between border-t border-slate-800 pt-4">
					<div className="text-sm text-slate-400">
						Total:{" "}
						<span className="font-medium text-slate-100">
							{formatMoney(total, draft.currency)}
						</span>
					</div>
					{!isReadOnly && (
						<button
							type="button"
							onClick={() => onSave(draft)}
							className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium hover:bg-cyan-500"
						>
							Save invoice
						</button>
					)}
				</div>
			</aside>
		</div>
	);
}
