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
	onRecordPayment?: (
		id: string,
		amount: number,
		reference?: string,
	) => Promise<void> | void;
};

const AUTOSAVE_DEBOUNCE_MS = 1600;

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

async function readSendEmailPayload(response: Response) {
	const body = await response.text();
	if (!body) return {};

	try {
		return JSON.parse(body) as { ok?: boolean; error?: string };
	} catch {
		const message = body
			.replace(/<[^>]*>/g, " ")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 240);
		return { error: message || undefined };
	}
}

function serializeInvoiceDraft(invoice: InvoiceRecord) {
	return JSON.stringify({
		id: invoice.id,
		token: invoice.token,
		documentType: invoice.documentType,
		convertedToInvoiceId: invoice.convertedToInvoiceId,
		shipmentDetails: invoice.shipmentDetails,
		depositRequest: invoice.depositRequest,
		invoiceNumber: invoice.invoiceNumber,
		customerName: invoice.customerName,
		customerPoNumber: invoice.customerPoNumber,
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
		paidAt: invoice.paidAt,
		paymentReference: invoice.paymentReference,
		notes: invoice.notes,
		lineItems: invoice.lineItems,
		compliance: invoice.compliance,
	});
}

function withPersistableCompliance(invoice: InvoiceRecord): InvoiceRecord {
	const withoutManualPaymentLink: InvoiceRecord = {
		...invoice,
		paymentLink: undefined,
		paymentProvider:
			invoice.paymentProvider === "manual"
				? undefined
				: invoice.paymentProvider,
	};
	if (!invoice.compliance) return withoutManualPaymentLink;
	const {
		netPayable: _netPayable,
		sellerTaxStatus: _sellerTaxStatus,
		...persistableCompliance
	} = invoice.compliance;
	return {
		...withoutManualPaymentLink,
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
		<div className="flex h-10 items-center overflow-hidden rounded-md border border-[#30352f] bg-[#171a18]">
			<button
				type="button"
				disabled={disabled}
				onClick={() => apply(value - step)}
				className="inline-flex h-full w-10 items-center justify-center border-r border-[#30352f] text-[#9c968a] transition-colors hover:bg-[#1a2117] hover:text-[#f2efe7] disabled:cursor-not-allowed disabled:opacity-40"
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
				className="h-full w-full border-0 bg-transparent px-3 text-center text-sm text-[#f2efe7] [appearance:textfield] outline-none [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
			/>
			<button
				type="button"
				disabled={disabled}
				onClick={() => apply(value + step)}
				className="inline-flex h-full w-10 items-center justify-center border-l border-[#30352f] text-[#9c968a] transition-colors hover:bg-[#1a2117] hover:text-[#f2efe7] disabled:cursor-not-allowed disabled:opacity-40"
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
		<section className="ui-panel rounded-md border border-[#30352f] bg-[#171a18]">
			<div className="border-b border-[#30352f] px-5 py-4">
				<h3 className="text-sm font-medium text-[#f2efe7]">{title}</h3>
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
		<div className="rounded-md border border-[#30352f] bg-[#0f1111] px-3 py-3">
			<div className="text-xs text-[#817d72]">{label}</div>
			<div className="mt-2 text-base font-medium text-[#f2efe7]">{value}</div>
		</div>
	);
}

function SkeletonBlock({ className = "" }: { className?: string }) {
	return (
		<div
			className={`animate-pulse rounded-md bg-[#242923] shadow-[inset_0_0_0_1px_rgba(200,255,98,0.03)] ${className}`}
		/>
	);
}

