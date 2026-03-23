import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import currencyCodes from "currency-codes";
import {
	CalendarDays,
	ChevronDown,
	Copy,
	DollarSign,
	Download,
	ExternalLink,
	FileText,
	ImagePlus,
	Loader2,
	Mail,
	Plus,
	ReceiptText,
	Search,
	Settings,
	X,
} from "lucide-react";
import { type ChangeEvent, useMemo, useState } from "react";
import { Button } from "#/components/ui/button";
import { Calendar } from "#/components/ui/calendar";
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
import { formatMoney } from "#/features/invoices/format";
import { api } from "../../../../convex/_generated/api";

type LineItem = {
	id: string;
	name: string;
	quantity: number;
	price: number;
};

type CreateInvoicePanelProps = {
	mode?: "page" | "sheet";
	onCreated?: (invoiceId: string) => void;
};

type ComposerStage = "editor" | "success";

type CreateIntent =
	| "create"
	| "open"
	| "create-and-send"
	| "schedule"
	| "recurring";

type CreatedInvoiceSummary = {
	id: string;
	token: string;
	invoiceNumber: string;
	dueDate: string;
	customerName: string;
	customerEmail: string;
	total: number;
};

const CURRENCY_OPTIONS = currencyCodes.data
	.filter((entry) => entry.code && entry.currency)
	.map((entry) => ({
		code: entry.code,
		label: `${entry.code} · ${entry.currency}`,
	}));

const SUPPORTED_CURRENCY_CODES = new Set(
	CURRENCY_OPTIONS.map((entry) => entry.code),
);
const DEFAULT_PAYMENT_DETAILS =
	"Add bank details, wallet address, or payment instructions";
const DEFAULT_NOTE = "Add note";

type SupportedCurrency = string;

function isSupportedCurrency(value: string): value is SupportedCurrency {
	return SUPPORTED_CURRENCY_CODES.has(value);
}

