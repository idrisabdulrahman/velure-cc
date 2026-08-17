import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createLazyFileRoute } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import {
	CalendarDays,
	ChevronLeft,
	ChevronRight,
	CircleAlert,
	Copy,
	Download,
	ExternalLink,
	FileEdit,
	MoreHorizontal,
	ReceiptText,
	Repeat2,
	Search,
	SlidersHorizontal,
	Trash2,
	Upload,
	Wrench,
	XCircle,
} from "lucide-react";
import {
	type ReactNode,
	useEffect,
	useMemo,
	useState,
	useTransition,
} from "react";
import {
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { Button } from "#/components/ui/button";
import { Calendar } from "#/components/ui/calendar";
import { Checkbox } from "#/components/ui/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Skeleton } from "#/components/ui/skeleton";
import { toast } from "#/components/ui/use-toast";
import { duplicateInvoiceNumberSet } from "#/features/invoices/cleanup";
import { CreateInvoiceSheet } from "#/features/invoices/components/create-invoice-sheet";
import { InvoiceDetailsSheet } from "#/features/invoices/components/invoice-details-sheet";
import {
	formatCompactMoney,
	formatInvoiceDate,
	formatMoney,
} from "#/features/invoices/format";
import {
	type ImportedInvoiceDraft,
	looksLikeSupplierReceivingGrid,
	parseCsvGrid,
	parseInvoiceCsv,
	parseInvoiceDraftGrid,
} from "#/features/invoices/import-spreadsheet";
import {
	keepVisibleInvoiceSelection,
	setInvoiceSelectionForIds,
} from "#/features/invoices/selection";
import type { InvoiceRecord, InvoiceStatus } from "#/features/invoices/types";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export const Route = createLazyFileRoute("/invoices/")({
	component: InvoicesIndex,
});

type InvoiceTypeFilter = "all" | "one-time" | "recurring";
type DocumentTypeFilter = "all" | "standard" | "proforma";
type DueDateFilter = "all" | "this-month" | "next-month" | "past-due";

type InvoiceRow = InvoiceRecord & {
	amount: number;
};

type RevenueChartPoint = {
	key: string;
	label: string;
	paidRevenue: number;
	paidCount: number;
	unpaidRevenue: number;
	unpaidCount: number;
};

type CurrencySummary = {
	currency: string;
	totalCount: number;
	openAmount: number;
	openCount: number;
	overdueAmount: number;
	overdueCount: number;
	paidAmount: number;
	paidCount: number;
};

type PaymentScore = {
	score: number;
	status: "no_data" | "excellent" | "good" | "fair" | "slow";
	paidInvoiceCount: number;
	onTimeCount: number;
	averageDaysToPay: number | null;
};

type CleanupPreviewItem = {
	id: Id<"invoices">;
	invoiceNumber: string;
	customerName?: string;
	status?: InvoiceStatus;
	action?: "hard-delete" | "archive";
	reason?: string;
};

type CleanupPreview = {
	hardDelete: CleanupPreviewItem[];
	archive: CleanupPreviewItem[];
	blocked: CleanupPreviewItem[];
};

type InvoiceSaveInput = Omit<
	InvoiceRecord,
	"id" | "createdAt" | "updatedAt" | "lifecycle"
> & {
	id: Id<"invoices">;
};

const STATUS_OPTIONS: InvoiceStatus[] = [
	"draft",
	"unpaid",
	"partially-paid",
	"paid",
	"overdue",
	"canceled",
];

const PENDING_STATUSES = new Set<InvoiceStatus>([
	"draft",
	"unpaid",
	"partially-paid",
	"overdue",
]);

const STANDARD_INVOICE_IMPORT_STORAGE_KEY = "velure:pending-standard-invoice";

function toLocalDateInputValue(date: Date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function toInvoiceSaveInput(invoice: InvoiceRecord): InvoiceSaveInput {
	return {
		id: invoice.id as Id<"invoices">,
		token: invoice.token,
		documentType: invoice.documentType,
		convertedToInvoiceId: invoice.convertedToInvoiceId,
		shipmentDetails: invoice.shipmentDetails,
		depositRequest: invoice.depositRequest,
		invoiceNumber: invoice.invoiceNumber,
		customerName: invoice.customerName,
		logoUrl: invoice.logoUrl,
		customerPoNumber: invoice.customerPoNumber,
		currency: invoice.currency,
		type: invoice.type,
		invoiceSize: invoice.invoiceSize,
		dateFormat: invoice.dateFormat,
		paymentTermsDays: invoice.paymentTermsDays,
		template: invoice.template,
		issueDate: invoice.issueDate,
		dueDate: invoice.dueDate,
		status: invoice.status,
		total: invoice.total,
		balance: invoice.balance,
		paymentAmount: invoice.paymentAmount,
		paymentDetails: invoice.paymentDetails,
		paymentLink: invoice.paymentLink,
		paymentProvider: invoice.paymentProvider,
		paidAt: invoice.paidAt,
		paymentReference: invoice.paymentReference,
		deliveredAt: invoice.deliveredAt,
		canceledAt: invoice.canceledAt,
		deletedAt: invoice.deletedAt,
		notes: invoice.notes,
		lineItems: invoice.lineItems,
		compliance: invoice.compliance,
		fiscalization: invoice.fiscalization,
		reminder: invoice.reminder,
		sync: invoice.sync,
	};
}

async function readXlsxInvoiceData(file: File) {
	const XLSX = await import("xlsx");
	const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
	const firstSheetName = workbook.SheetNames[0];
	if (!firstSheetName) return { csv: "", grid: [] as string[][] };
	const sheet = workbook.Sheets[firstSheetName];
	if (!sheet) return { csv: "", grid: [] as string[][] };
	return {
		csv: XLSX.utils.sheet_to_csv(sheet),
		grid: XLSX.utils.sheet_to_json<string[]>(sheet, {
			header: 1,
			raw: false,
			blankrows: false,
			defval: "",
		}),
	};
}

function InvoicesIndex() {
	const saveInvoice = useMutation(api.invoices.save);
	const duplicateInvoice = useMutation(api.invoices.duplicate);
	const convertProformaToInvoice = useMutation(
		api.invoices.convertProformaToInvoice,
	);
	const previewBulkCleanup = useMutation(api.invoices.previewBulkCleanup);
	const bulkDeleteOrArchive = useMutation(api.invoices.bulkDeleteOrArchive);
	const renumberInvoices = useMutation(api.invoices.renumberInvoices);
	const deleteEmptyDrafts = useMutation(api.invoices.deleteEmptyDrafts);
	const updateStatus = useMutation(api.invoices.updateStatus);
	const recordPayment = useMutation(api.payments.recordPayment);
	const importInvoices = useMutation(api.invoices.importCsv);

	const [activeInvoiceId, setActiveInvoiceId] = useState<Id<"invoices"> | null>(
		null,
	);
	const [createOpen, setCreateOpen] = useState(false);
	const [createDocumentType, setCreateDocumentType] = useState<
		"standard" | "proforma"
	>("standard");
	const [importedDraft, setImportedDraft] =
		useState<ImportedInvoiceDraft | null>(null);
	const [query, setQuery] = useState("");
	const [statusFilter, setStatusFilter] = useState<"all" | InvoiceStatus>(
		"all",
	);
	const [typeFilter, setTypeFilter] = useState<InvoiceTypeFilter>("all");
	const [documentTypeFilter, setDocumentTypeFilter] =
		useState<DocumentTypeFilter>("all");
	const [customerFilter, setCustomerFilter] = useState("");
	const [dueDateFilter, setDueDateFilter] = useState<DueDateFilter>("all");
	const [dueDateFrom, setDueDateFrom] = useState("");
	const [dueDateTo, setDueDateTo] = useState("");
	const [, startTransition] = useTransition();
	const [selectedSummaryCurrency, setSelectedSummaryCurrency] = useState<
		string | null
	>(null);
	const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<
		Set<Id<"invoices">>
	>(() => new Set());
	const [cleanupPreview, setCleanupPreview] = useState<CleanupPreview | null>(
		null,
	);
	const [cleanupTargetIds, setCleanupTargetIds] = useState<Id<"invoices">[]>(
		[],
	);
	const [cleanupDialogOpen, setCleanupDialogOpen] = useState(false);
	const [bulkActionPending, setBulkActionPending] = useState(false);

	useEffect(() => {
		const stored = window.sessionStorage.getItem(
			STANDARD_INVOICE_IMPORT_STORAGE_KEY,
		);
		if (!stored) return;

		try {
			setImportedDraft(JSON.parse(stored) as ImportedInvoiceDraft);
			setCreateDocumentType("standard");
			setCreateOpen(true);
			toast({
				title: "Invoice routed here",
				description: "Review the imported invoice before creating it.",
				variant: "success",
			});
		} finally {
			window.sessionStorage.removeItem(STANDARD_INVOICE_IMPORT_STORAGE_KEY);
		}
	}, []);

	const listArgs = useMemo(
		() => ({
			q: query.trim(),
			status: statusFilter,
			type: typeFilter,
			documentType: documentTypeFilter,
			customer: customerFilter.trim() || undefined,
			dueDateFrom: dueDateFrom || undefined,
			dueDateTo: dueDateTo || undefined,
		}),
		[
			customerFilter,
			documentTypeFilter,
			dueDateFrom,
			dueDateTo,
			query,
			statusFilter,
			typeFilter,
		],
	);
	const listSignature = JSON.stringify(listArgs);
	const [pageCursors, setPageCursors] = useState<(string | null)[]>([null]);
	const [pageIndex, setPageIndex] = useState(0);
	const pageCursor = pageCursors[pageIndex] ?? null;
	const pageArgs = useMemo(
		() => ({
			...listArgs,
			cursor: pageCursor,
			pageSize: 50,
		}),
		[listArgs, pageCursor],
	);

	useEffect(() => {
		setPageCursors([null]);
		setPageIndex(0);
	}, [listSignature]);

	const { data: invoicesQuery, isPending: isInvoicesLoading } = useQuery(
		convexQuery(api.invoices.listPage, pageArgs),
	);
	const { data: invoiceSummaryQuery } = useQuery(
		convexQuery(api.invoices.listSummary, listArgs),
	);

	const invoices = (invoicesQuery?.page ?? []) as InvoiceRecord[];
	const currencySummaries = (invoiceSummaryQuery?.currencySummaries ??
		[]) as CurrencySummary[];
	const chartDataByCurrency = (invoiceSummaryQuery?.chartDataByCurrency ??
		{}) as Record<string, RevenueChartPoint[]>;
	const paymentScore = (invoiceSummaryQuery?.paymentScore ?? {
		score: 0,
		status: "no_data",
		paidInvoiceCount: 0,
		onTimeCount: 0,
		averageDaysToPay: null,
	}) as PaymentScore;
	const activeInvoiceEnabled = activeInvoiceId !== null;
	const { data: activeInvoice } = useQuery({
		...convexQuery(api.invoices.getById, {
			id: activeInvoiceId as Id<"invoices">,
		}),
		enabled: activeInvoiceEnabled,
	});

	const rows: InvoiceRow[] = useMemo(
		() =>
			invoices.map((invoice: InvoiceRecord) => {
				const amount = calculateInvoiceAmount(invoice);
				const paymentAmount = safeMoneyValue(invoice.paymentAmount);
				const balance = safeMoneyValue(invoice.balance, amount - paymentAmount);

				return {
					...invoice,
					amount,
					paymentAmount,
					balance,
				};
			}),
		[invoices],
	);

	useEffect(() => {
		const visibleIds = new Set(
			rows.map((invoice) => invoice.id as Id<"invoices">),
		);
		setSelectedInvoiceIds((current) =>
			keepVisibleInvoiceSelection(current, visibleIds),
		);
	}, [rows]);

	const duplicateInvoiceNumbers = useMemo(() => {
		return duplicateInvoiceNumberSet(rows);
	}, [rows]);
	const duplicateRows = useMemo(
		() =>
			rows.filter((invoice) =>
				duplicateInvoiceNumbers.has(invoice.invoiceNumber),
			),
		[duplicateInvoiceNumbers, rows],
	);
	const duplicateRowCount = duplicateRows.length;
	const selectedRows = useMemo(
		() =>
			rows.filter((invoice) =>
				selectedInvoiceIds.has(invoice.id as Id<"invoices">),
			),
		[rows, selectedInvoiceIds],
	);
	const selectedCount = selectedInvoiceIds.size;
	const allVisibleSelected =
		rows.length > 0 &&
		rows.every((invoice) =>
			selectedInvoiceIds.has(invoice.id as Id<"invoices">),
		);
	const someVisibleSelected =
		rows.some((invoice) =>
			selectedInvoiceIds.has(invoice.id as Id<"invoices">),
		) && !allVisibleSelected;

	const customers = useMemo(() => {
		const names = invoices.map((invoice) => invoice.customerName.trim());
		return Array.from(new Set(names)).filter((customer) => customer.length > 0);
	}, [invoices]);
	const availableCurrencies = useMemo(
		() => currencySummaries.map((item) => item.currency),
		[currencySummaries],
	);
	const defaultSummaryCurrency = availableCurrencies.includes("NGN")
		? "NGN"
		: (availableCurrencies[0] ?? "NGN");
	const summaryCurrency =
		selectedSummaryCurrency &&
		availableCurrencies.includes(selectedSummaryCurrency)
			? selectedSummaryCurrency
			: defaultSummaryCurrency;
	const selectedCurrencySummary =
		currencySummaries.find((item) => item.currency === summaryCurrency) ??
		createEmptyCurrencySummary(summaryCurrency);
	const hasMixedCurrencies = availableCurrencies.length > 1;
	const currencySignature = availableCurrencies.join("|");
	const otherCurrencySummaries = currencySummaries.filter(
		(item) => item.currency !== summaryCurrency,
	);
	const revenueChartData = useMemo(
		() => chartDataByCurrency[summaryCurrency] ?? buildRevenueChartData([]),
		[chartDataByCurrency, summaryCurrency],
	);
	const canGoToPreviousPage = pageIndex > 0;
	const canGoToNextPage =
		Boolean(invoicesQuery) &&
		invoicesQuery?.isDone === false &&
		Boolean(invoicesQuery?.continueCursor);

	const goToPreviousPage = () => {
		if (!canGoToPreviousPage) return;
		setPageIndex((current) => Math.max(0, current - 1));
	};

	const goToNextPage = () => {
		if (!canGoToNextPage || !invoicesQuery?.continueCursor) return;

		setPageCursors((current) => {
			const next = current.slice(0, pageIndex + 1);
			next[pageIndex + 1] = invoicesQuery.continueCursor;
			return next;
		});
		setPageIndex((current) => current + 1);
	};

	useEffect(() => {
		if (availableCurrencies.length === 0) {
			if (selectedSummaryCurrency !== null) {
				setSelectedSummaryCurrency(null);
			}
			return;
		}

		if (
			!selectedSummaryCurrency ||
			!availableCurrencies.includes(selectedSummaryCurrency)
		) {
			setSelectedSummaryCurrency(defaultSummaryCurrency);
		}
	}, [
		availableCurrencies,
		currencySignature,
		defaultSummaryCurrency,
		selectedSummaryCurrency,
	]);

	const applyDueDateFilter = (filter: DueDateFilter) => {
		setDueDateFilter(filter);

		if (filter === "all") {
			setDueDateFrom("");
			setDueDateTo("");
			return;
		}

		const now = new Date();
		if (filter === "past-due") {
			setDueDateFrom("");
			setDueDateTo(toLocalDateInputValue(now));
			return;
		}

		const monthOffset = filter === "this-month" ? 0 : 1;
		setDueDateFrom(
			toLocalDateInputValue(
				new Date(now.getFullYear(), now.getMonth() + monthOffset, 1),
			),
		);
		setDueDateTo(
			toLocalDateInputValue(
				new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0),
			),
		);
	};

	const clearFilters = () => {
		startTransition(() => {
			setQuery("");
			setStatusFilter("all");
			setTypeFilter("all");
			setDocumentTypeFilter("all");
			setCustomerFilter("");
			setDueDateFilter("all");
			setDueDateFrom("");
			setDueDateTo("");
		});
	};

	const toggleInvoiceSelection = (id: Id<"invoices">) => {
		setSelectedInvoiceIds((current) => {
			const next = new Set(current);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const toggleAllVisibleSelection = (checked: boolean) => {
		setSelectedInvoiceIds((current) =>
			setInvoiceSelectionForIds(
				current,
				rows.map((invoice) => invoice.id as Id<"invoices">),
				checked,
			),
		);
	};

	const selectDuplicateRows = () => {
		setSelectedInvoiceIds(
			new Set(duplicateRows.map((invoice) => invoice.id as Id<"invoices">)),
		);
	};

	const openCleanupConfirmation = async (ids: Id<"invoices">[]) => {
		if (ids.length === 0 || bulkActionPending) return;
		setBulkActionPending(true);
		try {
			const preview = (await previewBulkCleanup({ ids })) as CleanupPreview;
			setCleanupPreview(preview);
			setCleanupTargetIds(ids);
			setCleanupDialogOpen(true);
		} catch (error) {
			toast({
				title: "Cleanup preview failed",
				description: error instanceof Error ? error.message : "Try again.",
				variant: "error",
			});
		} finally {
			setBulkActionPending(false);
		}
	};

	const commitCleanup = async () => {
		const ids = cleanupTargetIds;
		if (ids.length === 0) return;
		setBulkActionPending(true);
		try {
			const result = await bulkDeleteOrArchive({ ids });
			setSelectedInvoiceIds(new Set());
			setCleanupDialogOpen(false);
			setCleanupPreview(null);
			setCleanupTargetIds([]);
			toast({
				title: "Invoices cleaned up",
				description: `${result.hardDeleted} deleted, ${result.archived} archived, ${result.blocked} skipped.`,
				variant: "success",
			});
		} catch (error) {
			toast({
				title: "Cleanup failed",
				description: error instanceof Error ? error.message : "Try again.",
				variant: "error",
			});
		} finally {
			setBulkActionPending(false);
		}
	};

	const onRenumberInvoices = async (ids: Id<"invoices">[]) => {
		if (ids.length === 0 || bulkActionPending) return;
		setBulkActionPending(true);
		try {
			const result = await renumberInvoices({ ids });
			setSelectedInvoiceIds(new Set());
			toast({
				title: "Invoice numbers fixed",
				description: `${result.renumbered.length} renumbered, ${result.skipped.length} skipped.`,
				variant: "success",
			});
		} catch (error) {
			toast({
				title: "Renumber failed",
				description: error instanceof Error ? error.message : "Try again.",
				variant: "error",
			});
		} finally {
			setBulkActionPending(false);
		}
	};

	const onDeleteEmptyDrafts = async () => {
		if (bulkActionPending) return;
		setBulkActionPending(true);
		try {
			const result = await deleteEmptyDrafts({});
			setSelectedInvoiceIds(new Set());
			toast({
				title: "Empty drafts deleted",
				description: `${result.deleted} empty draft${result.deleted === 1 ? "" : "s"} removed.`,
				variant: "success",
			});
		} catch (error) {
			toast({
				title: "Draft cleanup failed",
				description: error instanceof Error ? error.message : "Try again.",
				variant: "error",
			});
		} finally {
			setBulkActionPending(false);
		}
	};

	const activeFilterCount = [
		query.trim().length > 0,
		statusFilter !== "all",
		typeFilter !== "all",
		documentTypeFilter !== "all",
		customerFilter.trim().length > 0,
		dueDateFilter !== "all",
	].filter(Boolean).length;
	const hasActiveFilters = activeFilterCount > 0;

	const copyPublicLink = async (token: string) => {
		try {
			await navigator.clipboard.writeText(
				`${window.location.origin}/i/${token}`,
			);
			toast({
				title: "Invoice link copied",
				description: "Public preview URL copied to clipboard.",
				variant: "success",
			});
		} catch {
			toast({
				title: "Could not copy link",
				description: "Clipboard permission denied.",
				variant: "error",
			});
		}
	};

	const onDuplicate = async (id: string) => {
		await duplicateInvoice({ id: id as Id<"invoices"> });
		toast({ title: "Invoice duplicated", variant: "success" });
	};

	const onConvertProforma = async (id: string) => {
		await convertProformaToInvoice({ id: id as Id<"invoices"> });
		toast({
			title: "Pro-forma converted",
			description: "A standard invoice was created in this workspace.",
			variant: "success",
		});
	};

	const onStatusChange = async (
		id: string,
		status: InvoiceStatus,
		details?: { paidAt?: number; paymentReference?: string },
	) => {
		await updateStatus.withOptimisticUpdate((localStore) => {
			const current = localStore.getQuery(api.invoices.listPage, pageArgs);
			if (current === undefined) return;
			localStore.setQuery(api.invoices.listPage, pageArgs, {
				...current,
				page: current.page.map((inv: InvoiceRecord) => {
					if (inv.id !== (id as Id<"invoices">)) return inv;
					if (status === "canceled") {
						return {
							...inv,
							status: "canceled" as const,
							canceledAt: Date.now(),
						};
					}
					if (status === "paid") {
						const now = Date.now();
						return {
							...inv,
							status: "paid" as const,
							paidAt: now,
							balance: 0,
							paymentAmount: inv.total,
						};
					}
					return {
						...inv,
						status,
						deliveredAt: inv.deliveredAt ?? Date.now(),
					};
				}),
			});
		})({ id: id as Id<"invoices">, status, ...details });
		toast({
			title: "Status updated",
			description: `Marked as ${status}.`,
			variant: "success",
		});
	};

	const onRecordFullPayment = async (invoice: InvoiceRow) => {
		const amount = invoice.balance > 0 ? invoice.balance : invoice.amount;
		await recordPayment({
			invoiceId: invoice.id as Id<"invoices">,
			amount,
			reference: invoice.paymentReference,
		});
		toast({
			title: "Payment recorded",
			description: `Recorded ${formatMoney(amount, invoice.currency)}.`,
			variant: "success",
		});
	};

	const onInvoiceImport = async (file: File | undefined) => {
		if (!file) return;

		try {
			const isXlsx = file.name.toLowerCase().endsWith(".xlsx");
			const xlsxData = isXlsx ? await readXlsxInvoiceData(file) : null;
			const csvText = xlsxData ? xlsxData.csv : await file.text();
			const grid = xlsxData?.grid ?? parseCsvGrid(csvText);
			if (looksLikeSupplierReceivingGrid(grid)) {
				toast({
					title: "Supplier receiving sheets are outside Velure invoices",
					description:
						"Create a pro-forma or standard invoice for customer billing. Supplier receiving and variance worksheets are outside Velure.",
					variant: "error",
				});
				return;
			}

			const rows = parseInvoiceCsv(csvText);
			if (rows.length > 0) {
				const result = await importInvoices({ rows });
				const issueCount = result.errors?.length ?? 0;
				toast({
					title: "Invoice import finished",
					description: `${result.created} created, ${result.skipped} skipped${
						issueCount > 0 ? `, ${issueCount} row issues reported` : ""
					}.`,
					variant: "success",
				});
				return;
			}

			const draft = parseInvoiceDraftGrid(grid);
			if (draft) {
				setImportedDraft(draft);
				setCreateDocumentType("standard");
				setCreateOpen(true);
				toast({
					title: "Invoice draft imported",
					description: "Review the extracted invoice before creating it.",
					variant: "success",
				});
				return;
			}

			toast({
				title: "No invoice rows found",
				description:
					"Use a row-based CSV or a formatted invoice sheet with bill-to, dates, and line items.",
				variant: "error",
			});
		} catch (error) {
			toast({
				title: "Invoice import failed",
				description: error instanceof Error ? error.message : "Unknown error",
				variant: "error",
			});
		}
	};

	return (
		<div className="flex h-full w-full flex-col gap-4">
			<div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
				<div>
					<h1 className="text-3xl font-semibold tracking-[-0.02em] text-ink">
						Invoices
					</h1>
					<p className="mt-2 text-sm text-ink-3">
						Review invoice status, search by customer, and keep the list moving.
					</p>
				</div>

				<div className="flex flex-wrap items-center gap-3">
					<Button
						type="button"
						onClick={() => {
							setImportedDraft(null);
							setCreateDocumentType("standard");
							setCreateOpen(true);
						}}
						className="h-10 rounded-md bg-brand px-4 text-sm font-medium text-brand-ink hover:bg-brand-hi"
					>
						New invoice
					</Button>
					<label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-rule bg-paper-2 px-3 text-sm font-medium text-ink-2 transition-colors hover:bg-paper-3">
						<Upload className="h-4 w-4 text-brand" />
						Import CSV
						<input
							type="file"
							accept=".csv,text/csv,.xlsx"
							className="hidden"
							onChange={(event) => {
								void onInvoiceImport(event.target.files?.[0]);
								event.target.value = "";
							}}
						/>
					</label>
				</div>
			</div>

			<div className="ui-panel rounded-md border border-rule bg-paper-2 p-3">
				<div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_180px_auto] lg:items-end">
					<FilterField label="Search">
						<div className="flex h-10 items-center gap-2 rounded-md border border-rule bg-paper px-3">
							<Search className="h-4 w-4 text-ink-3" />
							<input
								value={query}
								onChange={(event) =>
									startTransition(() => setQuery(event.target.value))
								}
								placeholder="Invoice number or customer"
								className="h-full w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
							/>
						</div>
					</FilterField>

					<FilterField label="Status">
						<Select
							value={statusFilter}
							onValueChange={(value) =>
								startTransition(() =>
									setStatusFilter(value as "all" | InvoiceStatus),
								)
							}
						>
							<SelectTrigger className="h-10 w-full rounded-md border-rule bg-paper text-ink">
								<SelectValue placeholder="All statuses" />
							</SelectTrigger>
							<SelectContent className="border-rule bg-paper-2 text-ink">
								<SelectItem value="all">All statuses</SelectItem>
								{STATUS_OPTIONS.map((status) => (
									<SelectItem
										key={status}
										value={status}
										className="capitalize"
									>
										{status}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</FilterField>

					<div className="flex min-w-0 items-end gap-2 lg:justify-end">
						<details className="group relative min-w-0 flex-1 lg:flex-none">
							<summary className="flex h-10 cursor-pointer list-none items-center justify-center gap-2 rounded-md border border-rule bg-paper px-3 text-sm font-medium text-ink-2 transition-colors hover:bg-paper-3 group-open:border-brand-line group-open:text-ink [&::-webkit-details-marker]:hidden">
								<SlidersHorizontal className="h-4 w-4 text-brand" />
								<span>Filters</span>
								{activeFilterCount > 0 ? (
									<span className="inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-brand-ink">
										{activeFilterCount}
									</span>
								) : null}
							</summary>
							<div className="mt-3 grid gap-3 rounded-md border border-rule bg-paper-2 p-3 shadow-lg sm:grid-cols-2 lg:absolute lg:right-0 lg:z-30 lg:w-[620px]">
								<FilterField label="Customer">
									<div className="flex h-10 items-center rounded-md border border-rule bg-paper px-3">
										<input
											value={customerFilter}
											onChange={(event) =>
												startTransition(() =>
													setCustomerFilter(event.target.value),
												)
											}
											placeholder="Any customer"
											list="invoice-customer-filter-options"
											className="h-full w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
										/>
										<datalist id="invoice-customer-filter-options">
											{customers.map((customer) => (
												<option key={customer} value={customer} />
											))}
										</datalist>
									</div>
								</FilterField>

								<FilterField label="Schedule">
									<Select
										value={typeFilter}
										onValueChange={(value) =>
											startTransition(() =>
												setTypeFilter(value as InvoiceTypeFilter),
											)
										}
									>
										<SelectTrigger className="h-10 w-full rounded-md border-rule bg-paper text-ink">
											<SelectValue placeholder="All schedules" />
										</SelectTrigger>
										<SelectContent className="border-rule bg-paper-2 text-ink">
											<SelectItem value="all">All schedules</SelectItem>
											<SelectItem value="one-time">One-time</SelectItem>
											<SelectItem value="recurring">Recurring</SelectItem>
										</SelectContent>
									</Select>
								</FilterField>

								<FilterField label="Document kind">
									<Select
										value={documentTypeFilter}
										onValueChange={(value) =>
											startTransition(() =>
												setDocumentTypeFilter(value as DocumentTypeFilter),
											)
										}
									>
										<SelectTrigger className="h-10 w-full rounded-md border-rule bg-paper text-ink">
											<SelectValue placeholder="All document kinds" />
										</SelectTrigger>
										<SelectContent className="border-rule bg-paper-2 text-ink">
											<SelectItem value="all">All document kinds</SelectItem>
											<SelectItem value="standard">Standard</SelectItem>
											<SelectItem value="proforma">Pro-forma</SelectItem>
										</SelectContent>
									</Select>
								</FilterField>

								<FilterField label="Due">
									<Select
										value={dueDateFilter}
										onValueChange={(value) =>
											startTransition(() =>
												applyDueDateFilter(value as DueDateFilter),
											)
										}
									>
										<SelectTrigger className="h-10 w-full rounded-md border-rule bg-paper text-ink">
											<SelectValue placeholder="Any due date" />
										</SelectTrigger>
										<SelectContent className="border-rule bg-paper-2 text-ink">
											<SelectItem value="all">Any due date</SelectItem>
											<SelectItem value="past-due">Due by today</SelectItem>
											<SelectItem value="this-month">This month</SelectItem>
											<SelectItem value="next-month">Next month</SelectItem>
										</SelectContent>
									</Select>
								</FilterField>
							</div>
						</details>
						{hasActiveFilters ? (
							<button
								type="button"
								onClick={clearFilters}
								className="h-10 shrink-0 rounded-md px-3 text-sm font-medium text-brand transition-colors hover:bg-brand-soft hover:text-brand-hi"
							>
								Clear
							</button>
						) : null}
					</div>
				</div>
			</div>

			{hasMixedCurrencies ? (
				<section className="rounded-md border border-warn-line bg-paper-3 px-4 py-3">
					<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
						<div>
							<p className="text-sm font-medium text-ink">
								Currency-scoped totals
							</p>
							<p className="mt-1 text-xs text-ink-3">
								Totals and chart are showing {summaryCurrency} only. Velure does
								not combine currencies without an exchange-rate audit trail.
							</p>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<Select
								value={summaryCurrency}
								onValueChange={setSelectedSummaryCurrency}
							>
								<SelectTrigger className="h-9 min-w-32 rounded-md border-warn-line bg-paper text-ink">
									<SelectValue placeholder="Currency" />
								</SelectTrigger>
								<SelectContent className="border-rule bg-paper-2 text-ink">
									{availableCurrencies.map((currency) => (
										<SelectItem key={currency} value={currency}>
											{currency}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{otherCurrencySummaries.map((item) => (
								<span
									key={item.currency}
									className="inline-flex h-9 items-center rounded-md border border-rule bg-paper-3 px-3 text-xs text-ink-3"
								>
									{item.totalCount} {item.currency} invoice
									{item.totalCount === 1 ? "" : "s"} outside totals
								</span>
							))}
						</div>
					</div>
				</section>
			) : null}

			<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
				<SummaryCard
					label="Open"
					value={formatCompactMoney(
						selectedCurrencySummary.openAmount,
						summaryCurrency,
					)}
					fullValue={formatMoney(
						selectedCurrencySummary.openAmount,
						summaryCurrency,
					)}
					meta={`${selectedCurrencySummary.openCount} ${summaryCurrency} invoices`}
					tone="open"
					isLoading={isInvoicesLoading}
				/>
				<SummaryCard
					label="Overdue"
					value={formatCompactMoney(
						selectedCurrencySummary.overdueAmount,
						summaryCurrency,
					)}
					fullValue={formatMoney(
						selectedCurrencySummary.overdueAmount,
						summaryCurrency,
					)}
					meta={`${selectedCurrencySummary.overdueCount} ${summaryCurrency} invoices`}
					tone="overdue"
					isLoading={isInvoicesLoading}
				/>
				<SummaryCard
					label="Paid"
					value={formatCompactMoney(
						selectedCurrencySummary.paidAmount,
						summaryCurrency,
					)}
					fullValue={formatMoney(
						selectedCurrencySummary.paidAmount,
						summaryCurrency,
					)}
					meta={`${selectedCurrencySummary.paidCount} ${summaryCurrency} invoices`}
					tone="paid"
					isLoading={isInvoicesLoading}
				/>
				<PaymentScoreCard score={paymentScore} isLoading={isInvoicesLoading} />
			</div>

			<RevenueTrendCard
				data={revenueChartData}
				currency={summaryCurrency}
				isCurrencyScoped={hasMixedCurrencies}
			/>

			<div className="ui-panel overflow-hidden rounded-md border border-rule bg-paper-2">
				<div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule px-4 py-3">
					<div>
						<p className="text-sm font-medium text-ink">Invoice list</p>
						<p className="mt-1 text-xs text-ink-3">
							{isInvoicesLoading
								? "Loading invoices"
								: `${rows.length} invoices`}
							{hasActiveFilters ? " match your filters" : " in this workspace"}
						</p>
					</div>
					<div className="flex items-center gap-3">
						{duplicateRowCount > 0 ? (
							<button
								type="button"
								onClick={selectDuplicateRows}
								className="inline-flex items-center gap-2 rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-xs font-medium text-danger transition-colors hover:bg-danger-soft"
							>
								<CircleAlert className="h-4 w-4" />
								{duplicateRowCount} duplicate row
								{duplicateRowCount === 1 ? "" : "s"}
							</button>
						) : null}
						{selectedCount > 0 ? (
							<Button
								type="button"
								variant="ghost"
								title="Renumber selected"
								aria-label="Renumber selected invoices"
								onClick={() =>
									void onRenumberInvoices(
										selectedRows.map((invoice) => invoice.id as Id<"invoices">),
									)
								}
								disabled={bulkActionPending}
								className="h-9 w-9 rounded-md border border-rule bg-paper p-0 text-ink-3 hover:border-brand-line hover:bg-brand-soft hover:text-brand"
							>
								<Wrench className="h-4 w-4" />
							</Button>
						) : null}
						<Button
							type="button"
							variant="ghost"
							title={
								selectedCount > 0 ? "Delete selected" : "Delete empty drafts"
							}
							aria-label={
								selectedCount > 0
									? "Delete selected invoices"
									: "Delete empty drafts"
							}
							onClick={() =>
								selectedCount > 0
									? void openCleanupConfirmation(
											selectedRows.map(
												(invoice) => invoice.id as Id<"invoices">,
											),
										)
									: void onDeleteEmptyDrafts()
							}
							disabled={bulkActionPending}
							className="h-9 w-9 rounded-md border border-rule bg-paper p-0 text-ink-3 hover:border-danger-line hover:bg-danger-soft hover:text-danger"
						>
							<Trash2 className="h-4 w-4" />
						</Button>
						{hasActiveFilters ? (
							<button
								type="button"
								onClick={clearFilters}
								className="text-sm text-brand hover:text-brand-hi"
							>
								Clear filters
							</button>
						) : null}
					</div>
				</div>

				{selectedCount > 0 ? (
					<div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule bg-secondary  px-4 py-3 text-sm">
						<span className="font-extrabold text-primary">
							{selectedCount} selected
						</span>
					</div>
				) : null}

				<div className="overflow-x-auto">
					<table className="hm-ts-board w-full min-w-205 text-sm">
						<thead className="bg-paper-3">
							<tr className="border-b border-rule text-left text-ink-3">
								<th className="w-12 px-4 py-3 font-medium">
									<div className="flex items-center justify-center">
										<Checkbox
											checked={
												someVisibleSelected
													? "indeterminate"
													: allVisibleSelected
											}
											onCheckedChange={(checked) =>
												toggleAllVisibleSelection(checked === true)
											}
											aria-label="Select all visible invoices"
											className="relative z-10 h-5 w-5 border-brand-line bg-paper text-brand-ink data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=indeterminate]:border-brand data-[state=indeterminate]:bg-brand"
										/>
									</div>
								</th>
								<th className="w-[34%] px-4 py-3 font-medium">Invoice</th>
								<th className="px-4 py-3 font-medium">Status</th>
								<th className="px-4 py-3 font-medium">Due date</th>
								<th className="px-4 py-3 font-medium">Issue date</th>
								<th className="px-4 py-3 font-medium">Type</th>
								<th className="px-4 py-3 text-right font-medium">Actions</th>
							</tr>
						</thead>
						<tbody>
							{isInvoicesLoading
								? ["row-1", "row-2", "row-3", "row-4", "row-5"].map(
										(rowKey) => (
											<tr key={rowKey} className="border-b border-rule">
												{["c1", "c2", "c3", "c4", "c5", "c6", "c7"].map(
													(cellKey) => (
														<td
															key={`${rowKey}-${cellKey}`}
															className="px-4 py-3"
														>
															<Skeleton className="h-4 w-20 bg-paper-3" />
														</td>
													),
												)}
											</tr>
										),
									)
								: rows.map((invoice) => (
										<tr
											key={invoice.id}
											data-status={
												invoice.status === "partially-paid"
													? "partial"
													: invoice.status === "unpaid"
														? "sent"
														: invoice.status
											}
											tabIndex={0}
											role="button"
											aria-label={`Edit invoice ${invoice.invoiceNumber}`}
											onClick={() =>
												setActiveInvoiceId(invoice.id as Id<"invoices">)
											}
											onKeyDown={(event) => {
												if (event.key !== "Enter" && event.key !== " ") return;
												event.preventDefault();
												setActiveInvoiceId(invoice.id as Id<"invoices">);
											}}
											className={`cursor-pointer border-b border-rule text-ink-2 outline-none transition-colors duration-150 hover:bg-paper-3 focus-visible:bg-brand-soft focus-visible:shadow-[inset_3px_0_0_var(--color-brand)] ${
												activeInvoiceId === invoice.id
													? "bg-danger-soft"
													: invoice.status === "canceled"
														? "opacity-55"
														: ""
											}`}
										>
											<td className="px-2 py-2">
												<div className="flex items-center justify-center">
													<Checkbox
														checked={selectedInvoiceIds.has(
															invoice.id as Id<"invoices">,
														)}
														onCheckedChange={() =>
															toggleInvoiceSelection(
																invoice.id as Id<"invoices">,
															)
														}
														onPointerDown={(event) => event.stopPropagation()}
														onClick={(event) => event.stopPropagation()}
														onKeyDown={(event) => event.stopPropagation()}
														aria-label={`Select invoice ${invoice.invoiceNumber}`}
														className="relative z-10 h-5 w-5 border-brand-line bg-paper text-brand-ink data-[state=checked]:border-brand data-[state=checked]:bg-brand"
													/>
												</div>
											</td>
											<td className="px-4 py-3 font-medium text-ink">
												<div className="flex min-w-0 flex-col">
													<span className="font-mono text-[13px]">
														{invoice.invoiceNumber}
													</span>
													<span className="mt-1 truncate text-xs font-normal text-ink-3">
														{invoice.customerName || "-"} ·{" "}
														{formatCompactMoney(
															invoice.amount,
															invoice.currency,
														)}
													</span>
													{duplicateInvoiceNumbers.has(
														invoice.invoiceNumber,
													) ? (
														<span className="mt-1 inline-flex w-fit items-center gap-1 rounded-md border border-danger-line bg-danger-soft px-1.5 py-0.5 text-[10px] font-medium text-danger">
															<CircleAlert className="h-3 w-3" />
															Duplicate number
														</span>
													) : null}
												</div>
											</td>
											<td className="px-4 py-3">
												<div className="flex items-center gap-2">
													<span className={invoiceStatusStamp[invoice.status]}>
														{invoiceStatusLabel(invoice.status)}
													</span>
													{invoice.lifecycle?.sentAt && (
														<span className="inline-flex items-center rounded-md border border-rule bg-paper-3 px-1.5 py-0.5 text-[10px] text-brand">
															Sent
														</span>
													)}
													{invoice.lifecycle?.firstViewedAt && (
														<span className="inline-flex items-center rounded-md border border-rule bg-paper-3 px-1.5 py-0.5 text-[10px] text-info">
															Viewed
														</span>
													)}
												</div>
											</td>
											<td
												className={`hm-num-cell px-4 py-3 ${dueDateClassName(invoice)}`}
												title={formatDate(invoice.dueDate)}
											>
												{formatDate(invoice.dueDate)}
											</td>
											<td className="hm-num-cell px-4 py-3 text-ink-3">
												{formatDate(invoice.issueDate)}
											</td>
											<td className="px-4 py-3 text-ink-3 capitalize">
												<div className="flex flex-col gap-1">
													<span>
														{invoice.documentType === "proforma"
															? "Pro-forma"
															: "Standard"}
													</span>
													{invoice.convertedToInvoiceId ? (
														<span className="text-[10px] font-medium text-brand">
															Converted
														</span>
													) : (
														<span className="text-[10px] text-ink-3">
															{invoice.type.replace("-", " ")}
														</span>
													)}
												</div>
											</td>
											<td
												className="px-4 py-3 text-right"
												onClick={(event) => event.stopPropagation()}
												onKeyDown={(event) => event.stopPropagation()}
											>
												<DropdownMenu>
													<DropdownMenuTrigger asChild>
														<Button
															type="button"
															variant="ghost"
															aria-label={`Actions for ${invoice.invoiceNumber}`}
															className="h-9 w-9 rounded-md border border-rule bg-paper-2 p-0 hover:bg-brand-soft"
														>
															<MoreHorizontal className="h-4 w-4 text-ink-2" />
														</Button>
													</DropdownMenuTrigger>
													<DropdownMenuContent
														align="end"
														className="min-w-47 border-rule bg-paper-2 p-1 text-ink"
													>
														<DropdownMenuItem
															onClick={() =>
																setActiveInvoiceId(invoice.id as Id<"invoices">)
															}
															className="focus:bg-brand-soft"
														>
															<FileEdit className="mr-2 h-4 w-4" />
															Edit invoice
														</DropdownMenuItem>
														<DropdownMenuItem
															onClick={() =>
																window.open(
																	`/i/${invoice.token}`,
																	"_blank",
																	"noopener,noreferrer",
																)
															}
															className="focus:bg-brand-soft"
														>
															<ExternalLink className="mr-2 h-4 w-4" />
															Open invoice
														</DropdownMenuItem>
														<DropdownMenuItem
															onClick={() => void copyPublicLink(invoice.token)}
															className="focus:bg-brand-soft"
														>
															<Copy className="mr-2 h-4 w-4" />
															Copy link
														</DropdownMenuItem>
														<DropdownMenuItem
															asChild
															className="focus:bg-brand-soft"
														>
															<a
																href={`/i/${encodeURIComponent(invoice.token)}`}
																target="_blank"
																rel="noreferrer"
																className="flex cursor-pointer items-center"
															>
																<Download className="mr-2 h-4 w-4" />
																Preview download
															</a>
														</DropdownMenuItem>
														<DropdownMenuItem
															onClick={() => void onDuplicate(invoice.id)}
															className="focus:bg-brand-soft"
														>
															<Repeat2 className="mr-2 h-4 w-4" />
															Duplicate
														</DropdownMenuItem>
														{duplicateInvoiceNumbers.has(
															invoice.invoiceNumber,
														) ? (
															<DropdownMenuItem
																onClick={() =>
																	void onRenumberInvoices([
																		invoice.id as Id<"invoices">,
																	])
																}
																className="focus:bg-brand-soft"
															>
																<Wrench className="mr-2 h-4 w-4" />
																Fix duplicate number
															</DropdownMenuItem>
														) : null}
														{invoice.status === "draft" ? (
															<DropdownMenuItem
																onClick={() =>
																	void openCleanupConfirmation([
																		invoice.id as Id<"invoices">,
																	])
																}
																className="text-danger focus:bg-danger-soft focus:text-danger"
															>
																<Trash2 className="mr-2 h-4 w-4" />
																Delete
															</DropdownMenuItem>
														) : null}
														{invoice.documentType === "proforma" &&
														!invoice.convertedToInvoiceId ? (
															<DropdownMenuItem
																onClick={() =>
																	void onConvertProforma(invoice.id)
																}
																className="focus:bg-brand-soft"
															>
																<ReceiptText className="mr-2 h-4 w-4" />
																Convert to invoice
															</DropdownMenuItem>
														) : null}
														<DropdownMenuSub>
															<DropdownMenuSubTrigger className="focus:bg-brand-soft">
																<CalendarDays className="mr-2 h-4 w-4" />
																Mark as paid
															</DropdownMenuSubTrigger>
															<DropdownMenuSubContent className="min-w-62 border-rule bg-paper-2 p-2 text-ink">
																<button
																	type="button"
																	onClick={() =>
																		void onRecordFullPayment(invoice)
																	}
																	className="mb-2 flex h-8 w-full items-center justify-center border border-rule bg-paper-3 px-3 text-xs text-ink-2 transition-colors hover:bg-brand-soft"
																>
																	Mark paid today
																</button>
																<Calendar
																	mode="single"
																	selected={new Date()}
																	onSelect={(date) => {
																		if (!date) return;
																		void onRecordFullPayment(invoice);
																	}}
																/>
															</DropdownMenuSubContent>
														</DropdownMenuSub>
														<DropdownMenuItem
															onClick={() =>
																void onStatusChange(invoice.id, "canceled")
															}
															className="text-danger focus:bg-danger-soft focus:text-danger"
														>
															<XCircle className="mr-2 h-4 w-4" />
															Cancel
														</DropdownMenuItem>
													</DropdownMenuContent>
												</DropdownMenu>
											</td>
										</tr>
									))}
						</tbody>
					</table>
				</div>

				{!isInvoicesLoading && (rows.length > 0 || pageIndex > 0) ? (
					<div className="flex flex-wrap items-center justify-between gap-3 border-t border-rule px-4 py-3 text-sm text-ink-3">
						<span>Page {pageIndex + 1}</span>
						<div className="flex items-center gap-2">
							<Button
								type="button"
								variant="ghost"
								onClick={goToPreviousPage}
								disabled={!canGoToPreviousPage}
								className="h-9 rounded-md border border-rule px-3 text-ink-2 hover:bg-paper-3 disabled:cursor-not-allowed disabled:opacity-40"
							>
								<ChevronLeft className="mr-1 h-4 w-4" />
								Previous
							</Button>
							<Button
								type="button"
								variant="ghost"
								onClick={goToNextPage}
								disabled={!canGoToNextPage}
								className="h-9 rounded-md border border-rule px-3 text-ink-2 hover:bg-paper-3 disabled:cursor-not-allowed disabled:opacity-40"
							>
								Next
								<ChevronRight className="ml-1 h-4 w-4" />
							</Button>
						</div>
					</div>
				) : null}

				{!isInvoicesLoading && rows.length === 0 ? (
					<div className="flex flex-col items-center gap-3 px-4 py-10 text-sm text-ink-3 text-center">
						<div>
							<p className="font-medium text-ink">No invoices yet.</p>
							<p className="mt-1">
								Create an invoice, add a client email, then share the
								Paystack-enabled public link.
							</p>
						</div>
						<Button
							type="button"
							onClick={() => {
								setImportedDraft(null);
								setCreateDocumentType("standard");
								setCreateOpen(true);
							}}
							className="h-9 rounded-md bg-brand px-3 text-sm font-medium text-brand-ink hover:bg-brand-hi"
						>
							New invoice
						</Button>
					</div>
				) : null}
			</div>

			<InvoiceDetailsSheet
				open={activeInvoiceId !== null}
				onOpenChange={(open) => {
					if (!open) setActiveInvoiceId(null);
				}}
				invoice={activeInvoice}
				onSave={async (invoice) => {
					const saveable = toInvoiceSaveInput(invoice);
					await saveInvoice.withOptimisticUpdate((localStore) => {
						const current = localStore.getQuery(
							api.invoices.listPage,
							pageArgs,
						);
						if (current === undefined) return;
						const invId = invoice.id as Id<"invoices">;
						localStore.setQuery(api.invoices.listPage, pageArgs, {
							...current,
							page: current.page.map((inv: InvoiceRecord) => {
								if (inv.id !== invId) return inv;
								return { ...inv, ...saveable, updatedAt: Date.now() };
							}),
						});
					})({
						...saveable,
					});
				}}
				onStatusChange={async (id, status, details) => {
					await onStatusChange(id, status, details);
				}}
				onRecordPayment={async (id, amount, reference) => {
					await recordPayment({
						invoiceId: id as Id<"invoices">,
						amount,
						reference,
					});
				}}
			/>

			<CreateInvoiceSheet
				open={createOpen}
				onOpenChange={setCreateOpen}
				initialDraft={importedDraft}
				initialDocumentType={createDocumentType}
				onCreated={() => setImportedDraft(null)}
			/>

			<AlertDialog
				open={cleanupDialogOpen}
				onOpenChange={(open) => {
					setCleanupDialogOpen(open);
					if (!open) {
						setCleanupPreview(null);
						setCleanupTargetIds([]);
					}
				}}
			>
				<AlertDialogContent className="max-w-2xl border-rule bg-paper-2 text-ink">
					<AlertDialogHeader>
						<AlertDialogTitle>Confirm invoice cleanup</AlertDialogTitle>
						<AlertDialogDescription className="text-ink-3">
							Untouched drafts will be permanently deleted. Invoices with sent,
							viewed, or payment history will be archived instead.
						</AlertDialogDescription>
					</AlertDialogHeader>

					{cleanupPreview ? (
						<div className="grid max-h-90 gap-3 overflow-y-auto text-sm">
							<CleanupPreviewGroup
								title="Will hard delete"
								items={cleanupPreview.hardDelete}
								emptyText="No untouched drafts selected."
							/>
							<CleanupPreviewGroup
								title="Will archive"
								items={cleanupPreview.archive}
								emptyText="No traceable invoices selected."
							/>
							<CleanupPreviewGroup
								title="Blocked"
								items={cleanupPreview.blocked}
								emptyText="No blocked rows."
							/>
						</div>
					) : null}

					<AlertDialogFooter>
						<AlertDialogCancel className="border-rule bg-transparent text-ink-2 hover:bg-paper-3">
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={(event) => {
								event.preventDefault();
								void commitCleanup();
							}}
							disabled={bulkActionPending || cleanupTargetIds.length === 0}
							className="bg-danger text-paper hover:bg-danger"
						>
							Confirm cleanup
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

function CleanupPreviewGroup({
	title,
	items,
	emptyText,
}: {
	title: string;
	items: CleanupPreviewItem[];
	emptyText: string;
}) {
	return (
		<div className="rounded-md border border-rule bg-paper p-3">
			<div className="mb-2 flex items-center justify-between gap-3">
				<p className="text-xs font-medium uppercase text-ink-3">{title}</p>
				<span className="text-xs text-ink-3">{items.length}</span>
			</div>
			{items.length > 0 ? (
				<ul className="space-y-1.5">
					{items.slice(0, 8).map((item) => (
						<li
							key={String(item.id)}
							className="flex items-center justify-between gap-3 text-xs"
						>
							<span className="font-mono text-ink">{item.invoiceNumber}</span>
							<span className="truncate text-ink-3">
								{item.customerName || item.reason || item.status || "-"}
							</span>
						</li>
					))}
					{items.length > 8 ? (
						<li className="text-xs text-ink-3">+{items.length - 8} more</li>
					) : null}
				</ul>
			) : (
				<p className="text-xs text-ink-3">{emptyText}</p>
			)}
		</div>
	);
}

function SummaryCard({
	label,
	value,
	fullValue,
	meta,
	tone,
	isLoading,
}: {
	label: string;
	value: string;
	fullValue: string;
	meta: string;
	tone: "open" | "overdue" | "paid";
	isLoading?: boolean;
}) {
	const toneClass = {
		open: "border-l-warn",
		overdue: "border-l-danger",
		paid: "border-l-ok",
	}[tone];

	return (
		<div
			className={`ui-panel rounded-md border border-l-4 border-rule bg-paper-2 px-4 py-4 ${toneClass}`}
			title={fullValue}
		>
			<p className="text-sm font-medium text-ink-3">{label}</p>
			{isLoading ? (
				<>
					<div className="mt-2 h-8 w-32 animate-pulse rounded bg-paper-3" />
					<div className="mt-2 h-5 w-24 animate-pulse rounded bg-paper-3" />
				</>
			) : (
				<>
					<p className="mt-2 text-2xl font-semibold text-ink">{value}</p>
					<p className="mt-1 text-sm text-ink-3">{meta}</p>
				</>
			)}
		</div>
	);
}

function PaymentScoreCard({
	score,
	isLoading,
}: {
	score: PaymentScore;
	isLoading?: boolean;
}) {
	const statusLabel = {
		no_data: "No paid history",
		excellent: "Excellent",
		good: "Good",
		fair: "Fair",
		slow: "Needs attention",
	}[score.status];
	const meta =
		score.paidInvoiceCount === 0
			? "Score appears after the first paid invoice"
			: `${score.onTimeCount}/${score.paidInvoiceCount} on time · ${score.averageDaysToPay ?? 0} day avg`;

	return (
		<div className="ui-panel rounded-md border border-l-4 border-rule border-l-info bg-paper-2 px-4 py-4">
			<p className="text-sm font-medium text-ink-3">Payment score</p>
			{isLoading ? (
				<>
					<div className="mt-2 h-8 w-32 animate-pulse rounded bg-paper-3" />
					<div className="mt-2 h-5 w-24 animate-pulse rounded bg-paper-3" />
				</>
			) : (
				<>
					<div className="mt-2 flex items-baseline gap-2">
						<p className="text-2xl font-semibold text-ink">{score.score}</p>
						<span className="text-xs uppercase tracking-[0.08em] text-info">
							{statusLabel}
						</span>
					</div>
					<p className="mt-1 text-sm text-ink-3">{meta}</p>
				</>
			)}
		</div>
	);
}

function RevenueTrendCard({
	data,
	currency,
	isCurrencyScoped,
}: {
	data: RevenueChartPoint[];
	currency: string;
	isCurrencyScoped: boolean;
}) {
	return (
		<section className="ui-panel rounded-md border border-brand bg-paper-2/90 p-4 shadow-[0_0_0_transparent] backdrop-blur-md transition-[border-color,box-shadow] duration-200 hover:border-brand-line hover:shadow-[0_18px_60px_color-mix(in srgb, var(--color-brand) 8%, transparent)]">
			<div className="mb-4 flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 className="text-sm font-medium text-ink">
						Paid Invoices Over Time
					</h2>
					<p className="mt-1 text-xs text-ink-3">
						Paid and open invoice value by month
						{isCurrencyScoped ? `, scoped to ${currency}.` : "."}
					</p>
				</div>
				<div className="flex items-center gap-4 text-xs font-medium">
					<span className="text-ok">● Paid</span>
					<span className="text-warn">● Open</span>
				</div>
			</div>

			<div className="h-48 w-full">
				<ResponsiveContainer width="100%" height="100%">
					<LineChart
						data={data}
						margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
					>
						{/* <CartesianGrid
							stroke="var(--color-rule)"
							strokeOpacity={0.65}
							vertical={false}
						/> */}
						<XAxis
							dataKey="label"
							tickLine={false}
							axisLine={false}
							tick={{ fill: "var(--color-ink-3)", fontSize: 12 }}
							dy={10}
						/>
						<YAxis
							width={72}
							tickLine={false}
							axisLine={false}
							tick={{ fill: "var(--color-ink-3)", fontSize: 12 }}
							tickFormatter={(value) =>
								formatCompactMoney(Number(value), currency)
							}
							domain={["auto", "auto"]}
						/>
						<Tooltip
							cursor={{ stroke: "var(--color-brand)", strokeWidth: 1 }}
							content={<RevenueTooltip currency={currency} />}
						/>
						<Line
							type="monotone"
							dataKey="paidRevenue"
							stroke="#66c2a3"
							strokeWidth={3}
							dot={false}
							activeDot={{
								r: 5,
								fill: "#66c2a3",
								stroke: "var(--color-brand-soft)",
								strokeWidth: 2,
							}}
						/>
						<Line
							type="monotone"
							dataKey="unpaidRevenue"
							stroke="#d7bc7f"
							strokeWidth={2.5}
							strokeDasharray="6 6"
							dot={false}
							activeDot={{
								r: 5,
								fill: "#d7bc7f",
								stroke: "#262016",
								strokeWidth: 2,
							}}
						/>
					</LineChart>
				</ResponsiveContainer>
			</div>
		</section>
	);
}

function RevenueTooltip({
	active,
	payload,
	label,
	currency,
}: {
	active?: boolean;
	payload?: Array<{
		dataKey?: string | number;
		value?: number | string;
		payload?: RevenueChartPoint;
	}>;
	label?: string;
	currency: string;
}) {
	if (!active || !payload?.length) return null;

	const point = payload[0]?.payload;
	if (!point) return null;

	return (
		<div className="min-w-47.5 rounded-md border border-rule bg-paper/95 px-3 py-3 text-xs shadow-[0_18px_50px_rgba(0,0,0,0.45)] backdrop-blur-md">
			<p className="mb-2 font-medium text-ink">{label}</p>
			<div className="space-y-2">
				<TooltipRow
					label="Paid"
					revenue={point.paidRevenue}
					count={point.paidCount}
					currency={currency}
					tone="paid"
				/>
				<TooltipRow
					label="Unpaid"
					revenue={point.unpaidRevenue}
					count={point.unpaidCount}
					currency={currency}
					tone="unpaid"
				/>
			</div>
		</div>
	);
}

function TooltipRow({
	label,
	revenue,
	count,
	currency,
	tone,
}: {
	label: string;
	revenue: number;
	count: number;
	currency: string;
	tone: "paid" | "unpaid";
}) {
	const toneClass = tone === "paid" ? "text-ok" : "text-warn";

	return (
		<div>
			<div
				className={`flex items-center justify-between gap-4 font-medium ${toneClass}`}
			>
				<span>{label}</span>
				<span>{formatMoney(revenue, currency)}</span>
			</div>
			<div className="mt-1 flex items-center justify-between gap-4 text-ink-3">
				<span>Revenue</span>
				<span>Count: {count} Invoices</span>
			</div>
		</div>
	);
}

function safeMoneyValue(value: unknown, fallback = 0) {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	return Math.max(0, fallback);
}

function calculateInvoiceAmount(invoice: InvoiceRecord) {
	const complianceAmount =
		invoice.compliance?.grandTotal !== undefined
			? invoice.compliance.grandTotal -
				(invoice.compliance.withholdingTaxAmount ?? 0)
			: undefined;

	if (
		typeof complianceAmount === "number" &&
		Number.isFinite(complianceAmount)
	) {
		return Math.max(0, complianceAmount);
	}

	const lineItemTotal = invoice.lineItems.reduce(
		(sum, item) =>
			sum + safeMoneyValue(item.quantity) * safeMoneyValue(item.price),
		0,
	);

	return safeMoneyValue(invoice.total, lineItemTotal);
}

function createEmptyCurrencySummary(currency: string): CurrencySummary {
	return {
		currency,
		totalCount: 0,
		openAmount: 0,
		openCount: 0,
		overdueAmount: 0,
		overdueCount: 0,
		paidAmount: 0,
		paidCount: 0,
	};
}

function buildRevenueChartData(rows: InvoiceRow[]) {
	const months = new Map<string, RevenueChartPoint>();

	for (const month of getRecentMonthKeys(6)) {
		months.set(month.key, createEmptyPoint(month.key, month.label));
	}

	for (const invoice of rows) {
		if (invoice.status === "canceled") continue;

		const date = new Date(invoice.issueDate);
		if (Number.isNaN(date.getTime())) continue;

		const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
		const point =
			months.get(key) ?? createEmptyPoint(key, formatMonthLabel(date));

		if (invoice.status === "paid") {
			point.paidRevenue += invoice.amount;
			point.paidCount += 1;
		} else if (PENDING_STATUSES.has(invoice.status)) {
			point.unpaidRevenue += invoice.balance;
			point.unpaidCount += 1;
		}

		months.set(key, point);
	}

	return Array.from(months.values()).sort((a, b) => a.key.localeCompare(b.key));
}

function getRecentMonthKeys(count: number) {
	const now = new Date();
	return Array.from({ length: count }, (_, index) => {
		const date = new Date(
			now.getFullYear(),
			now.getMonth() - (count - 1 - index),
			1,
		);
		const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
		return { key, label: formatMonthLabel(date) };
	});
}

function createEmptyPoint(key: string, label: string): RevenueChartPoint {
	return {
		key,
		label,
		paidRevenue: 0,
		paidCount: 0,
		unpaidRevenue: 0,
		unpaidCount: 0,
	};
}

function formatMonthLabel(date: Date) {
	return new Intl.DateTimeFormat(undefined, { month: "short" }).format(date);
}

function FilterField({
	label,
	className = "",
	children,
}: {
	label: string;
	className?: string;
	children: ReactNode;
}) {
	return (
		<div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
			<span className="text-xs font-medium text-ink-3">{label}</span>
			{children}
		</div>
	);
}

const invoiceStatusStamp: Record<InvoiceStatus, string> = {
	paid: "hm-ts-stamp is-ok",
	unpaid: "hm-ts-stamp is-info",
	"partially-paid": "hm-ts-stamp is-warn",
	overdue: "hm-ts-stamp is-danger",
	canceled: "hm-ts-stamp is-paper",
	draft: "hm-ts-stamp is-paper",
};

function invoiceStatusLabel(status: InvoiceStatus) {
	if (status === "unpaid") return "sent";
	if (status === "partially-paid") return "partial";
	return status;
}

function formatDate(value: string) {
	return formatInvoiceDate(value, "ng");
}

function dueDateClassName(invoice: InvoiceRow) {
	if (invoice.status === "paid") return "font-medium text-ok";
	if (invoice.status === "canceled") return "text-ink-3";

	const dueDate = new Date(`${invoice.dueDate}T00:00:00`);
	if (Number.isNaN(dueDate.getTime())) return "text-ink-3";

	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const daysUntilDue = Math.ceil(
		(dueDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
	);

	if (daysUntilDue < 0 || invoice.status === "overdue") {
		return "font-medium text-danger";
	}
	if (daysUntilDue <= 7) return "font-medium text-warn";
	return "text-ink-3";
}
