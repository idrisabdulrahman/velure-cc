import { useMutation, useQuery } from "convex/react";
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
	ImagePlus,
	Minus,
	Plus,
	ReceiptText,
	Search,
	Settings2,
	X,
} from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
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
import { cn } from "#/utils/cn";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

type LineItem = {
	id: string;
	name: string;
	quantity: number;
	price: number;
	productId?: Id<"products">;
};

type CreateInvoicePanelProps = {
	mode?: "page" | "sheet";
	onCreated?: (invoiceId: string) => void;
	initialDraft?: ImportedInvoiceDraft | null;
	initialDocumentType?: InvoiceDocumentType;
};

type ComposerStage = "editor" | "success";

type CreateIntent = "create" | "open";
type AutosaveStatus = "idle" | "saving" | "saved" | "error";
type InvoiceDocumentType = "standard" | "proforma";
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
	{ value: "iso", label: "YYYY-MM-DD" },
	{ value: "us", label: "MM/DD/YYYY" },
] as const;

const PAYMENT_TERM_OPTIONS = [7, 14, 30] as const;
const DOCUMENT_TYPE_OPTIONS = [
	{
		value: "standard",
		label: "Standard",
		description: "Final invoice for payment collection.",
	},
	{
		value: "proforma",
		label: "Pro-forma",
		description: "Pre-sale approval, customs, or deposit request.",
	},
] as const;

const TAX_SETTING_OPTIONS = [
	{ value: "none", label: "No tax" },
	{ value: "exclusive_rate", label: `VAT ${NIGERIA_VAT_RATE}%` },
	{ value: "exempt", label: "Exempt" },
] as const satisfies ReadonlyArray<{ value: TaxTreatment; label: string }>;

const PAYMENT_DETAILS_PLACEHOLDER =
	"Add bank details, wallet address, or payment instructions";
const NOTE_PLACEHOLDER =
	"E.g. Thank you for your business. Payment due within 14 days.";
const NGN_PER_CURRENCY = {
	NGN: 1,
	USD: 1500,
	GBP: 1900,
} as const;
const PERSISTABLE_WARNING_CODES = new Set([
	"missing_seller_tax_id",
	"missing_buyer_tax_id",
	"cross_border_review",
	"reverse_charge_review",
	"unknown_jurisdiction",
	"domestic_vat_not_applied",
	"missing_workspace_tax_status",
]);

type SupportedCurrency = (typeof INVOICE_CURRENCY_OPTIONS)[number]["code"];
type SupportedTemplateName = (typeof TEMPLATE_OPTIONS)[number]["value"];
function getCountryCodeFromCurrency(currency: string): JurisdictionCode {
	switch (currency.toUpperCase()) {
		case "NGN":
			return "NG";
		case "GBP":
			return "GB";
		case "USD":
			return "US";
		default:
			return "OTHER";
	}
}

function normalizeCurrency(value?: string | null): SupportedCurrency {
	const normalized = value?.trim().toUpperCase();
	if (normalized === "NGN" || normalized === "USD" || normalized === "GBP")
		return normalized;
	return "NGN";
}