function normalizeCurrency(value?: string | null): SupportedCurrency {
	const normalized = value?.trim().toUpperCase();
	if (normalized && isSupportedCurrency(normalized)) return normalized;
	return "USD";
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

function generateInvoiceNumber() {
	const stamp = String(Date.now()).slice(-4);
	return `INV-2026-${stamp}`;
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
	for (const character of raw) {
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
	if (!Number.isFinite(parsed) || parsed < 0) return 0;
	return parsed;
}

function createEmptyLineItem(): LineItem {
	return {
		id: `li-${crypto.randomUUID()}`,
		name: "",
		quantity: 1,
		price: 0,
	};
}

export function CreateInvoicePanel({
	mode = "page",
	onCreated,
}: CreateInvoicePanelProps) {
	const navigate = useNavigate();
	const isSheetMode = mode === "sheet";
	const createDraft = useMutation(api.invoices.createDraft);
	const clients =
		useQuery(api.clients.list, {
			q: "",
			status: "all",
		}) ?? [];

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
	const [fromName, setFromName] = useState("Velure Studio");
	const [fromEmail, setFromEmail] = useState("hello@velure.app");
	const [paymentDetails, setPaymentDetails] = useState(DEFAULT_PAYMENT_DETAILS);
	const [notes, setNotes] = useState(DEFAULT_NOTE);
	const [currency, setCurrency] = useState<SupportedCurrency>("USD");
	const [invoiceSize, setInvoiceSize] = useState<"A4" | "LETTER">("A4");
	const [invoiceType, setInvoiceType] = useState<"one-time" | "recurring">(
		"one-time",
	);
	const [dateFormat, setDateFormat] = useState<"iso" | "us">("iso");
	const [paymentTermDays, setPaymentTermDays] = useState(14);
	const [dueDate, setDueDate] = useState(() => buildDueDate(14));
	const [showFromEmail, setShowFromEmail] = useState(true);
	const [showCustomerEmail, setShowCustomerEmail] = useState(true);
	const [showPaymentDetailsSection, setShowPaymentDetailsSection] =
		useState(true);
	const [showNoteSection, setShowNoteSection] = useState(true);
	const [includeVat, setIncludeVat] = useState(true);
	const [includeDiscount, setIncludeDiscount] = useState(false);
	const [includeDecimals, setIncludeDecimals] = useState(true);
	const [includeUnits, setIncludeUnits] = useState(false);
	const [includeQrCode, setIncludeQrCode] = useState(false);
	const [templateName, setTemplateName] = useState("Default");
	const [customerSearch, setCustomerSearch] = useState("");
	const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
	const [lastCreatedToken, setLastCreatedToken] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
	const [lineItems, setLineItems] = useState<LineItem[]>([
		createEmptyLineItem(),
	]);

	const subtotal = useMemo(
		() => lineItems.reduce((sum, item) => sum + item.quantity * item.price, 0),
		[lineItems],
	);
	const vatAmount = includeVat ? 0 : 0;
	const discountAmount = includeDiscount ? 0 : 0;
	const totalAmount = subtotal + vatAmount - discountAmount;

	const canSubmit =
		invoiceNumber.trim().length > 0 &&
		customerName.trim().length > 1 &&
		lineItems.some((item) => item.name.trim().length > 0) &&
		!submitting;

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

	const paperFrameClass =
		invoiceSize === "A4" ? "max-w-[620px]" : "max-w-[650px]";
	const footerGhostButtonClass =
		"inline-flex h-9 items-center gap-2 border border-[#202225] bg-[#11151c] px-3 text-[13px] text-[#d0d6de] transition-colors hover:bg-[#16191d] hover:text-[#ece7de]";
	const footerIconButtonClass =
		"inline-flex h-9 w-9 items-center justify-center border border-[#202225] bg-[#11151c] text-[#9aa2af] transition-colors hover:bg-[#16191d] hover:text-[#ece7de]";

	const createdInvoicePublicUrl = createdInvoice
		? `${typeof window !== "undefined" ? window.location.origin : ""}/i/${createdInvoice.token}`
		: "";
	const createdInvoiceDownloadUrl = createdInvoice
		? `${typeof window !== "undefined" ? window.location.origin : ""}/api/invoice/download/${encodeURIComponent(createdInvoice.id)}`
		: "";

	const updatePaymentTerms = (days: number) => {
		setPaymentTermDays(days);
		setDueDate(buildDueDate(days, issueDate));
	};

	const openInvoiceTab = (token: string) => {
		window.open(`/i/${token}`, "_blank", "noopener,noreferrer");
	};

	const selectClient = (name: string) => {
		setCustomerName(name);
		const matched = clients.find((client) => client.name === name);
		if (matched) {
			setCustomerEmail(matched.email ?? "");
			setCurrency(normalizeCurrency(matched.currency));
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

	const addLine = () => {
		setLineItems((prev) => [...prev, createEmptyLineItem()]);
	};

	const removeLine = (index: number) => {
		setLineItems((prev) => {
			const target = prev[index];
			if (!target) return prev;

			setPriceDrafts((current) => {
				const next = { ...current };
				delete next[target.id];
				return next;
			});

			if (prev.length === 1) return [createEmptyLineItem()];
			return prev.filter((_, itemIndex) => itemIndex !== index);
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
		setInvoiceNumber(generateInvoiceNumber());
		setIssueDate(nextIssueDate);
		setLogoUrl("");
		setCustomerName("");
		setCustomerEmail("");
		setFromName("Velure Studio");
		setFromEmail("hello@velure.app");
		setPaymentDetails(DEFAULT_PAYMENT_DETAILS);
		setNotes(DEFAULT_NOTE);
		setCurrency("USD");
		setInvoiceSize("A4");
		setInvoiceType("one-time");
		setDateFormat("iso");
		setPaymentTermDays(nextTermDays);
		setDueDate(buildDueDate(nextTermDays, nextIssueDate));
		setShowFromEmail(true);
		setShowCustomerEmail(true);
		setShowPaymentDetailsSection(true);
		setShowNoteSection(true);
		setIncludeVat(true);
		setIncludeDiscount(false);
		setIncludeDecimals(true);
		setIncludeUnits(false);
		setIncludeQrCode(false);
		setTemplateName("Default");
		setCustomerSearch("");
		setCustomerPickerOpen(false);
		setLastCreatedToken(null);
		setSubmitting(false);
		setPriceDrafts({});
		setLineItems([createEmptyLineItem()]);
	};

	const createInvoice = async (intent: CreateIntent = "create") => {
		if (!canSubmit) return;

		setSubmitting(true);
		try {
			const created = await createDraft({
				token: `pub-${crypto.randomUUID()}`,
				invoiceNumber: invoiceNumber.trim(),
				customerName: customerName.trim(),
				logoUrl: logoUrl.trim() || undefined,
				currency,
				type: invoiceType,
				invoiceSize,
				dateFormat,
				paymentTermsDays: paymentTermDays,
				template: templateName,
				issueDate,
				dueDate,
				paymentDetails:
					showPaymentDetailsSection &&
					paymentDetails.trim() !== DEFAULT_PAYMENT_DETAILS
						? paymentDetails.trim()
						: undefined,
				notes:
					showNoteSection && notes.trim() !== DEFAULT_NOTE
						? notes.trim()
						: undefined,
				lineItems: lineItems
					.filter((item) => item.name.trim().length > 0)
					.map((item) => ({
						id: item.id,
						name: item.name.trim(),
						quantity: Math.max(1, item.quantity),
						price: Math.max(0, item.price),
					})),
			});

			setLastCreatedToken(created.token);
			setCreatedInvoice({
				id: created.id,
				token: created.token,
				invoiceNumber: created.invoiceNumber,
				dueDate: created.dueDate,
				customerName: created.customerName,
				customerEmail,
				total: totalAmount,
			});
			setComposerStage("success");
			onCreated?.(created.id);

			if (intent === "open") {
				openInvoiceTab(created.token);
			} else if (intent === "create-and-send") {
				toast({
					title: "Create & Send coming soon",
					description: `${created.invoiceNumber} was created. Send flow is not wired yet.`,
				});
			} else if (intent === "schedule") {
				toast({
					title: "Scheduling coming soon",
					description: `${created.invoiceNumber} was created. Scheduling is not wired yet.`,
				});
			} else if (intent === "recurring") {
				toast({
					title: "Recurring invoices coming soon",
					description: `${created.invoiceNumber} was created as a standard invoice for now.`,
				});
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
					<div className="mx-auto flex h-full min-h-full w-full max-w-[620px] flex-col border border-[#202225] bg-[#0b0f16]">
						<div className="flex min-h-0 flex-1 flex-col px-6 py-6">
							<div>
								<h2 className="text-[34px] font-medium tracking-[-0.03em] text-[#ece7de]">
									Created
								</h2>
								<p className="mt-2 text-sm text-[#8d938f]">
									Your invoice was created successfully.
								</p>
							</div>

							<div className="mt-10 border border-[#202225] bg-[#141618] p-5">
								<div className="flex items-start justify-between gap-4 text-sm text-[#8d938f]">
									<div className="text-[13px]">
										Invoice No:{" "}
										<span className="font-medium text-[#ece7de]">
											{createdInvoice.invoiceNumber}
										</span>
									</div>
									<div className="text-[13px]">
										Due Date:{" "}
										<span className="font-medium text-[#ece7de]">
											{formatDate(createdInvoice.dueDate, dateFormat)}
										</span>
									</div>
								</div>

								<div className="mt-8">
									<div className="text-[18px] font-medium text-[#ece7de]">
										{createdInvoice.customerName}
									</div>
									{createdInvoice.customerEmail ? (
										<div className="mt-3 text-[13px] text-[#8d938f] underline underline-offset-2">
											{createdInvoice.customerEmail}
										</div>
									) : null}
								</div>

								<div className="mt-10 flex items-end justify-between gap-4 border-b border-dashed border-[#202225] pb-5">
									<div className="text-[13px] text-[#8d938f]">Total</div>
									<div className="text-[18px] text-[#ece7de]">
										{formatMoney(
											createdInvoice.total,
											normalizeCurrency(currency),
											{
												maximumFractionDigits: includeDecimals ? 2 : 0,
											},
										)}
									</div>
								</div>

								<div className="mt-10">
									<div className="text-[28px] font-medium tracking-[-0.03em] text-[#ece7de]">
										Details
									</div>
									<div className="mt-10">
										<div className="mb-2 text-[12px] text-[#8d938f]">
											Share link
										</div>
										<div className="flex items-center gap-2">
											<div className="flex h-10 flex-1 items-center border border-[#202225] bg-[#0f1114] px-3 text-[13px] text-[#8d938f]">
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
												href={createdInvoiceDownloadUrl}
												className={footerIconButtonClass}
												aria-label="Download invoice"
											>
												<Download className="h-4 w-4" />
											</a>
										</div>
									</div>
								</div>
							</div>
						</div>

						<div className="flex items-center justify-end gap-3 border-t border-[#202225] bg-[#0d1117] px-6 py-5">
							<button
								type="button"
								onClick={() => openInvoiceTab(createdInvoice.token)}
								className="inline-flex h-10 items-center border border-[#202225] bg-[#141618] px-5 text-[14px] text-[#ece7de] transition-colors hover:bg-[#181b1f]"
							>
								View invoice
							</button>
							<button
								type="button"
								onClick={resetDraft}
								className="inline-flex h-10 items-center border border-[#d6d3cb] bg-[#ece7de] px-5 text-[14px] text-[#111214] transition-colors hover:bg-[#f5f1e8]"
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
		<div
			className={`flex h-full min-h-0 w-full flex-col ${isSheetMode ? "" : "pb-6"}`}
		>
			<div className={`flex-1 overflow-auto ${isSheetMode ? "p-0" : "px-2"}`}>
				<div
					className={`mx-auto flex h-full min-h-full w-full flex-col border border-[#202225] bg-[#0b0f16] ${paperFrameClass}`}
				>
					<div className="flex min-h-0 flex-1 flex-col">
						<div className="border-b border-[#202225] px-5 py-4 md:px-5 md:py-4">
							<div className="mb-6 flex items-start justify-between gap-5 text-[13px] text-[#8d938f]">
								<div className="space-y-1">
									<div className="flex items-center gap-2">
										<span className="text-[#7f857f]">Issue Date:</span>
										<span className="font-mono text-[#d8d4cc]">
											{formatDate(issueDate, dateFormat)}
										</span>
									</div>
									<div className="flex items-center gap-2">
										<span className="text-[#7f857f]">Due Date:</span>
										<Popover>
											<PopoverTrigger asChild>
												<Button
													type="button"
													className="inline-flex h-7 items-center gap-2 border-0 bg-transparent p-0 font-mono text-[#d8d4cc]"
												>
													{formatDate(dueDate, dateFormat)}
													<CalendarDays className="h-4 w-4 text-[#7f857f]" />
												</Button>
											</PopoverTrigger>
											<PopoverContent
												align="start"
												className="w-auto border-[#202225] bg-[#0f1114] p-0"
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

								<div className="w-[84px] space-y-1.5">
									<div className="h-14 w-[84px] overflow-hidden border border-[#202225] bg-[#0f1319]">
										{logoUrl.trim() ? (
											<img
												src={logoUrl}
												alt="Company logo preview"
												className="h-full w-full object-contain"
											/>
										) : (
											<div className="h-full w-full bg-[repeating-linear-gradient(135deg,#171c24_0,#171c24_2px,transparent_2px,transparent_6px)]" />
										)}
									</div>
									<div className="flex items-center gap-1">
										<label className="inline-flex h-6 cursor-pointer items-center gap-1 border border-[#202225] bg-[#11151c] px-2 text-[10px] text-[#9da39f] transition-colors hover:bg-[#151922] hover:text-[#ece7de]">
											<ImagePlus className="h-3 w-3" />
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

							<div className="mb-7 grid gap-6 md:grid-cols-2">
								<div className="space-y-1.5">
									<div className="text-sm text-[#7f857f]">From</div>
									<Input
										value={fromName}
										onChange={(event) => setFromName(event.target.value)}
										className="h-7 border-0 bg-transparent px-0 text-[15px] font-medium text-[#ece7de]"
									/>
									{showFromEmail ? (
										<Input
											value={fromEmail}
											onChange={(event) => setFromEmail(event.target.value)}
											className="h-6 border-0 bg-transparent px-0 text-[13px] text-[#d8d4cc]"
										/>
									) : null}
								</div>

								<div className="space-y-1.5">
									<div className="text-sm text-[#7f857f]">To</div>
									<div className="mb-1 flex flex-wrap gap-2">
										<div className="relative">
											<button
												type="button"
												onClick={() => setCustomerPickerOpen((prev) => !prev)}
												className="inline-flex h-7 min-w-[170px] items-center justify-between border border-[#202225] bg-[#11151c] px-2 text-xs text-[#d8d4cc]"
											>
												{customerName || "Select client"}
												<ChevronDown className="h-3.5 w-3.5 text-[#7f857f]" />
											</button>
											{customerPickerOpen ? (
												<div className="absolute left-0 top-8 z-20 w-[260px] border border-[#202225] bg-[#0f1114] p-2 shadow-[0_10px_26px_rgba(0,0,0,0.45)]">
													<div className="mb-2 flex h-7 items-center gap-2 border border-[#202225] bg-[#11151c] px-2">
														<Search className="h-3.5 w-3.5 text-[#7f857f]" />
														<input
															value={customerSearch}
															onChange={(event) =>
																setCustomerSearch(event.target.value)
															}
															placeholder="Search customer..."
															className="h-full w-full bg-transparent text-xs text-[#d8d4cc] outline-none placeholder:text-[#616661]"
														/>
													</div>
													<div className="max-h-48 overflow-y-auto">
														{filteredClients.map((client) => (
															<button
																key={client.id}
																type="button"
																onClick={() => selectClient(client.name)}
																className="flex h-7 w-full items-center px-2 text-left text-[13px] text-[#d8d4cc] transition-colors hover:bg-[#151922]"
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
													<div className="mt-2 border-t border-[#202225] pt-2">
														<button
															type="button"
															onClick={() => navigate({ to: "/clients/new" })}
															className="h-7 px-2 text-[13px] text-[#d8b865] transition-colors hover:text-[#e2c577]"
														>
															Create customer
														</button>
													</div>
												</div>
											) : null}
										</div>
										<DropdownMenu>
											<DropdownMenuTrigger asChild>
												<button
													type="button"
													className="inline-flex h-7 w-[74px] items-center justify-between border border-[#202225] bg-[#11151c] px-2 text-xs font-mono text-[#d8d4cc]"
												>
													{currency}
													<ChevronDown className="h-3.5 w-3.5 text-[#7f857f]" />
												</button>
											</DropdownMenuTrigger>
											<DropdownMenuContent
												align="end"
												className="min-w-[86px] border-[#202225] bg-[#0f1114] p-1 text-[#d8d4cc]"
											>
												{CURRENCY_OPTIONS.map((option) => (
													<DropdownMenuItem
														key={option.code}
														onClick={() => setCurrency(option.code)}
														className={`text-xs focus:bg-[#16191d] focus:text-[#ece7de] ${currency === option.code ? "text-[#d8b865]" : ""}`}
													>
														{option.label}
													</DropdownMenuItem>
												))}
											</DropdownMenuContent>
										</DropdownMenu>
									</div>

									<Input
										value={customerName}
										onChange={(event) => setCustomerName(event.target.value)}
										placeholder="Client name"
										className="h-7 border-0 bg-transparent px-0 text-[15px] font-medium text-[#ece7de]"
									/>
									{showCustomerEmail ? (
										<Input
											value={customerEmail}
											onChange={(event) => setCustomerEmail(event.target.value)}
											placeholder="client@email.com"
											className="h-6 border-0 bg-transparent px-0 text-[13px] text-[#d8d4cc]"
										/>
									) : null}
								</div>
							</div>

							<div className="mb-3 grid grid-cols-[1.55fr_.44fr_.72fr_.72fr_28px] border-b border-[#202225] pb-2 text-[13px] text-[#7f857f]">
								<span>Description</span>
								<span>Quantity</span>
								<span>Price</span>
								<span className="text-right">Total</span>
								<span />
							</div>

							<div className="max-h-[300px] overflow-y-auto pr-1">
								<div className="space-y-1.5">
									{lineItems.map((item, index) => {
										const lineTotal = item.quantity * item.price;

										return (
											<div
												key={item.id}
												className="grid grid-cols-[1.55fr_.44fr_.72fr_.72fr_28px] items-center gap-2.5"
											>
												<Input
													value={item.name}
													onChange={(event) =>
														updateLine(index, { name: event.target.value })
													}
													className={`h-7 border-0 px-0 text-[13px] leading-none text-[#ece7de] ${
														item.name.trim().length === 0
															? "bg-[repeating-linear-gradient(135deg,#171c24_0,#171c24_2px,transparent_2px,transparent_6px)]"
															: "bg-transparent"
													}`}
												/>

												<div className="flex items-center gap-1.5 text-[#9098A5]">
													<button
														type="button"
														onClick={() => decrementQuantity(index)}
														className="inline-flex h-5 w-5 items-center justify-center border border-[#202225] bg-[#11151c] text-[11px] text-[#a5adb9] transition-colors hover:bg-[#16191d] hover:text-[#ece7de]"
														aria-label="Decrease quantity"
													>
														-
													</button>
													<Input
														type="number"
														min={1}
														step={1}
														value={item.quantity}
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
														className="h-7 w-[44px] border-0 bg-transparent px-0 text-center text-[13px] font-mono text-[#ece7de]"
													/>
													<button
														type="button"
														onClick={() => incrementQuantity(index)}
														className="inline-flex h-5 w-5 items-center justify-center border border-[#202225] bg-[#11151c] text-[11px] text-[#a5adb9] transition-colors hover:bg-[#16191d] hover:text-[#ece7de]"
														aria-label="Increase quantity"
													>
														+
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
													className={`h-7 border-0 px-0 text-[13px] font-mono text-[#ece7de] ${
														item.price <= 0
															? "bg-[repeating-linear-gradient(135deg,#171c24_0,#171c24_2px,transparent_2px,transparent_6px)]"
															: "bg-transparent"
													}`}
												/>

												<div className="text-right text-[13px] font-mono text-[#ece7de]">
													{formatMoney(lineTotal, normalizeCurrency(currency), {
														maximumFractionDigits: includeDecimals ? 2 : 0,
													})}
												</div>

												<button
													type="button"
													onClick={() => removeLine(index)}
													className="inline-flex h-5 w-5 items-center justify-center border border-[#202225] bg-[#11151c] text-[#7f857f] transition-colors hover:bg-[#16191d] hover:text-[#ece7de]"
													aria-label={`Remove line item ${index + 1}`}
												>
													<X className="h-3 w-3" />
												</button>
											</div>
										);
									})}
								</div>
							</div>

							<div className="mt-4">
								<button
									type="button"
									onClick={addLine}
									className="inline-flex items-center gap-1.5 text-[13px] text-[#9aa2af] transition-colors hover:text-[#d8b865]"
								>
									<Plus className="h-3.5 w-3.5" />
									Add item
								</button>
							</div>

							<div className="mt-8 ml-auto w-full max-w-[250px] space-y-1.5 text-[13px] text-[#a0a8b5]">
								<div className="flex items-center justify-between">
									<span>Subtotal</span>
									<span className="font-mono">
										{formatMoney(subtotal, normalizeCurrency(currency), {
											maximumFractionDigits: includeDecimals ? 2 : 0,
										})}
									</span>
								</div>
								{includeVat ? (
									<div className="flex items-center justify-between">
										<span>VAT (0%)</span>
										<span className="font-mono">
											{formatMoney(vatAmount, normalizeCurrency(currency), {
												maximumFractionDigits: includeDecimals ? 2 : 0,
											})}
										</span>
									</div>
								) : null}
								{includeDiscount ? (
									<div className="flex items-center justify-between">
										<span>Discount</span>
										<span className="font-mono">
											{formatMoney(
												discountAmount,
												normalizeCurrency(currency),
												{
													maximumFractionDigits: includeDecimals ? 2 : 0,
												},
											)}
										</span>
									</div>
								) : null}
								<div className="mt-2.5 flex items-center justify-between border-t border-[#202225] pt-3">
									<span className="text-[#aab2be]">Total</span>
									<span className="text-[22px] leading-none text-[#f0ece4]">
										{formatMoney(totalAmount, normalizeCurrency(currency), {
											maximumFractionDigits: includeDecimals ? 2 : 0,
										})}
									</span>
								</div>
							</div>

							{showPaymentDetailsSection || showNoteSection ? (
								<div
									className={`mt-9 grid gap-6 ${
										showPaymentDetailsSection && showNoteSection
											? "md:grid-cols-2"
											: ""
									}`}
								>
									{showPaymentDetailsSection ? (
										<div>
											<div className="mb-1.5 text-[13px] text-[#7f857f]">
												Payment Details
											</div>
											<textarea
												value={paymentDetails}
												onChange={(event) =>
													setPaymentDetails(event.target.value)
												}
												className={`h-20 w-full resize-none border border-[#202225] p-2 text-[13px] leading-5 outline-none ${
													paymentDetails.trim() === DEFAULT_PAYMENT_DETAILS
														? "bg-[repeating-linear-gradient(135deg,#171c24_0,#171c24_2px,transparent_2px,transparent_6px)] text-[#6d7583]"
														: "bg-transparent text-[#d9dee4]"
												}`}
											/>
										</div>
									) : null}
									{showNoteSection ? (
										<div>
											<div className="mb-1.5 text-[13px] text-[#7f857f]">
												Note
											</div>
											<textarea
												value={notes}
												onChange={(event) => setNotes(event.target.value)}
												className={`h-20 w-full resize-none border border-[#202225] p-2 text-[13px] leading-5 outline-none ${
													notes.trim() === DEFAULT_NOTE
														? "bg-[repeating-linear-gradient(135deg,#171c24_0,#171c24_2px,transparent_2px,transparent_6px)] text-[#6d7583]"
														: "bg-transparent text-[#d9dee4]"
												}`}
											/>
										</div>
									) : null}
								</div>
							) : null}
						</div>
					</div>

					<div className="flex items-center justify-between border-t border-[#202225] bg-[#0d1117] px-4 py-3">
						<div className="flex items-center gap-2">
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										className={footerIconButtonClass}
									>
										<Settings className="h-4 w-4" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent
									side="top"
									align="start"
									className="min-w-[190px] border-[#202225] bg-[#0f1114] p-1 text-[#d8d4cc]"
								>
									<DropdownMenuSub>
										<DropdownMenuSubTrigger className="text-xs focus:bg-[#16191d] data-[state=open]:bg-[#16191d] focus:text-[#ece7de] data-[state=open]:text-[#ece7de]">
											<FileText className="mr-2 h-3.5 w-3.5" />
											Invoice
										</DropdownMenuSubTrigger>
										<DropdownMenuSubContent className="border-[#202225] bg-[#0f1114] text-[#d8d4cc]">
											<DropdownMenuLabel className="px-2 pb-1 pt-1 text-[10px] font-normal uppercase tracking-[0.08em] text-[#6f756f]">
												Invoice
											</DropdownMenuLabel>
											<DropdownMenuSeparator className="bg-[#202225]" />
											<DropdownMenuSub>
												<DropdownMenuSubTrigger className="text-xs focus:bg-[#16191d] data-[state=open]:bg-[#16191d] focus:text-[#ece7de] data-[state=open]:text-[#ece7de]">
													Invoice size
												</DropdownMenuSubTrigger>
												<DropdownMenuSubContent className="border-[#202225] bg-[#0f1114] text-[#d8d4cc]">
													<DropdownMenuItem
														onClick={() => setInvoiceSize("A4")}
														className={`text-xs focus:bg-[#16191d] focus:text-[#ece7de] ${invoiceSize === "A4" ? "text-[#d8b865]" : ""}`}
													>
														A4
													</DropdownMenuItem>
													<DropdownMenuItem
														onClick={() => setInvoiceSize("LETTER")}
														className={`text-xs focus:bg-[#16191d] focus:text-[#ece7de] ${invoiceSize === "LETTER" ? "text-[#d8b865]" : ""}`}
													>
														Letter
													</DropdownMenuItem>
												</DropdownMenuSubContent>
											</DropdownMenuSub>
											<DropdownMenuSub>
												<DropdownMenuSubTrigger className="text-xs focus:bg-[#16191d] data-[state=open]:bg-[#16191d] focus:text-[#ece7de] data-[state=open]:text-[#ece7de]">
													Currency
												</DropdownMenuSubTrigger>
												<DropdownMenuSubContent className="max-h-64 border-[#202225] bg-[#0f1114] text-[#d8d4cc]">
													{CURRENCY_OPTIONS.map((option) => (
														<DropdownMenuItem
															key={option.code}
															onClick={() => setCurrency(option.code)}
															className={`text-xs focus:bg-[#16191d] focus:text-[#ece7de] ${currency === option.code ? "text-[#d8b865]" : ""}`}
														>
															{option.label}
														</DropdownMenuItem>
													))}
												</DropdownMenuSubContent>
											</DropdownMenuSub>
											<DropdownMenuSub>
												<DropdownMenuSubTrigger className="text-xs focus:bg-[#16191d] data-[state=open]:bg-[#16191d] focus:text-[#ece7de] data-[state=open]:text-[#ece7de]">
													Date format
												</DropdownMenuSubTrigger>
												<DropdownMenuSubContent className="border-[#202225] bg-[#0f1114] text-[#d8d4cc]">
													<DropdownMenuItem
														onClick={() => setDateFormat("iso")}
														className={`text-xs focus:bg-[#16191d] focus:text-[#ece7de] ${dateFormat === "iso" ? "text-[#d8b865]" : ""}`}
													>
														YYYY-MM-DD
													</DropdownMenuItem>
													<DropdownMenuItem
														onClick={() => setDateFormat("us")}
														className={`text-xs focus:bg-[#16191d] focus:text-[#ece7de] ${dateFormat === "us" ? "text-[#d8b865]" : ""}`}
													>
														MM/DD/YYYY
													</DropdownMenuItem>
												</DropdownMenuSubContent>
											</DropdownMenuSub>
											<DropdownMenuSub>
												<DropdownMenuSubTrigger className="text-xs focus:bg-[#16191d] data-[state=open]:bg-[#16191d] focus:text-[#ece7de] data-[state=open]:text-[#ece7de]">
													Payment terms
												</DropdownMenuSubTrigger>
												<DropdownMenuSubContent className="border-[#202225] bg-[#0f1114] text-[#d8d4cc]">
													{[7, 14, 30].map((days) => (
														<DropdownMenuItem
															key={days}
															onClick={() => updatePaymentTerms(days)}
															className={`text-xs focus:bg-[#16191d] focus:text-[#ece7de] ${paymentTermDays === days ? "text-[#d8b865]" : ""}`}
														>
															Net {days}
														</DropdownMenuItem>
													))}
												</DropdownMenuSubContent>
											</DropdownMenuSub>
										</DropdownMenuSubContent>
									</DropdownMenuSub>

									<DropdownMenuSub>
										<DropdownMenuSubTrigger className="text-xs focus:bg-[#16191d] data-[state=open]:bg-[#16191d] focus:text-[#ece7de] data-[state=open]:text-[#ece7de]">
											<DollarSign className="mr-2 h-3.5 w-3.5" />
											Tax & Pricing
										</DropdownMenuSubTrigger>
										<DropdownMenuSubContent className="border-[#202225] bg-[#0f1114] text-[#d8d4cc]">
											<DropdownMenuCheckboxItem
												checked={includeVat}
												onCheckedChange={(checked) =>
													setIncludeVat(checked === true)
												}
												className="text-xs focus:bg-[#16191d] focus:text-[#ece7de]"
											>
												VAT
											</DropdownMenuCheckboxItem>
											<DropdownMenuCheckboxItem
												checked={includeDiscount}
												onCheckedChange={(checked) =>
													setIncludeDiscount(checked === true)
												}
												className="text-xs focus:bg-[#16191d] focus:text-[#ece7de]"
											>
												Discount
											</DropdownMenuCheckboxItem>
											<DropdownMenuCheckboxItem
												checked={includeDecimals}
												onCheckedChange={(checked) =>
													setIncludeDecimals(checked === true)
												}
												className="text-xs focus:bg-[#16191d] focus:text-[#ece7de]"
											>
												Decimals
											</DropdownMenuCheckboxItem>
											<DropdownMenuCheckboxItem
												checked={includeUnits}
												onCheckedChange={(checked) =>
													setIncludeUnits(checked === true)
												}
												className="text-xs focus:bg-[#16191d] focus:text-[#ece7de]"
											>
												Units
											</DropdownMenuCheckboxItem>
											<DropdownMenuCheckboxItem
												checked={includeQrCode}
												onCheckedChange={(checked) =>
													setIncludeQrCode(checked === true)
												}
												className="text-xs focus:bg-[#16191d] focus:text-[#ece7de]"
											>
												QR code
											</DropdownMenuCheckboxItem>
										</DropdownMenuSubContent>
									</DropdownMenuSub>

									<DropdownMenuSub>
										<DropdownMenuSubTrigger className="text-xs focus:bg-[#16191d] data-[state=open]:bg-[#16191d] focus:text-[#ece7de] data-[state=open]:text-[#ece7de]">
											<Mail className="mr-2 h-3.5 w-3.5" />
											Email
										</DropdownMenuSubTrigger>
										<DropdownMenuSubContent className="border-[#202225] bg-[#0f1114] text-[#d8d4cc]">
											<DropdownMenuCheckboxItem
												checked={showFromEmail}
												onCheckedChange={(checked) =>
													setShowFromEmail(checked === true)
												}
												className="text-xs focus:bg-[#16191d] focus:text-[#ece7de]"
											>
												Show sender email
											</DropdownMenuCheckboxItem>
											<DropdownMenuCheckboxItem
												checked={showCustomerEmail}
												onCheckedChange={(checked) =>
													setShowCustomerEmail(checked === true)
												}
												className="text-xs focus:bg-[#16191d] focus:text-[#ece7de]"
											>
												Show client email
											</DropdownMenuCheckboxItem>
										</DropdownMenuSubContent>
									</DropdownMenuSub>

									<DropdownMenuSub>
										<DropdownMenuSubTrigger className="text-xs focus:bg-[#16191d] data-[state=open]:bg-[#16191d] focus:text-[#ece7de] data-[state=open]:text-[#ece7de]">
											<ReceiptText className="mr-2 h-3.5 w-3.5" />
											Payments
										</DropdownMenuSubTrigger>
										<DropdownMenuSubContent className="border-[#202225] bg-[#0f1114] text-[#d8d4cc]">
											<DropdownMenuCheckboxItem
												checked={showPaymentDetailsSection}
												onCheckedChange={(checked) =>
													setShowPaymentDetailsSection(checked === true)
												}
												className="text-xs focus:bg-[#16191d] focus:text-[#ece7de]"
											>
												Payment details block
											</DropdownMenuCheckboxItem>
											<DropdownMenuCheckboxItem
												checked={showNoteSection}
												onCheckedChange={(checked) =>
													setShowNoteSection(checked === true)
												}
												className="text-xs focus:bg-[#16191d] focus:text-[#ece7de]"
											>
												Note block
											</DropdownMenuCheckboxItem>
											<DropdownMenuSeparator className="bg-[#202225]" />
											<DropdownMenuItem
												onClick={() =>
													setPaymentDetails(DEFAULT_PAYMENT_DETAILS)
												}
												className="text-xs focus:bg-[#16191d] focus:text-[#ece7de]"
											>
												Reset payment details
											</DropdownMenuItem>
											<DropdownMenuItem
												onClick={() => setNotes(DEFAULT_NOTE)}
												className="text-xs focus:bg-[#16191d] focus:text-[#ece7de]"
											>
												Reset note
											</DropdownMenuItem>
										</DropdownMenuSubContent>
									</DropdownMenuSub>

									<DropdownMenuSeparator className="bg-[#202225]" />
									<DropdownMenuItem
										onClick={() => {
											setTemplateName(`${templateName} Copy`);
											toast({
												title: "Template duplicated",
												description:
													"A duplicate draft template has been created.",
												variant: "success",
											});
										}}
										className="text-xs focus:bg-[#16191d] focus:text-[#ece7de]"
									>
										Duplicate template
									</DropdownMenuItem>
									<DropdownMenuItem
										onClick={() => {
											setTemplateName("Default");
											toast({
												title: "Template reset",
												description:
													"The composer has been restored to the default template.",
											});
										}}
										className="text-xs text-[#d48f8f] focus:bg-[#2a1f1f] focus:text-[#efb1b1]"
									>
										Delete template
									</DropdownMenuItem>
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
									className="min-w-[224px] border-[#202225] bg-[#0f1114] p-1 text-[#d8d4cc]"
								>
									<DropdownMenuLabel className="px-2 pb-1 pt-1 text-[10px] font-normal uppercase tracking-[0.08em] text-[#6f756f]">
										Templates
									</DropdownMenuLabel>
									<DropdownMenuSeparator className="bg-[#202225]" />
									<DropdownMenuItem
										onClick={() => setTemplateName("Default")}
										className={`text-xs focus:bg-[#16191d] focus:text-[#ece7de] ${templateName === "Default" ? "text-[#ece7de]" : ""}`}
									>
										Default
									</DropdownMenuItem>
									<DropdownMenuItem
										onClick={() => setTemplateName("Default Copy")}
										className={`text-xs focus:bg-[#16191d] focus:text-[#ece7de] ${templateName === "Default Copy" ? "text-[#ece7de]" : ""}`}
									>
										Default Copy
									</DropdownMenuItem>
									<DropdownMenuSeparator className="bg-[#202225]" />
									<DropdownMenuItem
										onClick={() => {
											setTemplateName("Untitled");
											toast({
												title: "Template created",
												description:
													"You can now customize a new invoice template.",
												variant: "success",
											});
										}}
										className="text-xs focus:bg-[#16191d] focus:text-[#ece7de]"
									>
										<Plus className="mr-2 h-3.5 w-3.5" />
										Create new
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>

						<div className="flex items-center gap-2">
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

							<div className="flex items-stretch">
								<button
									type="button"
									disabled={!canSubmit}
									onClick={() => void createInvoice("create")}
									className="inline-flex h-9 items-center border border-[#d6d3cb] bg-[#ece7de] px-5 text-[12px] font-medium text-[#111214] transition-colors hover:bg-[#f5f1e8] disabled:cursor-not-allowed disabled:border-[#5a5d61] disabled:bg-[#7d7f83] disabled:text-[#141516]"
								>
									{submitting ? (
										<>
											<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
											Creating
										</>
									) : (
										"Create"
									)}
								</button>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<button
											type="button"
											disabled={!canSubmit}
											className="inline-flex h-9 items-center border border-l-0 border-[#d6d3cb] bg-[#ece7de] px-2 text-[#111214] transition-colors hover:bg-[#f5f1e8] disabled:cursor-not-allowed disabled:border-[#5a5d61] disabled:bg-[#7d7f83] disabled:text-[#141516]"
										>
											<ChevronDown className="h-3.5 w-3.5" />
										</button>
									</DropdownMenuTrigger>
									<DropdownMenuContent
										side="top"
										align="end"
										className="min-w-[200px] border-[#202225] bg-[#0f1114] p-1 text-[#d8d4cc]"
									>
										<DropdownMenuItem
											onClick={() => void createInvoice("create")}
											className="text-xs focus:bg-[#16191d] focus:text-[#ece7de]"
										>
											Create
										</DropdownMenuItem>
										<DropdownMenuItem
											onClick={() => void createInvoice("create-and-send")}
											className="text-xs focus:bg-[#16191d] focus:text-[#ece7de]"
										>
											Create & Send
										</DropdownMenuItem>
										<DropdownMenuSub>
											<DropdownMenuSubTrigger className="text-xs focus:bg-[#16191d] data-[state=open]:bg-[#16191d] focus:text-[#ece7de] data-[state=open]:text-[#ece7de]">
												Schedule
											</DropdownMenuSubTrigger>
											<DropdownMenuSubContent className="border-[#202225] bg-[#0f1114] text-[#d8d4cc]">
												<DropdownMenuItem
													onClick={() => void createInvoice("schedule")}
													className="text-xs focus:bg-[#16191d] focus:text-[#ece7de]"
												>
													Schedule send
												</DropdownMenuItem>
											</DropdownMenuSubContent>
										</DropdownMenuSub>
										<DropdownMenuSub>
											<DropdownMenuSubTrigger className="text-xs focus:bg-[#16191d] data-[state=open]:bg-[#16191d] focus:text-[#ece7de] data-[state=open]:text-[#ece7de]">
												Recurring
											</DropdownMenuSubTrigger>
											<DropdownMenuSubContent className="border-[#202225] bg-[#0f1114] text-[#d8d4cc]">
												<DropdownMenuItem
													onClick={() => void createInvoice("recurring")}
													className="text-xs focus:bg-[#16191d] focus:text-[#ece7de]"
												>
													Create recurring draft
												</DropdownMenuItem>
											</DropdownMenuSubContent>
										</DropdownMenuSub>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
