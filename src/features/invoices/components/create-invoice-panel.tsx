import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery } from "@tanstack/react-query";
import {
	CalendarDays,
	Check,
	ChevronDown,
	CircleAlert,
	Copy,
	DollarSign,
	Download,
	ExternalLink,
	FileText,
	GripVertical,
	ImagePlus,
	Loader2,
	Minus,
	Plus,
	ReceiptText,
	Search,
	Settings2,
	X,
} from "lucide-react";
import {
	type ChangeEvent,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { DatePicker } from "#/components/navigation/DatePicker";
import { Button } from "#/components/ui/button";
import { Calendar } from "#/components/ui/calendar";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "#/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { Input } from "#/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "#/components/ui/tooltip";
import { toast } from "#/components/ui/use-toast";
import { calculateInvoiceCompliance } from "#/features/compliance/calculate";
import {
	defaultTaxTreatmentForSellerTaxStatus,
	defaultWithholdingSelection,
	NIGERIA_FOREIGN_CURRENCY_WARNING,
	NIGERIA_TAX_RULE_SET_VERSION,
	NIGERIA_VAT_RATE,
	SELLER_TAX_STATUS_OPTIONS,
	WITHHOLDING_CATEGORY_OPTIONS,
	WITHHOLDING_ENTITY_TYPE_OPTIONS,
	WITHHOLDING_RESIDENCY_OPTIONS,
} from "#/features/compliance/nigeria";
import {
	netPayableFromCompliance,
	PERSISTABLE_WARNING_CODES,
} from "#/features/compliance/persist";
import type {
	InvoiceComplianceSnapshot,
	JurisdictionCode,
	SellerTaxStatus,
	TaxTreatment,
	TemplateVariant,
	WithholdingCategory,
	WithholdingRecipientEntityType,
	WithholdingRecipientResidency,
} from "#/features/compliance/types";
import { formatMoney } from "#/features/invoices/format";
import type { ImportedInvoiceDraft } from "#/features/invoices/import-spreadsheet";
import { lineTotalKobo, priceToKobo } from "#/features/invoices/line-money";
import { toEditorDoc } from "#/features/invoices/midday-adapter";
import type {
	InvoiceDocumentType,
	InvoiceLineItem,
	InvoiceTemplateSettings,
} from "#/features/invoices/types";
import {
	INVOICE_DOCUMENT_TYPE_LABELS,
	isCorrectionDocumentType,
} from "#/features/invoices/types";
import {
	UNIT_OPTIONS,
	VAT_CATEGORY_OPTIONS,
} from "#/features/products/product-form-utils";
import { useUnifiedAuth } from "#/lib/auth-hook";
import type { EditorDoc } from "#/lib/midday-invoice/types";
import { useSupabaseSession } from "#/lib/supabase-session";
import { createClient, listClients } from "#/server/data/clients";
import {
	autosaveDraft,
	createDraft,
	getTemplateDefaults,
	list as listInvoices,
	saveTemplateDefaults,
} from "#/server/data/invoices";
import { searchProducts } from "#/server/data/products";
import { getInvoiceWorkspaceSettings } from "#/server/data/workspaces";
import { cn } from "#/utils/cn";

import { NotesEditor } from "./editor/notes-editor";
import { InlineLabelInput } from "./inline-label-input";

type LineItem = InvoiceLineItem;

type CreateInvoicePanelProps = {
	mode?: "page" | "sheet";
	onCreated?: (invoiceId: string) => void;
	initialDraft?: ImportedInvoiceDraft | null;
	initialDocumentType?: InvoiceDocumentType;
};

type ComposerStage = "editor" | "success";

type CreateIntent = "create" | "open" | "create_and_send" | "scheduled";
type AutosaveStatus = "idle" | "saving" | "saved" | "error";
type DepositRequestKind = "amount" | "percentage";

type CreatedInvoiceSummary = {
	id: string;
	token: string;
	documentType: InvoiceDocumentType;
	invoiceNumber: string;
	dueDate: string;
	customerName: string;
	customerEmail: string;
	total: number;
};

type SellerProfileType = "freelancer" | "business";

const INVOICE_CURRENCY_OPTIONS = [
	{ code: "NGN", symbol: "₦", label: "NGN" },
	{ code: "USD", symbol: "$", label: "USD" },
	{ code: "GBP", symbol: "£", label: "GBP" },
] as const;

const TEMPLATE_OPTIONS = [
	{ value: "Default NG", description: "Standard domestic invoice." },
	{
		value: "Cross-border",
		description: "Foreign-currency invoice with CBN note.",
	},
	{ value: "VAT-ready", description: "Domestic VAT collection template." },
] as const;

const DOCUMENT_SIZE_OPTIONS = [
	{ value: "A4", label: "A4" },
	{ value: "LETTER", label: "Letter" },
] as const;

const DATE_FORMAT_OPTIONS = [
	{ value: "ng", label: "DD/MM/YYYY" },
	{ value: "iso", label: "YYYY-MM-DD" },
	{ value: "us", label: "MM/DD/YYYY" },
] as const;

const PAYMENT_TERM_OPTIONS = [7, 14, 30] as const;
const DOCUMENT_TYPE_OPTIONS = [
	{
		value: "standard",
		label: INVOICE_DOCUMENT_TYPE_LABELS.standard,
	},
	{
		value: "credit_note",
		label: INVOICE_DOCUMENT_TYPE_LABELS.credit_note,
	},
	{
		value: "debit_note",
		label: INVOICE_DOCUMENT_TYPE_LABELS.debit_note,
	},
	{
		value: "proforma",
		label: INVOICE_DOCUMENT_TYPE_LABELS.proforma,
	},
] as const;

type InvoiceDateFormat = (typeof DATE_FORMAT_OPTIONS)[number]["value"];

const TAX_SETTING_OPTIONS = [
	{ value: "none", label: "No tax" },
	{ value: "exclusive_rate", label: `VAT ${NIGERIA_VAT_RATE}%` },
	{ value: "exempt", label: "Exempt" },
] as const satisfies ReadonlyArray<{ value: TaxTreatment; label: string }>;

const PAYMENT_DETAILS_PLACEHOLDER =
	"Add bank details, wallet address, or payment instructions";
const NOTE_PLACEHOLDER =
	"E.g. Thank you for your business. Payment due within 14 days.";
const LINE_ITEM_GRID_COLUMNS =
	"@md:grid-cols-[minmax(0,1.4fr)_112px_minmax(0,1fr)_minmax(0,1.1fr)_32px]";

type SupportedCurrency = (typeof INVOICE_CURRENCY_OPTIONS)[number]["code"];
type SupportedTemplateName = (typeof TEMPLATE_OPTIONS)[number]["value"];
const CURRENCY_COUNTRIES: Record<SupportedCurrency, JurisdictionCode> = {
	NGN: "NG",
	GBP: "GB",
	USD: "US",
};

function getCountryCodeFromCurrency(currency: string): JurisdictionCode {
	return (
		CURRENCY_COUNTRIES[currency.toUpperCase() as SupportedCurrency] ?? "OTHER"
	);
}

function normalizeCurrency(value?: string | null): SupportedCurrency {
	const normalized = value?.trim().toUpperCase();
	return normalized && normalized in CURRENCY_COUNTRIES
		? (normalized as SupportedCurrency)
		: "NGN";
}

function toIsoDate(value: Date) {
	return [
		value.getFullYear(),
		String(value.getMonth() + 1).padStart(2, "0"),
		String(value.getDate()).padStart(2, "0"),
	].join("-");
}

function fromIsoDate(value: string) {
	const date = new Date(`${value}T00:00:00`);
	if (Number.isNaN(date.getTime())) return undefined;
	return date;
}

function buildIssueDate() {
	return toIsoDate(new Date());
}

function buildDueDate(termDays = 14, fromValue = buildIssueDate()) {
	const baseDate = new Date(`${fromValue}T00:00:00`);
	baseDate.setDate(baseDate.getDate() + termDays);
	return toIsoDate(baseDate);
}

function generateInvoiceNumber(
	settings?: {
		name?: string;
		invoiceNumberMode?: "prefix" | "business_name";
		invoiceNumberPrefix?: string;
		nextInvoiceSequence?: number;
	},
	documentType: InvoiceDocumentType = "standard",
) {
	const prefixSource =
		documentType === "proforma"
			? "PF"
			: documentType === "credit_note"
				? "CN"
				: documentType === "debit_note"
					? "DN"
					: settings?.invoiceNumberMode === "business_name"
						? settings.name
						: settings?.invoiceNumberPrefix;
	const prefix =
		(prefixSource || "INV")
			.trim()
			.toUpperCase()
			.replace(/[^A-Z0-9]/g, "")
			.slice(0, 12) || "INV";
	const sequence = Math.max(1, settings?.nextInvoiceSequence ?? 1);
	const width = prefix === "INV" ? 6 : 4;
	return `${prefix}-${new Date().getFullYear()}-${String(sequence).padStart(width, "0")}`;
}

function formatDate(value: string, format: InvoiceDateFormat) {
	const date = fromIsoDate(value);
	if (!date) return value;
	if (format === "iso") return value;
	return date.toLocaleDateString(format === "ng" ? "en-GB" : "en-US", {
		day: "2-digit",
		month: "2-digit",
		year: "numeric",
	});
}

function InvoiceDateField({
	value,
	onChange,
	format,
	label,
	min,
}: {
	value: string;
	onChange: (value: string) => void;
	format: InvoiceDateFormat;
	label: string;
	min?: string;
}) {
	const [open, setOpen] = useState(false);
	const selectedDate = fromIsoDate(value);
	const minimumDate = min ? fromIsoDate(min) : undefined;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					aria-label={label}
					className="mt-1 inline-flex h-auto max-w-full items-center gap-2 border-0 bg-transparent p-0 font-mono text-[14px] text-ink hover:bg-transparent hover:text-ink-3"
				>
					<span className="truncate">{formatDate(value, format)}</span>
					<CalendarDays className="h-4 w-4 shrink-0 text-ink-3" />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-auto border-rule bg-paper p-0">
				<Calendar
					mode="single"
					selected={selectedDate}
					defaultMonth={selectedDate}
					disabled={minimumDate ? { before: minimumDate } : undefined}
					onSelect={(date) => {
						if (!date) return;
						onChange(toIsoDate(date));
						setOpen(false);
					}}
				/>
			</PopoverContent>
		</Popover>
	);
}

function sanitizeDecimalInput(raw: string) {
	let result = "";
	let hasDot = false;
	for (let i = 0; i < raw.length; i++) {
		const character = raw[i];
		if (i === 0 && character === "-") {
			result += character;
			continue;
		}
		if (character >= "0" && character <= "9") {
			result += character;
			continue;
		}
		if (character === "." && !hasDot) {
			result += character;
			hasDot = true;
		}
	}
	return result;
}

function parsePriceInput(raw: string) {
	return priceToKobo(raw) / 100;
}

function formatPriceInput(price: number) {
	return new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(
		priceToKobo(price) / 100,
	);
}

function toPersistableCompliance(compliance: InvoiceComplianceSnapshot) {
	const {
		netPayable: _netPayable,
		sellerTaxStatus: _sellerTaxStatus,
		...persistableCompliance
	} = compliance;
	return {
		...persistableCompliance,
		warnings: compliance.warnings.filter((warning) =>
			PERSISTABLE_WARNING_CODES.has(warning),
		),
	};
}

function sanitizeTinInput(raw: string) {
	return raw.replace(/\D/g, "").slice(0, 10);
}

function sanitizeRcInput(raw: string) {
	return raw.toUpperCase().replace(/\s+/g, "").slice(0, 10);
}

function CreateSortableLineItem({
	id,
	className,
	children,
}: {
	id: string;
	className?: string;
	children: ReactNode;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={cn(
				"group relative flex min-w-0 items-start gap-2 border border-rule bg-paper px-2 py-2 md:gap-3",
				className,
			)}
		>
			<button
				type="button"
				className="inline-flex h-8 w-8 shrink-0 cursor-grab touch-none items-center justify-center text-ink-3 hover:text-ink active:cursor-grabbing"
				aria-label="Drag to reorder"
				{...attributes}
				{...listeners}
			>
				<GripVertical className="h-4 w-4" />
			</button>
			<div className="min-w-0 flex-1">{children}</div>
		</div>
	);
}

function createEmptyLineItem(): LineItem {
	return {
		id: `li-${crypto.randomUUID()}`,
		name: "",
		quantity: 1,
		price: 0,
		unit: "",
	};
}

function resolveTemplateVariant(
	templateName: SupportedTemplateName,
): TemplateVariant {
	if (templateName === "Cross-border") return "cross_border";
	if (templateName === "VAT-ready") return "vat_ready";
	return "default_ng";
}

function pillClassName(isActive: boolean) {
	return cn(
		"inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[12px] font-medium transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out",
		isActive
			? "border-brand bg-brand text-brand-ink"
			: "border-rule bg-paper text-ink-2 hover:bg-paper-2 hover:text-ink",
	);
}

