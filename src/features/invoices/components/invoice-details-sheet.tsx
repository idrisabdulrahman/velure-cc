import { useQuery } from "convex/react";
import {
	ArrowDownToLine,
	CalendarClock,
	CheckCircle2,
	Copy,
	ExternalLink,
	FileText,
	Loader2,
	Plus,
	Send,
	Share2,
	X,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { FaTelegram, FaWhatsapp } from "react-icons/fa6";
import { Button } from "#/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { Input } from "#/components/ui/input";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "#/components/ui/sheet";
import { toast } from "#/components/ui/use-toast";
import { calculateInvoiceCompliance } from "#/features/compliance/calculate";
import {
	defaultTaxTreatmentForSellerTaxStatus,
	defaultWithholdingSelection,
	legacyWithholdingSelectionFromPreset,
	NIGERIA_FOREIGN_CURRENCY_WARNING,
	NIGERIA_TAX_RULE_SET_VERSION,
	SELLER_TAX_STATUS_OPTIONS,
	WITHHOLDING_CATEGORY_OPTIONS,
	WITHHOLDING_ENTITY_TYPE_OPTIONS,
	WITHHOLDING_RESIDENCY_OPTIONS,
} from "#/features/compliance/nigeria";
import {
	type ComplianceWarningCode,
	JURISDICTION_OPTIONS,
	type JurisdictionCode,
	type SellerTaxStatus,
	TAX_TREATMENT_OPTIONS,
	type TaxTreatment,
	type WithholdingCategory,
	type WithholdingRecipientEntityType,
	type WithholdingRecipientResidency,
} from "#/features/compliance/types";
import { invoiceTotal } from "#/features/invoices/calculate";
import { formatInvoiceDate, formatMoney } from "#/features/invoices/format";
import type { InvoiceLineItem, InvoiceRecord } from "#/features/invoices/types";
import { api } from "../../../../convex/_generated/api";

type Props = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	invoice: InvoiceRecord | null | undefined;
	onSave: (invoice: InvoiceRecord) => Promise<void> | void;
	onStatusChange?: (
		id: string,
		status: InvoiceRecord["status"],
		details?: { paidAt?: number; paymentReference?: string },
	) => Promise<void> | void;
};

const PERSISTABLE_WARNING_CODES = new Set<ComplianceWarningCode>([
	"missing_seller_tax_id",
	"missing_buyer_tax_id",
	"cross_border_review",
	"reverse_charge_review",
	"unknown_jurisdiction",
	"domestic_vat_not_applied",
	"missing_workspace_tax_status",
]);
const NGN_PER_CURRENCY = {
	NGN: 1,
	USD: 1500,
	GBP: 1900,
} as const;
type SupportedCurrency = keyof typeof NGN_PER_CURRENCY;

