import { createLazyFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
	CheckCircle2,
	ChevronRight,
	Copy,
	Eye,
	FileEdit,
	MoreHorizontal,
	Repeat2,
	Search,
	SlidersHorizontal,
	Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { Skeleton } from "#/components/ui/skeleton";
import { toast } from "#/components/ui/use-toast";
import { CreateInvoiceSheet } from "#/features/invoices/components/create-invoice-sheet";
import { InvoiceDetailsSheet } from "#/features/invoices/components/invoice-details-sheet";
import { formatMoney } from "#/features/invoices/format";
import type { InvoiceRecord, InvoiceStatus } from "#/features/invoices/types";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export const Route = createLazyFileRoute("/invoices/")({
	component: InvoicesIndex,
});

type InvoiceTypeFilter = "all" | "one-time" | "recurring";

type InvoiceRow = InvoiceRecord & {
	amount: number;
};

const STATUS_OPTIONS: InvoiceStatus[] = [
	"draft",
	"unpaid",
	"paid",
	"overdue",
	"canceled",
	"scheduled",
];

function InvoicesIndex() {
	const saveInvoice = useMutation(api.invoices.save);
	const duplicateInvoice = useMutation(api.invoices.duplicate);
	const removeInvoice = useMutation(api.invoices.remove);
	const updateStatus = useMutation(api.invoices.updateStatus);

	const summary = useQuery(api.invoices.summary, {});

	const [activeInvoiceId, setActiveInvoiceId] = useState<Id<"invoices"> | null>(
		null,
	)
	const [createOpen, setCreateOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [statusFilter, setStatusFilter] = useState<"all" | InvoiceStatus>(
		"all",
	)
	const [typeFilter, setTypeFilter] = useState<InvoiceTypeFilter>("all");
	const [customerFilter, setCustomerFilter] = useState("");
	const [dueDateFrom, setDueDateFrom] = useState("");
	const [dueDateTo, setDueDateTo] = useState("");

	const invoicesQuery = useQuery(api.invoices.list, {
		q: query,
		status: statusFilter,
		type: typeFilter,
		customer: customerFilter || undefined,
		dueDateFrom: dueDateFrom || undefined,
		dueDateTo: dueDateTo || undefined,
	})

	const invoices = (invoicesQuery ?? []) as InvoiceRecord[];
	const isInvoicesLoading = invoicesQuery === undefined;

	const activeInvoice = useQuery(
		api.invoices.getById,
		activeInvoiceId ? { id: activeInvoiceId } : "skip",
	)

	const rows: InvoiceRow[] = useMemo(
		() =>
			invoices.map((invoice: InvoiceRecord) => ({
				...invoice,
				amount: invoice.lineItems.reduce(
					(sum, item) => sum + item.quantity * item.price,
					0,
				),
			})),
		[invoices],
	)

	const customers = useMemo(() => {
		const names = invoices.map((invoice) => invoice.customerName.trim());
		return Array.from(new Set(names)).filter((customer) => customer.length > 0);
	}, [invoices]);

	const duePreset = (preset: "this-month" | "next-month" | "clear") => {
		if (preset === "clear") {
			setDueDateFrom("");
			setDueDateTo("");
			return
		}

		const now = new Date();
		if (preset === "this-month") {
			setDueDateFrom(
				new Date(now.getFullYear(), now.getMonth(), 1)
					.toISOString()
					.slice(0, 10),
			)
			setDueDateTo(
				new Date(now.getFullYear(), now.getMonth() + 1, 0)
					.toISOString()
					.slice(0, 10),
			)
			return
		}

		setDueDateFrom(
			new Date(now.getFullYear(), now.getMonth() + 1, 1)
				.toISOString()
				.slice(0, 10),
		)
		setDueDateTo(
			new Date(now.getFullYear(), now.getMonth() + 2, 0)
				.toISOString()
				.slice(0, 10),
		)
	}

	const copyPublicLink = async (token: string) => {
		try {
			await navigator.clipboard.writeText(
				`${window.location.origin}/i/${token}`,
			)
			toast({
				title: "Invoice link copied",
				description: "Public preview URL copied to clipboard.",
				variant: "success",
			})
		} catch {
			toast({
				title: "Could not copy link",
				description: "Clipboard permission denied.",
				variant: "error",
			})
		}
	}

	const onDuplicate = async (id: string) => {
		await duplicateInvoice({ id });
		toast({ title: "Invoice duplicated", variant: "success" });
	}

	const onDelete = async (id: string) => {
		if (!window.confirm("Delete this invoice?")) return;
		await removeInvoice({ id });
		toast({ title: "Invoice deleted", variant: "success" });
	}

	const onStatusChange = async (id: string, status: InvoiceStatus) => {
		await updateStatus({ id, status });
		toast({
			title: "Status updated",
			description: `Marked as ${status}.`,
			variant: "success",
		})
	}

	return (
		<div className="flex h-full w-full flex-col p-4 md:p-6">
			<div className="mb-4 grid gap-3 md:grid-cols-3">
				<MetricCard
					title="Open"
					value={formatMoney(summary?.open ?? 0, "USD")}
					subtitle={`${rows.filter((invoice) => invoice.status === "draft" || invoice.status === "unpaid").length} invoice`}
				/>
				<MetricCard
					title="Overdue"
					value={formatMoney(summary?.overdue ?? 0, "USD")}
					subtitle={`${rows.filter((invoice) => invoice.status === "overdue").length} invoice`}
				/>
				<MetricCard
					title="Paid"
					value={formatMoney(summary?.paid ?? 0, "USD")}
					subtitle={`${rows.filter((invoice) => invoice.status === "paid").length} invoice`}
				/>
			</div>

			<div className="mb-4 flex items-center justify-between gap-2">
				<div className="flex h-9 w-full max-w-[360px] items-center gap-2 border border-[#1A1D22] bg-[#0D1118] px-2.5">
					<Search className="h-3.5 w-3.5 text-[#6D7583]" />
					<input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search invoices..."
						className="h-full w-full bg-transparent text-sm text-[#D6DBE3] outline-none placeholder:text-[#5E6673]"
					/>
				</div>

				<div className="flex items-center gap-2">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								className="h-9 w-9 border border-[#1A1D22] bg-[#0D1118] p-0 text-[#8D94A1] hover:bg-[#141B25]"
							>
								<SlidersHorizontal className="h-3.5 w-3.5" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							align="end"
							className="min-w-[220px] border-[#1A1D22] bg-[#0A0D12] p-1 text-[#EDF0F4]"
						>
							<DropdownMenuSub>
								<DropdownMenuSubTrigger className="text-xs focus:bg-[#18240E] data-[state=open]:bg-[#18240E] focus:text-[#DFFF62] data-[state=open]:text-[#DFFF62]">
									Due date
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent className="min-w-[180px] border-[#1A1D22] bg-[#0A0D12] p-1 text-[#EDF0F4]">
									<DropdownMenuItem
										onClick={() => duePreset("this-month")}
										className="text-xs focus:bg-[#18240E] focus:text-[#DFFF62]"
									>
										This month
									</DropdownMenuItem>
									<DropdownMenuItem
										onClick={() => duePreset("next-month")}
										className="text-xs focus:bg-[#18240E] focus:text-[#DFFF62]"
									>
										Next month
									</DropdownMenuItem>
									<DropdownMenuItem
										onClick={() => duePreset("clear")}
										className="text-xs focus:bg-[#18240E] focus:text-[#DFFF62]"
									>
										Clear
									</DropdownMenuItem>
								</DropdownMenuSubContent>
							</DropdownMenuSub>

							<DropdownMenuSub>
								<DropdownMenuSubTrigger className="text-xs focus:bg-[#18240E] data-[state=open]:bg-[#18240E] focus:text-[#DFFF62] data-[state=open]:text-[#DFFF62]">
									Customer
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent className="max-h-64 min-w-[220px] overflow-y-auto border-[#1A1D22] bg-[#0A0D12] p-1 text-[#EDF0F4]">
									<DropdownMenuItem
										onClick={() => setCustomerFilter("")}
										className="text-xs focus:bg-[#18240E] focus:text-[#DFFF62]"
									>
										All customers
									</DropdownMenuItem>
									{customers.map((customer) => (
										<DropdownMenuItem
											key={customer}
											onClick={() => setCustomerFilter(customer)}
											className="text-xs focus:bg-[#18240E] focus:text-[#DFFF62]"
										>
											{customer}
										</DropdownMenuItem>
									))}
								</DropdownMenuSubContent>
							</DropdownMenuSub>

							<DropdownMenuSub>
								<DropdownMenuSubTrigger className="text-xs focus:bg-[#18240E] data-[state=open]:bg-[#18240E] focus:text-[#DFFF62] data-[state=open]:text-[#DFFF62]">
									Status
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent className="min-w-[180px] border-[#1A1D22] bg-[#0A0D12] p-1 text-[#EDF0F4]">
									<DropdownMenuItem
										onClick={() => setStatusFilter("all")}
										className="text-xs focus:bg-[#18240E] focus:text-[#DFFF62]"
									>
										All
									</DropdownMenuItem>
									{STATUS_OPTIONS.map((status) => (
										<DropdownMenuItem
											key={status}
											onClick={() => setStatusFilter(status)}
											className="text-xs capitalize focus:bg-[#18240E] focus:text-[#DFFF62]"
										>
											{status}
										</DropdownMenuItem>
									))}
								</DropdownMenuSubContent>
							</DropdownMenuSub>

							<DropdownMenuSub>
								<DropdownMenuSubTrigger className="text-xs focus:bg-[#18240E] data-[state=open]:bg-[#18240E] focus:text-[#DFFF62] data-[state=open]:text-[#DFFF62]">
									Type
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent className="min-w-[180px] border-[#1A1D22] bg-[#0A0D12] p-1 text-[#EDF0F4]">
									<DropdownMenuItem
										onClick={() => setTypeFilter("all")}
										className="text-xs focus:bg-[#18240E] focus:text-[#DFFF62]"
									>
										All
									</DropdownMenuItem>
									<DropdownMenuItem
										onClick={() => setTypeFilter("one-time")}
										className="text-xs focus:bg-[#18240E] focus:text-[#DFFF62]"
									>
										One-time
									</DropdownMenuItem>
									<DropdownMenuItem
										onClick={() => setTypeFilter("recurring")}
										className="text-xs focus:bg-[#18240E] focus:text-[#DFFF62]"
									>
										Recurring
									</DropdownMenuItem>
								</DropdownMenuSubContent>
							</DropdownMenuSub>
						</DropdownMenuContent>
					</DropdownMenu>

					<Button
						type="button"
						onClick={() => setCreateOpen(true)}
						className="h-9 rounded-none border border-[#2A351A] bg-[#C8FF1A]/30 px-4 text-[11px] font-bold uppercase tracking-[0.1em] text-[#DFFF62] hover:bg-[#C8FF1A]/45"
					>
						+
					</Button>
				</div>
			</div>

			<div className="relative min-h-0 flex-1 overflow-auto border border-[#1A1D22] bg-[#070B11]">
				<div className="grid grid-cols-[150px_110px_130px_180px_130px_130px_110px] border-b border-[#1A1D22] px-4 py-3 text-[11px] uppercase tracking-[0.08em] text-[#747E8C]">
					<div>Invoice no.</div>
					<div>Status</div>
					<div>Due date</div>
					<div>Customer</div>
					<div>Amount</div>
					<div>Issue date</div>
					<div className="text-right">Actions</div>
				</div>

				<div>
					{isInvoicesLoading
						? ["row-1", "row-2", "row-3", "row-4", "row-5"].map((rowKey) => (
								<div
									key={rowKey}
									className="grid grid-cols-[150px_110px_130px_180px_130px_130px_110px] items-center border-b border-[#1A1D22] px-4 py-3"
								>
									{["c1", "c2", "c3", "c4", "c5", "c6", "c7"].map((cellKey) => (
										<Skeleton
											key={"${rowKey}-${cellKey}"}
											className="h-5 w-20 rounded-none bg-[#151B25]"
										/>
									))}
								</div>
							))
						: rows.map((invoice) => (
								<div
									key={invoice.id}
									className="grid grid-cols-[150px_110px_130px_180px_130px_130px_110px] items-center border-b border-[#1A1D22] px-4 py-2.5 text-sm hover:bg-[#101620]"
								>
									<div className="truncate text-[#E7EBF1]">
										{invoice.invoiceNumber}
									</div>
									<StatusChip status={invoice.status} />
									<div className="text-[#C9CED6]">
										{formatDate(invoice.dueDate)}
									</div>
									<div className="truncate text-[#E7EBF1]">
										{invoice.customerName || "-"}
									</div>
									<div className="font-mono text-[#E7EBF1]">
										{formatMoney(invoice.amount, invoice.currency)}
									</div>
									<div className="text-[#9DA5B2]">
										{formatDate(invoice.issueDate)}
									</div>
									<div className="ml-auto">
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<Button
													type="button"
													variant="ghost"
													className="h-7 w-7 rounded-none border border-[#1A1D22] bg-[#0D1118] p-0"
												>
													<MoreHorizontal className="h-3.5 w-3.5 text-[#E7EBF1]" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent
												align="end"
												className="min-w-[188px] rounded-none border-[#1A1D22] bg-[#0A0D12] p-1 text-[#EDF0F4]"
											>
												<DropdownMenuItem
													onClick={() =>
														setActiveInvoiceId(invoice.id as Id<"invoices">)
													}
													className="text-xs focus:bg-[#18240E] focus:text-[#DFFF62]"
												>
													<FileEdit className="mr-2 h-3.5 w-3.5" /> Edit invoice
												</DropdownMenuItem>
												<DropdownMenuItem
													asChild
													className="text-xs focus:bg-[#18240E] focus:text-[#DFFF62]"
												>
													<a
														href={"/i/${invoice.token}"}
														target="_blank"
														rel="noreferrer"
													>
														<Eye className="mr-2 h-3.5 w-3.5" /> Open invoice
													</a>
												</DropdownMenuItem>
												<DropdownMenuItem
													asChild
													className="text-xs focus:bg-[#18240E] focus:text-[#DFFF62]"
												>
													<a
														href={"/i/${invoice.token}"}
														target="_blank"
														rel="noreferrer"
													>
														<Eye className="mr-2 h-3.5 w-3.5" /> Preview invoice
													</a>
												</DropdownMenuItem>
												<DropdownMenuItem
													onClick={() => void copyPublicLink(invoice.token)}
													className="text-xs focus:bg-[#18240E] focus:text-[#DFFF62]"
												>
													<Copy className="mr-2 h-3.5 w-3.5" /> Copy link
												</DropdownMenuItem>
												<DropdownMenuItem
													onClick={() => void onDuplicate(invoice.id)}
													className="text-xs focus:bg-[#18240E] focus:text-[#DFFF62]"
												>
													<Repeat2 className="mr-2 h-3.5 w-3.5" /> Duplicate
												</DropdownMenuItem>
												<DropdownMenuSub>
													<DropdownMenuSubTrigger className="text-xs focus:bg-[#18240E] data-[state=open]:bg-[#18240E] focus:text-[#DFFF62] data-[state=open]:text-[#DFFF62]">
														<CheckCircle2 className="mr-2 h-3.5 w-3.5" /> Update
														status
													</DropdownMenuSubTrigger>
													<DropdownMenuSubContent className="min-w-[150px] border-[#1A1D22] bg-[#0A0D12] p-1 text-[#EDF0F4]">
														{STATUS_OPTIONS.map((status) => (
															<DropdownMenuItem
																key={status}
																onClick={() =>
																	void onStatusChange(invoice.id, status)
																}
																className="text-xs capitalize focus:bg-[#18240E] focus:text-[#DFFF62]"
															>
																{status}
															</DropdownMenuItem>
														))}
													</DropdownMenuSubContent>
												</DropdownMenuSub>
												<DropdownMenuItem
													onClick={() => void onDelete(invoice.id)}
													className="text-xs text-[#FF9CAB]"
												>
													<Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
								</div>
							))}

					{!isInvoicesLoading && rows.length === 0 ? (
						<div className="px-4 py-10 text-sm text-[#8A93A2]">
							No invoices yet.
						</div>
					) : null}
				</div>

				{(statusFilter !== "all" ||
					typeFilter !== "all" ||
					customerFilter ||
					dueDateFrom ||
					dueDateTo) && (
					<div className="absolute bottom-3 right-3 flex items-center gap-2 border border-[#1A1D22] bg-[#0D1118] px-2 py-1 text-[11px] text-[#96A0AF]">
						<span>Filters active</span>
						<ChevronRight className="h-3 w-3" />
						<button
							type="button"
							onClick={() => {
								setStatusFilter("all")
								setTypeFilter("all")
								setCustomerFilter("")
								setDueDateFrom("")
								setDueDateTo("")
							}}
							className="text-[#C8FF1A]"
						>
							Reset
						</button>
					</div>
				)}
			</div>

			<InvoiceDetailsSheet
				open={activeInvoiceId !== null}
				onOpenChange={(open) => {
					if (!open) setActiveInvoiceId(null);
				}}
				invoice={activeInvoice}
				onSave={async (invoice) => {
					await saveInvoice({
						...invoice,
						id: invoice.id as Id<"invoices">,
					})
				}}
				onStatusChange={async (id, status) => {
					await onStatusChange(id, status);
				}}
			/>

			<CreateInvoiceSheet
				open={createOpen}
				onOpenChange={setCreateOpen}
				onCreated={(id) => {
					setActiveInvoiceId(id);
				}}
			/>
		</div>
	)
}

function MetricCard({
	title,
	value,
	subtitle,
}: {
	title: string;
	value: string;
	subtitle: string;
}) {
	return (
		<div className="border border-[#1A1D22] bg-[#090D14] px-5 py-4">
			<p className="font-serif text-[22px] leading-none text-[#EAEFF5]">
				{value}
			</p>
			<p className="mt-2 text-[14px] leading-none text-[#EAEFF5]">{title}</p>
			<p className="mt-1 text-sm text-[#7D8694]">{subtitle}</p>
		</div>
	)
}

function StatusChip({ status }: { status: InvoiceStatus }) {
	if (status === "paid") {
		return (
			<span className="inline-flex w-fit items-center border border-[#2A351A] bg-[#131C0B] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#C8FF1A]">
				paid
			</span>
		)
	}

	if (status === "unpaid" || status === "overdue") {
		return (
			<span className="inline-flex w-fit items-center border border-[#3A2E1A] bg-[#1B150B] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#F5BA62]">
				{status}
			</span>
		)
	}

	if (status === "scheduled") {
		return (
			<span className="inline-flex w-fit items-center border border-[#1C3A66] bg-[#0A1730] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#85B8FF]">
				scheduled
			</span>
		)
	}

	if (status === "canceled") {
		return (
			<span className="inline-flex w-fit items-center border border-[#4D2430] bg-[#251116] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#FFA8B5]">
				canceled
			</span>
		)
	}

	return (
		<span className="inline-flex w-fit items-center border border-[#2B3038] bg-[#171A20] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9AA2AF]">
			draft
		</span>
	)
}

function formatDate(value: string) {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) return value;

	return parsed.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
	})
}
