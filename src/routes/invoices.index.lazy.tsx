import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createLazyFileRoute } from "@tanstack/react-router";
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
	X,
	XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import {
	startTransition,
	useEffect,
	useMemo,
	useState,
	useTransition,
} from "react";
import { Callout } from "#/components/redesign/callout";
import { ColumnChart } from "#/components/redesign/column-chart";
import {
	DataTable,
	type DataTableColumn,
} from "#/components/redesign/data-table";
import { EmptyState } from "#/components/redesign/empty-state";
import { Kpi, KpiStrip } from "#/components/redesign/kpi-strip";
import { Panel } from "#/components/redesign/panel";
import { SegmentedFilter } from "#/components/redesign/segmented-filter";
import {
	StatusPill,
	type StatusPillTone,
} from "#/components/redesign/status-pill";
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
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { PanelLoader } from "#/components/ui/panel-loader";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
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
import type {
	InvoiceDocumentType,
	InvoiceRecord,
	InvoiceStatus,
} from "#/features/invoices/types";
import { INVOICE_DOCUMENT_TYPE_LABELS } from "#/features/invoices/types";
import { useUnifiedAuth } from "#/lib/auth-hook";
import { assertImportFileSize } from "#/lib/import-limits";
import { useSupabaseSession } from "#/lib/supabase-session";
import {
	bulkDeleteOrArchive,
	convertProformaToInvoice,
	deleteEmptyDrafts,
	duplicate,
	getById as getInvoiceById,
	INVOICE_LIST_PAGE_SIZE,
	importCsv,
	listPage as listInvoicePage,
	listSummary as listInvoiceSummary,
	previewBulkCleanup,
	renumberInvoices,
	save,
	updateStatus,
} from "#/server/data/invoices";
import { recordPayment } from "#/server/data/payments";

type Id<_Table extends string> = string;

export const Route = createLazyFileRoute("/invoices/")({
	component: InvoicesIndex,
});

type InvoiceTypeFilter = "all" | "one-time" | "recurring";
type DocumentTypeFilter = "all" | InvoiceDocumentType;
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

type SegmentedStatusValue =
	| "all"
	| "draft"
	| "sent"
	| "paid"
	| "overdue"
	| "canceled";

function toSegmentedStatusValue(status: "all" | InvoiceStatus) {
	if (status === "unpaid" || status === "partially-paid") return "sent";
	return status as SegmentedStatusValue;
}

function fromSegmentedStatusValue(value: string): "all" | InvoiceStatus {
	if (value === "sent") return "unpaid";
	return value as "all" | InvoiceStatus;
}

