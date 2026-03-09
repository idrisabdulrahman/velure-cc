import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
	CalendarDays,
	ChevronDown,
	ExternalLink,
	ImagePlus,
	Loader2,
	Plus,
	Search,
	Settings,
} from "lucide-react";
import { type ChangeEvent, useMemo, useState } from "react";
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
	onCancel?: () => void;
	onCreated?: (invoiceId: string) => void;
};

const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "NGN"] as const;
type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

function isSupportedCurrency(value: string): value is SupportedCurrency {
	return SUPPORTED_CURRENCIES.includes(value as SupportedCurrency);
}

function normalizeCurrency(value?: string | null): SupportedCurrency {
	const normalized = value?.trim().toUpperCase();
	if (normalized && isSupportedCurrency(normalized)) return normalized;
	return "USD";
}

function formatAmount(amount: number, currency: string) {
	return formatMoney(amount, normalizeCurrency(currency));
}

function toIsoDate(value: Date) {
	return value.toISOString().slice(0, 10);
}

function fromIsoDate(value: string) {
	const date = new Date(`${value}T00:00:00`);
	if (Number.isNaN(date.getTime())) return undefined;
	return date;
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

export function CreateInvoicePanel({
	mode = "page",
	onCancel,
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

	const [invoiceNumber] = useState(() => {
		const stamp = String(Date.now()).slice(-4);
		return `INV-2026-${stamp}`;
	});
	const [logoUrl, setLogoUrl] = useState("");
	const [customerName, setCustomerName] = useState("");
	const [customerEmail, setCustomerEmail] = useState("");
	const [fromName, setFromName] = useState("Velure Studio");
	const [fromEmail, setFromEmail] = useState("hello@velure.app");
	const [paymentDetails, setPaymentDetails] = useState("");
	const [notes, setNotes] = useState("");
	const [currency, setCurrency] = useState<SupportedCurrency>("USD");
	const [invoiceSize, setInvoiceSize] = useState("A4");
	const [invoiceType, setInvoiceType] = useState<"one-time" | "recurring">(
		"one-time",
	);
	const [dateFormat, setDateFormat] = useState<"iso" | "us">("iso");
	const [paymentTermDays, setPaymentTermDays] = useState(14);
	const [dueDate, setDueDate] = useState(() => {
		const d = new Date();
		d.setDate(d.getDate() + 14);
		return toIsoDate(d);
	});
	const [issueDate] = useState(() => toIsoDate(new Date()));
	const [customerSearch, setCustomerSearch] = useState("");
	const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
	const [lastCreatedToken, setLastCreatedToken] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
	const [lineItems, setLineItems] = useState<LineItem[]>([
		{
			id: `li-${crypto.randomUUID()}`,
			name: "",
			quantity: 1,
			price: 0,
		},
	]);

	const subtotal = useMemo(
		() => lineItems.reduce((sum, item) => sum + item.quantity * item.price, 0),
		[lineItems],
	);

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
		setLineItems((prev) => [
			...prev,
			{
				id: `li-${crypto.randomUUID()}`,
				name: "",
				quantity: 1,
				price: 0,
			},
		]);
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

	const createInvoice = async () => {
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
				invoiceSize: invoiceSize === "A4" ? "A4" : "LETTER",
				dateFormat,
				paymentTermsDays: paymentTermDays,
				template: "Default",
				issueDate,
				dueDate,
				paymentDetails,
				notes,
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

			toast({
				title: "Invoice created",
				description: `${created.invoiceNumber} is ready.`,
				variant: "success",
			});

			onCreated?.(created.id);

			if (!isSheetMode && !onCreated) {
				navigate({ to: "/invoices" });
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

	const updatePaymentTerms = (days: number) => {
		setPaymentTermDays(days);
		const base = new Date(issueDate);
		base.setDate(base.getDate() + days);
		setDueDate(toIsoDate(base));
	};

	const paperFrameClass =
		invoiceSize === "A4"
			? "max-w-[860px] min-h-[1140px]"
			: "max-w-[900px] min-h-[1060px]";

	return (
		<div
			className={`flex h-full min-h-0 w-full flex-col ${isSheetMode ? "" : "pb-6"}`}
		>
			<div className={`flex-1 overflow-auto ${isSheetMode ? "p-2" : "px-2"}`}>
				<div
					className={`mx-auto w-full border border-[#1A1D22] bg-[#090D14] ${paperFrameClass}`}
				>
					<div className="grid gap-0">
						<div className="border-b border-[#1A1D22] p-8 md:p-10">
							<div className="mb-10 flex items-start justify-between gap-6 text-sm text-[#9AA2AF]">
								<div className="space-y-1">
									<div className="flex items-center gap-2">
										<span className="text-[#757E8B]">Issue Date:</span>
										<span className="font-mono text-[#D5D9DE]">
											{formatDate(issueDate, dateFormat)}
										</span>
									</div>
									<div className="flex items-center gap-2">
										<span className="text-[#757E8B]">Due Date:</span>
										<Popover>
											<PopoverTrigger asChild>
												<Button
													type="button"
													className="inline-flex h-7 items-center gap-2 border-0 bg-transparent p-0 font-mono text-[#D5D9DE]"
												>
													{formatDate(dueDate, dateFormat)}
													<CalendarDays className="h-4 w-4 text-[#7F8895]" />
												</Button>
											</PopoverTrigger>
											<PopoverContent
												align="start"
												className="w-auto border-[#1A1D22] bg-[#0B0F15] p-0"
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
								<div className="w-24 space-y-2">
									<div className="h-16 w-24 overflow-hidden border border-[#222831] bg-[#0B1018]">
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
										<label className="inline-flex h-7 cursor-pointer items-center gap-1 border border-[#1A1D22] bg-[#0D1118] px-2 text-[10px] uppercase tracking-[0.06em] text-[#9AA2AF] hover:text-[#D9DEE4]">
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

							<div className="mb-14 grid gap-8 md:grid-cols-2">
								<div className="space-y-2">
									<div className="text-sm text-[#7D8694]">From</div>
									<Input
										value={fromName}
										onChange={(event) => setFromName(event.target.value)}
										className="h-8 border-0 bg-transparent px-0 text-[20px] font-serif text-[#F2F3F5]"
									/>
									<Input
										value={fromEmail}
										onChange={(event) => setFromEmail(event.target.value)}
										className="h-7 border-0 bg-transparent px-0 text-sm text-[#D5D9DE]"
									/>
								</div>
								<div className="space-y-2">
									<div className="text-sm text-[#7D8694]">To</div>
									<div className="mb-1 flex flex-wrap gap-2">
										<div className="relative">
											<button
												type="button"
												onClick={() => setCustomerPickerOpen((prev) => !prev)}
												className="inline-flex h-8 min-w-[180px] items-center justify-between border border-[#1A1D22] bg-[#0D1118] px-2 text-xs text-[#D5D9DE]"
											>
												{customerName || "Select client"}
												<ChevronDown className="h-3.5 w-3.5 text-[#7D8694]" />
											</button>
											{customerPickerOpen ? (
												<div className="absolute left-0 top-9 z-20 w-[280px] border border-[#1A1D22] bg-[#0B0F15] p-2 shadow-[0_10px_26px_rgba(0,0,0,0.45)]">
													<div className="mb-2 flex h-8 items-center gap-2 border border-[#1A1D22] bg-[#0D1118] px-2">
														<Search className="h-3.5 w-3.5 text-[#6F7784]" />
														<input
															value={customerSearch}
															onChange={(event) =>
																setCustomerSearch(event.target.value)
															}
															placeholder="Search customer..."
															className="h-full w-full bg-transparent text-xs text-[#D5D9DE] outline-none placeholder:text-[#5C6470]"
														/>
													</div>
													<div className="max-h-48 overflow-y-auto">
														{filteredClients.map((client) => (
															<button
																key={client.id}
																type="button"
																onClick={() => selectClient(client.name)}
																className="flex h-8 w-full items-center px-2 text-left text-sm text-[#D5D9DE] hover:bg-[#131922]"
															>
																{client.name}
															</button>
														))}
														{filteredClients.length === 0 ? (
															<div className="px-2 py-2 text-xs text-[#6F7784]">
																No customers found.
															</div>
														) : null}
													</div>
													<div className="mt-2 border-t border-[#1A1D22] pt-2">
														<button
															type="button"
															onClick={() => navigate({ to: "/clients/new" })}
															className="h-8 px-2 text-sm text-[#C8FF1A] hover:text-[#DBFF6C]"
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
													className="inline-flex h-8 w-[86px] items-center justify-between border border-[#1A1D22] bg-[#0D1118] px-2 text-xs font-mono text-[#D5D9DE]"
												>
													{currency}
													<ChevronDown className="h-3.5 w-3.5 text-[#7D8694]" />
												</button>
											</DropdownMenuTrigger>
											<DropdownMenuContent
												align="end"
												className="min-w-[86px] border-[#1A1D22] bg-[#0B0F15] p-1 text-[#D6DBE2]"
											>
												{SUPPORTED_CURRENCIES.map((c) => (
													<DropdownMenuItem
														key={c}
														onClick={() => setCurrency(c)}
														className={`text-xs focus:bg-[#18240E] focus:text-[#DFFF62] ${currency === c ? "text-[#C8FF1A]" : ""}`}
													>
														{c}
													</DropdownMenuItem>
												))}
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
									<Input
										value={customerName}
										onChange={(event) => setCustomerName(event.target.value)}
										placeholder="Client name"
										className="h-8 border-0 bg-transparent px-0 text-[20px] font-serif text-[#F2F3F5]"
									/>
									<Input
										value={customerEmail}
										onChange={(event) => setCustomerEmail(event.target.value)}
										placeholder="client@email.com"
										className="h-7 border-0 bg-transparent px-0 text-sm text-[#D5D9DE]"
									/>
								</div>
							</div>

							<div className="mb-5 grid grid-cols-[1.5fr_.55fr_.8fr_.8fr] border-b border-[#1A1D22] pb-3 text-sm text-[#7D8694]">
								<span>Description</span>
								<span>Quantity</span>
								<span>Price</span>
								<span className="text-right">Total</span>
							</div>

							<div className="space-y-2">
								{lineItems.map((item, index) => {
									const lineTotal = item.quantity * item.price;
									return (
										<div
											key={item.id}
											className="grid grid-cols-[1.5fr_.55fr_.8fr_.8fr] items-center gap-3"
										>
											<Input
												value={item.name}
												onChange={(event) =>
													updateLine(index, { name: event.target.value })
												}
												className={`h-8 border-0 px-0 text-base leading-none font-serif text-[#E5E9EF] ${
													item.name.trim().length === 0
														? "bg-[repeating-linear-gradient(135deg,#171c24_0,#171c24_2px,transparent_2px,transparent_6px)]"
														: "bg-transparent"
												}`}
											/>
											<div className="flex items-center gap-2 text-[#9098A5]">
												<button
													type="button"
													onClick={() => decrementQuantity(index)}
													className="inline-flex h-6 w-6 items-center justify-center rounded border border-[#1A1D22] bg-[#0D1118] text-[#A5ADB9] hover:text-[#D5D9DE]"
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
													className={`h-8 w-[64px] border-0 px-0 text-center font-mono text-[#F2F3F5] ${
														item.quantity <= 0
															? "bg-[repeating-linear-gradient(135deg,#171c24_0,#171c24_2px,transparent_2px,transparent_6px)]"
															: "bg-transparent"
													}`}
												/>
												<button
													type="button"
													onClick={() => incrementQuantity(index)}
													className="inline-flex h-6 w-6 items-center justify-center rounded border border-[#1A1D22] bg-[#0D1118] text-[#A5ADB9] hover:text-[#D5D9DE]"
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
												className={`h-8 border-0 px-0 font-mono text-[#F2F3F5] ${
													item.price <= 0
														? "bg-[repeating-linear-gradient(135deg,#171c24_0,#171c24_2px,transparent_2px,transparent_6px)]"
														: "bg-transparent"
												}`}
											/>
											<div className="text-right font-mono text-[#F2F3F5]">
												{formatAmount(lineTotal, currency)}
											</div>
										</div>
									);
								})}
							</div>

							<div className="mt-6">
								<button
									type="button"
									onClick={addLine}
									className="inline-flex items-center gap-2 text-sm text-[#9AA2AF] transition-colors hover:text-[#C8FF1A]"
								>
									<Plus className="h-3.5 w-3.5" />
									Add item
								</button>
							</div>

							<div className="mt-14 ml-auto w-full max-w-[330px] space-y-2 text-[#A0A8B5]">
								<div className="flex items-center justify-between">
									<span>Subtotal</span>
									<span className="font-mono">
										{formatAmount(subtotal, currency)}
									</span>
								</div>
								<div className="flex items-center justify-between">
									<span>VAT (0%)</span>
									<span className="font-mono">{formatAmount(0, currency)}</span>
								</div>
								<div className="mt-4 border-t border-[#1A1D22] pt-4 flex items-center justify-between">
									<span className="text-[#AAB2BE]">Total</span>
									<span className="text-[44px] leading-none font-serif italic text-[#F2F3F5]">
										{formatAmount(subtotal, currency)}
									</span>
								</div>
							</div>

							<div className="mt-16 grid gap-8 md:grid-cols-2">
								<div>
									<div className="mb-2 text-sm text-[#7D8694]">
										Payment Details
									</div>
									<textarea
										value={paymentDetails}
										onChange={(event) => setPaymentDetails(event.target.value)}
										placeholder="Add bank details, wallet address, or payment instructions"
										className={`h-24 w-full resize-none border border-[#1A1D22] p-2 text-sm leading-6 text-[#D9DEE4] outline-none placeholder:text-[#6D7583] ${
											paymentDetails.trim().length === 0
												? "bg-[repeating-linear-gradient(135deg,#171c24_0,#171c24_2px,transparent_2px,transparent_6px)]"
												: "bg-transparent"
										}`}
									/>
								</div>
								<div>
									<div className="mb-2 text-sm text-[#7D8694]">Note</div>
									<textarea
										value={notes}
										onChange={(event) => setNotes(event.target.value)}
										placeholder="Add note"
										className={`h-24 w-full resize-none border border-[#1A1D22] p-2 text-sm leading-6 text-[#D9DEE4] outline-none placeholder:text-[#6D7583] ${
											notes.trim().length === 0
												? "bg-[repeating-linear-gradient(135deg,#171c24_0,#171c24_2px,transparent_2px,transparent_6px)]"
												: "bg-transparent"
										}`}
									/>
								</div>
							</div>
						</div>
					</div>

					<div className="flex items-center justify-between border-t border-[#1A1D22] bg-[#070B12] px-5 py-4">
						<div className="flex items-center gap-2">
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										className="h-9 w-9 border border-[#1A1D22] bg-[#0D1118] text-[#9AA2AF] hover:text-[#C8FF1A]"
									>
										<Settings className="h-4 w-4" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent
									side="top"
									align="start"
									className="min-w-[220px] border-[#1A1D22] bg-[#0B0F15] p-1 text-[#D6DBE2]"
								>
									<DropdownMenuSub>
										<DropdownMenuSubTrigger className="text-xs focus:bg-[#18240E] data-[state=open]:bg-[#18240E] focus:text-[#DFFF62] data-[state=open]:text-[#DFFF62]">
											Invoice size
										</DropdownMenuSubTrigger>
										<DropdownMenuSubContent className="border-[#1A1D22] bg-[#0B0F15] text-[#D6DBE2]">
											<DropdownMenuItem
												onClick={() => setInvoiceSize("A4")}
												className={`text-xs focus:bg-[#18240E] focus:text-[#DFFF62] ${invoiceSize === "A4" ? "text-[#C8FF1A]" : ""}`}
											>
												A4
											</DropdownMenuItem>
											<DropdownMenuItem
												onClick={() => setInvoiceSize("Letter")}
												className={`text-xs focus:bg-[#18240E] focus:text-[#DFFF62] ${invoiceSize === "Letter" ? "text-[#C8FF1A]" : ""}`}
											>
												Letter
											</DropdownMenuItem>
										</DropdownMenuSubContent>
									</DropdownMenuSub>
									<DropdownMenuSub>
										<DropdownMenuSubTrigger className="text-xs focus:bg-[#18240E] data-[state=open]:bg-[#18240E] focus:text-[#DFFF62] data-[state=open]:text-[#DFFF62]">
											Currency
										</DropdownMenuSubTrigger>
										<DropdownMenuSubContent className="border-[#1A1D22] bg-[#0B0F15] text-[#D6DBE2]">
											{SUPPORTED_CURRENCIES.map((c) => (
												<DropdownMenuItem
													key={c}
													onClick={() => setCurrency(c)}
													className={`text-xs focus:bg-[#18240E] focus:text-[#DFFF62] ${currency === c ? "text-[#C8FF1A]" : ""}`}
												>
													{c}
												</DropdownMenuItem>
											))}
										</DropdownMenuSubContent>
									</DropdownMenuSub>
									<DropdownMenuSub>
										<DropdownMenuSubTrigger className="text-xs focus:bg-[#18240E] data-[state=open]:bg-[#18240E] focus:text-[#DFFF62] data-[state=open]:text-[#DFFF62]">
											Type
										</DropdownMenuSubTrigger>
										<DropdownMenuSubContent className="border-[#1A1D22] bg-[#0B0F15] text-[#D6DBE2]">
											<DropdownMenuItem
												onClick={() => setInvoiceType("one-time")}
												className={`text-xs focus:bg-[#18240E] focus:text-[#DFFF62] ${invoiceType === "one-time" ? "text-[#C8FF1A]" : ""}`}
											>
												One-time
											</DropdownMenuItem>
											<DropdownMenuItem
												onClick={() => setInvoiceType("recurring")}
												className={`text-xs focus:bg-[#18240E] focus:text-[#DFFF62] ${invoiceType === "recurring" ? "text-[#C8FF1A]" : ""}`}
											>
												Recurring
											</DropdownMenuItem>
										</DropdownMenuSubContent>
									</DropdownMenuSub>
									<DropdownMenuSub>
										<DropdownMenuSubTrigger className="text-xs focus:bg-[#18240E] data-[state=open]:bg-[#18240E] focus:text-[#DFFF62] data-[state=open]:text-[#DFFF62]">
											Date format
										</DropdownMenuSubTrigger>
										<DropdownMenuSubContent className="border-[#1A1D22] bg-[#0B0F15] text-[#D6DBE2]">
											<DropdownMenuItem
												onClick={() => setDateFormat("iso")}
												className={`text-xs focus:bg-[#18240E] focus:text-[#DFFF62] ${dateFormat === "iso" ? "text-[#C8FF1A]" : ""}`}
											>
												YYYY-MM-DD
											</DropdownMenuItem>
											<DropdownMenuItem
												onClick={() => setDateFormat("us")}
												className={`text-xs focus:bg-[#18240E] focus:text-[#DFFF62] ${dateFormat === "us" ? "text-[#C8FF1A]" : ""}`}
											>
												MM/DD/YYYY
											</DropdownMenuItem>
										</DropdownMenuSubContent>
									</DropdownMenuSub>
									<DropdownMenuSub>
										<DropdownMenuSubTrigger className="text-xs focus:bg-[#18240E] data-[state=open]:bg-[#18240E] focus:text-[#DFFF62] data-[state=open]:text-[#DFFF62]">
											Payment terms
										</DropdownMenuSubTrigger>
										<DropdownMenuSubContent className="border-[#1A1D22] bg-[#0B0F15] text-[#D6DBE2]">
											{[7, 14, 30].map((days) => (
												<DropdownMenuItem
													key={days}
													onClick={() => updatePaymentTerms(days)}
													className={`text-xs focus:bg-[#18240E] focus:text-[#DFFF62] ${paymentTermDays === days ? "text-[#C8FF1A]" : ""}`}
												>
													Net {days}
												</DropdownMenuItem>
											))}
										</DropdownMenuSubContent>
									</DropdownMenuSub>
								</DropdownMenuContent>
							</DropdownMenu>
							<button
								type="button"
								className="inline-flex h-9 items-center gap-2 border border-[#1A1D22] bg-[#0D1118] px-4 text-sm text-[#D0D6DE]"
							>
								{`Default • ${invoiceSize}`}{" "}
								<ChevronDown className="h-3.5 w-3.5" />
							</button>
						</div>
						<div className="flex items-center gap-2">
							<Button
								type="button"
								variant="ghost"
								onClick={() => {
									if (!lastCreatedToken) {
										toast({
											title: "Create invoice first",
											description:
												"Create the invoice to open its public preview link.",
										});
										return;
									}
									window.open(
										`/i/${lastCreatedToken}`,
										"_blank",
										"noopener,noreferrer",
									);
								}}
								className="h-9 w-9 border border-[#1A1D22] bg-[#0D1118] text-[#9AA2AF]"
							>
								<ExternalLink className="h-4 w-4" />
							</Button>
							{isSheetMode ? (
								<Button
									type="button"
									variant="ghost"
									onClick={onCancel}
									className="h-9 border border-[#1A1D22] bg-[#0D1118] px-4 text-xs font-bold text-[#9AA2AF]"
								>
									Cancel
								</Button>
							) : null}
							<button
								type="button"
								disabled={!canSubmit}
								onClick={createInvoice}
								className="inline-flex h-9 items-center border border-[#2A351A] bg-[#C8FF1A]/30 px-5 text-xs font-bold uppercase tracking-[0.08em] text-[#D7FF58] transition-colors hover:bg-[#C8FF1A]/45 disabled:cursor-not-allowed disabled:opacity-40"
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
							<button
								type="button"
								className="inline-flex h-9 items-center border border-[#1A1D22] bg-[#0D1118] px-2 text-[#9AA2AF]"
							>
								<ChevronDown className="h-3.5 w-3.5" />
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
