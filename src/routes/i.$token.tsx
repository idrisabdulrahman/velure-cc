import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { BadgeCheck, Banknote, Check, Copy, Download } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { FaWhatsapp } from "react-icons/fa6";
import { useResizeObserver } from "#/components/hooks/use-resize-observer";
import { AppLoader } from "#/components/ui/app-loader";
import { Spinner } from "#/components/ui/spinner";
import { toast } from "#/components/ui/use-toast";
import { formatInvoiceDate, formatMoney } from "#/features/invoices/format";
import {
	getInvoiceTemplateSize,
	toInvoiceDocument,
} from "#/features/invoices/invoice-document-adapter";
import {
	getPublicPaymentAffordances,
	getPublicPrimaryAmount,
	PUBLIC_DRAFT_PAYMENT_NOTICE,
} from "#/features/invoices/public-payment-affordances";
import { buildInvoiceShareLinks } from "#/features/invoices/share-links";
import type { InvoiceRecord } from "#/features/invoices/types";
import { INVOICE_DOCUMENT_TYPE_LABELS } from "#/features/invoices/types";
import { getInvoicePaymentReference } from "#/lib/invoice-document/payment-reference";
import { HtmlTemplate } from "#/lib/invoice-document/templates/html";
import type {
	PaymentSource,
	PublicPaymentContext,
} from "#/server/data/payments";

export const Route = createFileRoute("/i/$token")({
	component: PublicInvoicePage,
});

function searchStringValue(search: unknown, key: string) {
	if (typeof search === "string") {
		return new URLSearchParams(search).get(key);
	}

	if (!search || typeof search !== "object") return null;
	const value = (search as Record<string, unknown>)[key];
	return typeof value === "string" ? value : null;
}

/* Instrument micro-caps (design.md · Typography). The `[class*="uppercase"]`
 * guard that re-voices ad-hoc caps only matches inside `.hm` / `.hm-app`, and
 * this public surface is in neither scope — so the legal instrument role is
 * simply written out here. Used for board captions and field labels only. */
const MICRO_CAPS =
	"font-label text-[0.625rem] font-medium uppercase tracking-[0.18em] text-ink-3";

const PRIMARY_ACTION =
	"inline-flex h-11 items-center justify-center gap-2 rounded-md bg-brand px-4 text-[13px] font-medium text-brand-ink transition-colors hover:bg-brand-hi focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60";

const GHOST_ACTION =
	"inline-flex h-11 items-center justify-center gap-2 rounded-md border border-rule bg-paper-2 px-4 text-[13px] font-medium text-ink-2 transition-colors hover:bg-paper-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60";

const FIELD =
	"mt-1 h-10 w-full rounded-md border border-rule bg-paper-2 px-3 font-num text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