function isEmptyDraftRow(invoice: {
	status: InvoiceStatus;
	customerName: string;
	amount: number;
}) {
	return (
		invoice.status === "draft" &&
		invoice.customerName.trim().length === 0 &&
		invoice.amount === 0
	);
}

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
	const queryClient = useQueryClient();
	const authState = useUnifiedAuth();
	const userId = authState.data?.user?.id;
	const { client: supabaseClient } = useSupabaseSession(userId);
	const requireSupabase = () => {
		if (!supabaseClient || !userId)
			throw new Error("Supabase session unavailable.");
		return { client: supabaseClient, userId };
	};

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
	const [chartVisible, setChartVisible] = useState(true);

	useEffect(() => {
		const stored = window.sessionStorage.getItem(
			STANDARD_INVOICE_IMPORT_STORAGE_KEY,
		);
		if (!stored) return;

		try {
			startTransition(() => {
				setImportedDraft(JSON.parse(stored) as ImportedInvoiceDraft);
				setCreateDocumentType("standard");
				setCreateOpen(true);
			});
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
			pageSize: INVOICE_LIST_PAGE_SIZE,
		}),
		[listArgs, pageCursor],
	);

	useEffect(() => {
		setPageCursors([null]);
		setPageIndex(0);
	}, [listSignature]);

	const {
		data: invoicesQuery,
		isPending: isInvoicesLoading,
		isError: isInvoicesError,
		refetch: refetchInvoices,
	} = useQuery({
		queryKey: ["supabase-invoices", "page", userId, pageArgs],
		queryFn: () => {
			const context = requireSupabase();
			return listInvoicePage(context.client, context.userId, pageArgs);
		},
		enabled: Boolean(supabaseClient && userId),
	});
	const { data: invoiceSummaryQuery } = useQuery({
		queryKey: ["supabase-invoices", "summary", userId, listArgs],
		queryFn: () => {
			const context = requireSupabase();
			return listInvoiceSummary(context.client, context.userId, listArgs);
		},
		enabled: Boolean(supabaseClient && userId),
	});

	const invoices = (invoicesQuery?.page ?? []) as InvoiceRecord[];
	const currencySummaries = (invoiceSummaryQuery?.currencySummaries ??
		[]) as CurrencySummary[];
	const chartDataByCurrency = (invoiceSummaryQuery?.chartDataByCurrency ??
		{}) as Record<string, RevenueChartPoint[]>;
	const paymentScore = (invoiceSummaryQuery &&
	"paymentScore" in invoiceSummaryQuery
		? invoiceSummaryQuery.paymentScore
		: undefined) ?? {
		score: 0,
		status: "no_data",
		paidInvoiceCount: 0,
		onTimeCount: 0,
		averageDaysToPay: null,
	};
	const activeInvoiceEnabled = activeInvoiceId !== null;
	const { data: activeInvoice } = useQuery({
		queryKey: ["supabase-invoices", "detail", userId, activeInvoiceId],
		queryFn: () => {
			const context = requireSupabase();
			if (!activeInvoiceId) return null;
			return getInvoiceById(context.client, context.userId, activeInvoiceId);
		},
		enabled: activeInvoiceEnabled && Boolean(supabaseClient && userId),
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
	const columnChartData = useMemo(
		() =>
			revenueChartData.map((point) => ({
				label: point.label,
				open: point.unpaidRevenue,
				paid: point.paidRevenue,
			})),
		[revenueChartData],
	);
	const visibleStatusCounts = useMemo(() => {
		const counts = { draft: 0, sent: 0, canceled: 0 };
		for (const invoice of rows) {
			if (invoice.status === "draft") counts.draft += 1;
			else if (
				invoice.status === "unpaid" ||
				invoice.status === "partially-paid"
			)
				counts.sent += 1;
			else if (invoice.status === "canceled") counts.canceled += 1;
		}
		return counts;
	}, [rows]);
	const segmentedStatusValue = toSegmentedStatusValue(statusFilter);
	const segmentedStatusOptions = [
		{ value: "all", label: "All", count: selectedCurrencySummary.totalCount },
		{ value: "draft", label: "Draft", count: visibleStatusCounts.draft },
		{ value: "sent", label: "Sent", count: visibleStatusCounts.sent },
		{ value: "paid", label: "Paid", count: selectedCurrencySummary.paidCount },
		{
			value: "overdue",
			label: "Overdue",
			count: selectedCurrencySummary.overdueCount,
		},
		{
			value: "canceled",
			label: "Canceled",
			count: visibleStatusCounts.canceled,
		},
	];
	const emptyDrafts = useMemo(
		() => rows.filter((invoice) => isEmptyDraftRow(invoice)),
		[rows],
	);
	// When every empty draft is selected, the red bulk bar is the single delete
	// affordance; the amber callout stands down so two rows don't compete.
	const allEmptyDraftsSelected =
		emptyDrafts.length > 0 &&
		emptyDrafts.every((invoice) =>
			selectedInvoiceIds.has(invoice.id as Id<"invoices">),
		);
	const paymentScoreStatusLabel = {
		no_data: "No paid history",
		excellent: "Excellent",
		good: "Good",
		fair: "Fair",
		slow: "Needs attention",
	}[paymentScore.status];
	const paymentScoreSub =
		paymentScore.paidInvoiceCount === 0
			? paymentScoreStatusLabel
			: `${paymentScoreStatusLabel} · ${paymentScore.onTimeCount}/${paymentScore.paidInvoiceCount} on time`;
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

	const selectEmptyDrafts = () => {
		const ids = emptyDrafts.map((invoice) => invoice.id as Id<"invoices">);
		if (ids.length === 0) return;
		startTransition(() => {
			setStatusFilter("draft");
			setSelectedInvoiceIds(new Set(ids));
		});
	};

	const clearSelection = () => {
		setSelectedInvoiceIds(new Set());
	};

	const openCleanupConfirmation = async (ids: Id<"invoices">[]) => {
		if (ids.length === 0 || bulkActionPending) return;
		setBulkActionPending(true);
		try {
			const { client, userId } = requireSupabase();
			const preview = (await previewBulkCleanup(
				client,
				userId,
				ids,
			)) as CleanupPreview;
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
			const { client, userId } = requireSupabase();
			const result = await bulkDeleteOrArchive(client, userId, ids);
			await queryClient.invalidateQueries({
				queryKey: ["supabase-invoices"],
			});
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
			const { client, userId } = requireSupabase();
			const result = await renumberInvoices(client, userId, ids);
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
			const { client, userId } = requireSupabase();
			const result = await deleteEmptyDrafts(client, userId);
			await queryClient.invalidateQueries({
				queryKey: ["supabase-invoices"],
			});
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

	const openNewInvoiceSheet = () => {
		startTransition(() => {
			setImportedDraft(null);
			setCreateDocumentType("standard");
			setCreateOpen(true);
		});
	};

	const invoiceColumns: DataTableColumn<InvoiceRow>[] = [
		{
			key: "invoice",
			header: "Invoice",
			render: (invoice) => (
				<button
					type="button"
					onClick={() => setActiveInvoiceId(invoice.id as Id<"invoices">)}
					className="block min-w-0 max-w-full text-left"
				>
					{/* A visually-hidden prefix keeps "Edit invoice" in the
					    computed name while every visible span (number, customer,
					    duplicate badge) stays part of it — WCAG 2.5.3. */}
					<span className="sr-only">Edit invoice </span>
					<span className="block truncate font-mono text-[13px] font-medium text-ink">
						{invoice.invoiceNumber}
					</span>
					{invoice.customerName.trim() ? (
						<span className="mt-1 block truncate text-xs text-ink-3">
							{invoice.customerName}
						</span>
					) : (
						<span className="mt-1 block text-xs text-ink-3 italic">
							No customer yet
						</span>
					)}
					{duplicateInvoiceNumbers.has(invoice.invoiceNumber) ? (
						<span className="mt-1 inline-flex w-fit items-center gap-1 rounded-md border border-danger-line bg-danger-soft px-1.5 py-0.5 text-[10px] font-medium text-danger">
							<CircleAlert className="h-3 w-3" />
							Duplicate number
						</span>
					) : null}
				</button>
			),
		},
		{
			key: "status",
			header: "Status",
			render: (invoice) => (
				<span className="flex items-center gap-2">
					<StatusPill tone={invoiceStatusPillTone(invoice.status)}>
						{invoiceStatusDisplayLabel(invoice.status)}
					</StatusPill>
					{invoice.lifecycle?.sentAt ? (
						<span className="inline-flex items-center rounded-md border border-rule bg-paper-3 px-1.5 py-0.5 text-[10px] text-brand">
							Sent
						</span>
					) : null}
					{invoice.lifecycle?.firstViewedAt ? (
						<span className="inline-flex items-center rounded-md border border-rule bg-paper-3 px-1.5 py-0.5 text-[10px] text-info">
							Viewed
						</span>
					) : null}
				</span>
			),
		},
		{
			key: "due",
			header: "Due",
			render: (invoice) => (
				<span
					className={`font-num whitespace-nowrap tabular-nums ${dueDateClassName(invoice)}`}
					title={formatDate(invoice.dueDate)}
				>
					{formatDate(invoice.dueDate)}
				</span>
			),
		},
		{
			key: "issued",
			header: "Issued",
			render: (invoice) => (
				<span className="font-num whitespace-nowrap text-ink-3 tabular-nums">
					{formatDate(invoice.issueDate)}
				</span>
			),
		},
		{
			key: "type",
			header: "Type",
			render: (invoice) => (
				<span className="flex flex-col gap-1 capitalize">
					<span className="text-ink-2">
						{INVOICE_DOCUMENT_TYPE_LABELS[invoice.documentType ?? "standard"]}
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
				</span>
			),
		},
		{
			key: "amount",
			header: "Amount",
			align: "right",
			render: (invoice) => (
				<span
					className={`font-num whitespace-nowrap tabular-nums ${invoice.amount === 0 ? "text-ink-3" : "font-medium text-ink"}`}
				>
					{formatMoney(invoice.amount, invoice.currency)}
				</span>
			),
		},
	];

	const renderInvoiceRowActions = (invoice: InvoiceRow) => (
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
					onClick={() => setActiveInvoiceId(invoice.id as Id<"invoices">)}
					className="focus:bg-brand-soft"
				>
					<FileEdit className="mr-2 h-4 w-4" />
					Edit invoice
				</DropdownMenuItem>
				<DropdownMenuItem
					onClick={() =>
						window.open(`/i/${invoice.token}`, "_blank", "noopener,noreferrer")
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
				<DropdownMenuItem asChild className="focus:bg-brand-soft">
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
				{duplicateInvoiceNumbers.has(invoice.invoiceNumber) ? (
					<DropdownMenuItem
						onClick={() =>
							void onRenumberInvoices([invoice.id as Id<"invoices">])
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
							void openCleanupConfirmation([invoice.id as Id<"invoices">])
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
						onClick={() => void onConvertProforma(invoice.id)}
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
							onClick={() => void onRecordFullPayment(invoice)}
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
					onClick={() => {
						// `onStatusChange` rethrows after toasting; swallow here
						// so the fire-and-forget menu item has no unhandled
						// rejection (the sheet keeps its own guard).
						void onStatusChange(invoice.id, "canceled").catch(() => undefined);
					}}
					className="text-danger focus:bg-danger-soft focus:text-danger"
				>
					<XCircle className="mr-2 h-4 w-4" />
					Cancel
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);

	const invoiceToolbar = (
		<>
			<div className="flex h-9 min-w-0 flex-1 basis-52 items-center gap-2 rounded-md border border-rule bg-paper px-3">
				<Search className="h-4 w-4 shrink-0 text-ink-3" />
				<input
					value={query}
					onChange={(event) =>
						startTransition(() => setQuery(event.target.value))
					}
					placeholder="Search invoice number or customer"
					aria-label="Search invoice number or customer"
					className="h-full w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-3"
				/>
			</div>
			<div className="min-w-0 max-w-full overflow-x-auto">
				<SegmentedFilter
					options={segmentedStatusOptions}
					value={segmentedStatusValue}
					onChange={(value) =>
						startTransition(() =>
							setStatusFilter(fromSegmentedStatusValue(value)),
						)
					}
				/>
			</div>
			<AdvancedInvoiceFilters
				customers={customers}
				customerFilter={customerFilter}
				onCustomerFilterChange={setCustomerFilter}
				typeFilter={typeFilter}
				onTypeFilterChange={setTypeFilter}
				documentTypeFilter={documentTypeFilter}
				onDocumentTypeFilterChange={setDocumentTypeFilter}
				dueDateFilter={dueDateFilter}
				onDueDateFilterChange={applyDueDateFilter}
				activeFilterCount={activeFilterCount}
				hasActiveFilters={hasActiveFilters}
				onClearFilters={clearFilters}
			/>
			{duplicateRowCount > 0 ? (
				<button
					type="button"
					onClick={selectDuplicateRows}
					className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-danger-line bg-danger-soft px-3 text-xs font-medium text-danger transition-colors hover:bg-danger-soft"
				>
					<CircleAlert className="h-4 w-4" />
					{duplicateRowCount} duplicate row
					{duplicateRowCount === 1 ? "" : "s"}
				</button>
			) : null}
		</>
	);

	const invoiceFooter = (
		<>
			<span className="font-num tabular-nums">
				Showing {rows.length} of {selectedCurrencySummary.totalCount}
			</span>
			<div className="flex items-center gap-2">
				<span className="font-num mr-1 tabular-nums">Page {pageIndex + 1}</span>
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
		</>
	);

	const invoiceEmptyState = hasActiveFilters ? (
		<EmptyState
			icon={<Search className="h-4 w-4" />}
			title="No invoices match"
			copy="Try another status or clear the search."
			action={
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={clearFilters}
				>
					Clear search and filters
				</Button>
			}
		/>
	) : (
		<EmptyState
			icon={<ReceiptText className="h-4 w-4" />}
			title="No invoices yet."
			copy="Create an invoice, add a client email, then share the Paystack-enabled public link."
			action={
				<Button
					type="button"
					size="sm"
					onClick={openNewInvoiceSheet}
					className="h-9 rounded-md bg-brand px-3 text-sm font-medium text-brand-ink hover:bg-brand-hi"
				>
					New invoice
				</Button>
			}
		/>
	);

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
		const { client, userId } = requireSupabase();
		await duplicate(client, userId, id);
		toast({ title: "Invoice duplicated", variant: "success" });
	};

	const onConvertProforma = async (id: string) => {
		const { client, userId } = requireSupabase();
		await convertProformaToInvoice(client, userId, id);
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
		const { client, userId } = requireSupabase();
		try {
			await updateStatus(client, userId, { id, status, ...details });
		} catch (error) {
			toast({
				title: "Status update failed",
				description: error instanceof Error ? error.message : "Try again.",
				variant: "error",
			});
			// Rethrow so optimistic callers skip their local state update.
			throw error;
		}
		await queryClient.invalidateQueries({ queryKey: ["supabase-invoices"] });
		toast({
			title: "Status updated",
			description: `Marked as ${status}.`,
			variant: "success",
		});
	};

	const onRecordFullPayment = async (invoice: InvoiceRow) => {
		const amount = invoice.balance > 0 ? invoice.balance : invoice.amount;
		const { client, userId } = requireSupabase();
		try {
			await recordPayment(client, userId, {
				invoiceId: invoice.id,
				amount,
				reference: invoice.paymentReference,
			});
		} catch (error) {
			toast({
				title: "Couldn't mark as paid",
				description: error instanceof Error ? error.message : "Try again.",
				variant: "error",
			});
			return;
		}
		await queryClient.invalidateQueries({ queryKey: ["supabase-invoices"] });
		toast({
			title: "Payment recorded",
			description: `Recorded ${formatMoney(amount, invoice.currency)}.`,
			variant: "success",
		});
	};

	const onInvoiceImport = async (file: File | undefined) => {
		if (!file) return;

		try {
			// Applied before the file is read: a larger file is refused while it
			// is still on disk instead of building the whole text plus a full
			// 2-D grid in memory first.
			assertImportFileSize(file.size);
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
				const { client, userId } = requireSupabase();
				const result = await importCsv(client, userId, rows);
				const issueCount = result.errors?.length ?? 0;
				// B2/B3 import flags report rows demoted to Draft because their
				// buyer or line classifications need attention.
				const buyerNote =
					result.needsBuyerMatch > 0
						? `, ${result.needsBuyerMatch} without a linked buyer`
						: "";
				const classificationNote =
					result.needsLineClassification > 0
						? `, ${result.needsLineClassification} need complete line classification`
						: "";
				toast({
					title: "Invoice import finished",
					description: `${result.created} created, ${result.skipped} skipped${
						issueCount > 0 ? `, ${issueCount} row issues reported` : ""
					}${buyerNote}${classificationNote}.`,
					variant: "success",
				});
				return;
			}

			const draft = parseInvoiceDraftGrid(grid);
			if (draft) {
				startTransition(() => {
					setImportedDraft(draft);
					setCreateDocumentType("standard");
					setCreateOpen(true);
				});
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
		<div className="flex h-full w-full min-w-0 max-w-full flex-col gap-4">
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
					<Button
						type="button"
						onClick={() => {
							// Mounting the editor is heavy (line items, tiptap notes);
							// keep it concurrent so the sheet slide-in keeps compositing.
							startTransition(() => {
								setImportedDraft(null);
								setCreateDocumentType("standard");
								setCreateOpen(true);
							});
						}}
						className="h-10 rounded-md bg-brand px-4 text-sm font-medium text-brand-ink hover:bg-brand-hi"
					>
						New invoice
					</Button>
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

			<KpiStrip>
				<Kpi
					label="Open"
					tone="warn"
					value={
						isInvoicesLoading
							? "…"
							: formatCompactMoney(
									selectedCurrencySummary.openAmount,
									summaryCurrency,
								)
					}
					sub={`${selectedCurrencySummary.openCount} ${summaryCurrency} invoices`}
				/>
				<Kpi
					label="Overdue"
					tone="danger"
					value={
						isInvoicesLoading
							? "…"
							: formatCompactMoney(
									selectedCurrencySummary.overdueAmount,
									summaryCurrency,
								)
					}
					sub={`${selectedCurrencySummary.overdueCount} ${summaryCurrency} invoices`}
				/>
				<Kpi
					label="Paid"
					tone="ok"
					value={
						isInvoicesLoading
							? "…"
							: formatCompactMoney(
									selectedCurrencySummary.paidAmount,
									summaryCurrency,
								)
					}
					sub={`${selectedCurrencySummary.paidCount} ${summaryCurrency} invoices`}
				/>
				<Kpi
					label="Payment score"
					tone="info"
					value={isInvoicesLoading ? "…" : String(paymentScore.score)}
					sub={paymentScoreSub}
				/>
			</KpiStrip>

			{emptyDrafts.length > 0 && !allEmptyDraftsSelected ? (
				<Callout
					tone="warn"
					title={`${emptyDrafts.length} empty draft${emptyDrafts.length === 1 ? "" : "s"}`}
					action={{ label: "Select them", onClick: selectEmptyDrafts }}
				>
					These drafts have no customer and a {formatMoney(0, summaryCurrency)}{" "}
					total. They count toward your open invoices and the reminder queue.
					<span className="mt-2 block">
						<button
							type="button"
							onClick={() => void onDeleteEmptyDrafts()}
							disabled={bulkActionPending}
							className="font-medium text-danger underline-offset-2 hover:underline disabled:opacity-50"
						>
							Delete empty drafts
						</button>
					</span>
				</Callout>
			) : null}

			<Panel
				title="Billed by month"
				sub="Open and paid invoice value"
				actions={
					<Button
						type="button"
						variant="ghost"
						size="sm"
						aria-pressed={chartVisible}
						onClick={() => setChartVisible((current) => !current)}
					>
						{chartVisible ? "Hide" : "Show"}
					</Button>
				}
			>
				{chartVisible ? (
					<ColumnChart
						data={columnChartData}
						series={[
							{ key: "open", label: "Open", color: "var(--color-warn)" },
							{ key: "paid", label: "Paid", color: "var(--hm-ok)" },
						]}
						height={210}
					/>
				) : null}
			</Panel>

			{isInvoicesError ? (
				<Callout
					tone="bad"
					title="Could not load invoices"
					action={{ label: "Retry", onClick: () => void refetchInvoices() }}
				>
					The invoice list failed to load. Check your connection and try again.
				</Callout>
			) : null}

			{isInvoicesLoading ? (
				<PanelLoader label="Loading invoices" />
			) : (
				<section
					aria-label="Invoice list"
					className="min-w-0 overflow-hidden rounded-lg border border-rule bg-paper"
				>
					<DataTable
						columns={invoiceColumns}
						rows={rows}
						keyOf={(invoice) => invoice.id}
						selected={selectedInvoiceIds}
						onToggle={(id) => toggleInvoiceSelection(id as Id<"invoices">)}
						onToggleAll={() => toggleAllVisibleSelection(!allVisibleSelected)}
						toolbar={invoiceToolbar}
						bulkBar={
							selectedCount > 0 ? (
								<>
									<strong className="font-num font-medium tabular-nums">
										{selectedCount} selected
									</strong>
									<span className="flex-1" />
									<div className="flex items-center gap-1">
										<Button
											type="button"
											variant="ghost"
											size="icon"
											className="h-8 w-8"
											title="Renumber selected"
											aria-label="Renumber selected invoices"
											onClick={() =>
												void onRenumberInvoices(
													selectedRows.map(
														(invoice) => invoice.id as Id<"invoices">,
													),
												)
											}
											disabled={bulkActionPending}
										>
											<Wrench className="h-4 w-4" />
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											className="h-8 w-8 text-ink-2 hover:bg-danger-soft hover:text-danger"
											title="Delete selected"
											aria-label="Delete selected invoices"
											onClick={() =>
												void openCleanupConfirmation(
													selectedRows.map(
														(invoice) => invoice.id as Id<"invoices">,
													),
												)
											}
											disabled={bulkActionPending}
										>
											<Trash2 className="h-4 w-4" />
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											className="h-8 w-8"
											title="Clear selection"
											aria-label="Clear selection"
											onClick={clearSelection}
										>
											<X className="h-4 w-4" />
										</Button>
									</div>
								</>
							) : undefined
						}
						rowActions={renderInvoiceRowActions}
						footer={invoiceFooter}
						emptyState={invoiceEmptyState}
					/>
				</section>
			)}

			<InvoiceDetailsSheet
				open={activeInvoiceId !== null}
				onOpenChange={(open) => {
					if (!open) setActiveInvoiceId(null);
				}}
				invoice={activeInvoice as InvoiceRecord | null | undefined}
				onSave={async (invoice) => {
					const saveable = toInvoiceSaveInput(invoice);
					const { client, userId } = requireSupabase();
					await save(client, userId, {
						...saveable,
						scheduledAt: saveable.scheduledAt
							? new Date(saveable.scheduledAt).toISOString()
							: undefined,
					});
				}}
				onStatusChange={async (id, status, details) => {
					await onStatusChange(id, status, details);
				}}
				onRecordPayment={async (id, amount, reference) => {
					const { client, userId } = requireSupabase();
					try {
						await recordPayment(client, userId, {
							invoiceId: id,
							amount,
							reference,
						});
					} catch (error) {
						toast({
							title: "Couldn't mark as paid",
							description:
								error instanceof Error ? error.message : "Try again.",
							variant: "error",
						});
						// Rethrow so the sheet skips its optimistic paid state.
						throw error;
					}
					await queryClient.invalidateQueries({
						queryKey: ["supabase-invoices"],
					});
					toast({
						title: "Payment recorded",
						description: "Invoice marked as paid.",
						variant: "success",
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

function AdvancedInvoiceFilters({
	customers,
	customerFilter,
	onCustomerFilterChange,
	typeFilter,
	onTypeFilterChange,
	documentTypeFilter,
	onDocumentTypeFilterChange,
	dueDateFilter,
	onDueDateFilterChange,
	activeFilterCount,
	hasActiveFilters,
	onClearFilters,
}: {
	customers: string[];
	customerFilter: string;
	onCustomerFilterChange: (value: string) => void;
	typeFilter: InvoiceTypeFilter;
	onTypeFilterChange: (value: InvoiceTypeFilter) => void;
	documentTypeFilter: DocumentTypeFilter;
	onDocumentTypeFilterChange: (value: DocumentTypeFilter) => void;
	dueDateFilter: DueDateFilter;
	onDueDateFilterChange: (value: DueDateFilter) => void;
	activeFilterCount: number;
	hasActiveFilters: boolean;
	onClearFilters: () => void;
}) {
	return (
		<span className="inline-flex shrink-0 items-center gap-2">
			<details className="group relative">
				<summary className="flex h-9 cursor-pointer list-none items-center justify-center gap-2 rounded-md border border-rule bg-paper px-3 text-sm font-medium text-ink-2 transition-colors hover:bg-paper-3 group-open:border-brand-line group-open:text-ink [&::-webkit-details-marker]:hidden">
					<SlidersHorizontal className="h-4 w-4 text-brand" />
					<span>Filters</span>
					{activeFilterCount > 0 ? (
						<span className="inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1.5 font-num text-[11px] font-semibold text-brand-ink tabular-nums">
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
										onCustomerFilterChange(event.target.value),
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
									onTypeFilterChange(value as InvoiceTypeFilter),
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
									onDocumentTypeFilterChange(value as DocumentTypeFilter),
								)
							}
						>
							<SelectTrigger className="h-10 w-full rounded-md border-rule bg-paper text-ink">
								<SelectValue placeholder="All document kinds" />
							</SelectTrigger>
							<SelectContent className="border-rule bg-paper-2 text-ink">
								<SelectItem value="all">All document kinds</SelectItem>
								<SelectItem value="standard">Standard</SelectItem>
								<SelectItem value="credit_note">Credit note</SelectItem>
								<SelectItem value="debit_note">Debit note</SelectItem>
								<SelectItem value="proforma">Pro-forma</SelectItem>
							</SelectContent>
						</Select>
					</FilterField>

					<FilterField label="Due">
						<Select
							value={dueDateFilter}
							onValueChange={(value) =>
								startTransition(() =>
									onDueDateFilterChange(value as DueDateFilter),
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
					onClick={onClearFilters}
					className="h-9 shrink-0 rounded-md px-3 text-sm font-medium text-brand transition-colors hover:bg-brand-soft hover:text-brand-hi"
				>
					Clear
				</button>
			) : null}
		</span>
	);
}

function invoiceStatusPillTone(status: InvoiceStatus): StatusPillTone {
	switch (status) {
		case "paid":
			return "ok";
		case "unpaid":
		case "partially-paid":
			return "warn";
		case "overdue":
			return "bad";
		default:
			return "mute";
	}
}

function invoiceStatusDisplayLabel(status: InvoiceStatus) {
	const label = invoiceStatusLabel(status);
	return label.charAt(0).toUpperCase() + label.slice(1);
}

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