function toIsoDate(value: Date) {
	return value.toISOString().slice(0, 10);
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

function formatDate(value: string, format: "iso" | "us") {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	if (format === "iso") return value;
	return date.toLocaleDateString("en-US");
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
	const trimmed = raw.trim();
	if (!trimmed) return 0;
	const parsed = Number.parseFloat(trimmed);
	if (!Number.isFinite(parsed)) return 0;
	return parsed;
}

function convertAmount(
	amount: number,
	fromCurrency: SupportedCurrency,
	toCurrency: SupportedCurrency,
) {
	if (fromCurrency === toCurrency) return amount;
	const converted =
		(amount * NGN_PER_CURRENCY[fromCurrency]) / NGN_PER_CURRENCY[toCurrency];
	return Math.round(converted * 100) / 100;
}

function netPayableFromCompliance(compliance: {
	grandTotal: number;
	withholdingTaxAmount?: number;
	netPayable?: number;
}) {
	return (
		compliance.netPayable ??
		compliance.grandTotal - (compliance.withholdingTaxAmount ?? 0)
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

function createEmptyLineItem(): LineItem {
	return {
		id: `li-${crypto.randomUUID()}`,
		name: "",
		quantity: 1,
		price: 0,
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
			? "border-[#c8ff62] bg-[#c8ff62] text-[#0f1111]"
			: "border-[#30352f] bg-[#101211] text-[#beb6a8] hover:bg-[#20241f] hover:text-[#f2efe7]",
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
	const createDraft = useMutation(api.invoices.createDraft);
	const autosaveDraft = useMutation(api.invoices.autosaveDraft);
	const clients = (useQuery(api.clients.list, {
		q: "",
		status: "all",
	}) ?? []) as Array<{
		id?: string;
		name: string;
		email?: string;
		currency?: string;
	}>;
	const workspace = useQuery(api.compliance.getWorkspaceSettings, {});

	const [composerStage, setComposerStage] = useState<ComposerStage>("editor");
	const [createdInvoice, setCreatedInvoice] =
		useState<CreatedInvoiceSummary | null>(null);
	const [invoiceNumber, setInvoiceNumber] = useState(() =>
		generateInvoiceNumber(),
	);
	const [documentType, setDocumentType] =
		useState<InvoiceDocumentType>(initialDocumentType);
	const [issueDate, setIssueDate] = useState(() => buildIssueDate());
	const [logoUrl, setLogoUrl] = useState("");
	const [customerName, setCustomerName] = useState("");
	const [customerEmail, setCustomerEmail] = useState("");
	const [customerPoNumber, setCustomerPoNumber] = useState("");
	const [fromName, setFromName] = useState("Velure Studio");
	const [fromEmail, setFromEmail] = useState("hello@velure.app");
	const [paymentDetails, setPaymentDetails] = useState("");
	const [notes, setNotes] = useState("");
	const [currency, setCurrency] = useState<SupportedCurrency>("NGN");
	const [invoiceSize, setInvoiceSize] = useState<"A4" | "LETTER">("A4");
	const [dateFormat, setDateFormat] = useState<"iso" | "us">("iso");
	const [paymentTermDays, setPaymentTermDays] = useState(14);
	const [dueDate, setDueDate] = useState(() => buildDueDate(14));
	const [includeDecimals, setIncludeDecimals] = useState(true);
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
	const [createClientOpen, setCreateClientOpen] = useState(false);
	const [newClientName, setNewClientName] = useState("");
	const [newClientEmail, setNewClientEmail] = useState("");
	const [newClientSubmitting, setNewClientSubmitting] = useState(false);
	const createClient = useMutation(api.clients.create);

	const onCreateClientSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!newClientName.trim() || !newClientEmail.trim() || newClientSubmitting)
			return;

		setNewClientSubmitting(true);
		try {
			await createClient({
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
	const [autoSendEmail, setAutoSendEmail] = useState(true);
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
	const [enteringLineIds, setEnteringLineIds] = useState<string[]>([]);
	const [exitingLineIds, setExitingLineIds] = useState<string[]>([]);
	const [pendingFocusLineId, setPendingFocusLineId] = useState<string | null>(
		null,
	);
	const [productSearchIndex, setProductSearchIndex] = useState<number | null>(
		null,
	);
	const [productSearchQuery, setProductSearchQuery] = useState("");
	const lineItemsScrollRef = useRef<HTMLDivElement | null>(null);
	const pendingLineInputRef = useRef<HTMLInputElement | null>(null);
	const autosaveDraftIdRef = useRef<Id<"invoices"> | null>(null);
	const autosaveTokenRef = useRef(`pub-${crypto.randomUUID()}`);
	const autosaveSignatureRef = useRef("");
	const autosaveInFlightRef = useRef(false);
	const autosavePendingRef = useRef(false);
	const autosaveNowRef = useRef<() => void>(() => {});

	const productSearchResults = useQuery(
		api.products.list,
		productSearchIndex !== null
			? {
					q: productSearchQuery.trim(),
					type: "all",
					status: "active",
				}
			: "skip",
	);
	const visibleProductSearchResults = (
		(productSearchResults as
			| Array<{
					id: Id<"products">;
					name: string;
					sku?: string;
					defaultUnitPrice: number;
					unitName?: string;
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
		setInvoiceNumber(generateInvoiceNumber(workspace, documentType));
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
		if (!workspace || initialDraft) return;
		setInvoiceNumber(generateInvoiceNumber(workspace, documentType));
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

		setComposerStage("editor");
		setCreatedInvoice(null);
		setDocumentType(initialDocumentType);
		if (initialDraft.invoiceNumber)
			setInvoiceNumber(initialDraft.invoiceNumber);
		if (initialDraft.issueDate) setIssueDate(initialDraft.issueDate);
		if (initialDraft.dueDate) setDueDate(initialDraft.dueDate);
		if (initialDraft.customerName) setCustomerName(initialDraft.customerName);
		if (initialDraft.customerEmail)
			setCustomerEmail(initialDraft.customerEmail);
		setCustomerPoNumber("");
		setCurrency(normalizeCurrency(initialDraft.currency));
		if (initialDraft.notes) {
			setNotes(initialDraft.notes);
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
				quantity: Math.max(1, item.quantity),
				price: Math.max(0, item.price),
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
	const isForeignCurrency = currency !== "NGN";
	const paperFrameClass =
		invoiceSize === "A4" ? "max-w-[860px]" : "max-w-[900px]";
	const footerGhostButtonClass =
		"inline-flex h-10 items-center gap-2 rounded-md border border-[#30352f] bg-[#101211] px-3.5 text-[13px] text-[#d8d1c4] transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out hover:bg-[#20241f] hover:text-[#f2efe7]";
	const footerIconButtonClass =
		"inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#30352f] bg-[#101211] text-[#beb6a8] transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out hover:bg-[#20241f] hover:text-[#f2efe7]";

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
			? "text-[#8fd26d]"
			: tinDigits === 0
				? "text-[#737b89]"
				: "text-[#c8ff62]";
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
	const canSubmit =
		customerName.trim().length > 1 && hasPricedLineItem && !submitting;
	const submitBlockerText = !customerName.trim()
		? "Select or enter a client before creating."
		: !hasPricedLineItem
			? "Add at least one priced line item."
			: "";
	const autosaveStatusText =
		autosaveStatus === "saving"
			? "Saving draft..."
			: autosaveStatus === "saved"
				? "Draft saved"
				: autosaveStatus === "error"
					? "Draft not saved"
					: "";
	const dueDateLabel =
		documentType === "proforma" && !depositEnabled ? "Valid Until" : "Due Date";
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
			notes.trim().length > 0 ||
			documentType !== "standard" ||
			Boolean(shipmentDetails) ||
			Boolean(depositRequest) ||
			dueDate !== defaultDueDate ||
			currency !== "NGN" ||
			invoiceSize !== "A4" ||
			dateFormat !== "iso" ||
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

	const buildDraftMutationArgs = (id?: Id<"invoices"> | null) => ({
		id: id ?? undefined,
		token: autosaveTokenRef.current,
		documentType,
		shipmentDetails,
		depositRequest,
		invoiceNumber: id ? invoiceNumber.trim() : "",
		customerName: customerName.trim(),
		logoUrl: logoUrl.trim() || undefined,
		customerPoNumber: customerPoNumber.trim() || undefined,
		currency,
		type: "one-time" as const,
		invoiceSize,
		dateFormat,
		paymentTermsDays: paymentTermDays,
		template: templateName,
		issueDate,
		dueDate,
		paymentDetails:
			showPaymentDetailsSection && paymentDetails.trim()
				? paymentDetails.trim()
				: undefined,
		notes: showNoteSection && notes.trim() ? notes.trim() : undefined,
		lineItems: lineItems.map((item) => ({
			id: item.id,
			name: item.name.trim(),
			quantity: Math.max(1, item.quantity),
			price: Math.max(0, item.price),
			productId: item.productId,
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
			!rcIsValid
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
			const saved = await autosaveDraft(
				buildDraftMutationArgs(autosaveDraftIdRef.current),
			);
			autosaveDraftIdRef.current = saved.id as Id<"invoices">;
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
		setLineItems((items) =>
			items.map((item) => ({
				...item,
				price: convertAmount(item.price, currency, nextCurrency),
			})),
		);
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

	const selectClient = (name: string) => {
		setCustomerName(name);
		const matched = clients.find((client) => client.name === name);
		if (matched) {
			setCustomerEmail(matched.email ?? "");
		}
		setCustomerPickerOpen(false);
		setCustomerSearch("");
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
			id: Id<"products"> | string;
			name: string;
			sku?: string;
			defaultUnitPrice: number;
			unitName?: string;
		},
	) => {
		const lineId = lineItems[index]?.id;
		updateLine(index, {
			name: product.name,
			price: product.defaultUnitPrice,
			productId: product.id as Id<"products">,
		});
		if (lineId) {
			setPriceDrafts((prev) => ({
				...prev,
				[lineId]: String(product.defaultUnitPrice),
			}));
		}
		setProductSearchIndex(null);
		setProductSearchQuery("");
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

	useEffect(() => {
		if (!pendingFocusLineId) return;
		lineItemsScrollRef.current?.scrollTo({
			top: lineItemsScrollRef.current.scrollHeight,
			behavior: "smooth",
		});
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

	const onPriceChange = (lineId: string, value: string) => {
		setPriceDrafts((prev) => ({
			...prev,
			[lineId]: sanitizeDecimalInput(value),
		}));
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
		setInvoiceNumber(generateInvoiceNumber(workspace));
		setIssueDate(nextIssueDate);
		setLogoUrl("");
		setCustomerName("");
		setCustomerEmail("");
		setCustomerPoNumber("");
		setFromName(workspace?.legalName || workspace?.name || "Velure Studio");
		setFromEmail(workspace?.email ?? "hello@velure.app");
		setLogoUrl(workspace?.logoUrl ?? "");
		setPaymentDetails(workspace?.paymentDetails ?? "");
		setNotes("");
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

	const createInvoice = async (intent: CreateIntent = "create") => {
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

		setSubmitting(true);
		try {
			const created = await createDraft({
				id: autosaveDraftIdRef.current ?? undefined,
				token: `pub-${crypto.randomUUID()}`,
				documentType,
				shipmentDetails,
				depositRequest,
				invoiceNumber: "",
				customerName: customerName.trim(),
				logoUrl: logoUrl.trim() || undefined,
				customerPoNumber: customerPoNumber.trim() || undefined,
				currency,
				type: "one-time",
				invoiceSize,
				dateFormat,
				paymentTermsDays: paymentTermDays,
				template: templateName,
				issueDate,
				dueDate,
				paymentDetails:
					showPaymentDetailsSection && paymentDetails.trim()
						? paymentDetails.trim()
						: undefined,
				notes: showNoteSection && notes.trim() ? notes.trim() : undefined,
				lineItems: lineItems
					.filter((item) => item.name.trim().length > 0)
					.map((item) => ({
						id: item.id,
						name: item.name.trim(),
						quantity: Math.max(1, item.quantity),
						price: Math.max(0, item.price),
						productId: item.productId,
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
				autoSendEmail,
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
				<div className={`flex-1 overflow-auto ${isSheetMode ? "p-0" : "px-2"}`}>
					<div className="mx-auto flex h-full min-h-full w-full max-w-[720px] flex-col border border-[#30352f] bg-[#101211]">
						<div className="flex min-h-0 flex-1 flex-col px-6 py-6">
							<div>
								<h2 className="text-[34px] font-medium tracking-[-0.03em] text-[#f2efe7]">
									Created
								</h2>
								<p className="mt-2 text-sm text-[#8d938f]">
									Your{" "}
									{createdInvoice.documentType === "proforma"
										? "pro-forma invoice"
										: "invoice"}{" "}
									was created successfully.
								</p>
							</div>

							<div className="mt-10 border border-[#30352f] bg-[#0f1111] p-5">
								<div className="flex items-start justify-between gap-4 text-sm text-[#8d938f]">
									<div className="text-[13px]">
										{createdInvoice.documentType === "proforma"
											? "Pro-forma No"
											: "Invoice No"}
										:{" "}
										<span className="font-medium text-[#f2efe7]">
											{createdInvoice.invoiceNumber}
										</span>
									</div>
									<div className="text-[13px]">
										{createdInvoice.documentType === "proforma"
											? "Valid Until"
											: "Due Date"}
										:{" "}
										<span className="font-medium text-[#f2efe7]">
											{formatDate(createdInvoice.dueDate, dateFormat)}
										</span>
									</div>
								</div>

								<div className="mt-8">
									<div className="text-[18px] font-medium text-[#f2efe7]">
										{createdInvoice.customerName}
									</div>
									{createdInvoice.customerEmail ? (
										<div className="mt-3 text-[13px] text-[#8d938f] underline underline-offset-2">
											{createdInvoice.customerEmail}
										</div>
									) : null}
								</div>

								<div className="mt-10 flex items-end justify-between gap-4 border-b border-[#30352f] pb-5">
									<div className="text-[13px] text-[#8d938f]">Total</div>
									<div className="text-[18px] text-[#f2efe7]">
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
									<div className="text-[28px] font-medium tracking-[-0.03em] text-[#f2efe7]">
										Details
									</div>
									<div className="mt-10">
										<div className="mb-2 text-[12px] text-[#8d938f]">
											Share link
										</div>
										<div className="flex items-center gap-2">
											<div className="flex h-10 flex-1 items-center border border-[#30352f] bg-[#101211] px-3 text-[13px] text-[#8d938f]">
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
							</div>
						</div>

						<div className="flex items-center justify-end gap-3 border-t border-[#30352f] bg-[#0f1111] px-6 py-5">
							<button
								type="button"
								onClick={() => openInvoiceTab(createdInvoice.token)}
								className="inline-flex h-10 items-center rounded-md border border-[#30352f] bg-[#101211] px-5 text-[14px] text-[#f2efe7] transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out hover:bg-[#20241f]"
							>
								View{" "}
								{createdInvoice.documentType === "proforma"
									? "pro-forma"
									: "invoice"}
							</button>
							<button
								type="button"
								onClick={resetDraft}
								className="inline-flex h-10 items-center rounded-md border border-[#c8ff62] bg-[#c8ff62] px-5 text-[14px] font-medium text-[#0f1111] transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out hover:bg-[#d5ff7a]"
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
				<div className={`flex-1 overflow-auto ${isSheetMode ? "p-0" : "px-2"}`}>
					<div
						className={`mx-auto flex min-h-full w-full flex-col border border-[#30352f] bg-[#101211] ${paperFrameClass}`}
					>
						<div className="flex min-h-0 flex-1 flex-col">
							<div className="flex min-h-0 flex-1 flex-col px-6 pb-24 pt-6 md:px-7">
								<div className="mb-5 grid gap-3 rounded-md border border-[#30352f] bg-[#0f1111] p-3 md:grid-cols-2">
									{DOCUMENT_TYPE_OPTIONS.map((option) => (
										<button
											key={option.value}
											type="button"
											onClick={() =>
												setDocumentType(option.value as InvoiceDocumentType)
											}
											aria-pressed={documentType === option.value}
											className={cn(
												"rounded-md border px-3 py-3 text-left transition-[background-color,border-color,color] duration-[110ms]",
												documentType === option.value
													? "border-[#c8ff62] bg-[#1a2117] text-[#f2efe7]"
													: "border-[#30352f] bg-[#101211] text-[#beb6a8] hover:bg-[#20241f]",
											)}
										>
											<span className="block text-sm font-medium">
												{option.label}
											</span>
											<span className="mt-1 block text-xs text-[#8d938f]">
												{option.description}
											</span>
										</button>
									))}
								</div>

								<div className="mb-8 grid gap-5 border-b border-[#30352f] pb-6 lg:grid-cols-[minmax(0,1fr)_120px] lg:items-start">
									<div className="space-y-4">
										<div className="grid gap-3 md:grid-cols-[minmax(190px,1.15fr)_minmax(150px,0.85fr)_minmax(168px,1fr)]">
											<div className="min-h-[76px] rounded-md border border-[#30352f] bg-[#0f1111] px-3 py-2.5">
												<div className="text-[11px] text-[#7f857f]">
													Invoice No.
												</div>
												<div className="mt-1 font-mono text-[14px] text-[#f2efe7]">
													{invoiceNumber}
												</div>
												<div className="mt-1 text-[11px] text-[#8d938f]">
													Server-reserved when saved.
												</div>
											</div>
											<div className="min-h-[76px] rounded-md border border-[#30352f] bg-[#0f1111] px-3 py-2.5">
												<div className="text-[11px] text-[#7f857f]">
													Issue Date
												</div>
												<div className="mt-1 font-mono text-[14px] text-[#f2efe7]">
													{formatDate(issueDate, dateFormat)}
												</div>
											</div>
											<div className="min-h-[76px] rounded-md border border-[#c8ff62] bg-[#101211] px-3 py-2.5">
												<div className="text-[11px] text-[#7f857f]">
													{dueDateLabel}
												</div>
												<Popover>
													<PopoverTrigger asChild>
														<Button
															type="button"
															variant="ghost"
															className="mt-1 inline-flex h-auto items-center gap-2 rounded-none border-0 bg-transparent p-0 font-mono text-[14px] text-[#f2efe7] hover:bg-transparent hover:text-[#f6f1e7]"
														>
															{formatDate(dueDate, dateFormat)}
															<CalendarDays className="h-4 w-4 text-[#7f857f]" />
														</Button>
													</PopoverTrigger>
													<PopoverContent
														align="start"
														className="w-auto border-[#30352f] bg-[#101211] p-0"
													>
														<Calendar
															mode="single"
															selected={fromIsoDate(dueDate)}
															onSelect={(selectedDate) => {
																if (!selectedDate) return;
																setDueDate(toIsoDate(selectedDate));
															}}
														/>
													</PopoverContent>
												</Popover>
											</div>
										</div>

										<div className="flex flex-wrap items-center gap-2">
											{INVOICE_CURRENCY_OPTIONS.map((option) => (
												<button
													key={option.code}
													type="button"
													aria-pressed={currency === option.code}
													onClick={() => updateCurrency(option.code)}
													className={pillClassName(currency === option.code)}
												>
													<span>{option.symbol}</span>
													<span>{option.label}</span>
												</button>
											))}
										</div>
									</div>

									<div className="justify-self-start lg:justify-self-end">
										<div className="w-[108px] space-y-2">
											<div className="h-[88px] w-[108px] overflow-hidden rounded-md border border-[#30352f] bg-[#0f1111]">
												{logoUrl.trim() ? (
													<img
														src={logoUrl}
														alt="Company logo preview"
														className="h-full w-full object-contain"
													/>
												) : (
													<div className="flex h-full w-full items-center justify-center text-[11px] text-[#817d72]">
														Logo
													</div>
												)}
											</div>
											<label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-[#30352f] bg-[#101211] px-2.5 text-[11px] text-[#beb6a8] transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out hover:bg-[#20241f] hover:text-[#f2efe7]">
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

								<div className="mb-7 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(260px,280px)] lg:items-start">
									<div className="space-y-2">
										<div className="text-sm text-[#7f857f]">From</div>
										<Input
											value={fromName}
											onChange={(event) => setFromName(event.target.value)}
											className="h-9 w-full border-[#30352f] bg-[#0f1111] px-3 text-[14px] font-medium text-[#f2efe7]"
										/>
										{showFromEmail ? (
											<Input
												value={fromEmail}
												onChange={(event) => setFromEmail(event.target.value)}
												className="h-9 w-full border-[#30352f] bg-[#0f1111] px-3 text-[13px] text-[#d8d1c4]"
											/>
										) : null}
										{showSellerTin ? (
											<div className="flex items-center gap-2 pt-2">
												<div className="w-[32px] text-[12px] text-[#7f857f]">
													TIN
												</div>
												<Input
													value={sellerTin}
													onChange={(event) =>
														setSellerTin(sanitizeTinInput(event.target.value))
													}
													placeholder="0123456789"
													className="h-8 w-full border-[#30352f] bg-[#0f1111] px-3 text-[13px] font-mono text-[#d8d1c4]"
												/>
											</div>
										) : null}
										{showSellerRc ? (
											<div className="flex items-center gap-2 pt-1">
												<div className="w-[32px] text-[12px] text-[#7f857f]">
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
													className="h-8 w-full border-[#30352f] bg-[#0f1111] px-3 text-[13px] font-mono text-[#d8d1c4]"
												/>
											</div>
										) : null}
									</div>

									<div className="space-y-2">
										<div className="text-sm text-[#7f857f]">To</div>
										<div className="mb-1">
											<div className="relative w-full">
												<button
													type="button"
													onClick={() => setCustomerPickerOpen((prev) => !prev)}
													className="flex h-9 w-full items-center justify-between rounded-md border border-[#30352f] bg-[#0f1111] px-3 text-[13px] text-[#d8d1c4]"
												>
													{customerName || "Select client"}
													<ChevronDown className="h-3.5 w-3.5 text-[#7f857f]" />
												</button>
												{customerPickerOpen ? (
													<div className="absolute left-0 top-10 z-20 w-full min-w-[260px] rounded-md border border-[#30352f] bg-[#101211] p-2 shadow-[0_2px_8px_rgba(0,0,0,0.25)]">
														<div className="mb-2 flex h-8 items-center gap-2 rounded-md border border-[#30352f] bg-[#0f1111] px-2">
															<Search className="h-3.5 w-3.5 text-[#7f857f]" />
															<input
																value={customerSearch}
																onChange={(event) =>
																	setCustomerSearch(event.target.value)
																}
																placeholder="Search customer..."
																className="h-full w-full bg-transparent text-xs text-[#d8d1c4] outline-none placeholder:text-[#616661]"
															/>
														</div>
														<div className="max-h-48 overflow-y-auto overscroll-contain">
															{filteredClients.map((client) => (
																<button
																	key={client.id ?? client.name}
																	type="button"
																	onClick={() => selectClient(client.name)}
																	className="flex h-8 w-full items-center rounded-md px-2 text-left text-[13px] text-[#d8d1c4] transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out hover:bg-[#20241f]"
																>
																	{client.name}
																</button>
															))}
															{filteredClients.length === 0 ? (
																<div className="px-2 py-2 text-xs text-[#7f857f]">
																	No customers found.
																</div>
															) : null}
														</div>
														<div className="mt-2 border-t border-[#30352f] pt-2">
															<button
																type="button"
																onClick={() => setCreateClientOpen(true)}
																className="h-8 rounded-md px-2 text-[13px] text-[#c8ff62] transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out hover:text-[#d5ff7a]"
															>
																Create customer
															</button>
														</div>
													</div>
												) : null}
											</div>
										</div>

										<Input
											value={customerName}
											onChange={(event) => setCustomerName(event.target.value)}
											placeholder="Client name"
											className="h-9 w-full border-[#30352f] bg-[#0f1111] px-3 text-[14px] font-medium text-[#f2efe7]"
										/>
										{showCustomerEmail ? (
											<Input
												value={customerEmail}
												onChange={(event) =>
													setCustomerEmail(event.target.value)
												}
												placeholder="client@email.com"
												className="h-9 w-full border-[#30352f] bg-[#0f1111] px-3 text-[13px] text-[#d8d1c4]"
											/>
										) : null}
										<Input
											value={customerPoNumber}
											onChange={(event) =>
												setCustomerPoNumber(event.target.value.slice(0, 80))
											}
											placeholder="Customer PO number (optional)"
											className="h-9 w-full border-[#30352f] bg-[#0f1111] px-3 text-[13px] text-[#d8d1c4]"
										/>
										{customerEmail.trim() && (
											<label className="flex items-center gap-2 pt-1">
												<input
													type="checkbox"
													checked={autoSendEmail}
													onChange={(e) => setAutoSendEmail(e.target.checked)}
													className="h-4 w-4 rounded border-[#30352f] bg-[#0f1111] accent-[#c8ff62]"
												/>
												<span className="text-[12px] text-[#8d938f]">
													Send invoice email now
												</span>
											</label>
										)}
									</div>

									<div className="h-full rounded-md border border-[#30352f] bg-[#0f1111] p-4">
										<div className="flex flex-wrap items-center gap-2">
											<button
												type="button"
												onClick={openComplianceDialog}
												className="rounded-md border border-[#30352f] bg-[#151817] px-2 py-1 text-[11px] text-[#d8d1c4] hover:border-[#3f5130] hover:bg-[#1a2117]"
											>
												{templateName}
											</button>
											<button
												type="button"
												onClick={openComplianceDialog}
												className="rounded-md border border-[#6a5a2d] bg-[#1f1b10] px-2 py-1 text-[11px] text-[#e0c27b] hover:border-[#8a783c] hover:bg-[#282311]"
											>
												{selectedTaxSetting?.label}
											</button>
											{selectedWhtCategory?.value !== "none" ? (
												<button
													type="button"
													onClick={openComplianceDialog}
													className="rounded-md border border-[#6a5a2d] bg-[#1f1b10] px-2 py-1 text-[11px] text-[#e1b46c] hover:border-[#8a783c] hover:bg-[#282311]"
												>
													{selectedWhtCategory?.label}
												</button>
											) : null}
										</div>
										<button
											type="button"
											onClick={openComplianceDialog}
											className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-[#c8ff62] hover:text-[#d5ff7a]"
										>
											<Settings2 className="h-3.5 w-3.5" />
											Edit tax and compliance settings
										</button>
										<div className="mt-3 space-y-2 text-[12px] text-[#aaa294]">
											<div>
												<div className="text-[#7f857f]">Compliance</div>
												<div className="mt-1 text-[#d8d1c4]">
													{isForeignCurrency
														? "Foreign currency settlement note active."
														: selectedTaxSetting?.label === "No tax"
															? "Domestic invoice with no tax line."
															: `${selectedTaxSetting?.label} applied to totals.`}
												</div>
											</div>
											<div>
												<div className="text-[#7f857f]">Seller tax status</div>
												<div className="mt-1 text-[#d8d1c4]">
													{selectedSellerTaxStatus?.label ?? "VAT registered"}
												</div>
											</div>
											<div>
												<div className="text-[#7f857f]">WHT deduction</div>
												<div className="mt-1 font-mono text-[#d8d1c4]">
													{selectedWhtCategory?.value === "none"
														? "Not applied"
														: `${selectedWhtCategory?.label} • ${withholdingRecipientEntityType.replaceAll("_", " ")} • ${withholdingRecipientResidency.replaceAll("_", " ")}`}
												</div>
											</div>
											{compliance.regulatoryNotice ? (
												<div className="rounded-md border border-[#4e3b21] bg-[#1f1911] px-3 py-2 text-[#e1b46c]">
													<div className="flex items-start gap-2">
														<CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
														<span>{compliance.regulatoryNotice}</span>
													</div>
												</div>
											) : null}
										</div>
									</div>
								</div>

								{documentType === "proforma" ? (
									<div className="mb-7 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
										<div className="rounded-md border border-[#30352f] bg-[#0f1111] p-4">
											<div className="mb-3 flex items-center justify-between gap-3">
												<div>
													<p className="text-sm font-medium text-[#f2efe7]">
														Shipment and customs details
													</p>
													<p className="mt-1 text-xs text-[#817d72]">
														Static document fields only.
													</p>
												</div>
											</div>
											<div className="grid gap-3 sm:grid-cols-2">
												<Input
													value={shipmentWeight}
													onChange={(event) =>
														setShipmentWeight(event.target.value.slice(0, 80))
													}
													placeholder="Weight (kg)"
													className="h-9 border-[#30352f] bg-[#101211] px-3 text-[13px] text-[#d8d1c4]"
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
													className="h-9 border-[#30352f] bg-[#101211] px-3 text-[13px] text-[#d8d1c4]"
												/>
												<Input
													value={shipmentHsCode}
													onChange={(event) =>
														setShipmentHsCode(event.target.value.slice(0, 40))
													}
													placeholder="HS code"
													className="h-9 border-[#30352f] bg-[#101211] px-3 text-[13px] text-[#d8d1c4]"
												/>
												<Input
													value={shipmentIncoterms}
													onChange={(event) =>
														setShipmentIncoterms(
															event.target.value.slice(0, 40),
														)
													}
													placeholder="Incoterms"
													className="h-9 border-[#30352f] bg-[#101211] px-3 text-[13px] text-[#d8d1c4]"
												/>
												<Input
													value={shipmentPortOfLoading}
													onChange={(event) =>
														setShipmentPortOfLoading(
															event.target.value.slice(0, 80),
														)
													}
													placeholder="Port of loading"
													className="h-9 border-[#30352f] bg-[#101211] px-3 text-[13px] text-[#d8d1c4]"
												/>
												<Input
													value={shipmentPortOfDischarge}
													onChange={(event) =>
														setShipmentPortOfDischarge(
															event.target.value.slice(0, 80),
														)
													}
													placeholder="Port of discharge"
													className="h-9 border-[#30352f] bg-[#101211] px-3 text-[13px] text-[#d8d1c4]"
												/>
											</div>
										</div>

										<div className="rounded-md border border-[#30352f] bg-[#0f1111] p-4">
											<label className="flex items-center gap-2">
												<input
													type="checkbox"
													checked={depositEnabled}
													onChange={(event) =>
														setDepositEnabled(event.target.checked)
													}
													className="h-4 w-4 rounded border-[#30352f] bg-[#0f1111] accent-[#c8ff62]"
												/>
												<span className="text-sm font-medium text-[#f2efe7]">
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
														className="h-9 border-[#30352f] bg-[#0f1111] px-3 text-[13px] text-[#d8d1c4]"
													/>
													<Input
														value={depositDueDate}
														onChange={(event) =>
															setDepositDueDate(event.target.value)
														}
														type="date"
														className="h-9 border-[#30352f] bg-[#0f1111] px-3 text-[13px] text-[#d8d1c4]"
													/>
												</div>
											) : null}
										</div>
									</div>
								) : null}

								<div className="mb-3 grid grid-cols-[minmax(0,1.7fr)_84px_120px_140px_32px] items-center gap-3 border-b border-[#30352f] px-2 pb-2 text-[12px] text-[#7f857f]">
									<span>Description</span>
									<span>Qty</span>
									<span>Price</span>
									<span className="text-right">Total</span>
									<span />
								</div>

								<div
									ref={lineItemsScrollRef}
									className={cn(
										"min-h-[52px] max-h-[250px] scroll-smooth",
										productSearchIndex !== null
											? "overflow-visible"
											: "overflow-y-auto",
									)}
								>
									<div className="space-y-2">
										{lineItems.map((item, index) => {
											const lineTotal = item.quantity * item.price;
											const isEntering = enteringLineIds.includes(item.id);
											const isExiting = exitingLineIds.includes(item.id);
											const isProductSearchOpen = productSearchIndex === index;

											return (
												<div
													key={item.id}
													className={cn(
														"group relative grid grid-cols-[minmax(0,1.7fr)_84px_120px_140px_32px] items-center gap-3 border border-[#30352f] bg-[#101211] px-2 py-2",
														isProductSearchOpen ? "z-40" : "z-0",
														isEntering && "invoice-line-enter",
														isExiting && "invoice-line-exit",
													)}
												>
													<div className="relative">
														<Input
															ref={
																item.id === pendingFocusLineId
																	? pendingLineInputRef
																	: undefined
															}
															value={item.name}
															onFocus={(e) => {
																e.target.select();
																setProductSearchIndex(index);
																setProductSearchQuery(e.target.value.trim());
															}}
															onChange={(event) => {
																updateLine(index, { name: event.target.value });
																setProductSearchIndex(index);
																setProductSearchQuery(event.target.value);
															}}
															onBlur={() => {
																setTimeout(() => {
																	setProductSearchIndex(null);
																	setProductSearchQuery("");
																}, 200);
															}}
															placeholder="Search product..."
															className={cn(
																"h-10 border-[#30352f] bg-[#0f1111] px-3 text-[13px] leading-none text-[#f2efe7] placeholder:text-[#5f655f]",
															)}
														/>
														{isProductSearchOpen &&
															visibleProductSearchResults.length > 0 && (
																<div className="absolute left-0 top-10 z-50 w-full rounded-md border border-[#30352f] bg-[#101211] shadow-lg">
																	<div className="border-b border-[#30352f] px-3 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-[#817d72]">
																		{productSearchQuery.trim().length > 0
																			? "Matching products"
																			: "Catalog products"}
																	</div>
																	<div className="max-h-48 overflow-y-auto">
																		{visibleProductSearchResults.map(
																			(product) => (
																				<button
																					type="button"
																					key={product.id}
																					onMouseDown={(e) => {
																						e.preventDefault();
																						selectProduct(index, product);
																					}}
																					className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] text-[#f2efe7] hover:bg-[#20241f]"
																				>
																					<span className="min-w-0">
																						<span className="block truncate">
																							{product.name}
																						</span>
																						<span className="mt-0.5 block text-[11px] capitalize text-[#817d72]">
																							{product.type}
																							{product.unitName
																								? ` / ${product.unitName}`
																								: ""}
																							{product.sku
																								? ` / SKU ${product.sku}`
																								: ""}
																						</span>
																					</span>
																					<span className="shrink-0 font-mono text-[#c8ff62]">
																						{formatMoney(
																							product.defaultUnitPrice,
																							"NGN",
																						)}
																					</span>
																				</button>
																			),
																		)}
																	</div>
																</div>
															)}
														{isProductSearchOpen &&
															productSearchQuery.trim().length > 0 &&
															productSearchResults === undefined && (
																<div className="absolute left-0 top-10 z-50 w-full rounded-md border border-[#30352f] bg-[#101211] px-3 py-2 text-[12px] text-[#9fa69f] shadow-lg">
																	Searching catalog...
																</div>
															)}
														{isProductSearchOpen &&
															productSearchQuery.trim().length > 0 &&
															productSearchResults !== undefined &&
															visibleProductSearchResults.length === 0 && (
																<div className="absolute left-0 top-10 z-50 w-full rounded-md border border-[#30352f] bg-[#101211] px-3 py-2 text-[12px] text-[#9fa69f] shadow-lg">
																	No catalog match. Keep this text as a custom
																	line, or create it in Products later.
																</div>
															)}
													</div>

													<div className="flex items-center gap-1.5 text-[#817d72]">
														<button
															type="button"
															onClick={() => decrementQuantity(index)}
															className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#30352f] bg-[#101211] text-[#beb6a8] transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out hover:bg-[#20241f] hover:text-[#f2efe7]"
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
																		Number(event.target.value) || 1,
																	),
																})
															}
															onBlur={(event) =>
																updateLine(index, {
																	quantity: Math.max(
																		1,
																		Number(event.target.value) || 1,
																	),
																})
															}
															className="h-9 w-[42px] border-[#30352f] bg-[#0f1111] px-0 text-center text-[13px] font-mono text-[#f2efe7]"
														/>
														<button
															type="button"
															onClick={() => incrementQuantity(index)}
															className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[#30352f] bg-[#101211] text-[#beb6a8] transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out hover:bg-[#20241f] hover:text-[#f2efe7]"
															aria-label="Increase quantity"
														>
															<Plus className="h-3 w-3" />
														</button>
													</div>

													<Input
														type="text"
														inputMode="decimal"
														value={
															priceDrafts[item.id] ??
															(item.price > 0 ? String(item.price) : "0")
														}
														onFocus={() => onPriceFocus(item.id, item.price)}
														onChange={(event) =>
															onPriceChange(item.id, event.target.value)
														}
														onBlur={() =>
															commitPriceDraft(item.id, index, item.price)
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
															"h-9 border-[#30352f] bg-[#0f1111] px-3 text-[13px] font-mono text-[#f2efe7]",
														)}
													/>

													<div className="text-right text-[13px] font-mono text-[#f2efe7]">
														{formatMoney(lineTotal, currency, {
															maximumFractionDigits:
																totalsMaximumFractionDigits,
														})}
													</div>

													<button
														type="button"
														onClick={() => removeLine(index)}
														className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[#7f857f] opacity-0 transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out group-hover:opacity-100 group-focus-within:opacity-100 hover:border-[#30352f] hover:bg-[#20241f] hover:text-[#f2efe7]"
														aria-label={`Remove line item ${index + 1}`}
													>
														<X className="h-3.5 w-3.5" />
													</button>
												</div>
											);
										})}
									</div>
								</div>

								<div className="mt-4 grid gap-4 md:grid-cols-[1fr_290px] md:items-start">
									<div>
										<button
											type="button"
											onClick={addLine}
											className="inline-flex h-9 items-center gap-1.5 rounded-md border border-transparent px-1.5 text-[13px] text-[#beb6a8] transition-[opacity,background-color,border-color,color] duration-[110ms] ease-out hover:border-[#30352f] hover:bg-[#101211] hover:text-[#c8ff62]"
										>
											<Plus className="h-3.5 w-3.5" />
											Add item
										</button>
									</div>

									<div className="w-full rounded-md border border-[#30352f] bg-[#0f1111] p-4 text-[13px] text-[#aaa294]">
										<div className="flex items-center justify-between">
											<span>Subtotal</span>
											<span
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
											<div className="mt-2 flex items-center justify-between text-[#e1b46c]">
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

										<div className="mt-3 flex items-center justify-between border-t border-[#30352f] pt-3">
											<span className="text-[#d8d1c4]">
												{withholdingCategory === "none"
													? "Total"
													: "Net payable"}
											</span>
											<span
												key={`net-${currency}-${netPayable}-${totalsMaximumFractionDigits}`}
												className="text-[24px] leading-none text-[#f2efe7] invoice-value-fade"
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
										className={`mt-7 grid items-start gap-6 ${
											showPaymentDetailsSection && showNoteSection
												? "md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
												: ""
										}`}
									>
										{showPaymentDetailsSection ? (
											<div>
												<div className="mb-1.5 flex min-h-7 items-center text-[13px] text-[#7f857f]">
													Payment Details
												</div>
												<textarea
													value={paymentDetails}
													onChange={(event) =>
														setPaymentDetails(event.target.value)
													}
													placeholder={PAYMENT_DETAILS_PLACEHOLDER}
													className="h-24 w-full resize-none rounded-md border border-[#30352f] bg-[#0f1111] p-3 text-[13px] leading-5 text-[#d8d1c4] outline-none transition-colors placeholder:text-[#817d72]"
												/>
											</div>
										) : null}
										{showNoteSection ? (
											<div>
												<div className="mb-1.5 flex min-h-7 flex-wrap items-center justify-between gap-2">
													<span className="text-[13px] text-[#d8d1c4]">
														Note to client
													</span>
													<span className="inline-flex items-center gap-1 rounded-md border border-[#3f5130] bg-[#1a2117] px-2 py-1 text-[11px] font-medium text-[#c8ff62]">
														<CircleAlert className="h-3.5 w-3.5" />
														Visible on invoice
													</span>
												</div>
												<textarea
													value={notes}
													onChange={(event) => setNotes(event.target.value)}
													placeholder={NOTE_PLACEHOLDER}
													className="h-24 w-full resize-none rounded-md border border-[#30352f] bg-[#0f1111] p-3 text-[13px] leading-5 text-[#d8d1c4] outline-none transition-colors placeholder:text-[#817d72]"
												/>
												<p className="mt-1.5 text-[11px] text-[#817d72]">
													Use final client-facing language here. This text
													prints on the public invoice and PDF.
												</p>
											</div>
										) : null}
									</div>
								) : null}
							</div>
						</div>

						<div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#30352f] bg-[#0f1111] px-6 py-3 md:px-7">
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
										className="min-w-[210px] border-[#30352f] bg-[#101211] p-1 text-[#d8d1c4]"
									>
										<DropdownMenuSub>
											<DropdownMenuSubTrigger className="text-xs focus:bg-[#20241f] data-[state=open]:bg-[#20241f] focus:text-[#f2efe7] data-[state=open]:text-[#f2efe7]">
												<FileText className="mr-2 h-3.5 w-3.5" />
												Invoice
											</DropdownMenuSubTrigger>
											<DropdownMenuSubContent className="border-[#30352f] bg-[#101211] text-[#d8d1c4]">
												<DropdownMenuLabel className="px-2 pb-1 pt-1 text-[10px] font-normal uppercase tracking-[0.08em] text-[#6f756f]">
													Invoice
												</DropdownMenuLabel>
												<DropdownMenuSeparator className="bg-[#30352f]" />
												<DropdownMenuSub>
													<DropdownMenuSubTrigger className="text-xs focus:bg-[#20241f] data-[state=open]:bg-[#20241f] focus:text-[#f2efe7] data-[state=open]:text-[#f2efe7]">
														Invoice size
													</DropdownMenuSubTrigger>
													<DropdownMenuSubContent className="border-[#30352f] bg-[#101211] text-[#d8d1c4]">
														{DOCUMENT_SIZE_OPTIONS.map((option) => (
															<DropdownMenuItem
																key={option.value}
																onClick={() => setInvoiceSize(option.value)}
																className={`text-xs focus:bg-[#20241f] focus:text-[#f2efe7] ${
																	invoiceSize === option.value
																		? "text-[#c8ff62]"
																		: ""
																}`}
															>
																{option.label}
															</DropdownMenuItem>
														))}
													</DropdownMenuSubContent>
												</DropdownMenuSub>
												<DropdownMenuSub>
													<DropdownMenuSubTrigger className="text-xs focus:bg-[#20241f] data-[state=open]:bg-[#20241f] focus:text-[#f2efe7] data-[state=open]:text-[#f2efe7]">
														Currency
													</DropdownMenuSubTrigger>
													<DropdownMenuSubContent className="border-[#30352f] bg-[#101211] text-[#d8d1c4]">
														{INVOICE_CURRENCY_OPTIONS.map((option) => (
															<DropdownMenuItem
																key={option.code}
																onClick={() => updateCurrency(option.code)}
																className={`text-xs focus:bg-[#20241f] focus:text-[#f2efe7] ${
																	currency === option.code
																		? "text-[#c8ff62]"
																		: ""
																}`}
															>
																{option.symbol} {option.label}
															</DropdownMenuItem>
														))}
													</DropdownMenuSubContent>
												</DropdownMenuSub>
												<DropdownMenuSub>
													<DropdownMenuSubTrigger className="text-xs focus:bg-[#20241f] data-[state=open]:bg-[#20241f] focus:text-[#f2efe7] data-[state=open]:text-[#f2efe7]">
														Date format
													</DropdownMenuSubTrigger>
													<DropdownMenuSubContent className="border-[#30352f] bg-[#101211] text-[#d8d1c4]">
														{DATE_FORMAT_OPTIONS.map((option) => (
															<DropdownMenuItem
																key={option.value}
																onClick={() => setDateFormat(option.value)}
																className={`text-xs focus:bg-[#20241f] focus:text-[#f2efe7] ${
																	dateFormat === option.value
																		? "text-[#c8ff62]"
																		: ""
																}`}
															>
																{option.label}
															</DropdownMenuItem>
														))}
													</DropdownMenuSubContent>
												</DropdownMenuSub>
												<DropdownMenuSub>
													<DropdownMenuSubTrigger className="text-xs focus:bg-[#20241f] data-[state=open]:bg-[#20241f] focus:text-[#f2efe7] data-[state=open]:text-[#f2efe7]">
														Payment terms
													</DropdownMenuSubTrigger>
													<DropdownMenuSubContent className="border-[#30352f] bg-[#101211] text-[#d8d1c4]">
														{PAYMENT_TERM_OPTIONS.map((days) => (
															<DropdownMenuItem
																key={days}
																onClick={() => updatePaymentTerms(days)}
																className={`text-xs focus:bg-[#20241f] focus:text-[#f2efe7] ${
																	paymentTermDays === days
																		? "text-[#c8ff62]"
																		: ""
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
											<DropdownMenuSubTrigger className="text-xs focus:bg-[#20241f] data-[state=open]:bg-[#20241f] focus:text-[#f2efe7] data-[state=open]:text-[#f2efe7]">
												<DollarSign className="mr-2 h-3.5 w-3.5" />
												Tax & Pricing
											</DropdownMenuSubTrigger>
											<DropdownMenuSubContent className="border-[#30352f] bg-[#101211] text-[#d8d1c4]">
												<DropdownMenuCheckboxItem
													checked={includeDecimals}
													onCheckedChange={(checked) =>
														setIncludeDecimals(checked === true)
													}
													className="text-xs focus:bg-[#20241f] focus:text-[#f2efe7]"
												>
													Decimals
												</DropdownMenuCheckboxItem>
												<DropdownMenuSeparator className="bg-[#30352f]" />
												<DropdownMenuSub>
													<DropdownMenuSubTrigger className="text-xs focus:bg-[#20241f] data-[state=open]:bg-[#20241f] focus:text-[#f2efe7] data-[state=open]:text-[#f2efe7]">
														Seller type
													</DropdownMenuSubTrigger>
													<DropdownMenuSubContent className="border-[#30352f] bg-[#101211] text-[#d8d1c4]">
														<DropdownMenuItem
															onClick={() =>
																updateSellerProfileType("freelancer")
															}
															className={`text-xs focus:bg-[#20241f] focus:text-[#f2efe7] ${
																sellerProfileType === "freelancer"
																	? "text-[#c8ff62]"
																	: ""
															}`}
														>
															Freelancer / individual
														</DropdownMenuItem>
														<DropdownMenuItem
															onClick={() =>
																updateSellerProfileType("business")
															}
															className={`text-xs focus:bg-[#20241f] focus:text-[#f2efe7] ${
																sellerProfileType === "business"
																	? "text-[#c8ff62]"
																	: ""
															}`}
														>
															Registered business
														</DropdownMenuItem>
													</DropdownMenuSubContent>
												</DropdownMenuSub>
												<DropdownMenuSub>
													<DropdownMenuSubTrigger className="text-xs focus:bg-[#20241f] data-[state=open]:bg-[#20241f] focus:text-[#f2efe7] data-[state=open]:text-[#f2efe7]">
														Seller tax status
													</DropdownMenuSubTrigger>
													<DropdownMenuSubContent className="border-[#30352f] bg-[#101211] text-[#d8d1c4]">
														{SELLER_TAX_STATUS_OPTIONS.map((option) => (
															<DropdownMenuItem
																key={option.value}
																onClick={() =>
																	updateSellerTaxStatus(option.value)
																}
																className={`text-xs focus:bg-[#20241f] focus:text-[#f2efe7] ${
																	sellerTaxStatus === option.value
																		? "text-[#c8ff62]"
																		: ""
																}`}
															>
																{option.label}
															</DropdownMenuItem>
														))}
													</DropdownMenuSubContent>
												</DropdownMenuSub>
												<DropdownMenuSub>
													<DropdownMenuSubTrigger className="text-xs focus:bg-[#20241f] data-[state=open]:bg-[#20241f] focus:text-[#f2efe7] data-[state=open]:text-[#f2efe7]">
														Tax treatment
													</DropdownMenuSubTrigger>
													<DropdownMenuSubContent className="border-[#30352f] bg-[#101211] text-[#d8d1c4]">
														{TAX_SETTING_OPTIONS.map((option) => (
															<DropdownMenuItem
																key={option.value}
																onClick={() => setTaxTreatment(option.value)}
																className={`text-xs focus:bg-[#20241f] focus:text-[#f2efe7] ${
																	taxTreatment === option.value
																		? "text-[#c8ff62]"
																		: ""
																}`}
															>
																{option.label}
															</DropdownMenuItem>
														))}
													</DropdownMenuSubContent>
												</DropdownMenuSub>
												<DropdownMenuSub>
													<DropdownMenuSubTrigger className="text-xs focus:bg-[#20241f] data-[state=open]:bg-[#20241f] focus:text-[#f2efe7] data-[state=open]:text-[#f2efe7]">
														WHT deduction
													</DropdownMenuSubTrigger>
													<DropdownMenuSubContent className="border-[#30352f] bg-[#101211] text-[#d8d1c4]">
														{WITHHOLDING_CATEGORY_OPTIONS.map((option) => (
															<DropdownMenuItem
																key={option.value}
																onClick={() =>
																	setWithholdingCategory(option.value)
																}
																className={`text-xs focus:bg-[#20241f] focus:text-[#f2efe7] ${
																	withholdingCategory === option.value
																		? "text-[#c8ff62]"
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
													className="text-xs focus:bg-[#20241f] focus:text-[#f2efe7]"
												>
													Compliance details
												</DropdownMenuItem>
											</DropdownMenuSubContent>
										</DropdownMenuSub>

										<DropdownMenuSub>
											<DropdownMenuSubTrigger className="text-xs focus:bg-[#20241f] data-[state=open]:bg-[#20241f] focus:text-[#f2efe7] data-[state=open]:text-[#f2efe7]">
												<ReceiptText className="mr-2 h-3.5 w-3.5" />
												Payments
											</DropdownMenuSubTrigger>
											<DropdownMenuSubContent className="border-[#30352f] bg-[#101211] text-[#d8d1c4]">
												<DropdownMenuCheckboxItem
													checked={showPaymentDetailsSection}
													onCheckedChange={(checked) =>
														setShowPaymentDetailsSection(checked === true)
													}
													className="text-xs focus:bg-[#20241f] focus:text-[#f2efe7]"
												>
													Payment details block
												</DropdownMenuCheckboxItem>
												<DropdownMenuCheckboxItem
													checked={showNoteSection}
													onCheckedChange={(checked) =>
														setShowNoteSection(checked === true)
													}
													className="text-xs focus:bg-[#20241f] focus:text-[#f2efe7]"
												>
													Note block
												</DropdownMenuCheckboxItem>
												<DropdownMenuSeparator className="bg-[#30352f]" />
												<DropdownMenuItem
													onClick={() =>
														setPaymentDetails(workspace?.paymentDetails ?? "")
													}
													className="text-xs focus:bg-[#20241f] focus:text-[#f2efe7]"
												>
													Reset payment details
												</DropdownMenuItem>
												<DropdownMenuItem
													onClick={() => setNotes("")}
													className="text-xs focus:bg-[#20241f] focus:text-[#f2efe7]"
												>
													Reset note
												</DropdownMenuItem>
											</DropdownMenuSubContent>
										</DropdownMenuSub>

										<DropdownMenuSub>
											<DropdownMenuSubTrigger className="text-xs focus:bg-[#20241f] data-[state=open]:bg-[#20241f] focus:text-[#f2efe7] data-[state=open]:text-[#f2efe7]">
												<Settings2 className="mr-2 h-3.5 w-3.5" />
												Visibility
											</DropdownMenuSubTrigger>
											<DropdownMenuSubContent className="border-[#30352f] bg-[#101211] text-[#d8d1c4]">
												<DropdownMenuCheckboxItem
													checked={showFromEmail}
													onCheckedChange={(checked) =>
														setShowFromEmail(checked === true)
													}
													className="text-xs focus:bg-[#20241f] focus:text-[#f2efe7]"
												>
													Show sender email
												</DropdownMenuCheckboxItem>
												<DropdownMenuCheckboxItem
													checked={showCustomerEmail}
													onCheckedChange={(checked) =>
														setShowCustomerEmail(checked === true)
													}
													className="text-xs focus:bg-[#20241f] focus:text-[#f2efe7]"
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
											<ChevronDown className="h-3.5 w-3.5 text-[#8f958d]" />
										</button>
									</DropdownMenuTrigger>
									<DropdownMenuContent
										side="top"
										align="start"
										className="min-w-55 border-[#30352f] bg-[#101211] p-1 text-[#d8d1c4]"
									>
										<DropdownMenuLabel className="px-2 pb-1 pt-1 text-[10px] font-normal uppercase tracking-[0.08em] text-[#6f756f]">
											Templates
										</DropdownMenuLabel>
										<DropdownMenuSeparator className="bg-[#30352f]" />
										{TEMPLATE_OPTIONS.map((option) => (
											<DropdownMenuItem
												key={option.value}
												onClick={() => setTemplateName(option.value)}
												className={`text-xs focus:bg-[#20241f] focus:text-[#f2efe7] ${
													templateName === option.value ? "text-[#f2efe7]" : ""
												}`}
											>
												{option.value}
											</DropdownMenuItem>
										))}
									</DropdownMenuContent>
								</DropdownMenu>
							</div>

							<div className="flex items-center gap-2">
								{autosaveStatusText ? (
									<div
										className={cn(
											"hidden max-w-[140px] text-right text-[12px] sm:block",
											autosaveStatus === "error"
												? "text-[#e1b46c]"
												: "text-[#8d938f]",
										)}
									>
										{autosaveStatusText}
									</div>
								) : null}
								{submitBlockerText ? (
									<div className="hidden max-w-[220px] text-right text-[12px] text-[#8d938f] sm:block">
										{submitBlockerText}
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

								<button
									type="button"
									disabled={!canSubmit}
									onClick={() => void createInvoice("create")}
									className={cn(
										"inline-flex h-10 items-center rounded-md border border-[#c8ff62] bg-[#c8ff62] px-5 text-[13px] font-medium text-[#0f1111] transition-[opacity,background-color,border-color,color] duration-[150ms] hover:bg-[#d5ff7a] disabled:cursor-not-allowed disabled:border-[#30352f] disabled:bg-[#30352f] disabled:text-[#817d72]",
									)}
								>
									{submitting ? "Creating..." : "Create"}
								</button>
							</div>
						</div>
					</div>
				</div>
			</div>

			<Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
				<DialogContent
					hideClose
					className="flex max-h-[85vh] w-[94vw] max-w-170 flex-col overflow-hidden rounded-lg border-[#30352f] bg-[#101211] p-0 text-[#f2efe7]"
				>
					<div className="flex items-start justify-between gap-4 border-b border-[#30352f] px-6 py-5">
						<div>
							<DialogTitle className="mb-1 text-[20px] font-medium tracking-[-0.02em] text-[#f2efe7]">
								Tax & compliance settings
							</DialogTitle>
							<DialogDescription className="text-[13px] text-[#8d938f]">
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
							<section className="rounded-md border border-[#30352f] bg-[#0f1111] p-4">
								<div>
									<div className="text-[13px] font-medium text-[#f2efe7]">
										Template
									</div>
									<div className="mt-1 text-[12px] text-[#8d938f]">
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

							<section className="rounded-md border border-[#30352f] bg-[#0f1111] p-4">
								<div className="text-[13px] font-medium text-[#f2efe7]">
									Tax & deductions
								</div>
								<div className="mt-4">
									<div className="mb-2 text-[12px] text-[#7f857f]">
										Seller type
									</div>
									<div className="grid gap-2 md:grid-cols-2">
										<button
											type="button"
											onClick={() => updateSellerProfileType("freelancer")}
											className={cn(
												"rounded-md border p-3 text-left transition-[background-color,border-color,color] duration-[110ms]",
												sellerProfileType === "freelancer"
													? "border-[#c8ff62] bg-[#1f2618] text-[#f2efe7]"
													: "border-[#30352f] bg-[#101211] text-[#beb6a8] hover:bg-[#20241f]",
											)}
										>
											<span className="block text-[13px] font-medium">
												Freelancer / individual
											</span>
											<span className="mt-1 block text-[12px] text-[#8d938f]">
												Fast invoices, VAT off, tax IDs optional.
											</span>
										</button>
										<button
											type="button"
											onClick={() => updateSellerProfileType("business")}
											className={cn(
												"rounded-md border p-3 text-left transition-[background-color,border-color,color] duration-[110ms]",
												sellerProfileType === "business"
													? "border-[#c8ff62] bg-[#1f2618] text-[#f2efe7]"
													: "border-[#30352f] bg-[#101211] text-[#beb6a8] hover:bg-[#20241f]",
											)}
										>
											<span className="block text-[13px] font-medium">
												Registered business
											</span>
											<span className="mt-1 block text-[12px] text-[#8d938f]">
												VAT-ready invoices with stronger compliance checks.
											</span>
										</button>
									</div>
								</div>
								<div className="mt-4">
									<div className="mb-2 text-[12px] text-[#7f857f]">
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
									<div className="mt-2 text-[12px] text-[#7f857f]">
										{selectedSellerTaxStatus?.description}
									</div>
								</div>

								<div className="mt-4">
									<div className="mb-2 text-[12px] text-[#7f857f]">
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
									<div className="mb-2 text-[12px] text-[#7f857f]">
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
												<div className="mb-2 text-[12px] text-[#7f857f]">
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
												<div className="mb-2 text-[12px] text-[#7f857f]">
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
									<div className="mt-2 text-[12px] text-[#7f857f]">
										{selectedWhtCategory?.description}
									</div>
								</div>

								{currency !== "NGN" ? (
									<div className="mt-4 rounded-md border border-[#4e3b21] bg-[#1f1911] px-3 py-3 text-[12px] text-[#e1b46c]">
										<div className="flex items-start gap-2">
											<CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
											<span>{NIGERIA_FOREIGN_CURRENCY_WARNING}</span>
										</div>
									</div>
								) : null}
							</section>

							<section className="rounded-md border border-[#30352f] bg-[#0f1111] p-4">
								<div className="text-[13px] font-medium text-[#f2efe7]">
									Seller tax profile
								</div>
								<div className="mt-4 grid gap-2 md:grid-cols-2">
									<button
										type="button"
										onClick={() => setShowSellerTin((current) => !current)}
										className={cn(
											"flex min-h-10 items-center justify-between rounded-md border px-3 text-left text-[13px] transition-[background-color,border-color,color] duration-[110ms]",
											showSellerTin
												? "border-[#c8ff62] bg-[#1f2618] text-[#f2efe7]"
												: "border-[#30352f] bg-[#101211] text-[#beb6a8] hover:bg-[#20241f]",
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
												? "border-[#c8ff62] bg-[#1f2618] text-[#f2efe7]"
												: "border-[#30352f] bg-[#101211] text-[#beb6a8] hover:bg-[#20241f]",
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
											className="mb-1.5 block text-[12px] text-[#7f857f]"
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
												"h-10 bg-[#0f1111] text-[#f2efe7] disabled:text-[#737b89]",
												tinIsValid ? "border-[#30352f]" : "border-[#c76f5b]",
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
											className="mb-1.5 block text-[12px] text-[#7f857f]"
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
												"h-10 bg-[#0f1111] text-[#f2efe7] disabled:text-[#737b89]",
												rcIsValid ? "border-[#30352f]" : "border-[#c76f5b]",
											)}
										/>
										<div
											className={cn(
												"mt-2 text-[12px]",
												rcIsValid ? "text-[#737b89]" : "text-[#c76f5b]",
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
									<div className="mt-4 rounded-md border border-[#30352f] bg-[#101211] px-3 py-3 text-[12px] text-[#8d938f]">
										Freelancer mode keeps TIN and RC optional and does not
										charge VAT by default.
									</div>
								) : null}
							</section>
						</div>
					</div>

					<div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#30352f] px-6 py-4">
						<div className="min-w-0 text-[12px] text-[#8d938f]">
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
								<div className="mt-1 flex items-center gap-1 text-[#817d72]">
									<CircleAlert className="h-3.5 w-3.5" />
									TIN is enabled but empty, so it will not print.
								</div>
							) : null}
						</div>
						<DialogClose asChild>
							<Button
								type="button"
								className="h-10 rounded-md border border-[#c8ff62] bg-[#c8ff62] px-5 text-[13px] font-medium text-[#0f1111] hover:bg-[#d5ff7a]"
							>
								Done
							</Button>
						</DialogClose>
					</div>
				</DialogContent>
			</Dialog>

			<Dialog open={createClientOpen} onOpenChange={setCreateClientOpen}>
				<DialogContent className="max-w-md border-[#30352f] bg-[#101211] p-0 shadow-2xl sm:rounded-xl">
					<div className="border-b border-[#30352f] px-6 py-5">
						<DialogTitle className="text-lg font-medium text-[#f2efe7]">
							Create Customer
						</DialogTitle>
						<DialogDescription className="mt-1 text-[13px] text-[#8d938f]">
							Add a new customer to your workspace.
						</DialogDescription>
					</div>
					<form onSubmit={onCreateClientSubmit} className="p-6">
						<div className="space-y-4">
							<div className="space-y-2">
								<label
									htmlFor="new-client-name"
									className="text-sm text-[#f2efe7]"
								>
									Customer name *
								</label>
								<Input
									id="new-client-name"
									value={newClientName}
									onChange={(e) => setNewClientName(e.target.value)}
									placeholder="Company or individual name"
									className="h-10 border-[#30352f] bg-[#0f1111] text-sm text-[#f2efe7]"
									required
								/>
							</div>
							<div className="space-y-2">
								<label
									htmlFor="new-client-email"
									className="text-sm text-[#f2efe7]"
								>
									Email address *
								</label>
								<Input
									id="new-client-email"
									type="email"
									value={newClientEmail}
									onChange={(e) => setNewClientEmail(e.target.value)}
									placeholder="billing@example.com"
									className="h-10 border-[#30352f] bg-[#0f1111] text-sm text-[#f2efe7]"
									required
								/>
							</div>
						</div>
						<div className="mt-6 flex justify-end gap-3">
							<Button
								type="button"
								variant="outline"
								onClick={() => setCreateClientOpen(false)}
								className="h-10 border-[#30352f] bg-[#0f1111] text-[#f2efe7] hover:bg-[#20241f]"
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
								className="h-10 bg-[#c8ff62] text-[#0f1111] hover:bg-[#d5ff7a]"
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