function isSupportedCurrency(value: string): value is SupportedCurrency {
	return value === "NGN" || value === "USD" || value === "GBP";
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

function formatDate(value: string) {
	return formatInvoiceDate(value, "ng");
}

function shareLinks(invoice: InvoiceRecord) {
	const origin = typeof window !== "undefined" ? window.location.origin : "";
	const publicUrl = `${origin}/i/${invoice.token}`;
	const text = `Invoice ${invoice.invoiceNumber} for ${invoice.customerName}`;

	const telegramHref = `https://t.me/share/url?url=${encodeURIComponent(publicUrl)}&text=${encodeURIComponent(text)}`;
	const whatsappHref = `https://wa.me/?text=${encodeURIComponent(`${text} ${publicUrl}`)}`;

	return { publicUrl, telegramHref, whatsappHref };
}

function serializeInvoiceDraft(invoice: InvoiceRecord) {
	return JSON.stringify({
		id: invoice.id,
		token: invoice.token,
		invoiceNumber: invoice.invoiceNumber,
		customerName: invoice.customerName,
		logoUrl: invoice.logoUrl,
		currency: invoice.currency,
		type: invoice.type,
		invoiceSize: invoice.invoiceSize,
		dateFormat: invoice.dateFormat,
		paymentTermsDays: invoice.paymentTermsDays,
		template: invoice.template,
		issueDate: invoice.issueDate,
		dueDate: invoice.dueDate,
		status: invoice.status,
		paymentDetails: invoice.paymentDetails,
		paymentLink: invoice.paymentLink,
		paymentProvider: invoice.paymentProvider,
		paidAt: invoice.paidAt,
		paymentReference: invoice.paymentReference,
		notes: invoice.notes,
		lineItems: invoice.lineItems,
		compliance: invoice.compliance,
	});
}

function withPersistableCompliance(invoice: InvoiceRecord): InvoiceRecord {
	if (!invoice.compliance) return invoice;
	const {
		netPayable: _netPayable,
		sellerTaxStatus: _sellerTaxStatus,
		...persistableCompliance
	} = invoice.compliance;
	return {
		...invoice,
		compliance: {
			...persistableCompliance,
			warnings: invoice.compliance.warnings.filter((warning) =>
				PERSISTABLE_WARNING_CODES.has(warning),
			),
		} as InvoiceRecord["compliance"],
	};
}

function netPayableFromCompliance(
	compliance: NonNullable<InvoiceRecord["compliance"]>,
) {
	return compliance.grandTotal - (compliance.withholdingTaxAmount ?? 0);
}

function withDerivedCompliance(invoice: InvoiceRecord): InvoiceRecord {
	const existingCompliance = invoice.compliance;
	const seller = {
		...existingCompliance?.seller,
		legalName:
			existingCompliance?.seller?.legalName ||
			existingCompliance?.seller?.tradingName ||
			"Velure Workspace",
		tradingName:
			existingCompliance?.seller?.tradingName ??
			existingCompliance?.seller?.legalName ??
			"Velure Workspace",
		countryCode: (existingCompliance?.seller?.countryCode ??
			"NG") as JurisdictionCode,
	};
	const buyer = {
		...existingCompliance?.buyer,
		legalName:
			existingCompliance?.buyer?.legalName || invoice.customerName || "Client",
		countryCode: (existingCompliance?.buyer?.countryCode ??
			"NG") as JurisdictionCode,
	};
	const withholding =
		existingCompliance?.withholding ??
		(existingCompliance?.withholdingTaxPreset
			? legacyWithholdingSelectionFromPreset(
					existingCompliance.withholdingTaxPreset,
				)
			: defaultWithholdingSelection());
	const compliance = calculateInvoiceCompliance({
		seller,
		buyer,
		sellerTaxStatus: (existingCompliance?.sellerTaxStatus ??
			"vat_registered") as SellerTaxStatus,
		placeOfSupply: (existingCompliance?.placeOfSupply ??
			buyer.countryCode ??
			"NG") as JurisdictionCode,
		currency: invoice.currency,
		taxRuleSetVersion:
			existingCompliance?.taxRuleSetVersion ?? NIGERIA_TAX_RULE_SET_VERSION,
		taxTreatment: (existingCompliance?.taxTreatment ??
			defaultTaxTreatmentForSellerTaxStatus(
				(existingCompliance?.sellerTaxStatus ??
					"vat_registered") as SellerTaxStatus,
			)) as TaxTreatment,
		taxRate: existingCompliance?.taxRate,
		taxLabel: existingCompliance?.taxLabel,
		withholding,
		withholdingTaxPreset: existingCompliance?.withholdingTaxPreset,
		lineItems: invoice.lineItems,
	});

	return {
		...invoice,
		compliance: {
			...compliance,
			seller,
			buyer,
		},
	};
}

function NumberStepperInput({
	value,
	disabled,
	min,
	step,
	onChange,
}: {
	value: number;
	disabled: boolean;
	min: number;
	step: number;
	onChange: (value: number) => void;
}) {
	const apply = (next: number) => {
		const rounded = step < 1 ? Math.round(next * 100) / 100 : Math.round(next);
		onChange(Math.max(min, rounded));
	};

	return (
		<div className="flex h-10 items-center overflow-hidden rounded-md border border-[#2b2d30] bg-[#17191b]">
			<button
				type="button"
				disabled={disabled}
				onClick={() => apply(value - step)}
				className="inline-flex h-full w-10 items-center justify-center border-r border-[#2b2d30] text-[#9c968a] transition-colors hover:bg-[#20241e] hover:text-[#ece7de] disabled:cursor-not-allowed disabled:opacity-40"
				aria-label="Decrease value"
			>
				-
			</button>
			<input
				disabled={disabled}
				type="number"
				min={min}
				step={step}
				value={value}
				onChange={(event) => apply(Number(event.target.value) || min)}
				className="h-full w-full border-0 bg-transparent px-3 text-center text-sm text-[#ece7de] [appearance:textfield] outline-none [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
			/>
			<button
				type="button"
				disabled={disabled}
				onClick={() => apply(value + step)}
				className="inline-flex h-full w-10 items-center justify-center border-l border-[#2b2d30] text-[#9c968a] transition-colors hover:bg-[#20241e] hover:text-[#ece7de] disabled:cursor-not-allowed disabled:opacity-40"
				aria-label="Increase value"
			>
				+
			</button>
		</div>
	);
}

function Section({
	title,
	subtitle,
	children,
}: {
	title: string;
	subtitle?: string;
	children: ReactNode;
}) {
	return (
		<section className="rounded-md border border-[#2b2d30] bg-[#17191b]">
			<div className="border-b border-[#2b2d30] px-5 py-4">
				<h3 className="text-sm font-medium text-[#ece7de]">{title}</h3>
				{subtitle ? (
					<p className="mt-1 text-sm text-[#9c968a]">{subtitle}</p>
				) : null}
			</div>
			<div className="px-5 py-5">{children}</div>
		</section>
	);
}

function FieldLabel({ children }: { children: ReactNode }) {
	return (
		<div className="mb-2 block text-xs font-medium text-[#9c968a]">
			{children}
		</div>
	);
}

function CompactMetric({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-md border border-[#2b2d30] bg-[#111315] px-3 py-3">
			<div className="text-xs text-[#7f7a72]">{label}</div>
			<div className="mt-2 text-base font-medium text-[#ece7de]">{value}</div>
		</div>
	);
}

export function InvoiceDetailsSheet({
	open,
	onOpenChange,
	invoice,
	onSave,
	onStatusChange,
}: Props) {
	const workspace = useQuery(api.compliance.getWorkspaceSettings, {});
	const [draft, setDraft] = useState<InvoiceRecord | null>(
		invoice ? withDerivedCompliance(invoice) : null,
	);
	const [editing, setEditing] = useState(true);
	const [saving, setSaving] = useState(false);
	const [savePillState, setSavePillState] = useState<
		"idle" | "saved" | "error"
	>("idle");
	const [recipientEmail, setRecipientEmail] = useState("");
	const [paymentReference, setPaymentReference] = useState("");
	const [isSendingEmail, setIsSendingEmail] = useState(false);
	const [emailStatus, setEmailStatus] = useState<string | null>(null);
	const [showCompliance, setShowCompliance] = useState(false);
	const [showPayment, setShowPayment] = useState(false);
	const [showNotes, setShowNotes] = useState(false);
	const lastSavedSnapshotRef = useRef("");
	const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const savePillTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lineItemsScrollRef = useRef<HTMLDivElement | null>(null);
	const pendingLineInputRef = useRef<HTMLInputElement | null>(null);
	const [pendingFocusLineId, setPendingFocusLineId] = useState<string | null>(
		null,
	);

	useEffect(() => {
		const normalizedInvoice = invoice ? withDerivedCompliance(invoice) : null;
		setDraft(normalizedInvoice);
		setEditing(Boolean(invoice));
		setSaving(false);
		setEmailStatus(null);
		setRecipientEmail(normalizedInvoice?.compliance?.buyer?.email ?? "");
		setPaymentReference(normalizedInvoice?.paymentReference ?? "");
		setShowCompliance(false);
		setShowPayment(
			Boolean(
				normalizedInvoice?.paymentLink || normalizedInvoice?.paymentReference,
			),
		);
		setShowNotes(
			Boolean(normalizedInvoice?.notes || normalizedInvoice?.paymentDetails),
		);
		lastSavedSnapshotRef.current = normalizedInvoice
			? serializeInvoiceDraft(normalizedInvoice)
			: "";
	}, [invoice]);

	useEffect(() => {
		if (!workspace) return;
		setDraft((prev) => {
			if (!prev || prev.compliance?.sellerTaxStatus) return prev;
			return withDerivedCompliance({
				...prev,
				compliance: prev.compliance
					? {
							...prev.compliance,
							sellerTaxStatus:
								(workspace.sellerTaxStatus as SellerTaxStatus | undefined) ??
								"vat_registered",
							taxRuleSetVersion:
								workspace.taxRuleSetVersion ?? NIGERIA_TAX_RULE_SET_VERSION,
						}
					: prev.compliance,
			});
		});
	}, [workspace]);

	useEffect(() => {
		return () => {
			if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
			if (savePillTimeoutRef.current) clearTimeout(savePillTimeoutRef.current);
		};
	}, []);

	const showSavePill = (state: "saved" | "error") => {
		if (savePillTimeoutRef.current) clearTimeout(savePillTimeoutRef.current);
		setSavePillState(state);
		savePillTimeoutRef.current = setTimeout(() => {
			setSavePillState("idle");
		}, 1400);
	};

	const persistDraft = async (nextDraft: InvoiceRecord) => {
		const snapshot = serializeInvoiceDraft(nextDraft);
		if (snapshot === lastSavedSnapshotRef.current) {
			return;
		}

		setSaving(true);
		try {
			await Promise.resolve(onSave(withPersistableCompliance(nextDraft)));
			lastSavedSnapshotRef.current = snapshot;
			showSavePill("saved");
		} catch (error) {
			showSavePill("error");
			toast({
				title: "Could not save invoice",
				description: error instanceof Error ? error.message : "Unknown error",
				variant: "error",
			});
			throw error;
		} finally {
			setSaving(false);
		}
	};

	useEffect(() => {
		if (!editing || !draft) return;

		const snapshot = serializeInvoiceDraft(draft);
		if (snapshot === lastSavedSnapshotRef.current) return;

		if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
		autosaveTimeoutRef.current = setTimeout(() => {
			setSaving(true);
			void Promise.resolve(onSave(withPersistableCompliance(draft)))
				.then(() => {
					lastSavedSnapshotRef.current = snapshot;
					showSavePill("saved");
				})
				.catch((error: unknown) => {
					showSavePill("error");
					toast({
						title: "Could not save invoice",
						description:
							error instanceof Error ? error.message : "Unknown error",
						variant: "error",
					});
				})
				.finally(() => {
					setSaving(false);
				});
		}, 700);

		return () => {
			if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
		};
	}, [draft, editing, onSave]);

	const updateLine = (
		id: string,
		patch: Partial<Pick<InvoiceLineItem, "name" | "quantity" | "price">>,
	) => {
		setDraft((prev) => {
			if (!prev) return prev;
			return withDerivedCompliance({
				...prev,
				lineItems: prev.lineItems.map((item) =>
					item.id === id ? { ...item, ...patch } : item,
				),
			});
		});
	};

	const addLineItem = () => {
		const nextId = `li-${crypto.randomUUID()}`;
		setDraft((prev) => {
			if (!prev) return prev;
			return withDerivedCompliance({
				...prev,
				lineItems: [
					...prev.lineItems,
					{
						id: nextId,
						name: "",
						quantity: 1,
						price: 0,
					},
				],
			});
		});
		setPendingFocusLineId(nextId);
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
	}, [pendingFocusLineId, draft?.lineItems.length]);

	const removeLineItem = (id: string) => {
		setDraft((prev) => {
			if (!prev) return prev;
			if (prev.lineItems.length === 1) {
				return withDerivedCompliance({
					...prev,
					lineItems: [
						{
							id: `li-${crypto.randomUUID()}`,
							name: "",
							quantity: 1,
							price: 0,
						},
					],
				});
			}
			return withDerivedCompliance({
				...prev,
				lineItems: prev.lineItems.filter((item) => item.id !== id),
			});
		});
	};

	const updateCurrency = (nextCurrency: string) => {
		const normalized = nextCurrency.toUpperCase();
		patchDraft((prev) => {
			const currentCurrency = prev.currency.trim().toUpperCase();
			if (
				!isSupportedCurrency(currentCurrency) ||
				!isSupportedCurrency(normalized)
			) {
				return { ...prev, currency: normalized };
			}
			if (currentCurrency === normalized) return prev;
			return {
				...prev,
				currency: normalized,
				template:
					normalized !== "NGN" && prev.template === "Default"
						? "Cross-border"
						: prev.template,
				lineItems: prev.lineItems.map((item) => ({
					...item,
					price: convertAmount(item.price, currentCurrency, normalized),
				})),
			};
		});
	};

	const patchDraft = (apply: (current: InvoiceRecord) => InvoiceRecord) => {
		setDraft((prev) => (prev ? withDerivedCompliance(apply(prev)) : prev));
	};

	const onSaveDraft = async () => {
		if (!draft) return;
		if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
		try {
			await persistDraft(draft);
		} catch {
			return;
		}
	};

	const onResetDraft = () => {
		if (!invoice) return;
		if (autosaveTimeoutRef.current) clearTimeout(autosaveTimeoutRef.current);
		const normalizedInvoice = withDerivedCompliance(invoice);
		setDraft(normalizedInvoice);
		setRecipientEmail(normalizedInvoice.compliance?.buyer?.email ?? "");
		setPaymentReference(normalizedInvoice.paymentReference ?? "");
		lastSavedSnapshotRef.current = serializeInvoiceDraft(normalizedInvoice);
		setSavePillState("idle");
	};

	const onSendEmail = async () => {
		if (!draft) return;
		const to = recipientEmail.trim().toLowerCase();
		if (!/^\S+@\S+\.\S+$/.test(to)) {
			setEmailStatus("Enter a valid email address.");
			return;
		}

		setIsSendingEmail(true);
		setEmailStatus(null);

		try {
			const response = await fetch(
				`/api/invoice/send/${encodeURIComponent(draft.id)}`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ to }),
				},
			);

			const payload = (await response.json()) as {
				ok?: boolean;
				error?: string;
			};
			if (!response.ok || !payload.ok) {
				setEmailStatus(payload.error ?? "Failed to send invoice email.");
				return;
			}

			setEmailStatus("Invoice email sent.");
		} catch {
			setEmailStatus("Failed to send invoice email.");
		} finally {
			setIsSendingEmail(false);
		}
	};

	const activityItems = draft
		? [
				{
					id: "issued",
					label: "Invoice issued",
					meta: formatDate(draft.issueDate),
					description: `Created as ${draft.status.toUpperCase()}.`,
					icon: FileText,
				},
				{
					id: "due",
					label: "Payment due",
					meta: formatDate(draft.dueDate),
					description: "Expected settlement date for this invoice.",
					icon: CalendarClock,
				},
				{
					id: "status",
					label: "Current status",
					meta: draft.status.toUpperCase(),
					description: "Latest workflow state applied to this invoice.",
					icon: CheckCircle2,
				},
			]
		: [];

	return (
		<>
			<Sheet open={open} onOpenChange={onOpenChange}>
				<SheetContent
					side="right"
					contentClassName="w-full sm:max-w-[820px] p-0"
					className="flex h-full min-h-0 flex-col border-[#2b2d30] bg-[#111315] p-0 text-[#ece7de]"
					title={draft ? `Edit ${draft.invoiceNumber}` : "Edit invoice"}
				>
					{draft ? (
						<>
							<div className="border-b border-[#2b2d30] px-6 py-5">
								<SheetHeader className="space-y-0 text-left">
									<div className="flex items-start justify-between gap-6">
										<div>
											<SheetTitle className="text-[28px] font-semibold tracking-[-0.03em] text-[#ece7de]">
												{draft.invoiceNumber}
											</SheetTitle>
											<SheetDescription className="mt-2 text-sm text-[#9c968a]">
												Edit the live invoice without leaving the list view.
											</SheetDescription>
										</div>
										<div className="grid gap-1 text-right text-sm text-[#9c968a]">
											<div>
												<span className="text-[#7f7a72]">Customer:</span>{" "}
												<span className="text-[#ece7de]">
													{draft.customerName || "Unassigned"}
												</span>
											</div>
											<div>
												<span className="text-[#7f7a72]">Amount:</span>{" "}
												<span className="text-[#ece7de]">
													{formatMoney(invoiceTotal(draft), draft.currency)}
												</span>
											</div>
										</div>
									</div>
								</SheetHeader>
							</div>

							<div className="flex-1 overflow-y-auto px-6 py-6">
								<div className="space-y-6">
									<Section
										title="Invoice details"
										subtitle="Core billing information and dates."
									>
										<div className="mb-5 grid gap-3 md:grid-cols-4">
											<CompactMetric
												label="Issue date"
												value={formatDate(draft.issueDate)}
											/>
											<CompactMetric
												label="Due date"
												value={formatDate(draft.dueDate)}
											/>
											<CompactMetric
												label="Status"
												value={draft.status.toUpperCase()}
											/>
											<CompactMetric
												label="Total"
												value={formatMoney(invoiceTotal(draft), draft.currency)}
											/>
										</div>

										<div className="grid gap-4 md:grid-cols-2">
											<div>
												<FieldLabel>Invoice number</FieldLabel>
												<Input
													value={draft.invoiceNumber}
													onChange={(event) =>
														patchDraft((prev) => ({
															...prev,
															invoiceNumber: event.target.value.toUpperCase(),
														}))
													}
													className="h-10 rounded-md border-[#2b2d30] bg-[#111315] text-[#ece7de]"
												/>
											</div>
											<div>
												<FieldLabel>Customer name</FieldLabel>
												<Input
													value={draft.customerName}
													onChange={(event) =>
														patchDraft((prev) => ({
															...prev,
															customerName: event.target.value,
															compliance: prev.compliance
																? {
																		...prev.compliance,
																		buyer: {
																			...prev.compliance.buyer,
																			legalName: event.target.value,
																		},
																	}
																: prev.compliance,
														}))
													}
													className="h-10 rounded-md border-[#2b2d30] bg-[#111315] text-[#ece7de]"
												/>
											</div>
											<div>
												<FieldLabel>Issue date</FieldLabel>
												<Input
													type="date"
													value={draft.issueDate}
													onChange={(event) =>
														patchDraft((prev) => ({
															...prev,
															issueDate: event.target.value,
														}))
													}
													className="h-10 rounded-md border-[#2b2d30] bg-[#111315] text-[#ece7de]"
												/>
											</div>
											<div>
												<FieldLabel>Due date</FieldLabel>
												<Input
													type="date"
													value={draft.dueDate}
													onChange={(event) =>
														patchDraft((prev) => ({
															...prev,
															dueDate: event.target.value,
														}))
													}
													className="h-10 rounded-md border-[#2b2d30] bg-[#111315] text-[#ece7de]"
												/>
											</div>
											<div>
												<FieldLabel>Currency</FieldLabel>
												<select
													value={draft.currency}
													onChange={(event) =>
														updateCurrency(event.target.value)
													}
													className="h-10 w-full rounded-md border border-[#2b2d30] bg-[#111315] px-3 text-sm text-[#ece7de] outline-none"
												>
													{Object.keys(NGN_PER_CURRENCY).map((option) => (
														<option key={option} value={option}>
															{option}
														</option>
													))}
												</select>
											</div>
											<div>
												<FieldLabel>Template</FieldLabel>
												<Input
													value={draft.template}
													onChange={(event) =>
														patchDraft((prev) => ({
															...prev,
															template: event.target.value,
														}))
													}
													className="h-10 rounded-md border-[#2b2d30] bg-[#111315] text-[#ece7de]"
												/>
											</div>
										</div>
									</Section>

									<Section
										title="Nigeria compliance"
										subtitle="Keep TIN, VAT, WHT, and settlement guidance aligned with the live invoice."
									>
										{!showCompliance ? (
											<Button
												type="button"
												variant="ghost"
												onClick={() => setShowCompliance(true)}
												className="h-9 rounded-md border border-[#2b2d30] bg-[#111315] px-4 text-sm text-[#d5d0c7] hover:bg-[#20241e] hover:text-[#ece7de]"
											>
												Review compliance settings
											</Button>
										) : (
											<>
												<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
													<div>
														<FieldLabel>Seller TIN</FieldLabel>
														<Input
															value={draft.compliance?.seller?.taxId ?? ""}
															onChange={(event) =>
																patchDraft((prev) => ({
																	...prev,
																	compliance: prev.compliance
																		? {
																				...prev.compliance,
																				seller: {
																					...prev.compliance.seller,
																					taxId: event.target.value,
																				},
																			}
																		: prev.compliance,
																}))
															}
															placeholder="10-digit TIN"
															className="h-10 rounded-md border-[#2b2d30] bg-[#111315] text-[#ece7de]"
														/>
													</div>
													<div>
														<FieldLabel>CAC RC Number</FieldLabel>
														<Input
															value={draft.compliance?.seller?.rcNumber ?? ""}
															onChange={(event) =>
																patchDraft((prev) => ({
																	...prev,
																	compliance: prev.compliance
																		? {
																				...prev.compliance,
																				seller: {
																					...prev.compliance.seller,
																					rcNumber:
																						event.target.value.toUpperCase(),
																				},
																			}
																		: prev.compliance,
																}))
															}
															placeholder="RC-1234567"
															className="h-10 rounded-md border-[#2b2d30] bg-[#111315] text-[#ece7de]"
														/>
													</div>
													<div>
														<FieldLabel>Buyer TIN</FieldLabel>
														<Input
															value={draft.compliance?.buyer?.taxId ?? ""}
															onChange={(event) =>
																patchDraft((prev) => ({
																	...prev,
																	compliance: prev.compliance
																		? {
																				...prev.compliance,
																				buyer: {
																					...prev.compliance.buyer,
																					taxId: event.target.value,
																				},
																			}
																		: prev.compliance,
																}))
															}
															placeholder="10-digit TIN"
															className="h-10 rounded-md border-[#2b2d30] bg-[#111315] text-[#ece7de]"
														/>
													</div>
													<div>
														<FieldLabel>Buyer email for reminders</FieldLabel>
														<Input
															value={draft.compliance?.buyer?.email ?? ""}
															onChange={(event) => {
																const value = event.target.value;
																setRecipientEmail(value);
																patchDraft((prev) => ({
																	...prev,
																	compliance: prev.compliance
																		? {
																				...prev.compliance,
																				buyer: {
																					...prev.compliance.buyer,
																					email: value,
																				},
																			}
																		: prev.compliance,
																}));
															}}
															placeholder="client@email.com"
															className="h-10 rounded-md border-[#2b2d30] bg-[#111315] text-[#ece7de]"
														/>
													</div>
													<div>
														<FieldLabel>Seller country</FieldLabel>
														<select
															value={
																draft.compliance?.seller?.countryCode ?? "NG"
															}
															onChange={(event) =>
																patchDraft((prev) => ({
																	...prev,
																	compliance: prev.compliance
																		? {
																				...prev.compliance,
																				seller: {
																					...prev.compliance.seller,
																					countryCode: event.target
																						.value as JurisdictionCode,
																				},
																			}
																		: prev.compliance,
																}))
															}
															className="h-10 w-full rounded-md border border-[#2b2d30] bg-[#111315] px-3 text-sm text-[#ece7de] outline-none"
														>
															{JURISDICTION_OPTIONS.map((option) => (
																<option key={option.value} value={option.value}>
																	{option.label}
																</option>
															))}
														</select>
													</div>
													<div>
														<FieldLabel>Buyer country</FieldLabel>
														<select
															value={
																draft.compliance?.buyer?.countryCode ?? "NG"
															}
															onChange={(event) =>
																patchDraft((prev) => ({
																	...prev,
																	compliance: prev.compliance
																		? {
																				...prev.compliance,
																				buyer: {
																					...prev.compliance.buyer,
																					countryCode: event.target
																						.value as JurisdictionCode,
																				},
																				placeOfSupply: (prev.compliance
																					.placeOfSupply ??
																					event.target
																						.value) as JurisdictionCode,
																			}
																		: prev.compliance,
																}))
															}
															className="h-10 w-full rounded-md border border-[#2b2d30] bg-[#111315] px-3 text-sm text-[#ece7de] outline-none"
														>
															{JURISDICTION_OPTIONS.map((option) => (
																<option key={option.value} value={option.value}>
																	{option.label}
																</option>
															))}
														</select>
													</div>
													<div>
														<FieldLabel>Seller tax status</FieldLabel>
														<select
															value={
																draft.compliance?.sellerTaxStatus ??
																"vat_registered"
															}
															onChange={(event) =>
																patchDraft((prev) => ({
																	...prev,
																	compliance: prev.compliance
																		? {
																				...prev.compliance,
																				sellerTaxStatus: event.target
																					.value as SellerTaxStatus,
																				taxRuleSetVersion:
																					prev.compliance.taxRuleSetVersion ??
																					NIGERIA_TAX_RULE_SET_VERSION,
																			}
																		: prev.compliance,
																}))
															}
															className="h-10 w-full rounded-md border border-[#2b2d30] bg-[#111315] px-3 text-sm text-[#ece7de] outline-none"
														>
															{SELLER_TAX_STATUS_OPTIONS.map((option) => (
																<option key={option.value} value={option.value}>
																	{option.label}
																</option>
															))}
														</select>
													</div>
													<div>
														<FieldLabel>Tax treatment</FieldLabel>
														<select
															value={draft.compliance?.taxTreatment ?? "none"}
															onChange={(event) =>
																patchDraft((prev) => ({
																	...prev,
																	compliance: prev.compliance
																		? {
																				...prev.compliance,
																				taxTreatment: event.target
																					.value as TaxTreatment,
																			}
																		: prev.compliance,
																}))
															}
															className="h-10 w-full rounded-md border border-[#2b2d30] bg-[#111315] px-3 text-sm text-[#ece7de] outline-none"
														>
															{TAX_TREATMENT_OPTIONS.map((option) => (
																<option key={option.value} value={option.value}>
																	{option.label}
																</option>
															))}
														</select>
													</div>
													<div>
														<FieldLabel>VAT rate %</FieldLabel>
														<Input
															type="number"
															min={0}
															step={0.5}
															value={draft.compliance?.taxRate ?? 0}
															onChange={(event) =>
																patchDraft((prev) => ({
																	...prev,
																	compliance: prev.compliance
																		? {
																				...prev.compliance,
																				taxRate:
																					Number(event.target.value) || 0,
																			}
																		: prev.compliance,
																}))
															}
															className="h-10 rounded-md border-[#2b2d30] bg-[#111315] text-[#ece7de]"
														/>
													</div>
													<div>
														<FieldLabel>WHT category</FieldLabel>
														<select
															value={
																draft.compliance?.withholding?.category ??
																"none"
															}
															onChange={(event) =>
																patchDraft((prev) => ({
																	...prev,
																	compliance: prev.compliance
																		? {
																				...prev.compliance,
																				withholding: {
																					...(prev.compliance.withholding ??
																						defaultWithholdingSelection()),
																					category: event.target
																						.value as WithholdingCategory,
																				},
																			}
																		: prev.compliance,
																}))
															}
															className="h-10 w-full rounded-md border border-[#2b2d30] bg-[#111315] px-3 text-sm text-[#ece7de] outline-none"
														>
															{WITHHOLDING_CATEGORY_OPTIONS.map((option) => (
																<option key={option.value} value={option.value}>
																	{option.label}
																</option>
															))}
														</select>
													</div>
													<div>
														<FieldLabel>WHT recipient type</FieldLabel>
														<select
															value={
																draft.compliance?.withholding
																	?.recipientEntityType ?? "corporate"
															}
															onChange={(event) =>
																patchDraft((prev) => ({
																	...prev,
																	compliance: prev.compliance
																		? {
																				...prev.compliance,
																				withholding: {
																					...(prev.compliance.withholding ??
																						defaultWithholdingSelection()),
																					recipientEntityType: event.target
																						.value as WithholdingRecipientEntityType,
																				},
																			}
																		: prev.compliance,
																}))
															}
															className="h-10 w-full rounded-md border border-[#2b2d30] bg-[#111315] px-3 text-sm text-[#ece7de] outline-none"
														>
															{WITHHOLDING_ENTITY_TYPE_OPTIONS.map((option) => (
																<option key={option.value} value={option.value}>
																	{option.label}
																</option>
															))}
														</select>
													</div>
													<div>
														<FieldLabel>WHT residency</FieldLabel>
														<select
															value={
																draft.compliance?.withholding
																	?.recipientResidency ?? "resident"
															}
															onChange={(event) =>
																patchDraft((prev) => ({
																	...prev,
																	compliance: prev.compliance
																		? {
																				...prev.compliance,
																				withholding: {
																					...(prev.compliance.withholding ??
																						defaultWithholdingSelection()),
																					recipientResidency: event.target
																						.value as WithholdingRecipientResidency,
																				},
																			}
																		: prev.compliance,
																}))
															}
															className="h-10 w-full rounded-md border border-[#2b2d30] bg-[#111315] px-3 text-sm text-[#ece7de] outline-none"
														>
															{WITHHOLDING_RESIDENCY_OPTIONS.map((option) => (
																<option key={option.value} value={option.value}>
																	{option.label}
																</option>
															))}
														</select>
													</div>
												</div>

												<div className="mt-5 grid gap-3 md:grid-cols-4">
													<CompactMetric
														label="Subtotal"
														value={formatMoney(
															draft.compliance?.subtotal ?? 0,
															draft.currency,
														)}
													/>
													<CompactMetric
														label={`${draft.compliance?.taxLabel ?? "VAT"} (${draft.compliance?.taxRate ?? 0}%)`}
														value={formatMoney(
															draft.compliance?.totalTax ?? 0,
															draft.currency,
														)}
													/>
													<CompactMetric
														label={`${draft.compliance?.withholdingTaxLabel ?? "WHT"} (${draft.compliance?.withholdingTaxRate ?? 0}%)`}
														value={formatMoney(
															-(draft.compliance?.withholdingTaxAmount ?? 0),
															draft.currency,
														)}
													/>
													<CompactMetric
														label="Net amount payable"
														value={formatMoney(
															draft.compliance
																? netPayableFromCompliance(draft.compliance)
																: 0,
															draft.currency,
														)}
													/>
												</div>

												{draft.compliance?.regulatoryNotice ? (
													<div className="mt-4 rounded-md border border-[#5b4630] bg-[#261d15] px-4 py-3 text-sm text-[#efc58f]">
														{draft.compliance.regulatoryNotice}
													</div>
												) : null}

												{draft.compliance?.warnings.length ? (
													<div className="mt-4 flex flex-wrap gap-2">
														{draft.compliance.warnings.map((warning) => (
															<span
																key={warning}
																className="inline-flex rounded-full border border-[#5b4630] bg-[#261d15] px-2.5 py-1 text-[11px] text-[#efc58f]"
															>
																{warning.replaceAll("_", " ")}
															</span>
														))}
													</div>
												) : null}
											</>
										)}
									</Section>

									<Section
										title="Line items"
										subtitle="Update quantities, pricing, and descriptions."
									>
										<div
											ref={lineItemsScrollRef}
											className="max-h-[420px] space-y-3 overflow-y-auto pr-1"
										>
											<div className="hidden grid-cols-[minmax(0,1fr)_132px_132px_160px_44px] gap-3 px-1 text-xs font-medium text-[#9c968a] md:grid">
												<span>Description</span>
												<span>Quantity</span>
												<span>Unit price</span>
												<span className="text-right">Line total</span>
												<span />
											</div>

											{draft.lineItems.map((item) => (
												<div
													key={item.id}
													className="rounded-md border border-[#2b2d30] bg-[#111315] p-3 md:border-0 md:bg-transparent md:p-0"
												>
													<div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_132px_132px_160px_44px] md:items-center">
														<div>
															<div className="mb-2 text-[11px] text-[#7f7a72] md:hidden">
																Description
															</div>
															<Input
																ref={
																	item.id === pendingFocusLineId
																		? pendingLineInputRef
																		: undefined
																}
																value={item.name}
																onChange={(event) =>
																	updateLine(item.id, {
																		name: event.target.value,
																	})
																}
																placeholder="Item description"
																className="h-10 rounded-md border-[#2b2d30] bg-[#111315] text-[#ece7de]"
															/>
														</div>
														<div>
															<div className="mb-2 text-[11px] text-[#7f7a72] md:hidden">
																Quantity
															</div>
															<NumberStepperInput
																disabled={false}
																value={item.quantity}
																min={1}
																step={1}
																onChange={(quantity) =>
																	updateLine(item.id, { quantity })
																}
															/>
														</div>
														<div>
															<div className="mb-2 text-[11px] text-[#7f7a72] md:hidden">
																Unit price
															</div>
															<NumberStepperInput
																disabled={false}
																value={item.price}
																min={0}
																step={0.01}
																onChange={(price) =>
																	updateLine(item.id, { price })
																}
															/>
														</div>
														<div>
															<div className="mb-2 text-[11px] text-[#7f7a72] md:hidden">
																Line total
															</div>
															<div className="flex h-10 items-center justify-between rounded-md border border-[#2b2d30] bg-[#111315] px-3 text-sm font-medium text-[#ece7de] md:justify-end">
																<span className="md:hidden text-[#7f7a72]">
																	Total
																</span>
																<span className="text-right">
																	{formatMoney(
																		item.quantity * item.price,
																		draft.currency,
																	)}
																</span>
															</div>
														</div>
														<div className="flex items-end md:block">
															<button
																type="button"
																onClick={() => removeLineItem(item.id)}
																className="inline-flex h-10 w-11 items-center justify-center rounded-md border border-[#2b2d30] bg-[#111315] text-[#9c968a] transition-colors hover:bg-[#20241e] hover:text-[#ece7de]"
																aria-label="Remove line item"
															>
																<X className="h-4 w-4" />
															</button>
														</div>
													</div>
												</div>
											))}

											<div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#2b2d30] pt-3">
												<Button
													type="button"
													variant="ghost"
													onClick={addLineItem}
													className="h-10 rounded-md border border-[#2b2d30] bg-[#111315] px-4 text-sm text-[#d5d0c7] hover:bg-[#20241e] hover:text-[#ece7de]"
												>
													<Plus className="mr-2 h-4 w-4" />
													Add line item
												</Button>
												<div className="w-full max-w-[260px] space-y-2 rounded-md border border-[#2b2d30] bg-[#111315] px-4 py-3">
													<div className="flex items-center justify-between text-sm text-[#9c968a]">
														<span>Subtotal</span>
														<span className="text-[#ece7de]">
															{formatMoney(
																draft.compliance?.subtotal ?? 0,
																draft.currency,
															)}
														</span>
													</div>
													{(draft.compliance?.totalTax ?? 0) > 0 ? (
														<div className="flex items-center justify-between text-sm text-[#9c968a]">
															<span>
																{draft.compliance?.taxLabel ?? "VAT"} (
																{draft.compliance?.taxRate ?? 0}%)
															</span>
															<span className="text-[#ece7de]">
																{formatMoney(
																	draft.compliance?.totalTax ?? 0,
																	draft.currency,
																)}
															</span>
														</div>
													) : null}
													{(draft.compliance?.withholdingTaxAmount ?? 0) > 0 ? (
														<div className="flex items-center justify-between text-sm text-[#9c968a]">
															<span>
																{draft.compliance?.withholdingTaxLabel ?? "WHT"}{" "}
																({draft.compliance?.withholdingTaxRate ?? 0}%)
															</span>
															<span className="text-[#ece7de]">
																-
																{formatMoney(
																	draft.compliance?.withholdingTaxAmount ?? 0,
																	draft.currency,
																)}
															</span>
														</div>
													) : null}
													<div className="flex items-center justify-between border-t border-[#2b2d30] pt-2 text-sm">
														<span className="text-[#9c968a]">Net payable</span>
														<span className="text-lg font-semibold text-[#ece7de]">
															{formatMoney(invoiceTotal(draft), draft.currency)}
														</span>
													</div>
												</div>
											</div>
										</div>
									</Section>

									<div className="grid gap-6 lg:grid-cols-2">
										<Section title="Status">
											{onStatusChange ? (
												<DropdownMenu>
													<DropdownMenuTrigger asChild>
														<Button
															variant="ghost"
															className="h-10 w-full justify-between rounded-md border border-[#2b2d30] bg-[#111315] px-3 text-sm capitalize text-[#ece7de] hover:bg-[#20241e]"
														>
															{draft.status}
														</Button>
													</DropdownMenuTrigger>
													<DropdownMenuContent
														align="end"
														className="min-w-[220px] border-[#2b2d30] bg-[#17191b] p-1 text-[#ece7de]"
													>
														{[
															"draft",
															"unpaid",
															"paid",
															"overdue",
															"canceled",
															"scheduled",
														].map((status) => (
															<DropdownMenuItem
																key={status}
																onClick={async () => {
																	const paidAt =
																		status === "paid"
																			? (draft.paidAt ?? Date.now())
																			: undefined;
																	await onStatusChange(
																		draft.id,
																		status as InvoiceRecord["status"],
																		status === "paid"
																			? {
																					paidAt,
																					paymentReference:
																						paymentReference.trim() ||
																						undefined,
																				}
																			: undefined,
																	);
																	setDraft((prev) =>
																		prev
																			? {
																					...prev,
																					status:
																						status as InvoiceRecord["status"],
																					paidAt,
																					paymentReference:
																						status === "paid"
																							? paymentReference.trim() ||
																								prev.paymentReference
																							: prev.paymentReference,
																				}
																			: prev,
																	);
																}}
																className="capitalize focus:bg-[#20241e]"
															>
																{status}
															</DropdownMenuItem>
														))}
													</DropdownMenuContent>
												</DropdownMenu>
											) : (
												<div className="rounded-md border border-[#2b2d30] bg-[#111315] px-3 py-2 text-sm capitalize text-[#ece7de]">
													{draft.status}
												</div>
											)}
										</Section>

										<Section title="Share">
											<div className="space-y-3">
												<div>
													<FieldLabel>Recipient email</FieldLabel>
													<div className="flex gap-2">
														<Input
															value={recipientEmail}
															onChange={(event) =>
																setRecipientEmail(event.target.value)
															}
															type="email"
															placeholder="client@email.com"
															className="h-10 rounded-md border-[#2b2d30] bg-[#111315] text-[#ece7de]"
														/>
														<Button
															onClick={onSendEmail}
															disabled={isSendingEmail}
															variant="ghost"
															className="h-10 rounded-md border border-[#2b2d30] bg-[#111315] px-3 hover:bg-[#20241e]"
														>
															{isSendingEmail ? (
																<Loader2 className="h-4 w-4 animate-spin" />
															) : (
																<Send className="h-4 w-4" />
															)}
														</Button>
													</div>
													{emailStatus ? (
														<p className="mt-2 text-xs text-[#9c968a]">
															{emailStatus}
														</p>
													) : null}
												</div>

												<div className="flex flex-wrap gap-2">
													<a
														href={shareLinks(draft).telegramHref}
														target="_blank"
														rel="noreferrer"
														aria-label="Share on Telegram"
														className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#2b2d30] bg-[#111315] text-[#d5d0c7] transition-colors hover:bg-[#20241e] hover:text-[#ece7de]"
													>
														<FaTelegram className="h-4 w-4" />
													</a>
													<a
														href={shareLinks(draft).whatsappHref}
														target="_blank"
														rel="noreferrer"
														aria-label="Share on WhatsApp"
														className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#2b2d30] bg-[#111315] text-[#d5d0c7] transition-colors hover:bg-[#20241e] hover:text-[#ece7de]"
													>
														<FaWhatsapp className="h-4 w-4" />
													</a>
													<button
														type="button"
														onClick={async () => {
															const links = shareLinks(draft);
															if (navigator.share) {
																await navigator.share({
																	title: `Invoice ${draft.invoiceNumber}`,
																	text: `Invoice for ${draft.customerName}`,
																	url: links.publicUrl,
																});
																return;
															}
															await navigator.clipboard.writeText(
																links.publicUrl,
															);
														}}
														aria-label="Share link"
														className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#2b2d30] bg-[#111315] text-[#d5d0c7] transition-colors hover:bg-[#20241e] hover:text-[#ece7de]"
													>
														<Share2 className="h-4 w-4" />
													</button>
													<button
														type="button"
														onClick={() =>
															window.open(
																`/i/${draft.token}`,
																"_blank",
																"noopener,noreferrer",
															)
														}
														aria-label="Open invoice"
														className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#2b2d30] bg-[#111315] text-[#d5d0c7] transition-colors hover:bg-[#20241e] hover:text-[#ece7de]"
													>
														<ExternalLink className="h-4 w-4" />
													</button>
													<button
														type="button"
														onClick={() =>
															void navigator.clipboard.writeText(
																shareLinks(draft).publicUrl,
															)
														}
														aria-label="Copy link"
														className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#2b2d30] bg-[#111315] text-[#d5d0c7] transition-colors hover:bg-[#20241e] hover:text-[#ece7de]"
													>
														<Copy className="h-4 w-4" />
													</button>
													<a
														href={shareLinks(draft).publicUrl}
														target="_blank"
														rel="noreferrer"
														aria-label="Preview before download"
														className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#2b2d30] bg-[#111315] text-[#d5d0c7] transition-colors hover:bg-[#20241e] hover:text-[#ece7de]"
													>
														<ArrowDownToLine className="h-4 w-4" />
													</a>
												</div>
											</div>
										</Section>
									</div>

									<Section title="Payment">
										{!showPayment ? (
											<Button
												type="button"
												variant="ghost"
												onClick={() => setShowPayment(true)}
												className="h-9 rounded-md border border-[#2b2d30] bg-[#111315] px-4 text-sm text-[#d5d0c7] hover:bg-[#20241e] hover:text-[#ece7de]"
											>
												Add payment details
											</Button>
										) : (
											<div className="grid gap-4 md:grid-cols-2">
												<div>
													<FieldLabel>Payment link</FieldLabel>
													<Input
														value={draft.paymentLink ?? ""}
														onChange={(event) =>
															patchDraft((prev) => ({
																...prev,
																paymentLink: event.target.value,
																paymentProvider: event.target.value.trim()
																	? "manual"
																	: "paystack",
															}))
														}
														placeholder="https://paystack.com/pay/..."
														className="h-10 rounded-md border-[#2b2d30] bg-[#111315] text-[#ece7de]"
													/>
												</div>
												<div>
													<FieldLabel>Payment reference</FieldLabel>
													<Input
														value={paymentReference}
														onChange={(event) =>
															setPaymentReference(event.target.value)
														}
														placeholder="Transfer ref, Paystack ref, or receipt no."
														className="h-10 rounded-md border-[#2b2d30] bg-[#111315] text-[#ece7de]"
													/>
													<p className="mt-2 text-xs text-[#9c968a]">
														Select Paid in status after entering reference.
													</p>
												</div>
											</div>
										)}
									</Section>

									<Section
										title="Notes"
										subtitle="Use Bank Name, Account Name, and a 10-digit account number for Nigerian transfers."
									>
										{!showNotes ? (
											<Button
												type="button"
												variant="ghost"
												onClick={() => setShowNotes(true)}
												className="h-9 rounded-md border border-[#2b2d30] bg-[#111315] px-4 text-sm text-[#d5d0c7] hover:bg-[#20241e] hover:text-[#ece7de]"
											>
												Add notes & payment instructions
											</Button>
										) : (
											<div className="grid gap-4 md:grid-cols-2">
												<div>
													<FieldLabel>Payment details</FieldLabel>
													<textarea
														value={draft.paymentDetails ?? ""}
														onChange={(event) =>
															patchDraft((prev) => ({
																...prev,
																paymentDetails: event.target.value,
															}))
														}
														className="min-h-32 w-full rounded-md border border-[#2b2d30] bg-[#111315] px-3 py-2 text-sm text-[#ece7de] outline-none placeholder:text-[#7f7a72]"
														placeholder={
															"Bank Name: Zenith Bank\nAccount Name: Velure Studio\nAccount Number: 0123456789"
														}
													/>
													{draft.currency.trim().toUpperCase() !== "NGN" ? (
														<p className="mt-2 text-xs text-[#efc58f]">
															{NIGERIA_FOREIGN_CURRENCY_WARNING}
														</p>
													) : null}
												</div>
												<div>
													<FieldLabel>Internal note</FieldLabel>
													<textarea
														value={draft.notes ?? ""}
														onChange={(event) =>
															patchDraft((prev) => ({
																...prev,
																notes: event.target.value,
															}))
														}
														className="min-h-32 w-full rounded-md border border-[#2b2d30] bg-[#111315] px-3 py-2 text-sm text-[#ece7de] outline-none placeholder:text-[#7f7a72]"
														placeholder="Private context for the team"
													/>
												</div>
											</div>
										)}
									</Section>

									<Section title="Activity">
										<div className="space-y-3">
											{activityItems.map((item) => {
												const Icon = item.icon;
												return (
													<div
														key={item.id}
														className="rounded-md border border-[#2b2d30] bg-[#111315] px-3 py-3"
													>
														<div className="flex items-start justify-between gap-3">
															<div className="flex items-start gap-3">
																<div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md border border-[#3a4330] bg-[#20241e] text-[#b7ca7c]">
																	<Icon className="h-4 w-4" />
																</div>
																<div>
																	<p className="text-sm font-medium text-[#ece7de]">
																		{item.label}
																	</p>
																	<p className="mt-1 text-xs text-[#9c968a]">
																		{item.description}
																	</p>
																</div>
															</div>
															<p className="text-xs text-[#7f7a72]">
																{item.meta}
															</p>
														</div>
													</div>
												);
											})}
										</div>
									</Section>
								</div>
							</div>

							<div className="shrink-0 border-t border-[#2b2d30] bg-[#15171a] px-6 py-4">
								<div className="flex items-center justify-between gap-4">
									<div className="text-sm text-[#9c968a]">
										{saving
											? "Saving changes..."
											: "Changes autosave while you edit."}
									</div>
									<div className="flex items-center gap-3">
										<Button
											type="button"
											variant="ghost"
											onClick={onResetDraft}
											className="h-10 rounded-md border border-[#2b2d30] bg-[#111315] px-4 text-sm text-[#d5d0c7] hover:bg-[#20241e] hover:text-[#ece7de]"
										>
											Reset
										</Button>
										<Button
											type="button"
											onClick={onSaveDraft}
											disabled={saving}
											className="h-10 rounded-md bg-[#a7bc62] px-4 text-sm font-medium text-[#121314] hover:bg-[#b5c97a]"
										>
											{saving ? (
												<>
													<Loader2 className="mr-2 h-4 w-4 animate-spin" />
													Saving
												</>
											) : (
												"Save invoice"
											)}
										</Button>
									</div>
								</div>
							</div>
						</>
					) : (
						<div className="px-6 py-8 text-sm text-[#9c968a]">
							Loading invoice details...
						</div>
					)}
				</SheetContent>
			</Sheet>
			{savePillState !== "idle" ? (
				<div className="pointer-events-none fixed bottom-6 left-1/2 z-[110] -translate-x-1/2">
					<div
						className={`inline-flex items-center rounded-md border px-3 py-1.5 text-[12px] font-medium shadow-[0_14px_30px_rgba(0,0,0,0.35)] ${
							savePillState === "saved"
								? "border-[#425033] bg-[#1e2418] text-[#d8e3b4]"
								: "border-[#6b3f3f] bg-[#2c1b1b] text-[#efb1b1]"
						}`}
					>
						{savePillState === "saved" ? "Saved" : "Could not save"}
					</div>
				</div>
			) : null}
		</>
	);
}
