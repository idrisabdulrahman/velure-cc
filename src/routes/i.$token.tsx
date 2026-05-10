import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Check, Copy, CreditCard, Download, ExternalLink } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useResizeObserver } from "#/components/hooks/use-resize-observer";
import { toast } from "#/components/ui/use-toast";
import {
	getInvoiceTemplateSize,
	toMiddayInvoice,
} from "#/features/invoices/midday-adapter";
import { HtmlTemplate } from "#/lib/midday-invoice/templates/html";
import { api } from "../../convex/_generated/api";

export const Route = createFileRoute("/i/$token")({
	component: PublicInvoicePage,
});

function PublicInvoicePage() {
	const { token } = Route.useParams();
	const location = useLocation();
	const stageRef = useRef<HTMLDivElement>(null);
	const invoice = useQuery(api.invoices.getPublicByToken, { token });
	const isEmbedded = new URLSearchParams(location.search).get("embed") === "1";
	const stageEntry = useResizeObserver(stageRef);
	const [isLinkCopied, setIsLinkCopied] = useState(false);

	if (invoice === undefined) {
		return (
			<section className="flex min-h-[100dvh] flex-col bg-[#121314]">
				<div className="mx-auto flex w-full max-w-[840px] items-center justify-between border-b border-[#2b2d30] px-4 py-5 sm:px-6">
					<div className="flex items-center gap-3">
						<div className="h-6 w-6 animate-pulse bg-[#22252a]" />
						<div className="h-4 w-32 animate-pulse bg-[#22252a]" />
					</div>
					<div className="h-6 w-16 animate-pulse bg-[#22252a]" />
				</div>
				<div className="flex flex-1 items-center justify-center p-4 sm:p-8">
					<div className="h-[750px] w-full max-w-[700px] animate-pulse border border-[#2b2d30] bg-[#17191b]" />
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
			<section className="flex min-h-[100dvh] items-center justify-center bg-[#121314] p-4">
				<div className="w-full max-w-md rounded-md border border-[#2b2d30] bg-[#17191b] p-6 text-center">
					<h2 className="text-base font-medium text-[#ece7de]">
						Invoice not found
					</h2>
					<p className="mt-2 text-sm text-[#a29b90]">
						The invoice you are looking for does not exist or the link is
						invalid.
					</p>
					<p className="mt-4 text-xs text-[#7f7a72]">Token: {token}</p>
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
	const statusLabel =
		invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1);
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

	const payUrl =
		invoice.paymentLink?.trim() ||
		`/api/payments/paystack/initialize?token=${encodeURIComponent(invoice.token)}`;

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
		<section className="flex min-h-[100dvh] flex-col bg-[#121314] text-[#ece7de]">
			<header className="border-b border-[#2b2d30] bg-[#121314] px-4 py-4 sm:px-6">
				<div className="mx-auto flex w-full max-w-[840px] items-center justify-between">
					<div className="flex min-w-0 items-center gap-3">
						{invoice.logoUrl?.trim() ? (
							<img
								src={invoice.logoUrl}
								alt={sellerName}
								className="h-6 w-6 object-cover"
							/>
						) : (
							<div className="flex h-6 w-6 items-center justify-center bg-[#22252a] text-xs font-medium text-[#ece7de]">
								{sellerName.charAt(0).toUpperCase()}
							</div>
						)}
						<div className="truncate text-[15px] font-medium text-[#ece7de]">
							{sellerName}
						</div>
					</div>
					<div
						className={`inline-flex border border-[#2b2d30] px-2.5 py-1 text-[12px] font-medium ${badgeTone}`}
					>
						{statusLabel}
					</div>
				</div>
			</header>

			<main
				ref={stageRef}
				className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-8"
			>
				<div
					className="overflow-hidden border border-[#2b2d30] bg-[#17191b] transition-transform duration-200"
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
			</main>

			<footer className="border-t border-[#2b2d30] bg-[#121314] px-4 py-4 sm:px-6">
				<div className="mx-auto flex w-full max-w-[840px] flex-col-reverse items-center justify-between gap-4 sm:flex-row">
					<div className="text-[11px] text-[#8a857d]">Powered by Velure</div>

					<div className="flex w-full items-center justify-center gap-3 sm:w-auto">
						{invoice.status !== "paid" ? (
							<a
								href={payUrl}
								target={invoice.paymentLink?.trim() ? "_blank" : undefined}
								rel={invoice.paymentLink?.trim() ? "noreferrer" : undefined}
								className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#a7bc62] px-4 text-[13px] font-medium text-[#121314] transition-colors hover:bg-[#b5c97a]"
								aria-label="Pay invoice"
								title="Pay invoice"
							>
								<CreditCard className="h-4 w-4 shrink-0" />
								<span>Pay invoice</span>
								{invoice.paymentLink?.trim() ? (
									<ExternalLink className="h-3.5 w-3.5" />
								) : null}
							</a>
						) : null}
						<a
							href={downloadUrl}
							className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#2b2d30] bg-[#17191b] px-4 text-[13px] text-[#d5d0c7] transition-colors hover:bg-[#1d2023]"
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
							className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[#2b2d30] bg-[#17191b] px-4 text-[13px] text-[#d5d0c7] transition-colors hover:bg-[#1d2023]"
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