export function CreateInvoicePanel({
	mode = "page",
	onCreated,
	initialDraft,
	initialDocumentType = "standard",
}: CreateInvoicePanelProps) {
	// const navigate = useNavigate();
	const isSheetMode = mode === "sheet";
	const authState = useUnifiedAuth();
	const userId = authState.data?.user?.id;
	const { client: supabaseClient } = useSupabaseSession(userId);
	const requireSupabase = () => {
		if (!supabaseClient || !userId) throw new Error("Session unavailable");
		return { client: supabaseClient, userId };
	};
	const [documentType, setDocumentType] =
		useState<InvoiceDocumentType>(initialDocumentType);
	const [correctsInvoiceId, setCorrectsInvoiceId] = useState<string>();
	const clientsQuery = useQuery({
		queryKey: ["invoice-composer-clients", userId],
		queryFn: () => {
			const context = requireSupabase();
			return listClients(context.client, context.userId);
		},
		enabled: Boolean(supabaseClient && userId),
	});
	const clients = (clientsQuery.data ?? []) as Array<{
		id?: string;
		name: string;
		email?: string;
		currency?: string;
	}>;
	const correctionSourcesQuery = useQuery({
		queryKey: ["invoice-correction-sources", userId],
		queryFn: () => {
			const context = requireSupabase();
			return listInvoices(context.client, context.userId, {
				documentType: "standard",
			});
		},
		enabled: Boolean(
			supabaseClient && userId && isCorrectionDocumentType(documentType),
		),
	});
	const correctionSources = (correctionSourcesQuery.data ?? []).filter(
		(invoice) =>
			invoice.documentType === "standard" &&
			invoice.status !== "draft" &&
			invoice.status !== "canceled" &&
			Boolean(
				invoice.deliveredAt ||
					invoice.paidAt ||
					invoice.paymentReference ||
					invoice.paymentAmount > 0 ||
					invoice.lifecycle?.sentAt ||
					invoice.lifecycle?.emailDeliveredAt ||
					invoice.lifecycle?.paymentReceivedAt,
			),
	);
	const workspaceQuery = useQuery({
		queryKey: ["invoice-workspace", userId],
		queryFn: () => {
			const context = requireSupabase();
			return getInvoiceWorkspaceSettings(context.client, context.userId);
		},
		enabled: Boolean(supabaseClient && userId),
	});
	const workspace = workspaceQuery.data;
	const savedTemplateSettingsQuery = useQuery({
		queryKey: ["invoice-template-defaults", userId],
		queryFn: () => {
			const context = requireSupabase();
			return getTemplateDefaults(context.client, context.userId);
		},
		enabled: Boolean(supabaseClient && userId),
	});
	const savedTemplateSettings = savedTemplateSettingsQuery.data;

	const [composerStage, setComposerStage] = useState<ComposerStage>("editor");
	const [createdInvoice, setCreatedInvoice] =
		useState<CreatedInvoiceSummary | null>(null);
	const [invoiceNumber, setInvoiceNumber] = useState(() =>
		generateInvoiceNumber(),
	);
	const [issueDate, setIssueDate] = useState(() => buildIssueDate());
	const [logoUrl, setLogoUrl] = useState("");
	const [customerName, setCustomerName] = useState("");
	const [customerEmail, setCustomerEmail] = useState("");
	const [customerPoNumber, setCustomerPoNumber] = useState("");
	const [fromName, setFromName] = useState("Velure Studio");
	const [fromEmail, setFromEmail] = useState("hello@velure.app");
	const [paymentDetails, setPaymentDetails] = useState("");
	const [notes, setNotes] = useState<EditorDoc | null>(null);
	const [topBlock, setTopBlock] = useState<EditorDoc | null>(null);
	const [bottomBlock, setBottomBlock] = useState<EditorDoc | null>(null);
	const [draftKey, setDraftKey] = useState(0);
	const [currency, setCurrency] = useState<SupportedCurrency>("NGN");
	const [invoiceSize, setInvoiceSize] = useState<"A4" | "LETTER">("A4");
	const [dateFormat, setDateFormat] = useState<"iso" | "us" | "ng">("ng");
	const [paymentTermDays, setPaymentTermDays] = useState(14);
	const [dueDate, setDueDate] = useState(() => buildDueDate(14));
	const [includeDecimals, setIncludeDecimals] = useState(true);
	const [defaultVatCategory, setDefaultVatCategory] =
		useState<NonNullable<LineItem["vatCategory"]>>("standard");
	const [includeUnits, setIncludeUnits] = useState(false);
	const [includeQr, setIncludeQr] = useState(false);
	const [includeDiscount, setIncludeDiscount] = useState(false);
	const [discount, setDiscount] = useState(0);
	const [templateLabels, setTemplateLabels] = useState({
		title: "Invoice",
		customerLabel: "To",
		fromLabel: "From",
		invoiceNoLabel: "Invoice No",
		issueDateLabel: "Issue Date",
		dueDateLabel: "Due Date",
		descriptionLabel: "Description",
		quantityLabel: "Quantity",
		priceLabel: "Price",
		totalLabel: "Total",
		totalSummaryLabel: "Total",
		subtotalLabel: "Subtotal",
		discountLabel: "Discount",
		paymentLabel: "Payment Details",
		noteLabel: "Note",
	});
	const [showFromEmail, setShowFromEmail] = useState(true);
	const [showCustomerEmail, setShowCustomerEmail] = useState(true);
	const [showPaymentDetailsSection, setShowPaymentDetailsSection] =
		useState(true);
	const [showNoteSection, setShowNoteSection] = useState(true);
	const [templateName, setTemplateName] =
		useState<SupportedTemplateName>("Default NG");
	const [sellerProfileType, setSellerProfileType] =
		useState<SellerProfileType>("freelancer");
	const [sellerTaxStatus, setSellerTaxStatus] = useState<SellerTaxStatus>(
		"below_threshold_not_charging_vat",
	);
	const [taxTreatment, setTaxTreatment] = useState<TaxTreatment>("none");
	const [withholdingCategory, setWithholdingCategory] =
		useState<WithholdingCategory>("none");
	const [withholdingRecipientEntityType, setWithholdingRecipientEntityType] =
		useState<WithholdingRecipientEntityType>("corporate");
	const [withholdingRecipientResidency, setWithholdingRecipientResidency] =
		useState<WithholdingRecipientResidency>("resident");
	const [sellerTin, setSellerTin] = useState("");
	const [showSellerTin, setShowSellerTin] = useState(false);
	const [sellerRcNumber, setSellerRcNumber] = useState("");
	const [showSellerRc, setShowSellerRc] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [customerSearch, setCustomerSearch] = useState("");
	const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
	const [customerId, setCustomerId] = useState<string | undefined>();
	const [customerActiveIndex, setCustomerActiveIndex] = useState(0);
	const [createClientOpen, setCreateClientOpen] = useState(false);
	const [newClientName, setNewClientName] = useState("");
	const [newClientEmail, setNewClientEmail] = useState("");
	const [newClientSubmitting, setNewClientSubmitting] = useState(false);

	const onCreateClientSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!newClientName.trim() || !newClientEmail.trim() || newClientSubmitting)
			return;

		setNewClientSubmitting(true);
		try {
			if (!supabaseClient || !userId) throw new Error("Session unavailable");
			const id = await createClient(supabaseClient, userId, {
				name: newClientName,
				email: newClientEmail,
				currency: "NGN",
				paymentTerms: "Net 14",
				contact: {},
				status: "active",
				favorite: false,
			});
			toast({ title: "Customer created", variant: "success" });
			setCustomerName(newClientName);
			setCustomerEmail(newClientEmail);
			setCustomerId(id);
			setCreateClientOpen(false);
			setCustomerPickerOpen(false);
			setNewClientName("");
			setNewClientEmail("");
		} catch {
			toast({ title: "Failed to create customer", variant: "error" });
		} finally {
			setNewClientSubmitting(false);
		}
	};
	const [lastCreatedToken, setLastCreatedToken] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [deliveryType, setDeliveryType] = useState<
		"create" | "create_and_send" | "scheduled"
	>("create");
	const [scheduledAt, setScheduledAt] = useState("");
	const [shipmentWeight, setShipmentWeight] = useState("");
	const [shipmentPackageCount, setShipmentPackageCount] = useState("");
	const [shipmentHsCode, setShipmentHsCode] = useState("");
	const [shipmentIncoterms, setShipmentIncoterms] = useState("");
	const [shipmentPortOfLoading, setShipmentPortOfLoading] = useState("");
	const [shipmentPortOfDischarge, setShipmentPortOfDischarge] = useState("");
	const [depositEnabled, setDepositEnabled] = useState(false);
	const [depositKind, setDepositKind] =
		useState<DepositRequestKind>("percentage");
	const [depositValue, setDepositValue] = useState("50");
	const [depositDueDate, setDepositDueDate] = useState("");
	const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("idle");
	const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
	const [lineItems, setLineItems] = useState<LineItem[]>([
		createEmptyLineItem(),
	]);
	const [expandedTaxLineIds, setExpandedTaxLineIds] = useState<string[]>([]);
	const [enteringLineIds, setEnteringLineIds] = useState<string[]>([]);
	const [exitingLineIds, setExitingLineIds] = useState<string[]>([]);
	const [pendingFocusLineId, setPendingFocusLineId] = useState<string | null>(
		null,
	);
	const [productSearchIndex, setProductSearchIndex] = useState<number | null>(
		null,
	);
	const [productSearchQuery, setProductSearchQuery] = useState("");
	const [debouncedProductSearchQuery, setDebouncedProductSearchQuery] =
		useState("");
	const [productActiveIndex, setProductActiveIndex] = useState(0);
	const pendingLineInputRef = useRef<HTMLInputElement | null>(null);
	const autosaveDraftIdRef = useRef<string | null>(null);
	const autosaveTokenRef = useRef(`pub-${crypto.randomUUID()}`);
	const autosaveSignatureRef = useRef("");
	const autosaveInFlightRef = useRef(false);
	const autosavePendingRef = useRef(false);
	const autosaveNowRef = useRef<() => void>(() => {});

	useEffect(() => {
		if (productSearchIndex === null) {
			setDebouncedProductSearchQuery("");
			return;
		}
		const timer = window.setTimeout(
			() => setDebouncedProductSearchQuery(productSearchQuery.trim()),
			250,
		);
		return () => window.clearTimeout(timer);
	}, [productSearchIndex, productSearchQuery]);

	const productSearchQueryResult = useQuery({
		queryKey: ["invoice-product-search", userId, debouncedProductSearchQuery],
		queryFn: ({ signal }) => {
			const context = requireSupabase();
			const timeout = AbortSignal.timeout(5_000);
			const searchSignal = AbortSignal.any([signal, timeout]);
			return Promise.race([
				searchProducts(
					context.client,
					context.userId,
					debouncedProductSearchQuery,
					searchSignal,
				),
				new Promise<never>((_, reject) =>
					searchSignal.addEventListener(
						"abort",
						() => reject(searchSignal.reason),
						{ once: true },
					),
				),
			]);
		},
		retry: false,
		enabled: Boolean(
			supabaseClient &&
				userId &&
				productSearchIndex !== null &&
				debouncedProductSearchQuery,
		),
	});
	const productSearchResults = productSearchQueryResult.data;
	const visibleProductSearchResults = (
		(productSearchResults as
			| Array<{
					id: string;
					name: string;
					sku?: string;
					defaultUnitPrice: number;
					unitName?: string;
					defaultVatCategory?: LineItem["vatCategory"];
					defaultClassificationCode?: string;
					type: "product" | "service";
			  }>
			| undefined) ?? []
	)
		.filter(
			(product) =>
				!lineItems.some(
					(item, itemIndex) =>
						itemIndex !== productSearchIndex && item.productId === product.id,
				),
		)
		.slice(0, 8);

	useEffect(() => {
		if (!workspace) return;

		const nextSellerTaxStatus =
			(workspace.sellerTaxStatus as SellerTaxStatus | undefined) ??
			"below_threshold_not_charging_vat";
		setSellerProfileType(
			nextSellerTaxStatus === "vat_registered" ||
				workspace.taxId ||
				workspace.rcNumber
				? "business"
				: "freelancer",
		);
		setSellerTaxStatus(nextSellerTaxStatus);
		setTaxTreatment(defaultTaxTreatmentForSellerTaxStatus(nextSellerTaxStatus));
		setInvoiceNumber(
			generateInvoiceNumber(
				{
					...workspace,
					invoiceNumberPrefix: workspace.invoiceNumberPrefix ?? undefined,
				},
				documentType,
			),
		);
		setFromName(workspace.legalName || workspace.name || "Velure Studio");
		setFromEmail(workspace.email ?? "");
		setLogoUrl(workspace.logoUrl ?? "");
		setPaymentDetails(workspace.paymentDetails ?? "");
		setPaymentTermDays(workspace.defaultPaymentTermsDays ?? 14);
		setDueDate(
			buildDueDate(workspace.defaultPaymentTermsDays ?? 14, issueDate),
		);
		setSellerTin(workspace.taxId ?? "");
		setShowSellerTin(!!workspace.taxId);
		setSellerRcNumber(workspace.rcNumber ?? "");
		setShowSellerRc(!!workspace.rcNumber);
	}, [workspace]);

	useEffect(() => {
		if (!savedTemplateSettings) return;
		setDefaultVatCategory(
			savedTemplateSettings.defaultVatCategory ?? "standard",
		);
		setIncludeDecimals(savedTemplateSettings.includeDecimals ?? true);
		setIncludeUnits(savedTemplateSettings.includeUnits ?? false);
		setIncludeQr(savedTemplateSettings.includeQr ?? false);
		setIncludeDiscount(savedTemplateSettings.includeDiscount ?? false);
		setDiscount(savedTemplateSettings.discount ?? 0);
		setTemplateLabels((current) => ({
			...current,
			...Object.fromEntries(
				Object.entries(savedTemplateSettings).filter(
					([, value]) => typeof value === "string",
				),
			),
		}));
	}, [savedTemplateSettings]);

	const templateSettings: InvoiceTemplateSettings = {
		...templateLabels,
		defaultVatCategory,
		includeDecimals,
		includeUnits,
		includeQr,
		includeDiscount,
		discount: includeDiscount ? discount : 0,
	};

	useEffect(() => {
		if (!workspace || initialDraft) return;
		setInvoiceNumber(
			generateInvoiceNumber(
				workspace
					? {
							...workspace,
							invoiceNumberPrefix: workspace.invoiceNumberPrefix ?? undefined,
						}
					: undefined,
				documentType,
			),
		);
	}, [
		documentType,
		initialDraft,
		workspace?.invoiceNumberMode,
		workspace?.invoiceNumberPrefix,
		workspace?.name,
		workspace?.nextInvoiceSequence,
	]);

	useEffect(() => {
		if (initialDraft) return;
		setDocumentType(initialDocumentType);
	}, [initialDocumentType, initialDraft]);

	useEffect(() => {
		if (!initialDraft) return;

		setDraftKey((k) => k + 1);
		setComposerStage("editor");
		setCreatedInvoice(null);
		setDocumentType(initialDocumentType);
		setCorrectsInvoiceId(undefined);
		if (initialDraft.invoiceNumber)
			setInvoiceNumber(initialDraft.invoiceNumber);
		if (initialDraft.issueDate) setIssueDate(initialDraft.issueDate);
		if (initialDraft.dueDate) setDueDate(initialDraft.dueDate);
		if (initialDraft.customerName) setCustomerName(initialDraft.customerName);
		if (initialDraft.customerEmail)
			setCustomerEmail(initialDraft.customerEmail);
		setCustomerPoNumber("");
		setCustomerId(undefined);
		setCorrectsInvoiceId(undefined);
		setCurrency(normalizeCurrency(initialDraft.currency));
		if (initialDraft.notes) {
			setNotes(toEditorDoc(initialDraft.notes));
			setShowNoteSection(true);
		}
		if (initialDraft.paymentDetails) {
			setPaymentDetails(initialDraft.paymentDetails);
			setShowPaymentDetailsSection(true);
		}
		setLineItems(
			initialDraft.lineItems.map((item) => ({
				id: `li-${crypto.randomUUID()}`,
				name: item.name,
				quantity: Math.max(1, Math.trunc(item.quantity)),
				price: Math.max(0, item.price),
				unit: item.unit,
				vatCategory: item.vatCategory,
				classificationCode: item.classificationCode,
			})),
		);
		setPriceDrafts({});
	}, [initialDraft]);

	const sellerTinForSubmission =
		showSellerTin && sellerTin.trim() ? sellerTin.trim() : "";
	const sellerRcForSubmission =
		showSellerRc && sellerRcNumber.trim() ? sellerRcNumber.trim() : "";

	const compliance = useMemo(
		() =>
			calculateInvoiceCompliance({
				seller: {
					legalName: fromName.trim() || undefined,
					email: fromEmail.trim() || undefined,
					countryCode: getCountryCodeFromCurrency(
						workspace?.baseCurrency ?? "NGN",
					),
					taxId: sellerTinForSubmission || undefined,
					rcNumber: sellerRcForSubmission || undefined,
				},
				buyer: {
					legalName: customerName.trim() || undefined,
					email: customerEmail.trim() || undefined,
					countryCode: getCountryCodeFromCurrency(currency),
				},
				sellerTaxStatus,
				placeOfSupply: getCountryCodeFromCurrency(
					workspace?.baseCurrency ?? "NGN",
				),
				currency,
				taxRuleSetVersion:
					workspace?.taxRuleSetVersion ?? NIGERIA_TAX_RULE_SET_VERSION,
				taxTreatment,
				taxRate:
					taxTreatment === "exclusive_rate"
						? NIGERIA_VAT_RATE
						: taxTreatment === "inclusive_rate"
							? NIGERIA_VAT_RATE
							: 0,
				taxLabel: taxTreatment === "exempt" ? "Exempt" : "VAT",
				withholding: {
					...defaultWithholdingSelection(),
					category: withholdingCategory,
					recipientEntityType: withholdingRecipientEntityType,
					recipientResidency: withholdingRecipientResidency,
				},
				lineItems,
			}),
		[
			currency,
			customerEmail,
			customerName,
			fromEmail,
			fromName,
			lineItems,
			showSellerTin,
			showSellerRc,
			sellerRcForSubmission,
			sellerRcNumber,
			sellerTaxStatus,
			sellerTinForSubmission,
			sellerTin,
			taxTreatment,
			withholdingCategory,
			withholdingRecipientEntityType,
			withholdingRecipientResidency,
			workspace?.baseCurrency,
			workspace?.taxRuleSetVersion,
		],
	);

	const filteredClients = useMemo(() => {
		const q = customerSearch.trim().toLowerCase();
		if (!q) return clients.slice(0, 8);
		return clients
			.filter((client) => {
				const haystack = `${client.name} ${client.email ?? ""}`.toLowerCase();
				return haystack.includes(q);
			})
			.slice(0, 8);
	}, [clients, customerSearch]);

	const selectedTaxSetting = TAX_SETTING_OPTIONS.find(
		(option) => option.value === taxTreatment,
	);
	const selectedSellerTaxStatus = SELLER_TAX_STATUS_OPTIONS.find(
		(option) => option.value === sellerTaxStatus,
	);
	const selectedWhtCategory = WITHHOLDING_CATEGORY_OPTIONS.find(
		(option) => option.value === withholdingCategory,
	);
	const shipmentDetails = useMemo(() => {
		if (documentType !== "proforma") return undefined;
		const packageCount = Number.parseInt(shipmentPackageCount, 10);
		const details = {
			weight: shipmentWeight.trim() || undefined,
			packageCount:
				Number.isFinite(packageCount) && packageCount > 0
					? packageCount
					: undefined,
			hsCode: shipmentHsCode.trim() || undefined,
			incoterms: shipmentIncoterms.trim() || undefined,
			portOfLoading: shipmentPortOfLoading.trim() || undefined,
			portOfDischarge: shipmentPortOfDischarge.trim() || undefined,
		};

		return Object.values(details).some((value) => value !== undefined)
			? details
			: undefined;
	}, [
		documentType,
		shipmentHsCode,
		shipmentIncoterms,
		shipmentPackageCount,
		shipmentPortOfDischarge,
		shipmentPortOfLoading,
		shipmentWeight,
	]);
	const depositRequest = useMemo(() => {
		if (documentType !== "proforma" || !depositEnabled) return undefined;
		const value = Number.parseFloat(depositValue);
		if (!Number.isFinite(value) || value <= 0) return undefined;
		return {
			kind: depositKind,
			value: depositKind === "percentage" ? Math.min(value, 100) : value,
			dueDate: depositDueDate || undefined,
		};
	}, [depositDueDate, depositEnabled, depositKind, depositValue, documentType]);
	const paperFrameClass =
		invoiceSize === "A4" ? "max-w-[860px]" : "max-w-[900px]";
	const footerGhostButtonClass =
		"inline-flex h-10 items-center gap-2 rounded-md border border-rule bg-paper px-3.5 text-[13px] text-ink-2 transition-[opacity,background-color,border-color,color] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-paper-2 hover:text-ink";
	const footerIconButtonClass =
		"inline-flex h-10 w-10 items-center justify-center rounded-md border border-rule bg-paper text-ink-2 transition-[opacity,background-color,border-color,color] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-paper-2 hover:text-ink";

	const createdInvoicePublicUrl = createdInvoice
		? `${typeof window !== "undefined" ? window.location.origin : ""}/i/${createdInvoice.token}`
		: "";
	const tinDigits = sellerTinForSubmission.length;
	const tinIsValid =
		sellerTinForSubmission.length === 0 || sellerTinForSubmission.length === 10;
	const tinHintText =
		tinDigits === 10
			? "Valid TIN format"
			: tinDigits === 0
				? "0/10 digits"
				: `${tinDigits}/10 digits`;
	const tinHintClass =
		tinDigits === 10
			? "text-ok"
			: tinDigits === 0
				? "text-ink-3"
				: "text-brand";
	const rcIsValid =
		sellerRcForSubmission.length === 0 ||
		/^RC-\d{7}$/i.test(sellerRcForSubmission);
	const isVatEnabled =
		taxTreatment === "exclusive_rate" || taxTreatment === "inclusive_rate";
	const requiresSellerTin =
		isVatEnabled || sellerTaxStatus === "vat_registered";
	const sellerTinWillNotPrint = showSellerTin && !sellerTinForSubmission;
	const netPayable = netPayableFromCompliance(compliance);
	const totalsMaximumFractionDigits = includeDecimals ? 2 : 0;
	const hasPricedLineItem = lineItems.some(
		(item) => item.name.trim().length > 0 && item.price > 0,
	);
	const dueDateInvalid = Boolean(issueDate && dueDate && dueDate < issueDate);
	const canSubmit =
		customerName.trim().length > 1 &&
		Boolean(customerId) &&
		hasPricedLineItem &&
		!dueDateInvalid &&
		!submitting;
	// B2: finalizing requires a saved client record (the server rejects a
	// customer-less invoice leaving Draft), so the blocker names the picker.
	const submitBlockerText = dueDateInvalid
		? "Due date is before issue date."
		: !customerId
			? "Select or create a saved client before creating."
			: !customerName.trim()
				? "Select or enter a client before creating."
				: !hasPricedLineItem
					? "Add at least one priced line item."
					: "";
	const autosaveStatusText =
		autosaveStatus === "saving"
			? "Saving draft..."
			: autosaveStatus === "saved"
				? "Saved"
				: autosaveStatus === "error"
					? "Draft not saved"
					: "";
	const hasMeaningfulDraft = useMemo(() => {
		const defaultFromName =
			workspace?.legalName || workspace?.name || "Velure Studio";
		const defaultFromEmail = workspace?.email ?? "hello@velure.app";
		const defaultLogoUrl = workspace?.logoUrl ?? "";
		const defaultPaymentDetails = workspace?.paymentDetails ?? "";
		const defaultSellerTin = workspace?.taxId ?? "";
		const defaultSellerRc = workspace?.rcNumber ?? "";
		const defaultPaymentTermsDays = workspace?.defaultPaymentTermsDays ?? 14;
		const defaultDueDate = buildDueDate(defaultPaymentTermsDays, issueDate);

		return (
			customerName.trim().length > 0 ||
			customerEmail.trim().length > 0 ||
			customerPoNumber.trim().length > 0 ||
			fromName.trim() !== defaultFromName.trim() ||
			fromEmail.trim() !== defaultFromEmail.trim() ||
			logoUrl.trim() !== defaultLogoUrl.trim() ||
			paymentDetails.trim() !== defaultPaymentDetails.trim() ||
			sellerTin.trim() !== defaultSellerTin.trim() ||
			sellerRcNumber.trim() !== defaultSellerRc.trim() ||
			Boolean(notes?.content.length) ||
			documentType !== "standard" ||
			Boolean(shipmentDetails) ||
			Boolean(depositRequest) ||
			dueDate !== defaultDueDate ||
			currency !== "NGN" ||
			invoiceSize !== "A4" ||
			dateFormat !== "ng" ||
			paymentTermDays !== defaultPaymentTermsDays ||
			templateName !== "Default NG" ||
			lineItems.some(
				(item) =>
					item.name.trim().length > 0 ||
					item.price > 0 ||
					item.quantity !== 1 ||
					Boolean(item.productId),
			)
		);
	}, [
		currency,
		customerEmail,
		customerName,
		customerPoNumber,
		dateFormat,
		depositRequest,
		documentType,
		fromEmail,
		fromName,
		invoiceSize,
		lineItems,
		logoUrl,
		notes,
		paymentDetails,
		paymentTermDays,
		sellerRcNumber,
		sellerTin,
		shipmentDetails,
		templateName,
		workspace,
	]);
	const autosaveSignature = useMemo(
		() =>
			JSON.stringify({
				compliance,
				currency,
				customerEmail,
				customerName,
				customerPoNumber,
				dateFormat,
				depositRequest,
				documentType,
				correctsInvoiceId,
				dueDate,
				fromEmail,
				fromName,
				includeDecimals,
				invoiceNumber,
				invoiceSize,
				lineItems,
				logoUrl,
				notes,
				paymentDetails,
				paymentTermDays,
				sellerRcForSubmission,
				sellerTaxStatus,
				sellerTinForSubmission,
				showCustomerEmail,
				showFromEmail,
				showNoteSection,
				showPaymentDetailsSection,
				shipmentDetails,
				templateName,
				taxTreatment,
				withholdingCategory,
				withholdingRecipientEntityType,
				withholdingRecipientResidency,
			}),
		[
			compliance,
			currency,
			customerEmail,
			customerName,
			customerPoNumber,
			dateFormat,
			depositRequest,
			documentType,
			correctsInvoiceId,
			dueDate,
			fromEmail,
			fromName,
			includeDecimals,
			invoiceNumber,
			invoiceSize,
			lineItems,
			logoUrl,
			notes,
			paymentDetails,
			paymentTermDays,
			sellerRcForSubmission,
			sellerTaxStatus,
			sellerTinForSubmission,
			showCustomerEmail,
			showFromEmail,
			showNoteSection,
			showPaymentDetailsSection,
			shipmentDetails,
			templateName,
			taxTreatment,
			withholdingCategory,
			withholdingRecipientEntityType,
			withholdingRecipientResidency,
		],
	);

	const buildDraftMutationArgs = (id?: string | null) => ({
		id: id ?? undefined,
		token: autosaveTokenRef.current,
		documentType,
		correctsInvoiceId,
		shipmentDetails,
		depositRequest,
		invoiceNumber: id ? invoiceNumber.trim() : "",
		customerName: customerName.trim(),
		customerId,
		logoUrl: logoUrl.trim() || undefined,
		customerPoNumber: customerPoNumber.trim() || undefined,
		currency,
		type: "one-time" as const,
		invoiceSize,
		dateFormat,
		paymentTermsDays: paymentTermDays,
		template: templateName,
		templateSettings,
		topBlock: topBlock ?? undefined,
		bottomBlock: bottomBlock ?? undefined,
		issueDate,
		dueDate,
		paymentDetails:
			showPaymentDetailsSection && paymentDetails.trim()
				? paymentDetails.trim()
				: undefined,
		notes: showNoteSection && notes?.content.length ? notes : undefined,
		lineItems: lineItems.map((item) => ({
			id: item.id,
			name: item.name.trim(),
			quantity: Math.max(1, item.quantity),
			price: Math.max(0, item.price),
			productId: item.productId,
			unit: item.unit,
			vatCategory: item.vatCategory ?? defaultVatCategory,
			classificationCode: item.classificationCode,
		})),
		compliance: toPersistableCompliance({
			...compliance,
			templateVariant: resolveTemplateVariant(templateName),
			sellerTaxStatus,
			taxRuleSetVersion:
				workspace?.taxRuleSetVersion ?? NIGERIA_TAX_RULE_SET_VERSION,
			seller: {
				...compliance.seller,
				legalName: fromName.trim() || undefined,
				email: fromEmail.trim() || undefined,
				countryCode: getCountryCodeFromCurrency(
					workspace?.baseCurrency ?? "NGN",
				),
				taxId: sellerTinForSubmission || undefined,
				rcNumber: sellerRcForSubmission || undefined,
			},
			buyer: {
				...compliance.buyer,
				legalName: customerName.trim() || undefined,
				email: customerEmail.trim() || undefined,
				countryCode: getCountryCodeFromCurrency(currency),
			},
			regulatoryNotice:
				currency === "NGN" ? undefined : NIGERIA_FOREIGN_CURRENCY_WARNING,
		}),
		fiscalization: {
			status: "not_configured" as const,
		},
	});

	const persistAutosaveDraft = async () => {
		if (
			composerStage !== "editor" ||
			!hasMeaningfulDraft ||
			!tinIsValid ||
			!rcIsValid ||
			(isCorrectionDocumentType(documentType) && !correctsInvoiceId)
		) {
			return;
		}

		if (autosaveSignatureRef.current === autosaveSignature) return;
		if (autosaveInFlightRef.current) {
			autosavePendingRef.current = true;
			return;
		}

		autosaveInFlightRef.current = true;
		setAutosaveStatus("saving");

		try {
			if (!supabaseClient || !userId) throw new Error("Session unavailable");
			const saved = await autosaveDraft(
				supabaseClient,
				userId,
				buildDraftMutationArgs(autosaveDraftIdRef.current),
			);
			autosaveDraftIdRef.current = saved.id;
			setInvoiceNumber(saved.invoiceNumber);
			autosaveSignatureRef.current = autosaveSignature;
			setAutosaveStatus("saved");
		} catch (_error) {
			setAutosaveStatus("error");
		} finally {
			autosaveInFlightRef.current = false;
			if (autosavePendingRef.current) {
				autosavePendingRef.current = false;
				void persistAutosaveDraft();
			}
		}
	};

	autosaveNowRef.current = () => {
		void persistAutosaveDraft();
	};

	useEffect(() => {
		if (
			composerStage !== "editor" ||
			!hasMeaningfulDraft ||
			!tinIsValid ||
			!rcIsValid
		) {
			return;
		}

		const timer = window.setTimeout(() => {
			void persistAutosaveDraft();
		}, 1200);
		return () => window.clearTimeout(timer);
	}, [
		autosaveSignature,
		composerStage,
		hasMeaningfulDraft,
		rcIsValid,
		tinIsValid,
	]);

	useEffect(() => {
		const flushDraft = () => autosaveNowRef.current();
		const onVisibilityChange = () => {
			if (document.visibilityState === "hidden") flushDraft();
		};

		document.addEventListener("visibilitychange", onVisibilityChange);
		window.addEventListener("pagehide", flushDraft);

		return () => {
			flushDraft();
			document.removeEventListener("visibilitychange", onVisibilityChange);
			window.removeEventListener("pagehide", flushDraft);
		};
	}, []);

	const updatePaymentTerms = (days: number) => {
		setPaymentTermDays(days);
		setDueDate(buildDueDate(days, issueDate));
	};

	const openComplianceDialog = () => {
		window.setTimeout(() => setSettingsOpen(true), 0);
	};

	const updateSellerTaxStatus = (nextStatus: SellerTaxStatus) => {
		setSellerTaxStatus(nextStatus);
		setTaxTreatment(defaultTaxTreatmentForSellerTaxStatus(nextStatus));
		if (nextStatus === "vat_registered") {
			setSellerProfileType("business");
			setShowSellerTin(true);
			return;
		}
		setSellerProfileType((current) =>
			current === "business" ? current : "freelancer",
		);
	};

	const updateSellerProfileType = (nextType: SellerProfileType) => {
		setSellerProfileType(nextType);
		if (nextType === "freelancer") {
			setSellerTaxStatus("below_threshold_not_charging_vat");
			setTaxTreatment("none");
			setWithholdingCategory("none");
			setShowSellerTin(false);
			setShowSellerRc(false);
			return;
		}
		setShowSellerTin(true);
		setShowSellerRc(true);
		setSellerTaxStatus("vat_registered");
		setTaxTreatment("exclusive_rate");
	};

	const updateCurrency = (nextCurrency: SupportedCurrency) => {
		if (currency === nextCurrency) return;
		setPriceDrafts({});
		setCurrency(nextCurrency);
		if (nextCurrency !== "NGN") {
			setTemplateName((current) =>
				current === "Default NG" ? "Cross-border" : current,
			);
			setTaxTreatment("exempt");
		} else if (workspace) {
			const nextSellerTaxStatus =
				(workspace.sellerTaxStatus as SellerTaxStatus | undefined) ??
				"below_threshold_not_charging_vat";
			setTaxTreatment(
				defaultTaxTreatmentForSellerTaxStatus(nextSellerTaxStatus),
			);
		}
	};

	const openInvoiceTab = (token: string) => {
		window.open(`/i/${token}`, "_blank", "noopener,noreferrer");
	};

	const selectClient = (client: (typeof clients)[number]) => {
		setCustomerId(client.id);
		setCustomerName(client.name);
		setCustomerEmail(client.email ?? "");
		setCustomerPickerOpen(false);
		setCustomerSearch("");
		setCustomerActiveIndex(0);
	};

	const updateLine = (index: number, patch: Partial<LineItem>) => {
		setLineItems((prev) =>
			prev.map((item, itemIndex) =>
				itemIndex === index ? { ...item, ...patch } : item,
			),
		);
	};

	const selectProduct = (
		index: number,
		product: {
			id: string;
			name: string;
			sku?: string;
			defaultUnitPrice: number;
			unitName?: string;
			defaultVatCategory?: LineItem["vatCategory"];
			defaultClassificationCode?: string;
		},
	) => {
		const lineId = lineItems[index]?.id;
		updateLine(index, {
			name: product.name,
			price: product.defaultUnitPrice,
			productId: product.id,
			unit: product.unitName ?? "",
			vatCategory: product.defaultVatCategory ?? defaultVatCategory,
			classificationCode: product.defaultClassificationCode ?? "",
		});
		if (lineId) {
			setPriceDrafts((prev) => {
				const next = { ...prev };
				delete next[lineId];
				return next;
			});
		}
		setProductSearchIndex(null);
		setProductSearchQuery("");
		setProductActiveIndex(0);
	};

	const addLine = () => {
		const nextLine = createEmptyLineItem();
		setLineItems((prev) => [...prev, nextLine]);
		setEnteringLineIds((prev) => [...prev, nextLine.id]);
		setPendingFocusLineId(nextLine.id);
		setTimeout(() => {
			setEnteringLineIds((prev) =>
				prev.filter((lineId) => lineId !== nextLine.id),
			);
		}, 180);
	};

	const dndSensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
	);

	const handleLineDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		if (!over || active.id === over.id) return;
		setLineItems((prev) => {
			const oldIndex = prev.findIndex((i) => i.id === active.id);
			const newIndex = prev.findIndex((i) => i.id === over.id);
			if (oldIndex === -1 || newIndex === -1) return prev;
			return arrayMove(prev, oldIndex, newIndex);
		});
	};

	useEffect(() => {
		if (!pendingFocusLineId) return;
		const focusTimer = window.setTimeout(() => {
			pendingLineInputRef.current?.focus();
			setPendingFocusLineId(null);
		}, 80);
		return () => window.clearTimeout(focusTimer);
	}, [pendingFocusLineId, lineItems.length]);

	const removeLine = (index: number) => {
		setLineItems((prev) => {
			const target = prev[index];
			if (!target) return prev;

			if (prev.length === 1) {
				setPriceDrafts({});
				return [createEmptyLineItem()];
			}

			if (exitingLineIds.includes(target.id)) {
				return prev;
			}

			setExitingLineIds((current) => [...current, target.id]);
			setTimeout(() => {
				setLineItems((items) => items.filter((item) => item.id !== target.id));
				setExitingLineIds((current) =>
					current.filter((lineId) => lineId !== target.id),
				);
				setPriceDrafts((current) => {
					const next = { ...current };
					delete next[target.id];
					return next;
				});
			}, 160);

			return prev;
		});
	};

	const decrementQuantity = (index: number) => {
		setLineItems((prev) =>
			prev.map((item, itemIndex) =>
				itemIndex === index
					? { ...item, quantity: Math.max(1, item.quantity - 1) }
					: item,
			),
		);
	};

	const incrementQuantity = (index: number) => {
		setLineItems((prev) =>
			prev.map((item, itemIndex) =>
				itemIndex === index ? { ...item, quantity: item.quantity + 1 } : item,
			),
		);
	};

	const onPriceFocus = (lineId: string, price: number) => {
		setPriceDrafts((prev) => ({
			...prev,
			[lineId]: price === 0 ? "" : String(price),
		}));
	};

	const onPriceChange = (lineId: string, index: number, value: string) => {
		const raw = sanitizeDecimalInput(value);
		if (raw.split(".")[0].length > 13) return;
		setPriceDrafts((prev) => ({
			...prev,
			[lineId]: raw,
		}));
		updateLine(index, { price: parsePriceInput(raw) });
	};

	const commitPriceDraft = (
		lineId: string,
		index: number,
		fallbackPrice: number,
	) => {
		const draft = priceDrafts[lineId] ?? String(fallbackPrice);
		updateLine(index, { price: parsePriceInput(draft) });
		setPriceDrafts((prev) => {
			const next = { ...prev };
			delete next[lineId];
			return next;
		});
	};

	const onLogoFileChange = (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file) return;
		if (!file.type.startsWith("image/")) {
			toast({
				title: "Invalid file",
				description: "Please select an image file for your logo.",
				variant: "error",
			});
			return;
		}

		const reader = new FileReader();
		reader.onload = () => {
			if (typeof reader.result === "string") {
				setLogoUrl(reader.result);
			}
		};
		reader.readAsDataURL(file);
	};

	const copyInvoiceLink = async (token: string) => {
		try {
			await navigator.clipboard.writeText(
				`${window.location.origin}/i/${token}`,
			);
			toast({
				title: "Invoice link copied",
				description: "The public invoice link is ready to share.",
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

	const resetDraft = () => {
		const nextIssueDate = buildIssueDate();
		const nextTermDays = 14;

		setComposerStage("editor");
		setCreatedInvoice(null);
		setDocumentType(initialDocumentType);
		setCorrectsInvoiceId(undefined);
		setInvoiceNumber(
			generateInvoiceNumber(
				workspace
					? {
							...workspace,
							invoiceNumberPrefix: workspace.invoiceNumberPrefix ?? undefined,
						}
					: undefined,
			),
		);
		setIssueDate(nextIssueDate);
		setLogoUrl("");
		setCustomerName("");
		setCustomerEmail("");
		setCustomerPoNumber("");
		setFromName(workspace?.legalName || workspace?.name || "Velure Studio");
		setFromEmail(workspace?.email ?? "hello@velure.app");
		setLogoUrl(workspace?.logoUrl ?? "");
		setPaymentDetails(workspace?.paymentDetails ?? "");
		setNotes(null);
		setCurrency("NGN");
		setInvoiceSize("A4");
		setDateFormat("iso");
		setPaymentTermDays(nextTermDays);
		setDueDate(buildDueDate(nextTermDays, nextIssueDate));
		setIncludeDecimals(true);
		setShowFromEmail(true);
		setShowCustomerEmail(true);
		setShowPaymentDetailsSection(true);
		setShowNoteSection(true);
		setShipmentWeight("");
		setShipmentPackageCount("");
		setShipmentHsCode("");
		setShipmentIncoterms("");
		setShipmentPortOfLoading("");
		setShipmentPortOfDischarge("");
		setDepositEnabled(false);
		setDepositKind("percentage");
		setDepositValue("50");
		setDepositDueDate("");
		setTemplateName("Default NG");
		setSellerProfileType(
			workspace?.sellerTaxStatus === "vat_registered" ||
				workspace?.taxId ||
				workspace?.rcNumber
				? "business"
				: "freelancer",
		);
		setSellerTaxStatus(
			(workspace?.sellerTaxStatus as SellerTaxStatus | undefined) ??
				"below_threshold_not_charging_vat",
		);
		setTaxTreatment(
			defaultTaxTreatmentForSellerTaxStatus(
				(workspace?.sellerTaxStatus as SellerTaxStatus | undefined) ??
					"below_threshold_not_charging_vat",
			),
		);
		setWithholdingCategory("none");
		setWithholdingRecipientEntityType("corporate");
		setWithholdingRecipientResidency("resident");
		setSellerTin(workspace?.taxId ?? "");
		setShowSellerTin(!!workspace?.taxId);
		setSellerRcNumber(workspace?.rcNumber ?? "");
		setShowSellerRc(!!workspace?.rcNumber);
		setSettingsOpen(false);
		setCustomerSearch("");
		setCustomerPickerOpen(false);
		setLastCreatedToken(null);
		setSubmitting(false);
		setPriceDrafts({});
		setLineItems([createEmptyLineItem()]);
		setEnteringLineIds([]);
		setExitingLineIds([]);
		autosaveDraftIdRef.current = null;
		autosaveTokenRef.current = `pub-${crypto.randomUUID()}`;
		autosaveSignatureRef.current = "";
		autosaveInFlightRef.current = false;
		autosavePendingRef.current = false;
		setAutosaveStatus("idle");
	};

	const createInvoice = async (intent: CreateIntent = deliveryType) => {
		if (!canSubmit) return;
		if (!tinIsValid) {
			toast({
				title: "Check seller tax ID",
				description: "Leave TIN blank or enter exactly 10 digits.",
				variant: "error",
			});
			return;
		}
		if (!rcIsValid) {
			toast({
				title: "Check CAC RC Number",
				description: "Leave RC blank or use RC-1234567 format.",
				variant: "error",
			});
			return;
		}
		if (requiresSellerTin && !sellerTinForSubmission) {
			toast({
				title: "Seller TIN needed for VAT",
				description:
					"Switch to Below threshold or add a 10-digit TIN before charging VAT.",
				variant: "error",
			});
			openComplianceDialog();
			return;
		}

		if (
			intent === "scheduled" &&
			(!scheduledAt || Date.parse(scheduledAt) <= Date.now())
		) {
			toast({
				title: "Choose a future schedule",
				description: "Scheduled time must be in the future.",
				variant: "error",
			});
			return;
		}
		if (
			(intent === "create_and_send" || intent === "scheduled") &&
			!customerEmail.trim()
		) {
			toast({
				title: "Customer email needed",
				description: "Add a customer email before sending or scheduling.",
				variant: "error",
			});
			return;
		}
		setSubmitting(true);
		try {
			if (!supabaseClient || !userId) throw new Error("Session unavailable");
			if (isCorrectionDocumentType(documentType) && !correctsInvoiceId) {
				throw new Error(
					"Select an issued standard invoice for this correction note.",
				);
			}
			const created = await createDraft(supabaseClient, userId, {
				id: autosaveDraftIdRef.current ?? undefined,
				token: `pub-${crypto.randomUUID()}`,
				documentType,
				correctsInvoiceId,
				shipmentDetails,
				depositRequest,
				invoiceNumber: "",
				customerId,
				customerName: customerName.trim(),
				logoUrl: logoUrl.trim() || undefined,
				customerPoNumber: customerPoNumber.trim() || undefined,
				currency,
				type: "one-time",
				invoiceSize,
				dateFormat,
				paymentTermsDays: paymentTermDays,
				template: templateName,
				templateSettings,
				topBlock: topBlock ?? undefined,
				bottomBlock: bottomBlock ?? undefined,
				issueDate,
				dueDate,
				paymentDetails:
					showPaymentDetailsSection && paymentDetails.trim()
						? paymentDetails.trim()
						: undefined,
				notes: showNoteSection && notes?.content.length ? notes : undefined,
				lineItems: lineItems
					.filter((item) => item.name.trim().length > 0)
					.map((item) => ({
						id: item.id,
						name: item.name.trim(),
						quantity: Math.max(1, item.quantity),
						price: Math.max(0, item.price),
						productId: item.productId,
						unit: item.unit,
						vatCategory: item.vatCategory ?? defaultVatCategory,
						classificationCode: item.classificationCode,
					})),
				compliance: toPersistableCompliance({
					...compliance,
					templateVariant: resolveTemplateVariant(templateName),
					sellerTaxStatus,
					taxRuleSetVersion:
						workspace?.taxRuleSetVersion ?? NIGERIA_TAX_RULE_SET_VERSION,
					seller: {
						...compliance.seller,
						legalName: fromName.trim() || undefined,
						email: fromEmail.trim() || undefined,
						countryCode: getCountryCodeFromCurrency(
							workspace?.baseCurrency ?? "NGN",
						),
						taxId: sellerTinForSubmission || undefined,
						rcNumber: sellerRcForSubmission || undefined,
					},
					buyer: {
						...compliance.buyer,
						legalName: customerName.trim() || undefined,
						email: customerEmail.trim() || undefined,
						countryCode: getCountryCodeFromCurrency(currency),
					},
					regulatoryNotice:
						currency === "NGN" ? undefined : NIGERIA_FOREIGN_CURRENCY_WARNING,
				}),
				fiscalization: {
					status: "not_configured",
				},
				deliveryType: intent === "open" ? "create" : intent,
				scheduledAt:
					intent === "scheduled"
						? new Date(scheduledAt).toISOString()
						: undefined,
			});

			setLastCreatedToken(created.token);
			setCreatedInvoice({
				id: created.id,
				token: created.token,
				documentType: created.documentType ?? "standard",
				invoiceNumber: created.invoiceNumber,
				dueDate: created.dueDate,
				customerName: created.customerName,
				customerEmail,
				total: netPayable,
			});
			setComposerStage("success");
			onCreated?.(created.id);
			if (intent === "create_and_send") {
				const response = await fetch(
					`/api/invoice/send/${encodeURIComponent(created.id)}`,
					{
						method: "POST",
						credentials: "include",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ to: customerEmail.trim() }),
					},
				);
				if (!response.ok)
					throw new Error("Invoice created but email delivery failed.");
			}
			autosaveDraftIdRef.current = null;
			autosaveTokenRef.current = `pub-${crypto.randomUUID()}`;
			autosaveSignatureRef.current = "";

			if (intent === "open") {
				openInvoiceTab(created.token);
			} else {
				toast({
					title: "Invoice created",
					description: `${created.invoiceNumber} is ready.`,
					variant: "success",
				});
			}
		} catch (error) {
			toast({
				title: "Could not create invoice",
				description: error instanceof Error ? error.message : "Unknown error",
				variant: "error",
			});
		} finally {
			setSubmitting(false);
		}
	};

	if (composerStage === "success" && createdInvoice) {
		return (
			<div
				className={`flex h-full min-h-0 w-full flex-col ${isSheetMode ? "" : "pb-6"}`}
			>
				<div
					className={`min-h-0 flex-1 ${isSheetMode ? "p-0" : "overflow-auto px-2"}`}
				>
					<div className="mx-auto flex h-full min-h-0 w-full max-w-[720px] flex-col border border-rule bg-paper">
						<div className="flex min-h-0 flex-1 flex-col px-6 py-6">
							<div>
								<h2 className="text-[34px] font-medium tracking-[-0.03em] text-ink">
									Created
								</h2>
								<p className="mt-2 text-sm text-ink-3">
									Your{" "}
									{INVOICE_DOCUMENT_TYPE_LABELS[createdInvoice.documentType]}{" "}
									was created successfully.
								</p>
							</div>

							<div className="relative my-auto border border-rule bg-paper-2 p-5 pb-7">
								<div className="flex items-start justify-between gap-4 text-sm text-ink-3">
									<div className="text-[13px]">
										{INVOICE_DOCUMENT_TYPE_LABELS[createdInvoice.documentType]}{" "}
										No:{" "}
										<span className="font-medium text-ink">
											{createdInvoice.invoiceNumber}
										</span>
									</div>
									<div className="text-[13px]">
										{createdInvoice.documentType === "proforma"
											? "Valid Until"
											: "Due Date"}
										:{" "}
										<span className="font-medium text-ink">
											{formatDate(createdInvoice.dueDate, dateFormat)}
										</span>
									</div>
								</div>

								<div className="mt-8">
									<div className="text-[18px] font-medium text-ink">
										{createdInvoice.customerName}
									</div>
									{createdInvoice.customerEmail ? (
										<div className="mt-3 text-[13px] text-ink-3 underline underline-offset-2">
											{createdInvoice.customerEmail}
										</div>
									) : null}
								</div>

								<div className="mt-10 flex items-end justify-between gap-4 border-b border-rule pb-5">
									<div className="text-[13px] text-ink-3">Total</div>
									<div className="text-[18px] text-ink">
										{formatMoney(
											createdInvoice.total,
											normalizeCurrency(currency),
											{
												maximumFractionDigits: totalsMaximumFractionDigits,
											},
										)}
									</div>
								</div>

								<div className="mt-10">
									<div className="text-[28px] font-medium tracking-[-0.03em] text-ink">
										Details
									</div>
									<div className="mt-10">
										<div className="mb-2 text-[12px] text-ink-3">
											Share link
										</div>
										<div className="flex items-center gap-2">
											<div className="flex h-10 flex-1 items-center border border-rule bg-paper px-3 text-[13px] text-ink-3">
												<span className="truncate">
													{createdInvoicePublicUrl}
												</span>
											</div>
											<button
												type="button"
												onClick={() =>
													void copyInvoiceLink(createdInvoice.token)
												}
												className={footerIconButtonClass}
												aria-label="Copy share link"
											>
												<Copy className="h-4 w-4" />
											</button>
											<a
												href={createdInvoicePublicUrl}
												target="_blank"
												rel="noreferrer"
												className={footerIconButtonClass}
												aria-label="Preview before download"
											>
												<Download className="h-4 w-4" />
											</a>
										</div>
									</div>
								</div>
								<div
									aria-hidden="true"
									className="absolute -bottom-3 left-0 right-0 flex justify-around overflow-hidden"
								>
									{[..."abcdefghijkl"].map((edge) => (
										<span
											key={`receipt-edge-${edge}`}
											className="h-6 w-6 shrink-0 rounded-full bg-paper"
										/>
									))}
								</div>
							</div>
						</div>

						<div className="flex items-center justify-end gap-3 border-t border-rule bg-paper px-6 py-5">
							<button
								type="button"
								onClick={() => openInvoiceTab(createdInvoice.token)}
								className="inline-flex h-10 items-center rounded-md border border-rule bg-paper px-5 text-[14px] text-ink transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out hover:bg-paper-2"
							>
								View{" "}
								{INVOICE_DOCUMENT_TYPE_LABELS[
									createdInvoice.documentType
								].toLowerCase()}
							</button>
							<button
								type="button"
								onClick={resetDraft}
								className="inline-flex h-10 items-center rounded-md border border-brand bg-brand px-5 text-[14px] font-medium text-brand-ink transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out hover:bg-brand-hi"
							>
								Create another
							</button>
						</div>
					</div>
				</div>
			</div>
		);
	}

	return (
		<>
			<div
				className={`flex h-full min-h-0 w-full flex-col ${isSheetMode ? "" : "pb-6"}`}
			>
				<div
					className={`min-h-0 flex-1 ${isSheetMode ? "p-0" : "overflow-auto px-2"}`}
				>
					<div
						className={`mx-auto flex h-[calc(100dvh-7rem)] min-h-0 w-full flex-col overflow-hidden border border-rule bg-paper shadow-[0_18px_60px_rgba(0,0,0,0.08)] ${isSheetMode ? "h-full" : "max-h-[960px]"} ${paperFrameClass}`}
					>
						<div className="flex min-h-0 flex-1 flex-col">
							<div className="invoice-paper-controls @container flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pb-16 pt-5 sm:px-6 md:px-8 md:pt-7 lg:px-10">
								{!isSheetMode ? (
									<ol
										aria-label="Create your first invoice in three steps"
										className="mb-5 grid gap-x-4 gap-y-3 border-b border-rule pb-5 text-[12px] text-ink-2 sm:grid-cols-2 lg:grid-cols-3"
									>
										{[
											"Choose a client",
											"Add a priced item",
											"Create and send",
										].map((step, index) => (
											<li key={step} className="flex items-center gap-2">
												<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-rule bg-paper-2 text-[12px] font-medium text-ink">
													{index + 1}
												</span>
												{step}
											</li>
										))}
									</ol>
								) : null}
								<div className="mb-5 flex w-fit rounded-md border border-rule bg-paper-2 p-1">
									{DOCUMENT_TYPE_OPTIONS.map((option) => (
										<button
											key={option.value}
											type="button"
											onClick={() => {
												const nextType = option.value as InvoiceDocumentType;
												setDocumentType(nextType);
												if (!isCorrectionDocumentType(nextType)) {
													setCorrectsInvoiceId(undefined);
												}
											}}
											aria-pressed={documentType === option.value}
											className={cn(
												"rounded-sm px-3 py-1.5 text-[12px] font-medium transition-colors",
												documentType === option.value
													? "bg-brand text-brand-ink"
													: "text-ink-3 hover:bg-paper-3 hover:text-ink",
											)}
										>
											{option.label}
										</button>
									))}
								</div>
								{isCorrectionDocumentType(documentType) ? (
									<div className="mb-5 max-w-xl space-y-2">
										<label
											htmlFor="invoice-correction-source"
											className="block text-[12px] font-medium text-ink"
										>
											Issued standard invoice being corrected
										</label>
										<select
											id="invoice-correction-source"
											value={correctsInvoiceId ?? ""}
											required
											disabled={correctionSourcesQuery.isPending}
											onChange={(event) => {
												const nextId = event.target.value;
												setCorrectsInvoiceId(nextId || undefined);
												const source = correctionSources.find(
													(invoice) => invoice.id === nextId,
												);
												if (!source) return;
												setCustomerId(source.customerId);
												setCustomerName(source.customerName);
												setCustomerEmail(
													clients.find(
														(client) => client.id === source.customerId,
													)?.email ?? "",
												);
												setCurrency(normalizeCurrency(source.currency));
											}}
											className="h-10 w-full rounded-md border border-rule bg-paper px-3 text-[13px] text-ink"
										>
											<option value="">Select a source invoice</option>
											{correctionSources.map((invoice) => (
												<option key={invoice.id} value={invoice.id}>
													{invoice.invoiceNumber} · {invoice.customerName}
												</option>
											))}
										</select>
										<p className="text-[12px] text-ink-3">
											Creates a separate document and leaves the source invoice
											unchanged.
										</p>
									</div>
								) : null}

								<div className="mb-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_96px] lg:items-start">
									<div className="space-y-3">
										<div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_minmax(0,1fr)]">
											<div className="min-h-[60px] border-b border-rule px-1 py-2">
												<InlineLabelInput
													value={templateLabels.invoiceNoLabel}
													onChange={(value) =>
														setTemplateLabels((current) => ({
															...current,
															invoiceNoLabel: value,
														}))
													}
													className="text-[12px] text-ink-3"
												/>
												<div className="mt-1 font-mono text-[14px] text-ink">
													{invoiceNumber}
												</div>
											</div>
											<div className="min-h-[60px] border-b border-rule px-1 py-2">
												<InlineLabelInput
													value={templateLabels.issueDateLabel}
													onChange={(value) =>
														setTemplateLabels((current) => ({
															...current,
															issueDateLabel: value,
														}))
													}
													className="text-[12px] text-ink-3"
												/>
												<InvoiceDateField
													value={issueDate}
													onChange={setIssueDate}
													format={dateFormat}
													label="Issue date"
												/>
											</div>
											<div
												className={cn(
													"min-h-[60px] border-b px-1 py-2",
													dueDateInvalid ? "border-warn" : "border-rule",
												)}
											>
												<InlineLabelInput
													value={templateLabels.dueDateLabel}
													onChange={(value) =>
														setTemplateLabels((current) => ({
															...current,
															dueDateLabel: value,
														}))
													}
													className="text-[12px] text-ink-3"
												/>
												<InvoiceDateField
													value={dueDate}
													onChange={setDueDate}
													format={dateFormat}
													label="Due date"
													min={issueDate}
												/>
												{dueDateInvalid ? (
													<p
														className="mt-1 text-[12px] text-warn"
														role="alert"
													>
														Due date is before issue date.
													</p>
												) : null}
											</div>
										</div>
									</div>

									<div className="justify-self-start lg:justify-self-end">
										<div className="w-[96px] space-y-1.5">
											<div className="h-[72px] w-[96px] overflow-hidden rounded-md border border-rule bg-paper">
												{logoUrl.trim() ? (
													<img
														src={logoUrl}
														alt="Company logo preview"
														className="h-full w-full object-contain"
													/>
												) : (
													<div className="flex h-full w-full items-center justify-center text-[12px] text-ink-3">
														Logo
													</div>
												)}
											</div>
											<label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-rule bg-paper px-2.5 text-[12px] text-ink-2 transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out hover:bg-paper-2 hover:text-ink">
												<ImagePlus className="h-3.5 w-3.5" />
												Upload
												<input
													type="file"
													accept="image/*"
													onChange={onLogoFileChange}
													className="hidden"
												/>
											</label>
										</div>
									</div>
								</div>

								<div className="mb-7 grid gap-6 border-y border-rule py-5 md:grid-cols-2 md:items-start">
									<div className="space-y-2">
										<div className="text-sm text-ink-3">From</div>
										<Input
											value={fromName}
											onChange={(event) => setFromName(event.target.value)}
											className="h-9 w-full border-rule bg-paper px-3 text-[14px] font-medium text-ink"
										/>
										{showFromEmail ? (
											<Input
												value={fromEmail}
												onChange={(event) => setFromEmail(event.target.value)}
												className="h-9 w-full border-rule bg-paper px-3 text-[13px] text-ink-2"
											/>
										) : null}
										{showSellerTin ? (
											<div className="flex items-center gap-2 pt-2">
												<div className="w-[32px] text-[12px] text-ink-3">
													TIN
												</div>
												<Input
													value={sellerTin}
													onChange={(event) =>
														setSellerTin(sanitizeTinInput(event.target.value))
													}
													placeholder="0123456789"
													className="h-8 w-full border-rule bg-paper px-3 text-[13px] font-mono text-ink-2"
												/>
											</div>
										) : null}
										{showSellerRc ? (
											<div className="flex items-center gap-2 pt-1">
												<div className="w-[32px] text-[12px] text-ink-3">
													CAC
												</div>
												<Input
													value={sellerRcNumber}
													onChange={(event) =>
														setSellerRcNumber(
															sanitizeRcInput(event.target.value),
														)
													}
													placeholder="RC-1234567"
													className="h-8 w-full border-rule bg-paper px-3 text-[13px] font-mono text-ink-2"
												/>
											</div>
										) : null}
									</div>

									<div className="space-y-2">
										<div className="text-sm text-ink-3">To</div>
										{!clientsQuery.isLoading &&
										clients.length === 0 &&
										!customerName ? (
											<div className="mb-3 border-l-2 border-brand bg-paper-2 px-3 py-2.5">
												<p className="text-[13px] font-medium text-ink">
													Start with your first client
												</p>
												<p className="mt-1 text-[12px] text-ink-3">
													Add their billing details, then select them here.
												</p>
												<button
													type="button"
													onClick={() => setCreateClientOpen(true)}
													className="mt-2 inline-flex h-8 items-center rounded-md border border-brand bg-brand px-3 text-[12px] font-medium text-brand-ink hover:bg-brand-hi"
												>
													Add your first client
												</button>
											</div>
										) : null}
										{clients.length > 0 ? (
											<div className="mb-1">
												<div className="relative w-full">
													<button
														type="button"
														aria-haspopup="listbox"
														aria-expanded={customerPickerOpen}
														onClick={() => {
															setCustomerActiveIndex(0);
															setCustomerPickerOpen((prev) => !prev);
														}}
														className="flex h-9 w-full items-center justify-between rounded-md border border-rule bg-paper px-3 text-[13px] text-ink-2"
													>
														{customerName || "Select client"}
														<ChevronDown className="h-3.5 w-3.5 text-ink-3" />
													</button>
													{customerPickerOpen ? (
														<div className="absolute left-0 top-10 z-20 w-full min-w-[260px] rounded-md border border-rule bg-paper p-2 shadow-[0_2px_8px_rgba(0,0,0,0.25)]">
															<div className="mb-2 flex h-8 items-center gap-2 rounded-md border border-rule bg-paper px-2">
																<Search className="h-3.5 w-3.5 text-ink-3" />
																<input
																	role="combobox"
																	aria-autocomplete="list"
																	aria-controls="invoice-customer-options"
																	aria-expanded={customerPickerOpen}
																	value={customerSearch}
																	onChange={(event) => {
																		setCustomerSearch(event.target.value);
																		setCustomerActiveIndex(0);
																	}}
																	onKeyDown={(event) => {
																		if (event.key === "Escape") {
																			setCustomerPickerOpen(false);
																			return;
																		}
																		if (!filteredClients.length) return;
																		if (
																			event.key === "ArrowDown" ||
																			event.key === "ArrowUp"
																		) {
																			event.preventDefault();
																			setCustomerActiveIndex((current) =>
																				event.key === "ArrowDown"
																					? (current + 1) %
																						filteredClients.length
																					: (current -
																							1 +
																							filteredClients.length) %
																						filteredClients.length,
																			);
																		} else if (event.key === "Enter") {
																			event.preventDefault();
																			selectClient(
																				filteredClients[customerActiveIndex],
																			);
																		}
																	}}
																	placeholder="Search customer..."
																	className="h-full w-full bg-transparent text-xs text-ink-2 outline-none placeholder:text-ink-3"
																/>
															</div>
															<div
																id="invoice-customer-options"
																role="listbox"
																className="max-h-48 overflow-y-auto overscroll-contain"
															>
																{filteredClients.map((client, clientIndex) => (
																	<button
																		key={client.id ?? client.name}
																		type="button"
																		role="option"
																		aria-selected={
																			clientIndex === customerActiveIndex
																		}
																		onMouseEnter={() =>
																			setCustomerActiveIndex(clientIndex)
																		}
																		onClick={() => selectClient(client)}
																		className={cn(
																			"flex h-8 w-full items-center rounded-md px-2 text-left text-[13px] text-ink-2 transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out hover:bg-paper-2",
																			clientIndex === customerActiveIndex &&
																				"bg-paper-2 text-ink",
																		)}
																	>
																		{client.name}
																	</button>
																))}
																{filteredClients.length === 0 ? (
																	<div className="px-2 py-2 text-xs text-ink-3">
																		No customers found.
																	</div>
																) : null}
															</div>
															<div className="mt-2 border-t border-rule pt-2">
																<button
																	type="button"
																	onClick={() => setCreateClientOpen(true)}
																	className="h-8 rounded-md px-2 text-[13px] text-brand transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out hover:text-brand-hi"
																>
																	Create customer
																</button>
															</div>
														</div>
													) : null}
												</div>
											</div>
										) : null}
										{showCustomerEmail && customerId && customerEmail ? (
											<p className="min-w-0 truncate px-3 text-[12px] text-ink-2">
												{customerEmail}
											</p>
										) : null}
										<Input
											value={customerPoNumber}
											onChange={(event) =>
												setCustomerPoNumber(event.target.value.slice(0, 80))
											}
											placeholder="Customer PO number (optional)"
											className="h-9 w-full border-rule bg-paper px-3 text-[13px] text-ink-2"
										/>
									</div>
								</div>

								{documentType === "proforma" ? (
									<div className="mb-5 grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
										<div className="rounded-md border border-rule bg-paper p-3">
											<p className="mb-3 text-sm font-medium text-ink">
												Shipment and customs details
											</p>
											<div className="grid gap-3 sm:grid-cols-2">
												<Input
													value={shipmentWeight}
													onChange={(event) =>
														setShipmentWeight(event.target.value.slice(0, 80))
													}
													placeholder="Weight (kg)"
													className="h-9 border-rule bg-paper px-3 text-[13px] text-ink-2"
												/>
												<Input
													value={shipmentPackageCount}
													onChange={(event) =>
														setShipmentPackageCount(
															event.target.value.replace(/\D/g, "").slice(0, 6),
														)
													}
													inputMode="numeric"
													placeholder="Packages count"
													className="h-9 border-rule bg-paper px-3 text-[13px] text-ink-2"
												/>
												<Input
													value={shipmentHsCode}
													onChange={(event) =>
														setShipmentHsCode(event.target.value.slice(0, 40))
													}
													placeholder="HS code"
													className="h-9 border-rule bg-paper px-3 text-[13px] text-ink-2"
												/>
												<Input
													value={shipmentIncoterms}
													onChange={(event) =>
														setShipmentIncoterms(
															event.target.value.slice(0, 40),
														)
													}
													placeholder="Incoterms"
													className="h-9 border-rule bg-paper px-3 text-[13px] text-ink-2"
												/>
												<Input
													value={shipmentPortOfLoading}
													onChange={(event) =>
														setShipmentPortOfLoading(
															event.target.value.slice(0, 80),
														)
													}
													placeholder="Port of loading"
													className="h-9 border-rule bg-paper px-3 text-[13px] text-ink-2"
												/>
												<Input
													value={shipmentPortOfDischarge}
													onChange={(event) =>
														setShipmentPortOfDischarge(
															event.target.value.slice(0, 80),
														)
													}
													placeholder="Port of discharge"
													className="h-9 border-rule bg-paper px-3 text-[13px] text-ink-2"
												/>
											</div>
										</div>

										<div className="rounded-md border border-rule bg-paper p-3">
											<label className="flex items-center gap-2">
												<input
													type="checkbox"
													checked={depositEnabled}
													onChange={(event) =>
														setDepositEnabled(event.target.checked)
													}
													className="h-4 w-4 rounded border-rule bg-paper accent-brand"
												/>
												<span className="text-sm font-medium text-ink">
													Request deposit
												</span>
											</label>
											{depositEnabled ? (
												<div className="mt-3 grid gap-3">
													<div className="grid grid-cols-2 gap-2">
														<button
															type="button"
															onClick={() => setDepositKind("percentage")}
															className={pillClassName(
																depositKind === "percentage",
															)}
														>
															%<span>Percent</span>
														</button>
														<button
															type="button"
															onClick={() => setDepositKind("amount")}
															className={pillClassName(
																depositKind === "amount",
															)}
														>
															{currency}
															<span>Amount</span>
														</button>
													</div>
													<Input
														value={depositValue}
														onChange={(event) =>
															setDepositValue(
																sanitizeDecimalInput(event.target.value).slice(
																	0,
																	12,
																),
															)
														}
														inputMode="decimal"
														placeholder={
															depositKind === "percentage" ? "50" : "250000"
														}
														className="h-9 border-rule bg-paper px-3 text-[13px] text-ink-2"
													/>
													<DatePicker
														value={depositDueDate}
														onChange={setDepositDueDate}
													/>
												</div>
											) : null}
										</div>
									</div>
								) : null}

								<NotesEditor
									key={`top-${draftKey}`}
									initialContent={topBlock}
									onChange={(content) =>
										setTopBlock(content as EditorDoc | null)
									}
									placeholder="Optional introduction or terms above line items"
									className="mb-4 min-h-14 border-y border-dashed border-rule bg-paper px-1 py-3"
								/>

								<div className="mb-3 hidden items-center gap-3 border-b border-rule px-2 pb-2 text-[12px] text-ink-3 @md:flex">
									{/* Mirrors CreateSortableLineItem's 32px drag
									 * handle + gap-3 — so the label cells sit exactly above
									 * their row columns. */}
									<span className="w-8 shrink-0" aria-hidden />
									<div
										className={cn(
											"grid min-w-0 flex-1 items-center gap-2",
											LINE_ITEM_GRID_COLUMNS,
										)}
									>
										<InlineLabelInput
											value={templateLabels.descriptionLabel}
											onChange={(value) =>
												setTemplateLabels((current) => ({
													...current,
													descriptionLabel: value,
												}))
											}
										/>
										<InlineLabelInput
											value={templateLabels.quantityLabel}
											onChange={(value) =>
												setTemplateLabels((current) => ({
													...current,
													quantityLabel: value,
												}))
											}
											className="text-right"
										/>
										<InlineLabelInput
											value={templateLabels.priceLabel}
											onChange={(value) =>
												setTemplateLabels((current) => ({
													...current,
													priceLabel: value,
												}))
											}
											className="text-right"
										/>
										<InlineLabelInput
											value={templateLabels.totalLabel}
											onChange={(value) =>
												setTemplateLabels((current) => ({
													...current,
													totalLabel: value,
												}))
											}
											className="text-right"
										/>
										<span />
									</div>
								</div>

								<div className="min-h-[52px] shrink-0">
									<div className="space-y-2">
										<DndContext
											sensors={dndSensors}
											collisionDetection={closestCenter}
											onDragEnd={handleLineDragEnd}
										>
											<SortableContext
												items={lineItems.map((i) => i.id)}
												strategy={verticalListSortingStrategy}
											>
												{lineItems.map((item, index) => {
													const lineTotal = lineTotalKobo(item) / 100;
													const isEntering = enteringLineIds.includes(item.id);
													const isExiting = exitingLineIds.includes(item.id);
													const isProductSearchOpen =
														productSearchIndex === index;
													const missingTaxDetails =
														!item.unit?.trim() ||
														!item.classificationCode?.trim();
													const taxDetailsOpen =
														missingTaxDetails ||
														expandedTaxLineIds.includes(item.id);

													return (
														<CreateSortableLineItem
															key={item.id}
															id={item.id}
															className={cn(
																isProductSearchOpen ? "z-40" : "z-0",
																isEntering && "invoice-line-enter",
																isExiting && "invoice-line-exit",
															)}
														>
															<div
																className={cn(
																	"relative grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2 @md:items-center",
																	LINE_ITEM_GRID_COLUMNS,
																)}
															>
																<div className="relative col-span-2 min-w-0 @md:col-span-1">
																	<label
																		className="mb-1 block text-[12px] text-ink-3 @md:sr-only"
																		htmlFor={`invoice-line-description-${item.id}`}
																	>
																		Description
																	</label>
																	<Input
																		id={`invoice-line-description-${item.id}`}
																		role="combobox"
																		aria-autocomplete="list"
																		aria-expanded={isProductSearchOpen}
																		aria-controls={`invoice-product-options-${index}`}
																		ref={
																			item.id === pendingFocusLineId
																				? pendingLineInputRef
																				: undefined
																		}
																		value={item.name}
																		onFocus={(e) => {
																			e.target.setSelectionRange(0, 0);
																			e.target.scrollLeft = 0;
																			setProductSearchIndex(index);
																			setProductSearchQuery(
																				e.target.value.trim(),
																			);
																		}}
																		onChange={(event) => {
																			updateLine(index, {
																				name: event.target.value,
																			});
																			setProductSearchIndex(index);
																			setProductSearchQuery(event.target.value);
																			setProductActiveIndex(0);
																		}}
																		onKeyDown={(event) => {
																			if (event.key === "Escape") {
																				setProductSearchIndex(null);
																				setProductSearchQuery("");
																				return;
																			}
																			if (!visibleProductSearchResults.length)
																				return;
																			if (
																				event.key === "ArrowDown" ||
																				event.key === "ArrowUp"
																			) {
																				event.preventDefault();
																				setProductActiveIndex((current) =>
																					event.key === "ArrowDown"
																						? (current + 1) %
																							visibleProductSearchResults.length
																						: (current -
																								1 +
																								visibleProductSearchResults.length) %
																							visibleProductSearchResults.length,
																				);
																			} else if (event.key === "Enter") {
																				event.preventDefault();
																				selectProduct(
																					index,
																					visibleProductSearchResults[
																						productActiveIndex
																					],
																				);
																			}
																		}}
																		onBlur={(event) => {
																			event.currentTarget.scrollLeft = 0;
																			setTimeout(() => {
																				setProductSearchIndex(null);
																				setProductSearchQuery("");
																			}, 200);
																		}}
																		placeholder="Search product..."
																		className="h-10 min-w-0 truncate border-rule bg-paper px-3 text-[13px] leading-none text-ink placeholder:text-ink-3"
																	/>

																	{isProductSearchOpen &&
																	productSearchQuery.trim() ? (
																		<div
																			id={`invoice-product-options-${index}`}
																			role="listbox"
																			className="absolute left-0 top-full z-50 mt-1 w-full max-w-[calc(100vw-16px)] rounded-md border border-rule bg-paper p-0 shadow-lg"
																		>
																			{productSearchQueryResult.isError &&
																			debouncedProductSearchQuery ===
																				productSearchQuery.trim() ? (
																				<div className="flex items-center justify-between gap-2 px-3 py-2 text-[12px] text-warn">
																					<span>Catalog search failed.</span>
																					<button
																						type="button"
																						className="h-8 px-2 text-brand"
																						onMouseDown={(event) =>
																							event.preventDefault()
																						}
																						onClick={() =>
																							void productSearchQueryResult.refetch()
																						}
																					>
																						Retry
																					</button>
																				</div>
																			) : debouncedProductSearchQuery !==
																					productSearchQuery.trim() ||
																				productSearchQueryResult.isFetching ? (
																				<div className="flex items-center gap-2 px-3 py-2 text-[12px] text-ink-2">
																					<Loader2 className="h-4 w-4 animate-spin" />{" "}
																					Searching catalog…
																				</div>
																			) : visibleProductSearchResults.length >
																				0 ? (
																				<>
																					<div className="border-b border-rule px-3 py-2 text-[12px] font-medium uppercase tracking-[0.12em] text-ink-3">
																						{productSearchQuery.trim().length >
																						0
																							? "Matching products"
																							: "Catalog products"}
																					</div>
																					<div
																						role="listbox"
																						className="max-h-64 overflow-y-auto overscroll-contain"
																					>
																						{visibleProductSearchResults.map(
																							(product, productIndex) => (
																								<button
																									type="button"
																									role="option"
																									aria-selected={
																										productIndex ===
																										productActiveIndex
																									}
																									onMouseEnter={() =>
																										setProductActiveIndex(
																											productIndex,
																										)
																									}
																									key={product.id}
																									onMouseDown={(e) => {
																										e.preventDefault();
																										selectProduct(
																											index,
																											product,
																										);
																									}}
																									className={cn(
																										"flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] text-ink hover:bg-paper-2",
																										productIndex ===
																											productActiveIndex &&
																											"bg-paper-2",
																									)}
																								>
																									<span className="min-w-0">
																										<span className="block truncate">
																											{product.name}
																										</span>
																										<span className="mt-0.5 block text-[12px] capitalize text-ink-3">
																											{product.type}
																											{product.unitName
																												? ` / ${product.unitName}`
																												: ""}
																											{product.sku
																												? ` / SKU ${product.sku}`
																												: ""}
																										</span>
																									</span>
																									<span className="shrink-0 font-mono text-brand">
																										{formatMoney(
																											product.defaultUnitPrice,
																											currency,
																										)}
																									</span>
																								</button>
																							),
																						)}
																					</div>
																				</>
																			) : (
																				<button
																					type="button"
																					role="option"
																					aria-selected={false}
																					className="flex min-h-8 w-full items-center px-3 py-2 text-left text-[12px] text-ink-2 hover:bg-paper-2"
																					onMouseDown={(event) => {
																						event.preventDefault();
																						setProductSearchIndex(null);
																						setProductSearchQuery("");
																					}}
																				>
																					No match – use ‘{item.name.trim()}’ as
																					a custom item
																				</button>
																			)}
																		</div>
																	) : null}
																</div>

																<div className="min-w-0">
																	<div className="mb-1 text-[12px] text-ink-3 @md:sr-only">
																		Qty
																	</div>
																	<div className="flex items-center justify-end gap-1 text-ink-3 @md:gap-1.5">
																		<button
																			type="button"
																			onClick={() => decrementQuantity(index)}
																			className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rule bg-paper text-ink-2 transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out hover:bg-paper-2 hover:text-ink"
																			aria-label="Decrease quantity"
																		>
																			<Minus className="h-3 w-3" />
																		</button>
																		<Input
																			type="number"
																			min={1}
																			step={1}
																			value={item.quantity}
																			onFocus={(e) => e.target.select()}
																			onChange={(event) =>
																				updateLine(index, {
																					quantity: Math.max(
																						1,
																						Math.trunc(
																							Number(event.target.value),
																						) || 1,
																					),
																				})
																			}
																			onBlur={(event) =>
																				updateLine(index, {
																					quantity: Math.max(
																						1,
																						Math.trunc(
																							Number(event.target.value),
																						) || 1,
																					),
																				})
																			}
																			className="h-9 w-[42px] border-rule bg-paper px-0 text-center text-[13px] font-mono text-ink"
																		/>
																		<button
																			type="button"
																			onClick={() => incrementQuantity(index)}
																			className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rule bg-paper text-ink-2 transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out hover:bg-paper-2 hover:text-ink"
																			aria-label="Increase quantity"
																		>
																			<Plus className="h-3 w-3" />
																		</button>
																	</div>
																</div>

																<div className="min-w-0">
																	<label
																		className="mb-1 block text-[12px] text-ink-3 @md:sr-only"
																		htmlFor={`invoice-line-price-${item.id}`}
																	>
																		Price
																	</label>
																	<Input
																		id={`invoice-line-price-${item.id}`}
																		type="text"
																		inputMode="decimal"
																		value={
																			priceDrafts[item.id] ??
																			formatPriceInput(item.price)
																		}
																		onFocus={() =>
																			onPriceFocus(item.id, item.price)
																		}
																		onChange={(event) =>
																			onPriceChange(
																				item.id,
																				index,
																				event.target.value,
																			)
																		}
																		onBlur={() =>
																			commitPriceDraft(
																				item.id,
																				index,
																				item.price,
																			)
																		}
																		onKeyDown={(event) => {
																			if (
																				event.key === "ArrowUp" ||
																				event.key === "ArrowDown"
																			) {
																				event.preventDefault();
																			}
																		}}
																		className={cn(
																			"h-9 w-full border-rule bg-paper px-3 text-right text-[13px] font-mono text-ink",
																		)}
																	/>
																</div>

																<div className="col-span-2 flex items-baseline justify-between border-t border-rule pt-2 text-[13px] text-ink @md:col-span-1 @md:block @md:border-0 @md:pt-0 @md:text-right @md:font-mono">
																	<span className="text-[12px] text-ink-3 @md:hidden">
																		Total
																	</span>
																	<span
																		className="font-mono"
																		data-testid="invoice-line-total"
																	>
																		{formatMoney(lineTotal, currency, {
																			maximumFractionDigits:
																				totalsMaximumFractionDigits,
																		})}
																	</span>
																</div>

																<button
																	type="button"
																	onClick={() => removeLine(index)}
																	className="absolute right-0 top-0 inline-flex h-8 w-8 items-center justify-center rounded-md border border-rule bg-paper text-ink-3 transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out hover:bg-paper-2 hover:text-ink @md:static @md:border-transparent @md:bg-transparent @md:opacity-0 @md:group-hover:opacity-100 @md:group-focus-within:opacity-100"
																	aria-label={`Remove line item ${index + 1}`}
																>
																	<X className="h-3.5 w-3.5" />
																</button>
															</div>

															<button
																type="button"
																aria-expanded={taxDetailsOpen}
																onClick={() => {
																	if (missingTaxDetails) return;
																	setExpandedTaxLineIds((current) =>
																		current.includes(item.id)
																			? current.filter((id) => id !== item.id)
																			: [...current, item.id],
																	);
																}}
																className="mt-2 inline-flex h-8 items-center text-[12px] text-ink-2 hover:text-brand"
															>
																Tax details {taxDetailsOpen ? "▾" : "▸"}
															</button>
															{missingTaxDetails ? (
																<p
																	className="text-[12px] text-warn"
																	role="status"
																>
																	Complete the unit and goods/service code for
																	this line.
																</p>
															) : null}
															{taxDetailsOpen ? (
																<div className="mt-2 grid gap-2 @md:grid-cols-3">
																	<div className="min-w-0">
																		<label
																			className="mb-1 block text-[12px] text-ink-3"
																			htmlFor={`invoice-line-unit-${item.id}`}
																		>
																			Unit of measure *
																		</label>
																		<Select
																			value={item.unit || undefined}
																			onValueChange={(unit) => {
																				updateLine(index, { unit });
																				setExpandedTaxLineIds((current) => [
																					...new Set([...current, item.id]),
																				]);
																			}}
																		>
																			<SelectTrigger
																				id={`invoice-line-unit-${item.id}`}
																				aria-invalid={!item.unit?.trim()}
																				className="h-9 px-2 text-[12px]"
																			>
																				<SelectValue placeholder="Choose unit" />
																			</SelectTrigger>
																			<SelectContent>
																				{UNIT_OPTIONS.map((option) => (
																					<SelectItem
																						key={option.value}
																						value={option.value}
																					>
																						{option.label}
																					</SelectItem>
																				))}
																			</SelectContent>
																		</Select>
																	</div>
																	<div className="min-w-0">
																		<label
																			className="mb-1 block text-[12px] text-ink-3"
																			htmlFor={`invoice-line-vat-${item.id}`}
																		>
																			VAT category *
																		</label>
																		<Select
																			value={
																				item.vatCategory ?? defaultVatCategory
																			}
																			onValueChange={(vatCategory) =>
																				updateLine(index, {
																					vatCategory:
																						vatCategory as LineItem["vatCategory"],
																				})
																			}
																		>
																			<SelectTrigger
																				id={`invoice-line-vat-${item.id}`}
																				className="h-9 px-2 text-[12px]"
																			>
																				<SelectValue placeholder="Choose category" />
																			</SelectTrigger>
																			<SelectContent>
																				{VAT_CATEGORY_OPTIONS.map((option) => (
																					<SelectItem
																						key={option.value}
																						value={option.value}
																					>
																						{option.label}
																					</SelectItem>
																				))}
																			</SelectContent>
																		</Select>
																	</div>
																	<div className="min-w-0">
																		<label
																			className="mb-1 block text-[12px] text-ink-3"
																			htmlFor={`invoice-line-code-${item.id}`}
																		>
																			Goods/service code *
																		</label>
																		<Input
																			id={`invoice-line-code-${item.id}`}
																			aria-invalid={
																				!item.classificationCode?.trim()
																			}
																			value={item.classificationCode ?? ""}
																			onChange={(event) => {
																				updateLine(index, {
																					classificationCode:
																						event.target.value,
																				});
																				setExpandedTaxLineIds((current) => [
																					...new Set([...current, item.id]),
																				]);
																			}}
																			className="h-9 border-rule bg-paper px-2 text-[12px]"
																			placeholder="Enter code"
																		/>
																	</div>
																</div>
															) : null}
														</CreateSortableLineItem>
													);
												})}
											</SortableContext>
										</DndContext>
									</div>
								</div>

								<div className="mt-4 grid gap-4 md:grid-cols-[1fr_290px] md:items-start">
									<div>
										<button
											type="button"
											onClick={addLine}
											className="inline-flex h-9 items-center gap-1.5 rounded-md border border-transparent px-1.5 text-[13px] text-ink-2 transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out hover:border-rule hover:bg-paper hover:text-brand"
										>
											<Plus className="h-3.5 w-3.5" />
											Add item
										</button>
									</div>

									<div className="w-full border-t border-rule pt-4 text-[13px] text-ink-3">
										<div className="flex items-center justify-between">
											<span>Subtotal</span>
											<span
												data-testid="invoice-subtotal"
												key={`subtotal-${currency}-${compliance.subtotal}-${totalsMaximumFractionDigits}`}
												className="font-mono invoice-value-fade"
											>
												{formatMoney(compliance.subtotal, currency, {
													maximumFractionDigits: totalsMaximumFractionDigits,
												})}
											</span>
										</div>
										{compliance.totalTax > 0 ? (
											<div className="mt-2 flex items-center justify-between">
												<span>{selectedTaxSetting?.label}</span>
												<span
													key={`tax-${currency}-${compliance.totalTax}-${totalsMaximumFractionDigits}`}
													className="font-mono invoice-value-fade"
												>
													{formatMoney(compliance.totalTax, currency, {
														maximumFractionDigits: totalsMaximumFractionDigits,
													})}
												</span>
											</div>
										) : null}
										{withholdingCategory !== "none" ? (
											<div className="mt-2 flex items-center justify-between text-warn">
												<span>{selectedWhtCategory?.label}</span>
												<span
													key={`wht-${currency}-${compliance.withholdingTaxAmount}-${totalsMaximumFractionDigits}`}
													className="font-mono invoice-value-fade"
												>
													-{" "}
													{formatMoney(
														compliance.withholdingTaxAmount,
														currency,
														{
															maximumFractionDigits:
																totalsMaximumFractionDigits,
														},
													)}
												</span>
											</div>
										) : null}

										<div className="mt-3 flex items-center justify-between border-t border-rule pt-3">
											<span className="text-ink-2">
												{withholdingCategory === "none"
													? "Total"
													: "Net payable"}
											</span>
											<span
												key={`net-${currency}-${netPayable}-${totalsMaximumFractionDigits}`}
												className="text-[24px] leading-none text-ink invoice-value-fade"
											>
												{formatMoney(netPayable, currency, {
													maximumFractionDigits: totalsMaximumFractionDigits,
												})}
											</span>
										</div>
									</div>
								</div>
								{showPaymentDetailsSection || showNoteSection ? (
									<div
										className={`mt-auto grid items-start gap-4 pt-10 ${
											showPaymentDetailsSection && showNoteSection
												? "md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
												: ""
										}`}
									>
										{showPaymentDetailsSection ? (
											<div>
												<div className="mb-1.5 flex min-h-7 items-center text-[13px] text-ink-3">
													<InlineLabelInput
														value={templateLabels.paymentLabel}
														onChange={(value) =>
															setTemplateLabels((current) => ({
																...current,
																paymentLabel: value,
															}))
														}
													/>
												</div>
												<textarea
													value={paymentDetails}
													onChange={(event) =>
														setPaymentDetails(event.target.value)
													}
													placeholder={PAYMENT_DETAILS_PLACEHOLDER}
													className="min-h-20 w-full resize-none border-0 bg-transparent px-0 py-1 text-[13px] leading-5 text-ink-2 outline-none placeholder:text-ink-3 focus-visible:ring-0"
												/>
											</div>
										) : null}
										{showNoteSection ? (
											<div>
												<div className="mb-1.5 flex min-h-7 items-center">
													<span className="text-[13px] text-ink-2">
														<InlineLabelInput
															value={templateLabels.noteLabel}
															onChange={(value) =>
																setTemplateLabels((current) => ({
																	...current,
																	noteLabel: value,
																}))
															}
														/>
													</span>
												</div>
												<NotesEditor
													key={draftKey}
													initialContent={notes}
													onChange={(content) =>
														setNotes(content as EditorDoc | null)
													}
													placeholder={NOTE_PLACEHOLDER}
													className="min-h-20 w-full border-0 bg-transparent px-0 py-1"
												/>
											</div>
										) : null}
										<NotesEditor
											key={`bottom-${draftKey}`}
											initialContent={bottomBlock}
											onChange={(content) =>
												setBottomBlock(content as EditorDoc | null)
											}
											placeholder="Optional footer or legal text"
											className="mt-4 min-h-14 border-y border-dashed border-rule bg-paper px-1 py-3"
										/>
									</div>
								) : null}
							</div>

							<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-rule bg-paper px-6 py-3 md:px-7">
								<div className="flex flex-wrap items-center gap-2">
									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												className={footerGhostButtonClass}
											>
												<Settings2 className="h-4 w-4" />
												Settings
											</Button>
										</DropdownMenuTrigger>
										<DropdownMenuContent
											side="top"
											align="start"
											className="min-w-[210px] border-rule bg-paper p-1 text-ink-2"
										>
											<DropdownMenuSub>
												<DropdownMenuSubTrigger className="text-xs focus:bg-paper-2 data-[state=open]:bg-paper-2 focus:text-ink data-[state=open]:text-ink">
													<FileText className="mr-2 h-3.5 w-3.5" />
													Invoice
												</DropdownMenuSubTrigger>
												<DropdownMenuSubContent className="border-rule bg-paper text-ink-2">
													<DropdownMenuLabel className="px-2 pb-1 pt-1 text-[12px] font-normal uppercase tracking-[0.08em] text-ink-3">
														Invoice
													</DropdownMenuLabel>
													<DropdownMenuSeparator className="bg-rule" />
													<DropdownMenuSub>
														<DropdownMenuSubTrigger className="text-xs focus:bg-paper-2 data-[state=open]:bg-paper-2 focus:text-ink data-[state=open]:text-ink">
															Invoice size
														</DropdownMenuSubTrigger>
														<DropdownMenuSubContent className="border-rule bg-paper text-ink-2">
															{DOCUMENT_SIZE_OPTIONS.map((option) => (
																<DropdownMenuItem
																	key={option.value}
																	onClick={() => setInvoiceSize(option.value)}
																	className={`text-xs focus:bg-paper-2 focus:text-ink ${
																		invoiceSize === option.value
																			? "text-brand"
																			: ""
																	}`}
																>
																	{option.label}
																</DropdownMenuItem>
															))}
														</DropdownMenuSubContent>
													</DropdownMenuSub>
													<DropdownMenuSub>
														<DropdownMenuSubTrigger className="text-xs focus:bg-paper-2 data-[state=open]:bg-paper-2 focus:text-ink data-[state=open]:text-ink">
															Currency
														</DropdownMenuSubTrigger>
														<DropdownMenuSubContent className="border-rule bg-paper text-ink-2">
															{INVOICE_CURRENCY_OPTIONS.map((option) => (
																<DropdownMenuItem
																	key={option.code}
																	onClick={() => updateCurrency(option.code)}
																	className={`text-xs focus:bg-paper-2 focus:text-ink ${
																		currency === option.code ? "text-brand" : ""
																	}`}
																>
																	{option.symbol} {option.label}
																</DropdownMenuItem>
															))}
														</DropdownMenuSubContent>
													</DropdownMenuSub>
													<DropdownMenuSub>
														<DropdownMenuSubTrigger className="text-xs focus:bg-paper-2 data-[state=open]:bg-paper-2 focus:text-ink data-[state=open]:text-ink">
															Date format
														</DropdownMenuSubTrigger>
														<DropdownMenuSubContent className="border-rule bg-paper text-ink-2">
															{DATE_FORMAT_OPTIONS.map((option) => (
																<DropdownMenuItem
																	key={option.value}
																	onClick={() => setDateFormat(option.value)}
																	className={`text-xs focus:bg-paper-2 focus:text-ink ${
																		dateFormat === option.value
																			? "text-brand"
																			: ""
																	}`}
																>
																	{option.label}
																</DropdownMenuItem>
															))}
														</DropdownMenuSubContent>
													</DropdownMenuSub>
													<DropdownMenuSub>
														<DropdownMenuSubTrigger className="text-xs focus:bg-paper-2 data-[state=open]:bg-paper-2 focus:text-ink data-[state=open]:text-ink">
															Payment terms
														</DropdownMenuSubTrigger>
														<DropdownMenuSubContent className="border-rule bg-paper text-ink-2">
															{PAYMENT_TERM_OPTIONS.map((days) => (
																<DropdownMenuItem
																	key={days}
																	onClick={() => updatePaymentTerms(days)}
																	className={`text-xs focus:bg-paper-2 focus:text-ink ${
																		paymentTermDays === days ? "text-brand" : ""
																	}`}
																>
																	Net {days}
																</DropdownMenuItem>
															))}
														</DropdownMenuSubContent>
													</DropdownMenuSub>
												</DropdownMenuSubContent>
											</DropdownMenuSub>

											<DropdownMenuSub>
												<DropdownMenuSubTrigger className="text-xs focus:bg-paper-2 data-[state=open]:bg-paper-2 focus:text-ink data-[state=open]:text-ink">
													<DollarSign className="mr-2 h-3.5 w-3.5" />
													Tax & Pricing
												</DropdownMenuSubTrigger>
												<DropdownMenuSubContent className="border-rule bg-paper text-ink-2">
													<DropdownMenuCheckboxItem
														checked={includeDecimals}
														onCheckedChange={(checked) =>
															setIncludeDecimals(checked === true)
														}
														className="text-xs focus:bg-paper-2 focus:text-ink"
													>
														Decimals
													</DropdownMenuCheckboxItem>
													<DropdownMenuCheckboxItem
														checked={includeUnits}
														onCheckedChange={(checked) =>
															setIncludeUnits(checked === true)
														}
														className="text-xs focus:bg-paper-2 focus:text-ink"
													>
														Units
													</DropdownMenuCheckboxItem>
													<DropdownMenuCheckboxItem
														checked={includeDiscount}
														onCheckedChange={(checked) =>
															setIncludeDiscount(checked === true)
														}
														className="text-xs focus:bg-paper-2 focus:text-ink"
													>
														Discount
													</DropdownMenuCheckboxItem>
													<DropdownMenuCheckboxItem
														checked={includeQr}
														onCheckedChange={(checked) =>
															setIncludeQr(checked === true)
														}
														className="text-xs focus:bg-paper-2 focus:text-ink"
													>
														QR code
													</DropdownMenuCheckboxItem>
													<DropdownMenuSeparator className="bg-rule" />
													<DropdownMenuSub>
														<DropdownMenuSubTrigger className="text-xs focus:bg-paper-2 data-[state=open]:bg-paper-2 focus:text-ink data-[state=open]:text-ink">
															Seller type
														</DropdownMenuSubTrigger>
														<DropdownMenuSubContent className="border-rule bg-paper text-ink-2">
															<DropdownMenuItem
																onClick={() =>
																	updateSellerProfileType("freelancer")
																}
																className={`text-xs focus:bg-paper-2 focus:text-ink ${
																	sellerProfileType === "freelancer"
																		? "text-brand"
																		: ""
																}`}
															>
																Freelancer / individual
															</DropdownMenuItem>
															<DropdownMenuItem
																onClick={() =>
																	updateSellerProfileType("business")
																}
																className={`text-xs focus:bg-paper-2 focus:text-ink ${
																	sellerProfileType === "business"
																		? "text-brand"
																		: ""
																}`}
															>
																Registered business
															</DropdownMenuItem>
														</DropdownMenuSubContent>
													</DropdownMenuSub>
													<DropdownMenuSub>
														<DropdownMenuSubTrigger className="text-xs focus:bg-paper-2 data-[state=open]:bg-paper-2 focus:text-ink data-[state=open]:text-ink">
															Seller tax status
														</DropdownMenuSubTrigger>
														<DropdownMenuSubContent className="border-rule bg-paper text-ink-2">
															{SELLER_TAX_STATUS_OPTIONS.map((option) => (
																<DropdownMenuItem
																	key={option.value}
																	onClick={() =>
																		updateSellerTaxStatus(option.value)
																	}
																	className={`text-xs focus:bg-paper-2 focus:text-ink ${
																		sellerTaxStatus === option.value
																			? "text-brand"
																			: ""
																	}`}
																>
																	{option.label}
																</DropdownMenuItem>
															))}
														</DropdownMenuSubContent>
													</DropdownMenuSub>
													<DropdownMenuSub>
														<DropdownMenuSubTrigger className="text-xs focus:bg-paper-2 data-[state=open]:bg-paper-2 focus:text-ink data-[state=open]:text-ink">
															Tax treatment
														</DropdownMenuSubTrigger>
														<DropdownMenuSubContent className="border-rule bg-paper text-ink-2">
															{TAX_SETTING_OPTIONS.map((option) => (
																<DropdownMenuItem
																	key={option.value}
																	onClick={() => setTaxTreatment(option.value)}
																	className={`text-xs focus:bg-paper-2 focus:text-ink ${
																		taxTreatment === option.value
																			? "text-brand"
																			: ""
																	}`}
																>
																	{option.label}
																</DropdownMenuItem>
															))}
														</DropdownMenuSubContent>
													</DropdownMenuSub>
													<DropdownMenuSub>
														<DropdownMenuSubTrigger className="text-xs focus:bg-paper-2 data-[state=open]:bg-paper-2 focus:text-ink data-[state=open]:text-ink">
															WHT deduction
														</DropdownMenuSubTrigger>
														<DropdownMenuSubContent className="border-rule bg-paper text-ink-2">
															{WITHHOLDING_CATEGORY_OPTIONS.map((option) => (
																<DropdownMenuItem
																	key={option.value}
																	onClick={() =>
																		setWithholdingCategory(option.value)
																	}
																	className={`text-xs focus:bg-paper-2 focus:text-ink ${
																		withholdingCategory === option.value
																			? "text-brand"
																			: ""
																	}`}
																>
																	{option.label}
																</DropdownMenuItem>
															))}
														</DropdownMenuSubContent>
													</DropdownMenuSub>
													<DropdownMenuItem
														onSelect={(event) => {
															event.preventDefault();
															openComplianceDialog();
														}}
														className="text-xs focus:bg-paper-2 focus:text-ink"
													>
														Compliance details
													</DropdownMenuItem>
												</DropdownMenuSubContent>
											</DropdownMenuSub>

											<DropdownMenuSub>
												<DropdownMenuSubTrigger className="text-xs focus:bg-paper-2 data-[state=open]:bg-paper-2 focus:text-ink data-[state=open]:text-ink">
													<ReceiptText className="mr-2 h-3.5 w-3.5" />
													Payments
												</DropdownMenuSubTrigger>
												<DropdownMenuSubContent className="border-rule bg-paper text-ink-2">
													<DropdownMenuCheckboxItem
														checked={showPaymentDetailsSection}
														onCheckedChange={(checked) =>
															setShowPaymentDetailsSection(checked === true)
														}
														className="text-xs focus:bg-paper-2 focus:text-ink"
													>
														Payment details block
													</DropdownMenuCheckboxItem>
													<DropdownMenuCheckboxItem
														checked={showNoteSection}
														onCheckedChange={(checked) =>
															setShowNoteSection(checked === true)
														}
														className="text-xs focus:bg-paper-2 focus:text-ink"
													>
														Note block
													</DropdownMenuCheckboxItem>
													<DropdownMenuSeparator className="bg-rule" />
													<DropdownMenuItem
														onClick={() =>
															setPaymentDetails(workspace?.paymentDetails ?? "")
														}
														className="text-xs focus:bg-paper-2 focus:text-ink"
													>
														Reset payment details
													</DropdownMenuItem>
													<DropdownMenuItem
														onClick={() => setNotes(null)}
														className="text-xs focus:bg-paper-2 focus:text-ink"
													>
														Reset note
													</DropdownMenuItem>
												</DropdownMenuSubContent>
											</DropdownMenuSub>

											<DropdownMenuSub>
												<DropdownMenuSubTrigger className="text-xs focus:bg-paper-2 data-[state=open]:bg-paper-2 focus:text-ink data-[state=open]:text-ink">
													<Settings2 className="mr-2 h-3.5 w-3.5" />
													Visibility
												</DropdownMenuSubTrigger>
												<DropdownMenuSubContent className="border-rule bg-paper text-ink-2">
													<DropdownMenuCheckboxItem
														checked={showFromEmail}
														onCheckedChange={(checked) =>
															setShowFromEmail(checked === true)
														}
														className="text-xs focus:bg-paper-2 focus:text-ink"
													>
														Show sender email
													</DropdownMenuCheckboxItem>
													<DropdownMenuCheckboxItem
														checked={showCustomerEmail}
														onCheckedChange={(checked) =>
															setShowCustomerEmail(checked === true)
														}
														className="text-xs focus:bg-paper-2 focus:text-ink"
													>
														Show client email
													</DropdownMenuCheckboxItem>
												</DropdownMenuSubContent>
											</DropdownMenuSub>
										</DropdownMenuContent>
									</DropdownMenu>

									<DropdownMenu>
										<DropdownMenuTrigger asChild>
											<button type="button" className={footerGhostButtonClass}>
												{templateName}
												<ChevronDown className="h-3.5 w-3.5 text-ink-3" />
											</button>
										</DropdownMenuTrigger>
										<DropdownMenuContent
											side="top"
											align="start"
											className="min-w-55 border-rule bg-paper p-1 text-ink-2"
										>
											<DropdownMenuLabel className="px-2 pb-1 pt-1 text-[12px] font-normal uppercase tracking-[0.08em] text-ink-3">
												Templates
											</DropdownMenuLabel>
											<DropdownMenuSeparator className="bg-rule" />
											{TEMPLATE_OPTIONS.map((option) => (
												<DropdownMenuItem
													key={option.value}
													onClick={() => setTemplateName(option.value)}
													className={`text-xs focus:bg-paper-2 focus:text-ink ${
														templateName === option.value ? "text-ink" : ""
													}`}
												>
													{option.value}
												</DropdownMenuItem>
											))}
										</DropdownMenuContent>
									</DropdownMenu>
								</div>

								<div className="ml-auto flex flex-wrap items-center justify-end gap-x-2 gap-y-2">
									<div
										className={cn(
											"min-w-28 text-right text-[12px]",
											autosaveStatus === "error" ? "text-warn" : "text-ink-2",
										)}
										aria-live="polite"
									>
										{autosaveStatusText || "\u00a0"}
									</div>
									{submitBlockerText ? (
										<div className="flex w-full flex-wrap items-center justify-end gap-2 text-right text-[12px] text-ink-2 min-[560px]:w-auto">
											{submitBlockerText}
											{!customerId ? (
												<button
													type="button"
													onClick={() => setCreateClientOpen(true)}
													className="h-8 rounded-md px-2 font-medium text-brand hover:text-brand-hi"
												>
													Add client
												</button>
											) : null}
										</div>
									) : null}
									<Button
										type="button"
										variant="ghost"
										onClick={() => {
											if (lastCreatedToken) {
												openInvoiceTab(lastCreatedToken);
												return;
											}
											void createInvoice("open");
										}}
										className={footerIconButtonClass}
										title="Open invoice"
									>
										<ExternalLink className="h-4 w-4" />
									</Button>

									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger asChild>
												<div
													className="flex overflow-hidden rounded-md border border-brand"
													tabIndex={!canSubmit ? 0 : undefined}
													aria-label={
														!canSubmit ? submitBlockerText : undefined
													}
												>
													<button
														type="button"
														disabled={!canSubmit}
														onClick={() => void createInvoice(deliveryType)}
														className={cn(
															"inline-flex h-10 items-center bg-brand px-5 text-[13px] font-medium text-brand-ink transition-[background-color,border-color,color] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-brand-hi disabled:cursor-not-allowed disabled:bg-rule disabled:text-ink-3",
														)}
													>
														{submitting
															? "Working..."
															: deliveryType === "create_and_send"
																? "Create & Send"
																: deliveryType === "scheduled"
																	? "Schedule"
																	: "Create"}
													</button>
													<DropdownMenu>
														<DropdownMenuTrigger asChild>
															<button
																type="button"
																disabled={!canSubmit}
																aria-label="Choose invoice delivery action"
																className="inline-flex h-10 w-10 items-center justify-center border-l border-brand-line bg-brand text-brand-ink transition-[background-color,border-color,color] duration-150 ease-[cubic-bezier(0.4,0,0.2,1)] hover:bg-brand-hi disabled:bg-rule"
															>
																<ChevronDown className="h-4 w-4" />
															</button>
														</DropdownMenuTrigger>
														<DropdownMenuContent
															side="top"
															align="end"
															className="w-64 border-rule bg-paper p-2"
														>
															{(
																[
																	["create", "Create"],
																	["create_and_send", "Create & Send"],
																	["scheduled", "Schedule"],
																] as const
															).map(([value, label]) => (
																<DropdownMenuItem
																	key={value}
																	onClick={() => setDeliveryType(value)}
																>
																	{label}
																</DropdownMenuItem>
															))}
															{deliveryType === "scheduled" ? (
																<div className="space-y-1 border-t border-rule px-2 pt-2">
																	<label
																		htmlFor="invoice-scheduled-at"
																		className="text-xs text-ink-3"
																	>
																		Send at
																	</label>
																	<Input
																		id="invoice-scheduled-at"
																		type="datetime-local"
																		min={new Date(Date.now() + 60_000)
																			.toISOString()
																			.slice(0, 16)}
																		value={scheduledAt}
																		onChange={(event) =>
																			setScheduledAt(event.target.value)
																		}
																	/>
																</div>
															) : null}
														</DropdownMenuContent>
													</DropdownMenu>
												</div>
											</TooltipTrigger>
											{!canSubmit && submitBlockerText ? (
												<TooltipContent
													side="top"
													className="border-rule bg-paper text-ink"
												>
													{submitBlockerText}
												</TooltipContent>
											) : null}
										</Tooltip>
									</TooltipProvider>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>

			<Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
				<DialogContent
					hideClose
					className="flex max-h-[85vh] w-[94vw] max-w-170 flex-col overflow-hidden rounded-lg border-rule bg-paper p-0 text-ink"
				>
					<div className="flex items-start justify-between gap-4 border-b border-rule px-6 py-5">
						<div>
							<DialogTitle className="mb-1 text-[20px] font-medium tracking-[-0.02em] text-ink">
								Tax & compliance settings
							</DialogTitle>
							<DialogDescription className="text-[13px] text-ink-3">
								Controls VAT, WHT, seller identity, and what prints on this
								invoice.
							</DialogDescription>
						</div>
						<DialogClose asChild>
							<button
								type="button"
								className={footerIconButtonClass}
								aria-label="Close invoice settings"
							>
								<X className="h-4 w-4" />
							</button>
						</DialogClose>
					</div>

					<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
						<div className="grid gap-6">
							<section className="rounded-md border border-rule bg-paper p-4">
								<div>
									<div className="text-[13px] font-medium text-ink">
										Template
									</div>
									<div className="mt-1 text-[12px] text-ink-3">
										Select the invoice treatment, then review the summary before
										closing.
									</div>
								</div>
								<div className="mt-4 flex flex-wrap gap-2">
									{TEMPLATE_OPTIONS.map((option) => (
										<button
											key={option.value}
											type="button"
											onClick={() => setTemplateName(option.value)}
											className={pillClassName(templateName === option.value)}
										>
											{templateName === option.value ? (
												<Check className="h-3.5 w-3.5" />
											) : null}
											{option.value}
										</button>
									))}
								</div>
							</section>

							<section className="rounded-md border border-rule bg-paper p-4">
								<div className="text-[13px] font-medium text-ink">
									Invoice labels & blocks
								</div>
								<div className="mt-4 grid gap-3 md:grid-cols-2">
									{Object.entries(templateLabels).map(([key, value]) => (
										<label
											key={key}
											htmlFor={`template-${key}`}
											className="text-[12px] text-ink-3"
										>
											<span className="mb-1 block">
												{key
													.replace(/Label$/, " label")
													.replace(/([A-Z])/g, " $1")}
											</span>
											<Input
												id={`template-${key}`}
												value={value}
												maxLength={80}
												onChange={(event) =>
													setTemplateLabels((current) => ({
														...current,
														[key]: event.target.value,
													}))
												}
												className="h-9 border-rule bg-paper text-ink"
											/>
										</label>
									))}
								</div>
								{includeDiscount ? (
									<label
										htmlFor="template-discount"
										className="mt-4 block text-[12px] text-ink-3"
									>
										<span className="mb-1 block">Discount amount</span>
										<Input
											id="template-discount"
											type="number"
											min={0}
											value={discount}
											onChange={(event) =>
												setDiscount(
													Math.max(0, Number(event.target.value) || 0),
												)
											}
											className="h-9 border-rule bg-paper text-ink"
										/>
									</label>
								) : null}
								<label
									className="mt-4 mb-1 block text-[12px] text-ink-2"
									htmlFor="invoice-default-vat-category"
								>
									Default VAT category for new lines
								</label>
								<Select
									value={defaultVatCategory}
									onValueChange={(value) =>
										setDefaultVatCategory(
											value as NonNullable<LineItem["vatCategory"]>,
										)
									}
								>
									<SelectTrigger id="invoice-default-vat-category">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{VAT_CATEGORY_OPTIONS.map((option) => (
											<SelectItem key={option.value} value={option.value}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<Button
									type="button"
									className="mt-4"
									onClick={() => {
										const context = requireSupabase();
										void saveTemplateDefaults(
											context.client,
											context.userId,
											templateSettings,
										).then(() =>
											toast({
												title: "Invoice defaults saved",
												variant: "success",
											}),
										);
									}}
								>
									Save as workspace defaults
								</Button>
							</section>

							<section className="rounded-md border border-rule bg-paper p-4">
								<div className="text-[13px] font-medium text-ink">
									Tax & deductions
								</div>
								<div className="mt-4">
									<div className="mb-2 text-[12px] text-ink-3">Seller type</div>
									<div className="grid gap-2 md:grid-cols-2">
										<button
											type="button"
											onClick={() => updateSellerProfileType("freelancer")}
											className={cn(
												"rounded-md border p-3 text-left transition-[background-color,border-color,color] duration-[110ms]",
												sellerProfileType === "freelancer"
													? "border-brand bg-paper-3 text-ink"
													: "border-rule bg-paper text-ink-2 hover:bg-paper-2",
											)}
										>
											<span className="block text-[13px] font-medium">
												Freelancer / individual
											</span>
											<span className="mt-1 block text-[12px] text-ink-3">
												Fast invoices, VAT off, tax IDs optional.
											</span>
										</button>
										<button
											type="button"
											onClick={() => updateSellerProfileType("business")}
											className={cn(
												"rounded-md border p-3 text-left transition-[background-color,border-color,color] duration-[110ms]",
												sellerProfileType === "business"
													? "border-brand bg-paper-3 text-ink"
													: "border-rule bg-paper text-ink-2 hover:bg-paper-2",
											)}
										>
											<span className="block text-[13px] font-medium">
												Registered business
											</span>
											<span className="mt-1 block text-[12px] text-ink-3">
												VAT-ready invoices with stronger compliance checks.
											</span>
										</button>
									</div>
								</div>
								<div className="mt-4">
									<div className="mb-2 text-[12px] text-ink-3">
										Seller tax status
									</div>
									<div className="flex flex-wrap gap-2">
										{SELLER_TAX_STATUS_OPTIONS.map((option) => (
											<button
												key={option.value}
												type="button"
												onClick={() => updateSellerTaxStatus(option.value)}
												className={pillClassName(
													sellerTaxStatus === option.value,
												)}
											>
												{option.label}
											</button>
										))}
									</div>
									<div className="mt-2 text-[12px] text-ink-3">
										{selectedSellerTaxStatus?.description}
									</div>
								</div>

								<div className="mt-4">
									<div className="mb-2 text-[12px] text-ink-3">
										Tax treatment
									</div>
									<div className="flex flex-wrap gap-2">
										{TAX_SETTING_OPTIONS.map((option) => (
											<button
												key={option.value}
												type="button"
												onClick={() => setTaxTreatment(option.value)}
												className={pillClassName(taxTreatment === option.value)}
											>
												{option.label}
											</button>
										))}
									</div>
								</div>

								<div className="mt-4">
									<div className="mb-2 text-[12px] text-ink-3">
										WHT deduction
									</div>
									<div className="flex flex-wrap gap-2">
										{WITHHOLDING_CATEGORY_OPTIONS.map((option) => (
											<button
												key={option.value}
												type="button"
												onClick={() => setWithholdingCategory(option.value)}
												className={pillClassName(
													withholdingCategory === option.value,
												)}
											>
												{option.label}
											</button>
										))}
									</div>
									{withholdingCategory !== "none" ? (
										<div className="mt-4 grid gap-4 md:grid-cols-2">
											<div>
												<div className="mb-2 text-[12px] text-ink-3">
													Recipient type
												</div>
												<div className="flex flex-wrap gap-2">
													{WITHHOLDING_ENTITY_TYPE_OPTIONS.map((option) => (
														<button
															key={option.value}
															type="button"
															onClick={() =>
																setWithholdingRecipientEntityType(option.value)
															}
															className={pillClassName(
																withholdingRecipientEntityType === option.value,
															)}
														>
															{option.label}
														</button>
													))}
												</div>
											</div>

											<div>
												<div className="mb-2 text-[12px] text-ink-3">
													Recipient residency
												</div>
												<div className="flex flex-wrap gap-2">
													{WITHHOLDING_RESIDENCY_OPTIONS.map((option) => (
														<button
															key={option.value}
															type="button"
															onClick={() =>
																setWithholdingRecipientResidency(option.value)
															}
															className={pillClassName(
																withholdingRecipientResidency === option.value,
															)}
														>
															{option.label}
														</button>
													))}
												</div>
											</div>
										</div>
									) : null}
									<div className="mt-2 text-[12px] text-ink-3">
										{selectedWhtCategory?.description}
									</div>
								</div>

								{currency !== "NGN" ? (
									<div className="mt-4 rounded-md border border-warn-line bg-paper-2 px-3 py-3 text-[12px] text-warn">
										<div className="flex items-start gap-2">
											<CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
											<span>{NIGERIA_FOREIGN_CURRENCY_WARNING}</span>
										</div>
									</div>
								) : null}
							</section>

							<section className="rounded-md border border-rule bg-paper p-4">
								<div className="text-[13px] font-medium text-ink">
									Seller tax profile
								</div>
								<div className="mt-4 grid gap-2 md:grid-cols-2">
									<button
										type="button"
										onClick={() => setShowSellerTin((current) => !current)}
										className={cn(
											"flex min-h-10 items-center justify-between rounded-md border px-3 text-left text-[13px] transition-[background-color,border-color,color] duration-[110ms]",
											showSellerTin
												? "border-brand bg-paper-3 text-ink"
												: "border-rule bg-paper text-ink-2 hover:bg-paper-2",
										)}
									>
										<span>Include seller TIN</span>
										{showSellerTin ? <Check className="h-3.5 w-3.5" /> : null}
									</button>
									<button
										type="button"
										onClick={() => setShowSellerRc((current) => !current)}
										className={cn(
											"flex min-h-10 items-center justify-between rounded-md border px-3 text-left text-[13px] transition-[background-color,border-color,color] duration-[110ms]",
											showSellerRc
												? "border-brand bg-paper-3 text-ink"
												: "border-rule bg-paper text-ink-2 hover:bg-paper-2",
										)}
									>
										<span>Include CAC RC Number</span>
										{showSellerRc ? <Check className="h-3.5 w-3.5" /> : null}
									</button>
								</div>
								<div className="mt-4 grid gap-4 md:grid-cols-2">
									<div>
										<label
											htmlFor="seller-tin"
											className="mb-1.5 block text-[12px] text-ink-3"
										>
											Seller tax ID
										</label>
										<Input
											id="seller-tin"
											value={sellerTin}
											disabled={!showSellerTin}
											onFocus={(e) => e.target.select()}
											onChange={(event) =>
												setSellerTin(sanitizeTinInput(event.target.value))
											}
											placeholder={
												showSellerTin ? "0123456789" : "Not included"
											}
											aria-invalid={!tinIsValid}
											className={cn(
												"h-10 bg-paper text-ink disabled:text-ink-3",
												tinIsValid ? "border-rule" : "border-danger",
											)}
										/>
										<div className={`mt-2 text-[12px] ${tinHintClass}`}>
											{!showSellerTin
												? "Off for this invoice."
												: requiresSellerTin && !sellerTinForSubmission
													? "Required when charging VAT."
													: tinHintText}
										</div>
									</div>

									<div>
										<label
											htmlFor="seller-rc"
											className="mb-1.5 block text-[12px] text-ink-3"
										>
											CAC RC Number
										</label>
										<Input
											id="seller-rc"
											value={sellerRcNumber}
											disabled={!showSellerRc}
											onFocus={(e) => e.target.select()}
											onChange={(event) =>
												setSellerRcNumber(sanitizeRcInput(event.target.value))
											}
											placeholder={showSellerRc ? "RC-1234567" : "Not included"}
											aria-invalid={!rcIsValid}
											className={cn(
												"h-10 bg-paper text-ink disabled:text-ink-3",
												rcIsValid ? "border-rule" : "border-danger",
											)}
										/>
										<div
											className={cn(
												"mt-2 text-[12px]",
												rcIsValid ? "text-ink-3" : "text-danger",
											)}
										>
											{!showSellerRc
												? "Off for this invoice."
												: sellerRcNumber.trim().length === 0 || rcIsValid
													? "Optional. Use RC-1234567 format if you want it printed."
													: "RC Number should look like RC-1234567."}
										</div>
									</div>
								</div>
								{sellerProfileType === "freelancer" ? (
									<div className="mt-4 rounded-md border border-rule bg-paper px-3 py-3 text-[12px] text-ink-3">
										Freelancer mode keeps TIN and RC optional and does not
										charge VAT by default.
									</div>
								) : null}
							</section>
						</div>
					</div>

					<div className="flex shrink-0 items-center justify-between gap-3 border-t border-rule px-6 py-4">
						<div className="min-w-0 text-[12px] text-ink-3">
							<div className="truncate">
								{templateName}
								{selectedTaxSetting?.label
									? ` • ${selectedTaxSetting.label}`
									: ""}
								{selectedWhtCategory?.value !== "none"
									? ` • ${selectedWhtCategory?.label}`
									: ""}
							</div>
							{sellerTinWillNotPrint ? (
								<div className="mt-1 flex items-center gap-1 text-ink-3">
									<CircleAlert className="h-3.5 w-3.5" />
									TIN is enabled but empty, so it will not print.
								</div>
							) : null}
						</div>
						<DialogClose asChild>
							<Button
								type="button"
								className="h-10 rounded-md border border-brand bg-brand px-5 text-[13px] font-medium text-brand-ink hover:bg-brand-hi"
							>
								Done
							</Button>
						</DialogClose>
					</div>
				</DialogContent>
			</Dialog>

			<Dialog open={createClientOpen} onOpenChange={setCreateClientOpen}>
				<DialogContent className="max-w-md border-rule bg-paper p-0 shadow-2xl sm:rounded-xl">
					<div className="border-b border-rule px-6 py-5">
						<DialogTitle className="text-lg font-medium text-ink">
							Create Customer
						</DialogTitle>
						<DialogDescription className="mt-1 text-[13px] text-ink-3">
							Add a new customer to your workspace.
						</DialogDescription>
					</div>
					<form onSubmit={onCreateClientSubmit} className="p-6">
						<div className="space-y-4">
							<div className="space-y-2">
								<label htmlFor="new-client-name" className="text-sm text-ink">
									Customer name *
								</label>
								<Input
									id="new-client-name"
									value={newClientName}
									onChange={(e) => setNewClientName(e.target.value)}
									placeholder="Company or individual name"
									className="h-10 border-rule bg-paper text-sm text-ink"
									required
								/>
							</div>
							<div className="space-y-2">
								<label htmlFor="new-client-email" className="text-sm text-ink">
									Email address *
								</label>
								<Input
									id="new-client-email"
									type="email"
									value={newClientEmail}
									onChange={(e) => setNewClientEmail(e.target.value)}
									placeholder="billing@example.com"
									className="h-10 border-rule bg-paper text-sm text-ink"
									required
								/>
							</div>
						</div>
						<div className="mt-6 flex justify-end gap-3">
							<Button
								type="button"
								variant="outline"
								onClick={() => setCreateClientOpen(false)}
								className="h-10 border-rule bg-paper text-ink hover:bg-paper-2"
							>
								Cancel
							</Button>
							<Button
								type="submit"
								disabled={
									!newClientName.trim() ||
									!newClientEmail.trim() ||
									newClientSubmitting
								}
								className="h-10 bg-brand text-brand-ink hover:bg-brand-hi"
							>
								{newClientSubmitting ? "Creating..." : "Create"}
							</Button>
						</div>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