function PublicInvoicePage() {
	const { token } = Route.useParams();
	const location = useLocation();
	const stageRef = useRef<HTMLDivElement>(null);
	const { data, refetch } = useQuery({
		queryKey: ["public-invoice", token],
		queryFn: async () => {
			const response = await fetch(
				`/api/invoice/public/${encodeURIComponent(token)}`,
			);
			if (response.status === 404) return null;
			if (!response.ok) throw new Error("Could not load invoice.");
			return (await response.json()) as {
				invoice: InvoiceRecord;
				paymentContext: PublicPaymentContext | null;
				paymentHistory: Array<{
					id: string;
					source: PaymentSource;
					provider?: string;
					reference?: string;
					amount: number;
					currency: string;
					createdAt: number;
				}>;
			};
		},
	});
	const invoice = data?.invoice ?? (data === null ? null : undefined);
	const paymentContext = data?.paymentContext;
	const paymentHistory = data?.paymentHistory;
	const isEmbedded = searchStringValue(location.search, "embed") === "1";
	const stageEntry = useResizeObserver(stageRef);
	const [isLinkCopied, setIsLinkCopied] = useState(false);
	const [isAccountCopied, setIsAccountCopied] = useState(false);
	const [isCreatingCharge, setIsCreatingCharge] = useState(false);
	const [showClaimForm, setShowClaimForm] = useState(false);
	const [claimAmount, setClaimAmount] = useState("");
	const [claimReference, setClaimReference] = useState("");
	const [claimNote, setClaimNote] = useState("");
	const [isSubmittingClaim, setIsSubmittingClaim] = useState(false);
	const [claimSubmitted, setClaimSubmitted] = useState(false);
	const [isAcceptingQuote, setIsAcceptingQuote] = useState(false);
	const [quoteAccepted, setQuoteAccepted] = useState(false);

	useEffect(() => {
		if (invoice && invoice.status !== "canceled") {
			void fetch(`/api/invoice/public/${encodeURIComponent(token)}`, {
				method: "POST",
			});
		}
	}, [invoice, token]);

	if (invoice === undefined) {
		return (
			<section className="dark flex min-h-[100dvh] items-center justify-center bg-paper">
				<AppLoader label="Loading invoice" />
			</section>
		);
	}

	if (!invoice) {
		return (
			<section className="dark flex min-h-[100dvh] items-center justify-center bg-paper p-4">
				<div className="w-full max-w-md rounded-md border border-rule bg-paper-2 p-6 text-center">
					<h2 className="text-base font-medium text-ink">Invoice not found</h2>
					<p className="mt-2 text-sm text-ink-3">
						The customer portal link is invalid or no longer available.
					</p>
				</div>
			</section>
		);
	}

	const invoiceDocument = toInvoiceDocument(invoice);
	const { width, height } = getInvoiceTemplateSize(invoiceDocument.template);
	const encodedToken = encodeURIComponent(invoice.token);
	const downloadUrl = `/api/invoice/download/${encodedToken}`;
	const sellerName =
		invoice.compliance?.seller.legalName?.trim() ||
		invoice.compliance?.seller.tradingName?.trim() ||
		"Invoice";
	const documentLabel =
		INVOICE_DOCUMENT_TYPE_LABELS[invoice.documentType ?? "standard"];
	const shareLinks =
		typeof window === "undefined"
			? null
			: buildInvoiceShareLinks({
					token: invoice.token,
					origin: window.location.origin,
					invoiceNumber: invoice.invoiceNumber,
					customerName: invoice.customerName,
					documentType: invoice.documentType,
					amountLabel: formatMoney(invoice.total, invoice.currency),
				});
	const statusLabel =
		invoice.status === "unpaid"
			? "Sent"
			: invoice.status === "partially-paid"
				? "Partially paid"
				: invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1);
	const badgeModifier =
		invoice.status === "paid"
			? "is-ok"
			: invoice.status === "overdue"
				? "is-danger"
				: invoice.status === "partially-paid"
					? "is-warn"
					: invoice.status === "draft" || invoice.status === "canceled"
						? "is-paper"
						: "is-info";
	// The sheet is measured against its own column, so the scale is driven by
	// width alone: a height term would be self-referential, since a taller sheet
	// grows the very column being measured and would collapse it. The cap keeps
	// the sheet from being blown up past its natural print size.
	const stageWidth = stageEntry?.contentRect.width ?? width;
	const paperScale = isEmbedded
		? 1
		: Math.min(
				Math.max(stageWidth - (stageWidth > 900 ? 12 : 8), 1) / width,
				1.08,
			);

	const copyPublicLink = async () => {
		try {
			await navigator.clipboard.writeText(window.location.href);
			setIsLinkCopied(true);
			toast({
				title: "Link copied",
				description: "The public invoice link is ready to share.",
				variant: "success",
			});
			await refetch();
			window.setTimeout(() => setIsLinkCopied(false), 1800);
		} catch {
			toast({
				title: "Could not copy link",
				description: "Clipboard permission was denied.",
				variant: "error",
			});
		}
	};

	const charge = paymentContext?.charge;
	const copyAccountNumber = async (accountNumber: string) => {
		try {
			await navigator.clipboard.writeText(accountNumber);
			setIsAccountCopied(true);
			toast({
				title: "Account number copied",
				description: "Paste it into your bank transfer screen.",
				variant: "success",
			});
			window.setTimeout(() => setIsAccountCopied(false), 1800);
		} catch {
			toast({
				title: "Could not copy account number",
				description: "Select the number and copy it manually.",
				variant: "error",
			});
		}
	};

	const payments = paymentHistory ?? [];
	// A draft (and its `scheduled` alias) is not payable, so its page shows no
	// collection panel, no bank-transfer instructions and no "I've paid" action.
	const {
		isDraft: isDraftState,
		canUsePaystackTransfer,
		showCollectionPanel,
		canClaimPayment,
	} = getPublicPaymentAffordances({
		status: invoice.status,
		balance: invoice.balance,
		automaticBankTransfer: paymentContext?.capabilities.automaticBankTransfer,
		payable: paymentContext?.payable,
	});
	const collectionStatusLabel = charge?.accountNumber
		? "Active collection session"
		: canUsePaystackTransfer
			? "Ready to collect"
			: (paymentContext?.payableIssue ?? "Online collection unavailable");
	const collectionAmountLabel = paymentContext?.collectionAmount
		? formatMoney(paymentContext.collectionAmount, invoice.currency)
		: null;

	// Match the document renderers: "scheduled" prints as "draft".
	const paymentReference = getInvoicePaymentReference({
		invoiceNumber: invoice.invoiceNumber,
		status: invoice.status === "scheduled" ? "draft" : invoice.status,
	});
	// WP-D: a pro-forma quote can be accepted while it is an open offer.
	const isQuote = (invoice.documentType ?? "standard") === "proforma";
	const quoteAcceptedView = quoteAccepted || invoice.quoteStatus === "accepted";
	const canAcceptQuote =
		isQuote &&
		!quoteAcceptedView &&
		invoice.quoteStatus !== "declined" &&
		invoice.quoteStatus !== "expired" &&
		(invoice.status === "unpaid" ||
			invoice.status === "overdue" ||
			invoice.status === "partially-paid");

	const openClaimForm = () => {
		setClaimAmount(invoice.balance > 0 ? String(invoice.balance) : "");
		setClaimReference(paymentReference?.value ?? invoice.invoiceNumber);
		setShowClaimForm(true);
	};

	const submitPaymentClaim = async () => {
		const amount = Number(claimAmount);
		if (!Number.isFinite(amount) || amount <= 0) {
			toast({
				title: "Enter the amount you paid",
				description: "Use a number greater than zero.",
				variant: "error",
			});
			return;
		}
		setIsSubmittingClaim(true);
		try {
			const response = await fetch("/api/invoice/public/claim", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					token: invoice.token,
					amount,
					reference: claimReference.trim() || undefined,
					note: claimNote.trim() || undefined,
				}),
			});
			const payload = (await response.json().catch(() => null)) as {
				ok?: boolean;
				error?: string;
			} | null;
			if (!response.ok || !payload?.ok) {
				throw new Error(
					payload?.error ?? "Could not send your payment notice.",
				);
			}
			setClaimSubmitted(true);
			setShowClaimForm(false);
			toast({
				title: "Payment notice sent",
				description: `${sellerName} will confirm your payment.`,
				variant: "success",
			});
		} catch (error) {
			toast({
				title: "Could not send payment notice",
				description: error instanceof Error ? error.message : "Try again.",
				variant: "error",
			});
		} finally {
			setIsSubmittingClaim(false);
		}
	};

	const submitQuoteAcceptance = async () => {
		setIsAcceptingQuote(true);
		try {
			const response = await fetch("/api/invoice/public/quote-accept", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ token: invoice.token }),
			});
			const payload = (await response.json().catch(() => null)) as {
				ok?: boolean;
				error?: string;
			} | null;
			if (!response.ok || !payload?.ok) {
				throw new Error(payload?.error ?? "Could not accept the quote.");
			}
			setQuoteAccepted(true);
			toast({
				title: "Quote accepted",
				description: `${sellerName} will issue your invoice.`,
				variant: "success",
			});
			void refetch();
		} catch (error) {
			toast({
				title: "Could not accept the quote",
				description: error instanceof Error ? error.message : "Try again.",
				variant: "error",
			});
		} finally {
			setIsAcceptingQuote(false);
		}
	};

	const createTransferCharge = async () => {
		setIsCreatingCharge(true);
		try {
			const response = await fetch("/api/payments/paystack/initialize", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ token: invoice.token }),
			});
			const payload = (await response.json().catch(() => null)) as {
				ok?: boolean;
				error?: string;
			} | null;
			if (!response.ok || !payload?.ok) {
				throw new Error(payload?.error ?? "Could not create transfer account.");
			}
			toast({
				title: "Transfer account ready",
				description: "Use the temporary account before it expires.",
				variant: "success",
			});
			// The charge is created server-side, but the account number lives on
			// `paymentContext.charge`. Without this the payer keeps seeing the
			// "Pay by transfer" button, retries, and burns the per-token rate
			// limit until the endpoint answers 429.
			await refetch();
		} catch (error) {
			toast({
				title: "Could not prepare transfer",
				description:
					error instanceof Error ? error.message : "Unknown payment error.",
				variant: "error",
			});
		} finally {
			setIsCreatingCharge(false);
		}
	};

	// ── Presentation values ──────────────────────────────────────────────────
	// The page mirrors the sheet's convention (`NGN 519,400.00`) rather than the
	// locale symbol, so the figure beside the sheet reads the same as the figure
	// on it. All values below are real stored amounts.
	const money = (value: number) =>
		formatMoney(value, invoice.currency, { currencyDisplay: "code" });
	const dueDateLabel = formatInvoiceDate(invoice.dueDate, invoice.dateFormat);
	// A draft is not payable, so it must not read "Amount due" with a zero
	// balance: show the draft's total instead.
	const { label: primaryAmountLabel, value: primaryAmountValue } =
		getPublicPrimaryAmount({
			status: invoice.status,
			total: invoice.total,
			balance: invoice.balance,
			paymentAmount: invoice.paymentAmount,
		});
	const invoiceFacts = [
		{ label: "Invoice no", value: invoice.invoiceNumber },
		{
			label: "Issued",
			value: formatInvoiceDate(invoice.issueDate, invoice.dateFormat),
		},
		{ label: "Due", value: dueDateLabel },
		{ label: primaryAmountLabel, value: money(primaryAmountValue) },
	];
	const collectionTitle = paymentContext?.depositRequest
		? "Deposit collection"
		: "Payment collection";
	// With no online collection the manual claim *is* the primary action; with
	// one, "I've paid" steps back so the panel keeps a single accent.
	const claimIsPrimary = !showCollectionPanel;
	const revealStyle = (index: number) => ({ "--hm-i": index }) as CSSProperties;

	if (isEmbedded) {
		return (
			<section className="flex h-full w-full items-center justify-center overflow-hidden bg-paper p-4">
				<HtmlTemplate
					data={invoiceDocument}
					width={width}
					height={height}
					appearance="public"
				/>
			</section>
		);
	}

	return (
		<section className="dark">
			<div className="dotted-bg min-h-[100dvh] bg-paper-2 text-ink">
				<div className="mx-auto w-full max-w-6xl px-4 pt-3 sm:px-6 lg:px-8">
					<header className="hm-reveal flex items-center justify-between gap-4 py-2">
						<div className="flex min-w-0 items-center gap-3">
							{invoice.logoUrl?.trim() ? (
								<img
									src={invoice.logoUrl}
									alt={sellerName}
									className="h-8 w-8 shrink-0 rounded-lg border border-rule object-cover"
								/>
							) : (
								<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-rule bg-paper-3 font-label text-[11px] font-medium text-ink-2">
									{sellerName.charAt(0).toUpperCase()}
								</div>
							)}
							<div className="min-w-0">
								<p className="truncate text-sm font-medium text-ink">
									{sellerName}
								</p>
								<p className="truncate text-[11px] text-ink-3">
									For {invoice.customerName || "you"}
								</p>
							</div>
						</div>
						<div className={`hm-ts-stamp ${badgeModifier}`}>{statusLabel}</div>
					</header>
				</div>

				{/* Departure-board fact strip. Wraps into a 2x2 grid on phones —
				 * never a horizontal scroller, because every element must stay
				 * inside the viewport (see e2e/public-invoice-responsive). */}
				<div className="border-b border-rule bg-paper">
					<div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
						<dl className="grid grid-cols-2 border-l border-rule lg:grid-cols-4">
							{invoiceFacts.map((fact) => (
								<div
									key={fact.label}
									className="min-w-0 border-r border-t border-rule px-4 py-3 sm:px-6"
								>
									<dt className={MICRO_CAPS}>{fact.label}</dt>
									<dd className="mt-1.5 font-num text-[13px] break-words text-ink sm:text-sm">
										{fact.value}
									</dd>
								</div>
							))}
						</dl>
					</div>
				</div>

				<div className="mx-auto w-full max-w-6xl px-4 pb-28 sm:px-6 md:pb-20 lg:px-8">
					<div className="mt-6 flex flex-col gap-5 lg:mt-8 lg:grid lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start lg:gap-8">
						<div
							ref={stageRef}
							className="hm-reveal flex justify-center"
							style={revealStyle(1)}
						>
							<div
								style={{
									width: width * paperScale,
									height: height * paperScale,
								}}
							>
								<div
									className="shadow-[0_34px_84px_-34px_rgba(0,0,0,0.92)]"
									style={{
										width,
										height,
										transform: `scale(${paperScale})`,
										transformOrigin: "top left",
									}}
								>
									<HtmlTemplate
										data={invoiceDocument}
										width={width}
										height={height}
										appearance="public"
									/>
								</div>
							</div>
						</div>

						<aside className="flex w-full flex-col gap-4">
							<div
								className="hm-reveal overflow-hidden rounded-lg border border-rule bg-paper"
								style={revealStyle(2)}
							>
								<div className="px-5 py-5">
									<div className="flex items-baseline justify-between gap-4">
										<span className={MICRO_CAPS}>{primaryAmountLabel}</span>
										<span className="font-num text-[11px] text-ink-3">
											{documentLabel}
										</span>
									</div>
									<p className="mt-2.5 font-num text-[1.75rem] leading-none font-medium tracking-tight text-ink">
										{money(primaryAmountValue)}
									</p>
									<dl className="mt-5 grid gap-2 border-t border-rule pt-4">
										<div className="flex items-baseline justify-between gap-4">
											<dt className="text-xs text-ink-3">Total</dt>
											<dd className="font-num text-xs text-ink-2">
												{money(invoice.total)}
											</dd>
										</div>
										{invoice.paymentAmount > 0 ? (
											<div className="flex items-baseline justify-between gap-4">
												<dt className="text-xs text-ink-3">Already paid</dt>
												<dd className="font-num text-xs text-ink-2">
													−{money(invoice.paymentAmount)}
												</dd>
											</div>
										) : null}
										<div className="flex items-baseline justify-between gap-4">
											<dt className="text-xs text-ink-3">Due</dt>
											<dd className="font-num text-xs text-ink-2">
												{dueDateLabel}
											</dd>
										</div>
									</dl>
									{/* Issue #3 finding 4: Download PDF was only reachable by
									 * hovering an unlabeled icon in the floating pill. Give it a
									 * visible, labeled action next to the invoice summary. */}
									<a
										href={downloadUrl}
										className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-rule bg-paper-2 text-xs font-medium text-ink transition-colors hover:bg-paper-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
									>
										<Download className="h-4 w-4 shrink-0" />
										Download PDF
									</a>
								</div>

								{isQuote && (canAcceptQuote || quoteAcceptedView) ? (
									<div className="border-t border-rule px-5 py-5">
										{quoteAcceptedView ? (
											<p
												role="status"
												aria-live="polite"
												className="flex items-start gap-2 text-xs text-ink-2"
											>
												<Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
												<span>
													Quote accepted — {sellerName} will issue your invoice.
												</span>
											</p>
										) : (
											<>
												<p className="text-xs font-medium text-ink">
													Ready to proceed?
												</p>
												<p className="mt-1 text-xs text-ink-3">
													Accept this quote and {sellerName} will issue an
													invoice for {money(invoice.total)}.
												</p>
												<button
													type="button"
													onClick={() => void submitQuoteAcceptance()}
													disabled={isAcceptingQuote}
													className={`${PRIMARY_ACTION} mt-3 w-full`}
												>
													{isAcceptingQuote ? (
														<Spinner size={16} />
													) : (
														<BadgeCheck className="h-4 w-4" />
													)}
													<span>Accept quote</span>
												</button>
											</>
										)}
									</div>
								) : null}

								{isDraftState ? (
									<div className="border-t border-rule px-5 py-5">
										<p role="status" className="text-xs font-medium text-ink">
											{PUBLIC_DRAFT_PAYMENT_NOTICE}
										</p>
										<p className="mt-1 text-xs text-ink-3">
											Payment instructions appear once {sellerName} issues it.
										</p>
									</div>
								) : null}

								{showCollectionPanel ? (
									<div className="border-t border-rule px-5 py-5">
										<div className="flex items-baseline justify-between gap-4">
											<p className="text-xs font-medium text-ink">
												{collectionTitle}
											</p>
											{paymentContext?.depositRequest &&
											collectionAmountLabel ? (
												<span className="font-num text-[11px] text-ink-3">
													{collectionAmountLabel} requested
												</span>
											) : null}
										</div>

										{charge?.accountNumber ? (
											<dl className="mt-3 overflow-hidden rounded-md border border-rule bg-paper-2">
												<div className="flex items-center justify-between gap-4 border-b border-rule px-3.5 py-2.5">
													<dt className="text-[11px] text-ink-3">Bank</dt>
													<dd className="font-num text-sm text-ink">
														{charge.bankName ?? "Paystack transfer"}
													</dd>
												</div>
												<div className="flex items-center justify-between gap-3 border-b border-rule px-3.5 py-2.5">
													<dt className="text-[11px] text-ink-3">
														Account number
													</dt>
													<dd className="flex min-w-0 items-center gap-1">
														<span className="select-all truncate font-num text-sm font-medium text-ink">
															{charge.accountNumber}
														</span>
														<button
															type="button"
															onClick={() =>
																void copyAccountNumber(
																	charge.accountNumber ?? "",
																)
															}
															className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-paper-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
															aria-label="Copy account number"
															title="Copy account number"
														>
															{isAccountCopied ? (
																<Check className="h-4 w-4 shrink-0" />
															) : (
																<Copy className="h-4 w-4 shrink-0" />
															)}
														</button>
													</dd>
												</div>
												<div className="flex items-center justify-between gap-4 px-3.5 py-2.5">
													<dt className="text-[11px] text-ink-3">Expires</dt>
													<dd className="font-num text-sm text-ink">
														{new Date(charge.expiresAt).toLocaleTimeString([], {
															hour: "2-digit",
															minute: "2-digit",
														})}
													</dd>
												</div>
											</dl>
										) : canUsePaystackTransfer ? (
											<button
												type="button"
												onClick={() => void createTransferCharge()}
												disabled={isCreatingCharge}
												className={`${PRIMARY_ACTION} mt-3 w-full`}
											>
												{isCreatingCharge ? (
													<Spinner size={16} />
												) : (
													<Banknote className="h-4 w-4" />
												)}
												<span>Pay by transfer</span>
											</button>
										) : (
											<p className="mt-2 text-xs text-ink-3">
												{paymentContext?.payableIssue ??
													`Online collection is not available for this ${documentLabel.toLowerCase()}.`}
											</p>
										)}

										{charge?.accountNumber || canUsePaystackTransfer ? (
											<p className="mt-2.5 text-[11px] text-ink-3">
												{collectionStatusLabel}
											</p>
										) : null}
									</div>
								) : null}

								{canClaimPayment ? (
									<div className="border-t border-rule px-5 py-5">
										<p className="text-xs font-medium text-ink">
											Paying by bank transfer?
										</p>
										<p className="mt-1 text-xs text-ink-3">
											Pay {money(invoice.balance)} with the details below, then
											let {sellerName} know.
										</p>

										{invoice.paymentDetails?.trim() ? (
											<div className="mt-3 rounded-md border border-rule bg-paper-2 px-3.5 py-3 text-xs whitespace-pre-wrap text-ink-2">
												{invoice.paymentDetails}
											</div>
										) : null}

										{paymentReference ? (
											<div className="mt-3 flex items-center justify-between gap-4 rounded-md border border-rule bg-paper-2 px-3.5 py-2.5">
												<span className="text-[11px] text-ink-3">
													{paymentReference.label}
												</span>
												<span className="select-all font-num text-sm font-medium text-ink">
													{paymentReference.value}
												</span>
											</div>
										) : null}

										{claimSubmitted ? (
											<p
												role="status"
												aria-live="polite"
												className="mt-4 flex items-start gap-2 text-xs text-ink-2"
											>
												<Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
												<span>
													Thanks — we&apos;ve told {sellerName} you paid.
													They&apos;ll confirm it shortly.
												</span>
											</p>
										) : showClaimForm ? (
											<div className="mt-4 grid gap-3">
												<label className="text-[11px] text-ink-3">
													Amount you paid
													<input
														type="number"
														inputMode="decimal"
														min="0"
														step="0.01"
														value={claimAmount}
														onChange={(event) =>
															setClaimAmount(event.target.value)
														}
														className={FIELD}
													/>
												</label>
												<label className="text-[11px] text-ink-3">
													Reference (optional)
													<input
														type="text"
														value={claimReference}
														onChange={(event) =>
															setClaimReference(event.target.value)
														}
														className={FIELD}
													/>
												</label>
												<label className="text-[11px] text-ink-3">
													Note (optional)
													<textarea
														rows={2}
														value={claimNote}
														onChange={(event) =>
															setClaimNote(event.target.value)
														}
														className="mt-1 w-full rounded-md border border-rule bg-paper-2 px-3 py-2 text-sm text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
													/>
												</label>
												<div className="flex flex-wrap gap-2">
													<button
														type="button"
														onClick={() => void submitPaymentClaim()}
														disabled={isSubmittingClaim}
														className={PRIMARY_ACTION}
													>
														{isSubmittingClaim ? (
															<Spinner size={16} />
														) : (
															<Check className="h-4 w-4" />
														)}
														<span>Send payment notice</span>
													</button>
													<button
														type="button"
														onClick={() => setShowClaimForm(false)}
														className={GHOST_ACTION}
													>
														Cancel
													</button>
												</div>
											</div>
										) : (
											<button
												type="button"
												onClick={openClaimForm}
												className={`${claimIsPrimary ? PRIMARY_ACTION : GHOST_ACTION} mt-4`}
											>
												<Check className="h-4 w-4" />
												<span>I&apos;ve paid</span>
											</button>
										)}
									</div>
								) : null}
							</div>

							<div className="hm-reveal" style={revealStyle(3)}>
								<div className="flex items-baseline justify-between gap-4 border-b border-rule pb-2.5">
									<span className={MICRO_CAPS}>Payment history</span>
									<span className="font-num text-[11px] text-ink-3">
										{paymentHistory === undefined
											? "—"
											: payments.length > 0
												? `${payments.length} recorded`
												: "None"}
									</span>
								</div>
								{paymentHistory === undefined ? (
									<div
										role="status"
										aria-label="Loading payment history"
										className="flex justify-center py-5"
									>
										<Spinner className="text-brand !stroke-brand" />
									</div>
								) : payments.length > 0 ? (
									<ul className="divide-y divide-rule">
										{payments.map((payment) => (
											<li
												key={payment.id}
												className="flex items-center justify-between gap-4 py-3"
											>
												<div className="min-w-0">
													<p className="truncate text-xs font-medium text-ink">
														{payment.provider === "paystack"
															? "Paystack transfer"
															: "Manual payment"}
													</p>
													<p className="mt-0.5 truncate text-[11px] text-ink-3">
														{formatInvoiceDate(payment.createdAt, "ng")}
														{payment.reference ? ` · ${payment.reference}` : ""}
													</p>
												</div>
												<span className="shrink-0 font-num text-sm text-ok">
													{formatMoney(payment.amount, payment.currency, {
														currencyDisplay: "code",
													})}
												</span>
											</li>
										))}
									</ul>
								) : (
									<p className="py-4 text-xs text-ink-3">
										No confirmed payments have been recorded for this{" "}
										{documentLabel.toLowerCase()}.
									</p>
								)}
							</div>
						</aside>
					</div>
				</div>

				<div className="fixed inset-x-0 bottom-5 z-20 flex justify-center">
					<div className="flex h-12 items-center gap-1 rounded-full border border-[#303033] bg-[#1a1a1a]/80 px-2 backdrop-blur-lg">
						<a
							href={downloadUrl}
							className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[#d7d3cc] transition-colors hover:bg-white/10 hover:text-white"
							aria-label="Download invoice PDF"
							title="Download invoice PDF"
						>
							<Download className="h-5 w-5 shrink-0" />
						</a>
						<button
							type="button"
							onClick={() => void copyPublicLink()}
							className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[#d7d3cc] transition-colors hover:bg-white/10 hover:text-white"
							aria-label="Copy public invoice link"
							title="Copy public invoice link"
						>
							{isLinkCopied ? (
								<Check className="h-5 w-5 shrink-0" />
							) : (
								<Copy className="h-5 w-5 shrink-0" />
							)}
						</button>
						<a
							href={shareLinks?.whatsappHref}
							target="_blank"
							rel="noreferrer"
							className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[#d7d3cc] transition-colors hover:bg-white/10 hover:text-white"
							aria-label="Share invoice on WhatsApp"
							title="Share invoice on WhatsApp"
						>
							<FaWhatsapp className="h-5 w-5 shrink-0" />
						</a>
					</div>
				</div>

				<div className="fixed bottom-4 right-4 hidden text-[9px] text-[#878787] md:block">
					Powered by <span className="text-[#d7d3cc]">Invoicly</span>
				</div>
			</div>
		</section>
	);
}
