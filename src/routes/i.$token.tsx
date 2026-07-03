import { convexQuery } from "@convex-dev/react-query";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import {
	Banknote,
	CalendarDays,
	Check,
	Copy,
	CreditCard,
	Download,
	Loader2,
	ReceiptText,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useResizeObserver } from "#/components/hooks/use-resize-observer";
import { toast } from "#/components/ui/use-toast";
import { formatInvoiceDate, formatMoney } from "#/features/invoices/format";
import {
	getInvoiceTemplateSize,
	toMiddayInvoice,
} from "#/features/invoices/midday-adapter";
import { HtmlTemplate } from "#/lib/midday-invoice/templates/html";
import { api } from "../../convex/_generated/api";

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

function PublicInvoicePage() {
	const { token } = Route.useParams();
	const location = useLocation();
	const stageRef = useRef<HTMLDivElement>(null);
	const { data: invoice } = useQuery(
		convexQuery(api.invoices.getPublicByToken, { token }),
	);
	const { data: paymentContext } = useQuery(
		convexQuery(api.payments.getPublicPaymentContext, {
			token,
		}),
	);
	const { data: paymentHistory } = useQuery(
		convexQuery(api.payments.listPublicInvoicePayments, {
			token,
		}),
	);
	const recordView = useMutation(api.invoices.recordInvoiceViewed);
	const isEmbedded = searchStringValue(location.search, "embed") === "1";
	const stageEntry = useResizeObserver(stageRef);
	const [isLinkCopied, setIsLinkCopied] = useState(false);
	const [isCreatingCharge, setIsCreatingCharge] = useState(false);

	useEffect(() => {
		if (invoice && invoice.status !== "canceled") {
			void recordView({ token });
		}
	}, [invoice, token, recordView]);

	if (invoice === undefined) {
		return (
			<section className="flex min-h-[100dvh] flex-col bg-[#0f1111]">
				<div className="mx-auto flex w-full max-w-[840px] items-center justify-between border-b border-[#30352f] px-4 py-5 sm:px-6">
					<div className="flex items-center gap-3">
						<div className="h-6 w-6 animate-pulse bg-[#22252a]" />
						<div className="h-4 w-32 animate-pulse bg-[#22252a]" />
					</div>
					<div className="h-6 w-16 animate-pulse bg-[#22252a]" />
				</div>
				<div className="flex flex-1 items-center justify-center p-4 sm:p-8">
					<div className="h-[750px] w-full max-w-[700px] animate-pulse border border-[#30352f] bg-[#171a18]" />
				</div>
				<div className="flex justify-center gap-3 p-4">
					<div className="h-9 w-28 animate-pulse bg-[#22252a]" />
					<div className="h-9 w-32 animate-pulse bg-[#22252a]" />
				</div>
			</section>
		);
	}

	if (!invoice) {
		return (
			<section className="flex min-h-[100dvh] items-center justify-center bg-[#0f1111] p-4">
				<div className="w-full max-w-md rounded-md border border-[#30352f] bg-[#171a18] p-6 text-center">
					<h2 className="text-base font-medium text-[#f2efe7]">
						Invoice not found
					</h2>
					<p className="mt-2 text-sm text-[#aaa294]">
						The customer portal link is invalid or no longer available.
					</p>
				</div>
			</section>
		);
	}

	const middayInvoice = toMiddayInvoice(invoice);
	const { width, height } = getInvoiceTemplateSize(middayInvoice.template);
	const encodedToken = encodeURIComponent(invoice.token);
	const downloadUrl = `/api/invoice/download/${encodedToken}`;
	const sellerName =
		invoice.compliance?.seller.legalName?.trim() ||
		invoice.compliance?.seller.tradingName?.trim() ||
		"Invoice";
	const isProforma = invoice.documentType === "proforma";
	const documentLabel = isProforma ? "Pro-forma invoice" : "Invoice";
	const statusLabel =
		invoice.status === "unpaid"
			? "Sent"
			: invoice.status === "partially-paid"
				? "Partially paid"
				: invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1);
	const badgeTone =
		invoice.status === "paid"
			? "border-[#23402f] bg-[#132118] text-[#c7f4d0]"
			: invoice.status === "overdue"
				? "border-[#4a2626] bg-[#1f1111] text-[#f1c6c6]"
				: "border-[#262626] bg-[#171717] text-[#d1d1d1]";
	const stageWidth = stageEntry?.contentRect.width ?? width;
	const stageHeight = stageEntry?.contentRect.height ?? height;
	const paperScale = (() => {
		if (isEmbedded) return 1;

		const horizontalPadding = stageWidth > 900 ? 12 : 8;
		const verticalPadding = stageHeight > 900 ? 20 : 10;
		const availableWidth = Math.max(stageWidth - horizontalPadding, 1);
		const availableHeight = Math.max(stageHeight - verticalPadding, 1);

		return Math.min(availableWidth / width, availableHeight / height, 1.08);
	})();

	const copyPublicLink = async () => {
		try {
			await navigator.clipboard.writeText(window.location.href);
			setIsLinkCopied(true);
			toast({
				title: "Link copied",
				description: "The public invoice link is ready to share.",
				variant: "success",
			});
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
	const payments = paymentHistory ?? [];
	const canUsePaystackTransfer =
		paymentContext?.capabilities.automaticBankTransfer &&
		paymentContext.payable !== false &&
		invoice.status !== "paid";
	const showCollectionPanel =
		paymentContext?.capabilities.automaticBankTransfer &&
		invoice.status !== "paid";
	const collectionStatusLabel = charge?.accountNumber
		? "Active collection session"
		: canUsePaystackTransfer
			? "Ready to collect"
			: (paymentContext?.payableIssue ?? "Online collection unavailable");
	const balanceLabel = formatMoney(invoice.balance, invoice.currency);
	const totalLabel = formatMoney(invoice.total, invoice.currency);
	const paidLabel = formatMoney(invoice.paymentAmount, invoice.currency);
	const collectionAmountLabel = paymentContext?.collectionAmount
		? formatMoney(paymentContext.collectionAmount, invoice.currency)
		: null;
	const dueDateLabel = formatInvoiceDate(invoice.dueDate, invoice.dateFormat);

	const createTransferCharge = async () => {
		setIsCreatingCharge(true);
		try {
			const response = await fetch(
				`/api/payments/paystack/initialize?token=${encodeURIComponent(invoice.token)}`,
				{ method: "POST" },
			);
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

	if (isEmbedded) {
		return (
			<section className="flex h-full w-full items-center justify-center overflow-hidden bg-[#0B0B0C] p-4">
				<HtmlTemplate
					data={middayInvoice}
					width={width}
					height={height}
					appearance="public"
				/>
			</section>
		);
	}

	return (
		<section className="flex min-h-[100dvh] flex-col bg-[#0f1111] text-[#f2efe7]">
			<header className="border-b border-[#30352f] bg-[#0f1111] px-4 py-4 sm:px-6">
				<div className="mx-auto flex w-full max-w-[840px] items-center justify-between">
					<div className="flex min-w-0 items-center gap-3">
						{invoice.logoUrl?.trim() ? (
							<img
								src={invoice.logoUrl}
								alt={sellerName}
								className="h-6 w-6 object-cover"
							/>
						) : (
							<div className="flex h-6 w-6 items-center justify-center bg-[#22252a] text-xs font-medium text-[#f2efe7]">
								{sellerName.charAt(0).toUpperCase()}
							</div>
						)}
						<div className="truncate text-[15px] font-medium text-[#f2efe7]">
							{sellerName}
						</div>
						<div className="hidden border-l border-[#30352f] pl-3 text-[12px] text-[#817d72] sm:block">
							{documentLabel}
						</div>
					</div>
					<div
						className={`inline-flex border border-[#30352f] px-2.5 py-1 text-[12px] font-medium ${badgeTone}`}
					>
						{statusLabel}
					</div>
				</div>
			</header>

			<main
				ref={stageRef}
				className="flex min-h-0 flex-1 flex-col items-center justify-start gap-4 overflow-y-auto px-4 py-8"
			>
				<section className="grid w-full max-w-[840px] gap-3 sm:grid-cols-3">
					<div className="rounded-md border border-[#30352f] bg-[#171a18] p-4">
						<div className="flex items-center justify-between gap-3">
							<p className="text-xs text-[#aaa294]">Balance due</p>
							<CreditCard className="h-4 w-4 text-[#c8ff62]" />
						</div>
						<p className="mt-2 text-xl font-semibold text-[#f2efe7]">
							{balanceLabel}
						</p>
						<p className="mt-1 text-xs text-[#817d72]">
							{paidLabel} paid of {totalLabel}
						</p>
					</div>
					<div className="rounded-md border border-[#30352f] bg-[#171a18] p-4">
						<div className="flex items-center justify-between gap-3">
							<p className="text-xs text-[#aaa294]">Due date</p>
							<CalendarDays className="h-4 w-4 text-[#d8d1c4]" />
						</div>
						<p className="mt-2 text-xl font-semibold text-[#f2efe7]">
							{dueDateLabel}
						</p>
						<p className="mt-1 text-xs text-[#817d72]">
							{isProforma ? "Pro-forma" : "Invoice"} {invoice.invoiceNumber}
						</p>
					</div>
					<div className="rounded-md border border-[#30352f] bg-[#171a18] p-4">
						<div className="flex items-center justify-between gap-3">
							<p className="text-xs text-[#aaa294]">Payment status</p>
							<ReceiptText className="h-4 w-4 text-[#d8d1c4]" />
						</div>
						<p className="mt-2 text-xl font-semibold text-[#f2efe7]">
							{statusLabel}
						</p>
						<p className="mt-1 text-xs text-[#817d72]">
							{payments.length
								? `${payments.length} payment${payments.length === 1 ? "" : "s"} recorded`
								: "No payments recorded yet"}
						</p>
					</div>
				</section>

				<div
					className="overflow-hidden border border-[#30352f] bg-[#171a18] transition-transform duration-200"
					style={{
						width,
						height,
						transform: `scale(${paperScale})`,
						transformOrigin: "center center",
					}}
				>
					<HtmlTemplate
						data={middayInvoice}
						width={width}
						height={height}
						appearance="public"
					/>
				</div>
				{showCollectionPanel ? (
					<div className="w-full max-w-[595px] rounded-md border border-[#30352f] bg-[#171a18] p-4">
						<div className="flex items-start justify-between gap-4">
							<div>
								<p className="text-sm font-medium text-[#f2efe7]">
									{paymentContext?.depositRequest
										? "Deposit collection"
										: "Payment collection"}
								</p>
								<p className="mt-1 text-xs text-[#aaa294]">
									{collectionStatusLabel}
									{paymentContext?.depositRequest && collectionAmountLabel
										? ` - ${collectionAmountLabel} requested`
										: ""}
								</p>
							</div>
							<Banknote className="h-5 w-5 text-[#c8ff62]" />
						</div>
						{charge?.accountNumber ? (
							<div className="mt-4 grid gap-3 sm:grid-cols-3">
								<div className="rounded-md border border-[#30352f] bg-[#0f1111] p-3">
									<div className="text-[11px] text-[#817d72]">Bank</div>
									<div className="mt-1 text-sm font-medium text-[#f2efe7]">
										{charge.bankName ?? "Paystack transfer"}
									</div>
								</div>
								<div className="rounded-md border border-[#30352f] bg-[#0f1111] p-3">
									<div className="text-[11px] text-[#817d72]">
										Account number
									</div>
									<div className="mt-1 font-mono text-sm font-medium text-[#f2efe7]">
										{charge.accountNumber}
									</div>
								</div>
								<div className="rounded-md border border-[#30352f] bg-[#0f1111] p-3">
									<div className="text-[11px] text-[#817d72]">Expires</div>
									<div className="mt-1 text-sm font-medium text-[#f2efe7]">
										{new Date(charge.expiresAt).toLocaleTimeString([], {
											hour: "2-digit",
											minute: "2-digit",
										})}
									</div>
								</div>
							</div>
						) : canUsePaystackTransfer ? (
							<button
								type="button"
								onClick={() => void createTransferCharge()}
								disabled={isCreatingCharge}
								className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#c8ff62] px-4 text-[13px] font-medium text-[#0f1111] transition-colors hover:bg-[#d5ff7a] disabled:cursor-not-allowed disabled:opacity-60"
							>
								{isCreatingCharge ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<Banknote className="h-4 w-4" />
								)}
								<span>Pay by transfer</span>
							</button>
						) : (
							<div className="mt-4 rounded-md border border-[#30352f] bg-[#0f1111] p-3 text-sm text-[#aaa294]">
								{paymentContext?.payableIssue ??
									`Online collection is not available for this ${isProforma ? "pro-forma" : "invoice"}.`}
							</div>
						)}
					</div>
				) : null}
				<section className="w-full max-w-[595px] rounded-md border border-[#30352f] bg-[#171a18] p-4">
					<div className="flex items-start justify-between gap-4">
						<div>
							<p className="text-sm font-medium text-[#f2efe7]">
								Payment history
							</p>
							<p className="mt-1 text-xs text-[#aaa294]">
								Confirmed payments linked to this{" "}
								{isProforma ? "pro-forma" : "invoice"}.
							</p>
						</div>
						<ReceiptText className="h-5 w-5 text-[#d8d1c4]" />
					</div>
					{paymentHistory === undefined ? (
						<div className="mt-4 space-y-2">
							<div className="h-10 animate-pulse rounded-md bg-[#22252a]" />
							<div className="h-10 animate-pulse rounded-md bg-[#22252a]" />
						</div>
					) : payments.length > 0 ? (
						<div className="mt-4 divide-y divide-[#30352f]">
							{payments.map((payment) => (
								<div
									key={payment.id}
									className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
								>
									<div className="min-w-0">
										<p className="truncate text-sm font-medium text-[#f2efe7]">
											{payment.provider === "paystack"
												? "Paystack transfer"
												: "Manual payment"}
										</p>
										<p className="mt-1 text-xs text-[#817d72]">
											{formatInvoiceDate(payment.createdAt, "ng")}
											{payment.reference ? ` - ${payment.reference}` : ""}
										</p>
									</div>
									<div className="shrink-0 text-sm font-medium text-[#c8ff62]">
										{formatMoney(payment.amount, payment.currency)}
									</div>
								</div>
							))}
						</div>
					) : (
						<div className="mt-4 rounded-md border border-[#30352f] bg-[#0f1111] p-3 text-sm text-[#aaa294]">
							No confirmed payments have been recorded for this{" "}
							{isProforma ? "pro-forma" : "invoice"}.
						</div>
					)}
				</section>
			</main>

			<footer className="border-t border-[#30352f] bg-[#0f1111] px-4 py-4 sm:px-6">
				<div className="mx-auto flex w-full max-w-[840px] flex-col-reverse items-center justify-between gap-4 sm:flex-row">
					<div className="text-[11px] text-[#817d72]">Powered by Velure</div>

					<div className="flex w-full items-center justify-center gap-3 sm:w-auto">
						<a
							href={downloadUrl}
							className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#30352f] bg-[#171a18] px-4 text-[13px] text-[#d8d1c4] transition-colors hover:bg-[#20241f]"
							aria-label="Download invoice PDF"
							title="Download invoice PDF"
						>
							<Download className="h-4 w-4 shrink-0" />
							<span className="hidden sm:inline">Download PDF</span>
							<span className="sm:hidden">PDF</span>
						</a>
						<button
							type="button"
							onClick={() => void copyPublicLink()}
							className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#30352f] bg-[#171a18] px-4 text-[13px] text-[#d8d1c4] transition-colors hover:bg-[#20241f]"
							aria-label="Copy public invoice link"
							title="Copy public invoice link"
						>
							{isLinkCopied ? (
								<Check className="h-4 w-4 shrink-0" />
							) : (
								<Copy className="h-4 w-4 shrink-0" />
							)}
							<span className="hidden sm:inline">
								{isLinkCopied ? "Copied" : "Copy link"}
							</span>
							<span className="sm:hidden">
								{isLinkCopied ? "Copied" : "Copy"}
							</span>
						</button>
					</div>
				</div>
			</footer>
		</section>
	);
}