function InvoiceDetailsSkeleton() {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="shrink-0 border-b border-[#30352f] bg-[#101211] px-6 py-5">
				<div className="flex items-start justify-between gap-6">
					<div className="min-w-0 flex-1">
						<SkeletonBlock className="h-8 w-56" />
						<SkeletonBlock className="mt-3 h-4 w-80 max-w-full" />
					</div>
					<div className="hidden w-44 space-y-2 sm:block">
						<SkeletonBlock className="h-4 w-full" />
						<SkeletonBlock className="h-4 w-32 ml-auto" />
					</div>
				</div>
			</div>

			<div className="flex-1 overflow-hidden px-6 py-6">
				<div className="space-y-6">
					<section className="ui-panel rounded-md border border-[#30352f] bg-[#171a18]">
						<div className="border-b border-[#30352f] px-5 py-4">
							<SkeletonBlock className="h-4 w-32" />
							<SkeletonBlock className="mt-2 h-3 w-52" />
						</div>
						<div className="px-5 py-5">
							<div className="grid gap-3 md:grid-cols-4">
								{["issue", "due", "status", "total"].map((item) => (
									<div
										key={item}
										className="rounded-md border border-[#30352f] bg-[#0f1111] px-3 py-3"
									>
										<SkeletonBlock className="h-3 w-16" />
										<SkeletonBlock className="mt-3 h-5 w-24" />
									</div>
								))}
							</div>
							<div className="mt-5 grid gap-4 md:grid-cols-2">
								{["number", "customer", "issue-date", "due-date"].map(
									(item) => (
										<div key={item}>
											<SkeletonBlock className="mb-2 h-3 w-20" />
											<SkeletonBlock className="h-10 w-full" />
										</div>
									),
								)}
							</div>
						</div>
					</section>

					<section className="ui-panel rounded-md border border-[#30352f] bg-[#171a18]">
						<div className="border-b border-[#30352f] px-5 py-4">
							<SkeletonBlock className="h-4 w-24" />
							<SkeletonBlock className="mt-2 h-3 w-64 max-w-full" />
						</div>
						<div className="space-y-3 px-5 py-5">
							{["line-1", "line-2", "line-3"].map((item) => (
								<div
									key={item}
									className="grid gap-3 rounded-md border border-[#30352f] bg-[#0f1111] p-3 md:grid-cols-[1fr_110px_120px_130px_44px]"
								>
									<SkeletonBlock className="h-10" />
									<SkeletonBlock className="h-10" />
									<SkeletonBlock className="h-10" />
									<SkeletonBlock className="h-10" />
									<SkeletonBlock className="h-10" />
								</div>
							))}
						</div>
					</section>
				</div>
			</div>

			<div className="shrink-0 border-t border-[#30352f] bg-[#15171a] px-6 py-4">
				<div className="flex items-center justify-between gap-4">
					<SkeletonBlock className="h-4 w-56" />
					<div className="flex gap-3">
						<SkeletonBlock className="h-10 w-20" />
						<SkeletonBlock className="h-10 w-28 bg-[#405126]" />
					</div>
				</div>
			</div>
		</div>
	);
}

