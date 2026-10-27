import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { Banknote, Check, Copy, Download, ReceiptText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useResizeObserver } from "#/components/hooks/use-resize-observer";
import { AppLoader } from "#/components/ui/app-loader";
import { Spinner } from "#/components/ui/spinner";
import { toast } from "#/components/ui/use-toast";
import { formatInvoiceDate, formatMoney } from "#/features/invoices/format";
import {
	getInvoiceTemplateSize,
	toMiddayInvoice,
} from "#/features/invoices/midday-adapter";
import type { InvoiceRecord } from "#/features/invoices/types";
import { INVOICE_DOCUMENT_TYPE_LABELS } from "#/features/invoices/types";
import { HtmlTemplate } from "#/lib/midday-invoice/templates/html";
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
	const [isCreatingCharge, setIsCreatingCharge] = useState(false);

	useEffect(() => {
		if (invoice && invoice.status !== "canceled") {
			void fetch(`/api/invoice/public/${encodeURIComponent(token)}`, {
				method: "POST",
			});
		}
	}, [invoice, token]);

	if (invoice === undefined) {
		return (
			<section className="flex min-h-[100dvh] items-center justify-center bg-paper">
				<AppLoader label="Loading invoice" />
			</section>
		);
	}

	if (!invoice) {
		return (
			<section className="flex min-h-[100dvh] items-center justify-center bg-paper p-4">
				<div className="w-full max-w-md rounded-md border border-rule bg-paper-2 p-6 text-center">
					<h2 className="text-base font-medium text-ink">Invoice not found</h2>
					<p className="mt-2 text-sm text-ink-3">
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
	const documentLabel =
		INVOICE_DOCUMENT_TYPE_LABELS[invoice.documentType ?? "standard"];
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
	const collectionAmountLabel = paymentContext?.collectionAmount
		? formatMoney(paymentContext.collectionAmount, invoice.currency)
		: null;

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
			<section className="flex h-full w-full items-center justify-center overflow-hidden bg-paper p-4">
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
		<section className="dotted-bg min-h-[100dvh] bg-[#0b0b0c] text-[#f2ede6]">
			<div
				className="mx-auto flex w-full max-w-full flex-col px-4 py-6 sm:px-6 md:px-0"
				style={{ maxWidth: width }}
			>
				<header className="mb-4 flex items-center justify-between">
					<div className="flex min-w-0 items-center gap-3">
						{invoice.logoUrl?.trim() ? (
							<img
								src={invoice.logoUrl}
								alt={sellerName}
								className="h-5 w-5 rounded-full border border-[#242426] object-cover"
							/>
						) : (
							<div className="flex h-5 w-5 items-center justify-center rounded-full border border-[#242426] bg-[#1a1a1b] text-[9px] font-medium">
								{sellerName.charAt(0).toUpperCase()}
							</div>
						)}
						<div className="truncate text-sm">{sellerName}</div>
					</div>
					<div className={`hm-ts-stamp ${badgeModifier}`}>{statusLabel}</div>
				</header>

				<main
					ref={stageRef}
					className="flex flex-col items-center pb-24 md:pb-16"
				>
					<div
						style={{
							width: width * paperScale,
							height: height * paperScale,
						}}
					>
						<div
							className="shadow-[0_24px_48px_-12px_rgba(0,0,0,0.6)]"
							style={{
								width,
								height,
								transform: `scale(${paperScale})`,
								transformOrigin: "top left",
							}}
						>
							<HtmlTemplate
								data={middayInvoice}
								width={width}
								height={height}
								appearance="public"
							/>
						</div>
					</div>
					{showCollectionPanel ? (
						<div className="mt-8 w-full rounded-md border border-[#242426] bg-[#101011] p-4">
							<div className="flex items-start justify-between gap-4">
								<div>
									<p className="text-sm font-medium text-ink">
										{paymentContext?.depositRequest
											? "Deposit collection"
											: "Payment collection"}
									</p>
									<p className="mt-1 text-xs text-ink-3">
										{collectionStatusLabel}
										{paymentContext?.depositRequest && collectionAmountLabel
											? ` - ${collectionAmountLabel} requested`
											: ""}
									</p>
								</div>
								<Banknote className="h-5 w-5 text-brand" />
							</div>
							{charge?.accountNumber ? (
								<div className="mt-4 grid gap-3 sm:grid-cols-3">
									<div className="rounded-md border border-rule bg-paper p-3">
										<div className="text-[11px] text-ink-3">Bank</div>
										<div className="mt-1 text-sm font-medium text-ink">
											{charge.bankName ?? "Paystack transfer"}
										</div>
									</div>
									<div className="rounded-md border border-rule bg-paper p-3">
										<div className="text-[11px] text-ink-3">Account number</div>
										<div className="mt-1 font-mono text-sm font-medium text-ink">
											{charge.accountNumber}
										</div>
									</div>
									<div className="rounded-md border border-rule bg-paper p-3">
										<div className="text-[11px] text-ink-3">Expires</div>
										<div className="mt-1 text-sm font-medium text-ink">
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
									className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-brand px-4 text-[13px] font-medium text-brand-ink transition-colors hover:bg-brand-hi disabled:cursor-not-allowed disabled:opacity-60"
								>
									{isCreatingCharge ? (
										<Spinner size={16} />
									) : (
										<Banknote className="h-4 w-4" />
									)}
									<span>Pay by transfer</span>
								</button>
							) : (
								<div className="mt-4 rounded-md border border-rule bg-paper p-3 text-sm text-ink-3">
									{paymentContext?.payableIssue ??
										`Online collection is not available for this ${documentLabel.toLowerCase()}.`}
								</div>
							)}
						</div>
					) : null}
					<section className="mt-4 w-full rounded-md border border-[#242426] bg-[#101011] p-4">
						<div className="flex items-start justify-between gap-4">
							<div>
								<p className="text-sm font-medium text-ink">Payment history</p>
								<p className="mt-1 text-xs text-ink-3">
									Confirmed payments linked to this{" "}
									{documentLabel.toLowerCase()}.
								</p>
							</div>
							<ReceiptText className="h-5 w-5 text-ink-2" />
						</div>
						{paymentHistory === undefined ? (
							<div
								role="status"
								aria-label="Loading payment history"
								className="mt-4 flex justify-center py-3"
							>
								<Spinner className="text-brand !stroke-brand" />
							</div>
						) : payments.length > 0 ? (
							<div className="mt-4 divide-y divide-rule">
								{payments.map((payment) => (
									<div
										key={payment.id}
										className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
									>
										<div className="min-w-0">
											<p className="truncate text-sm font-medium text-ink">
												{payment.provider === "paystack"
													? "Paystack transfer"
													: "Manual payment"}
											</p>
											<p className="mt-1 text-xs text-ink-3">
												{formatInvoiceDate(payment.createdAt, "ng")}
												{payment.reference ? ` - ${payment.reference}` : ""}
											</p>
										</div>
										<div className="shrink-0 text-sm font-medium text-brand">
											{formatMoney(payment.amount, payment.currency)}
										</div>
									</div>
								))}
							</div>
						) : (
							<div className="mt-4 rounded-md border border-rule bg-paper p-3 text-sm text-ink-3">
								No confirmed payments have been recorded for this{" "}
								{documentLabel.toLowerCase()}.
							</div>
						)}
					</section>
				</main>
			</div>

			<div className="fixed inset-x-0 bottom-5 z-20 flex justify-center">
				<div className="flex h-10 items-center rounded-full border border-[#303033] bg-[#1a1a1a]/80 px-2 backdrop-blur-lg">
					<a
						href={downloadUrl}
						className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#d7d3cc] transition-colors hover:bg-white/10 hover:text-white"
						aria-label="Download invoice PDF"
						title="Download invoice PDF"
					>
						<Download className="h-4 w-4 shrink-0" />
					</a>
					<button
						type="button"
						onClick={() => void copyPublicLink()}
						className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#d7d3cc] transition-colors hover:bg-white/10 hover:text-white"
						aria-label="Copy public invoice link"
						title="Copy public invoice link"
					>
						{isLinkCopied ? (
							<Check className="h-4 w-4 shrink-0" />
						) : (
							<Copy className="h-4 w-4 shrink-0" />
						)}
					</button>
				</div>
			</div>

			<div className="fixed bottom-4 right-4 hidden text-[9px] text-[#878787] md:block">
				Powered by <span className="text-[#d7d3cc]">Velure</span>
			</div>
		</section>
	);
}