export function InvoiceDetailsSheet({
	open,
	onOpenChange,
	invoice,
	onSave,
	onStatusChange,
	onRecordPayment,
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
		setShowPayment(Boolean(normalizedInvoice?.paymentReference));
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
			void persistDraft(draft).catch(() => undefined);
		}, AUTOSAVE_DEBOUNCE_MS);

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
					credentials: "include",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ to }),
				},
			);

			const payload = await readSendEmailPayload(response);
			if (!response.ok || !payload.ok) {
				setEmailStatus(
					payload.error ?? `Failed to send invoice email (${response.status}).`,
				);
				return;
			}

			setEmailStatus("Invoice email sent.");
		} catch (error) {
			setEmailStatus(
				error instanceof Error
					? error.message
					: "Failed to send invoice email.",
			);
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
				...(draft.lifecycle?.sentAt
					? [
							{
								id: "sent",
								label: "Invoice sent",
								meta: new Date(draft.lifecycle.sentAt).toLocaleDateString(),
								description: "Email delivered to recipient.",
								icon: Send,
							},
						]
					: []),
				...(draft.lifecycle?.firstViewedAt
					? [
							{
								id: "viewed",
								label: "First viewed",
								meta: new Date(
									draft.lifecycle.firstViewedAt,
								).toLocaleDateString(),
								description: "Recipient opened the invoice.",
								icon: ExternalLink,
							},
						]
					: []),
				{
					id: "due",
					label: "Payment due",
					meta: formatDate(draft.dueDate),
					description: "Expected settlement date for this invoice.",
					icon: CalendarClock,
				},
				...(draft.lifecycle?.paymentReceivedAt
					? [
							{
								id: "paid",
								label: "Payment received",
								meta: new Date(
									draft.lifecycle.paymentReceivedAt,
								).toLocaleDateString(),
								description: "Payment confirmed.",
								icon: CheckCircle2,
							},
						]
					: []),
				{
					id: "status",
					label: "Current status",
					meta:
						draft.status === "partially-paid"
							? "PARTIALLY PAID"
							: draft.status.toUpperCase(),
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
					className="flex h-full min-h-0 flex-col border-[#30352f] bg-[#101211] p-0 text-[#f2efe7] [background-image:none]"
					title={draft ? `Edit ${draft.invoiceNumber}` : "Edit invoice"}
				>
					{draft ? (
						<>
							<div className="border-b border-[#30352f] bg-[#101211] px-6 py-5">
								<SheetHeader className="space-y-0 text-left">
									<div className="flex items-start justify-between gap-6">
										<div>
											<SheetTitle className="text-[28px] font-semibold tracking-[-0.03em] text-[#f2efe7]">
												{draft.invoiceNumber}
											</SheetTitle>
											<SheetDescription className="mt-2 text-sm text-[#9c968a]">
												Edit the live invoice without leaving the list view.
											</SheetDescription>
										</div>
										<div className="grid gap-1 text-right text-sm text-[#9c968a]">
											<div>
												<span className="text-[#817d72]">Customer:</span>{" "}
												<span className="text-[#f2efe7]">
													{draft.customerName || "Unassigned"}
												</span>
											</div>
											<div>
												<span className="text-[#817d72]">Amount:</span>{" "}
												<span className="text-[#f2efe7]">
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
													className="h-10 rounded-md border-[#30352f] bg-[#0f1111] text-[#f2efe7]"
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
													className="h-10 rounded-md border-[#30352f] bg-[#0f1111] text-[#f2efe7]"
												/>
											</div>
											<div>
												<FieldLabel>Customer PO number</FieldLabel>
												<Input
													value={draft.customerPoNumber ?? ""}
													onChange={(event) =>
														patchDraft((prev) => ({
															...prev,
															customerPoNumber: event.target.value.slice(0, 80),
														}))
													}
													placeholder="PO number from the client"
													className="h-10 rounded-md border-[#30352f] bg-[#0f1111] text-[#f2efe7]"
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
													className="h-10 rounded-md border-[#30352f] bg-[#0f1111] text-[#f2efe7]"
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
													className="h-10 rounded-md border-[#30352f] bg-[#0f1111] text-[#f2efe7]"
												/>
											</div>
											<div>
												<FieldLabel>Currency</FieldLabel>
												<select
													value={draft.currency}
													onChange={(event) =>
														updateCurrency(event.target.value)
													}
													className="h-10 w-full rounded-md border border-[#30352f] bg-[#0f1111] px-3 text-sm text-[#f2efe7] outline-none"
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
													className="h-10 rounded-md border-[#30352f] bg-[#0f1111] text-[#f2efe7]"
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
												className="h-9 rounded-md border border-[#30352f] bg-[#0f1111] px-4 text-sm text-[#d8d1c4] hover:bg-[#1a2117] hover:text-[#f2efe7]"
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
															className="h-10 rounded-md border-[#30352f] bg-[#0f1111] text-[#f2efe7]"
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
															className="h-10 rounded-md border-[#30352f] bg-[#0f1111] text-[#f2efe7]"
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
															className="h-10 rounded-md border-[#30352f] bg-[#0f1111] text-[#f2efe7]"
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
															className="h-10 rounded-md border-[#30352f] bg-[#0f1111] text-[#f2efe7]"
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
															className="h-10 w-full rounded-md border border-[#30352f] bg-[#0f1111] px-3 text-sm text-[#f2efe7] outline-none"
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
															className="h-10 w-full rounded-md border border-[#30352f] bg-[#0f1111] px-3 text-sm text-[#f2efe7] outline-none"
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
															className="h-10 w-full rounded-md border border-[#30352f] bg-[#0f1111] px-3 text-sm text-[#f2efe7] outline-none"
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
															className="h-10 w-full rounded-md border border-[#30352f] bg-[#0f1111] px-3 text-sm text-[#f2efe7] outline-none"
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
															className="h-10 rounded-md border-[#30352f] bg-[#0f1111] text-[#f2efe7]"
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
															className="h-10 w-full rounded-md border border-[#30352f] bg-[#0f1111] px-3 text-sm text-[#f2efe7] outline-none"
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
															className="h-10 w-full rounded-md border border-[#30352f] bg-[#0f1111] px-3 text-sm text-[#f2efe7] outline-none"
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
															className="h-10 w-full rounded-md border border-[#30352f] bg-[#0f1111] px-3 text-sm text-[#f2efe7] outline-none"
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
													className="rounded-md border border-[#30352f] bg-[#0f1111] p-3 md:border-0 md:bg-transparent md:p-0"
												>
													<div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_132px_132px_160px_44px] md:items-center">
														<div>
															<div className="mb-2 text-[11px] text-[#817d72] md:hidden">
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
																className="h-10 rounded-md border-[#30352f] bg-[#0f1111] text-[#f2efe7]"
															/>
														</div>
														<div>
															<div className="mb-2 text-[11px] text-[#817d72] md:hidden">
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
															<div className="mb-2 text-[11px] text-[#817d72] md:hidden">
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
															<div className="mb-2 text-[11px] text-[#817d72] md:hidden">
																Line total
															</div>
															<div className="flex h-10 items-center justify-between rounded-md border border-[#30352f] bg-[#0f1111] px-3 text-sm font-medium text-[#f2efe7] md:justify-end">
																<span className="md:hidden text-[#817d72]">
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
																className="inline-flex h-10 w-11 items-center justify-center rounded-md border border-[#30352f] bg-[#0f1111] text-[#9c968a] transition-colors hover:bg-[#1a2117] hover:text-[#f2efe7]"
																aria-label="Remove line item"
															>
																<X className="h-4 w-4" />
															</button>
														</div>
													</div>
												</div>
											))}

											<div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#30352f] pt-3">
												<Button
													type="button"
													variant="ghost"
													onClick={addLineItem}
													className="h-10 rounded-md border border-[#30352f] bg-[#0f1111] px-4 text-sm text-[#d8d1c4] hover:bg-[#1a2117] hover:text-[#f2efe7]"
												>
													<Plus className="mr-2 h-4 w-4" />
													Add line item
												</Button>
												<div className="w-full max-w-[260px] space-y-2 rounded-md border border-[#30352f] bg-[#0f1111] px-4 py-3">
													<div className="flex items-center justify-between text-sm text-[#9c968a]">
														<span>Subtotal</span>
														<span className="text-[#f2efe7]">
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
															<span className="text-[#f2efe7]">
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
															<span className="text-[#f2efe7]">
																-
																{formatMoney(
																	draft.compliance?.withholdingTaxAmount ?? 0,
																	draft.currency,
																)}
															</span>
														</div>
													) : null}
													<div className="flex items-center justify-between border-t border-[#30352f] pt-2 text-sm">
														<span className="text-[#9c968a]">Net payable</span>
														<span className="text-lg font-semibold text-[#f2efe7]">
															{formatMoney(invoiceTotal(draft), draft.currency)}
														</span>
													</div>
												</div>
											</div>
										</div>
									</Section>

									<div className="grid gap-6 lg:grid-cols-2">
										<Section title="Status">
											<div className="space-y-3">
												<div className="rounded-md border border-[#30352f] bg-[#0f1111] px-3 py-2 text-sm capitalize text-[#f2efe7]">
													{draft.status === "unpaid"
														? "sent"
														: draft.status.replace("-", " ")}
												</div>
												<div className="grid gap-2 sm:grid-cols-2">
													<Button
														type="button"
														variant="ghost"
														disabled={!onRecordPayment || draft.balance <= 0}
														onClick={async () => {
															if (!onRecordPayment) return;
															await onRecordPayment(
																draft.id,
																draft.balance,
																paymentReference.trim() || undefined,
															);
															setDraft((prev) =>
																prev
																	? {
																			...prev,
																			paymentAmount: prev.total,
																			balance: 0,
																			status: "paid",
																			paymentReference:
																				paymentReference.trim() ||
																				prev.paymentReference,
																		}
																	: prev,
															);
														}}
														className="h-9 whitespace-nowrap rounded-md border border-[#3f5130] bg-[#1a2117] px-3 text-sm font-medium text-[#c8ff62] hover:bg-[#202a18] hover:text-[#d5ff7a]"
													>
														Mark as paid
													</Button>
													<Button
														type="button"
														variant="ghost"
														disabled={
															!onStatusChange || draft.status === "canceled"
														}
														onClick={async () => {
															if (!onStatusChange) return;
															await onStatusChange(draft.id, "canceled");
															setDraft((prev) =>
																prev
																	? {
																			...prev,
																			status: "canceled",
																			canceledAt: Date.now(),
																		}
																	: prev,
															);
														}}
														className="h-9 rounded-md border border-[#4b2d2d] bg-[#1a1111] px-3 text-sm text-[#efb1b1] hover:bg-[#2a1f1f]"
													>
														Cancel invoice
													</Button>
												</div>
											</div>
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
															className="h-10 rounded-md border-[#30352f] bg-[#0f1111] text-[#f2efe7]"
														/>
														<Button
															onClick={onSendEmail}
															disabled={isSendingEmail}
															variant="ghost"
															className="h-10 rounded-md border border-[#30352f] bg-[#0f1111] px-3 hover:bg-[#1a2117]"
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
														className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#30352f] bg-[#0f1111] text-[#d8d1c4] transition-colors hover:bg-[#1a2117] hover:text-[#f2efe7]"
													>
														<FaTelegram className="h-4 w-4" />
													</a>
													<a
														href={shareLinks(draft).whatsappHref}
														target="_blank"
														rel="noreferrer"
														aria-label="Share on WhatsApp"
														className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#30352f] bg-[#0f1111] text-[#d8d1c4] transition-colors hover:bg-[#1a2117] hover:text-[#f2efe7]"
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
														className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#30352f] bg-[#0f1111] text-[#d8d1c4] transition-colors hover:bg-[#1a2117] hover:text-[#f2efe7]"
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
														className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#30352f] bg-[#0f1111] text-[#d8d1c4] transition-colors hover:bg-[#1a2117] hover:text-[#f2efe7]"
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
														className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#30352f] bg-[#0f1111] text-[#d8d1c4] transition-colors hover:bg-[#1a2117] hover:text-[#f2efe7]"
													>
														<Copy className="h-4 w-4" />
													</button>
													<a
														href={shareLinks(draft).publicUrl}
														target="_blank"
														rel="noreferrer"
														aria-label="Preview before download"
														className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#30352f] bg-[#0f1111] text-[#d8d1c4] transition-colors hover:bg-[#1a2117] hover:text-[#f2efe7]"
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
												className="h-9 rounded-md border border-[#30352f] bg-[#0f1111] px-4 text-sm text-[#d8d1c4] hover:bg-[#1a2117] hover:text-[#f2efe7]"
											>
												Add payment details
											</Button>
										) : (
											<div className="grid gap-4">
												<div>
													<FieldLabel>Payment reference</FieldLabel>
													<Input
														value={paymentReference}
														onChange={(event) =>
															setPaymentReference(event.target.value)
														}
														placeholder="Transfer ref, Paystack ref, or receipt no."
														className="h-10 rounded-md border-[#30352f] bg-[#0f1111] text-[#f2efe7]"
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
												className="h-9 rounded-md border border-[#30352f] bg-[#0f1111] px-4 text-sm text-[#d8d1c4] hover:bg-[#1a2117] hover:text-[#f2efe7]"
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
														className="min-h-32 w-full rounded-md border border-[#30352f] bg-[#0f1111] px-3 py-2 text-sm text-[#f2efe7] outline-none placeholder:text-[#817d72]"
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
														className="min-h-32 w-full rounded-md border border-[#30352f] bg-[#0f1111] px-3 py-2 text-sm text-[#f2efe7] outline-none placeholder:text-[#817d72]"
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
														className="rounded-md border border-[#30352f] bg-[#0f1111] px-3 py-3"
													>
														<div className="flex items-start justify-between gap-3">
															<div className="flex items-start gap-3">
																<div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-md border border-[#3a4330] bg-[#1a2117] text-[#b7ca7c]">
																	<Icon className="h-4 w-4" />
																</div>
																<div>
																	<p className="text-sm font-medium text-[#f2efe7]">
																		{item.label}
																	</p>
																	<p className="mt-1 text-xs text-[#9c968a]">
																		{item.description}
																	</p>
																</div>
															</div>
															<p className="text-xs text-[#817d72]">
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

							<div className="shrink-0 border-t border-[#30352f] bg-[#15171a] px-6 py-4">
								<div className="flex items-center justify-between gap-4">
									<div className="text-sm text-[#9c968a]">
										{saving ? "Saving changes..." : ""}
									</div>
									<div className="flex items-center gap-3">
										<Button
											type="button"
											variant="ghost"
											onClick={onResetDraft}
											className="h-10 rounded-md border border-[#30352f] bg-[#0f1111] px-4 text-sm text-[#d8d1c4] hover:bg-[#1a2117] hover:text-[#f2efe7]"
										>
											Reset
										</Button>
										<Button
											type="button"
											onClick={onSaveDraft}
											disabled={saving}
											className="h-10 rounded-md bg-[#c8ff62] px-4 text-sm font-medium text-[#0f1111] hover:bg-[#d5ff7a]"
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
						<InvoiceDetailsSkeleton />
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
