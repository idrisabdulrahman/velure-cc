import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Spinner } from "#/components/ui/spinner";
import { toast } from "#/components/ui/use-toast";
import { formatMoney } from "#/features/invoices/format";
import type { InvoiceRecord } from "#/features/invoices/types";

/**
 * WP-A seller surface: buyer payment claims for one invoice.
 *
 * A claim is **evidence, not settlement** — confirming calls the server, which
 * settles through the existing `recordPayment` path and only then marks the
 * claim confirmed. The invoice on screen is refreshed from the parent query
 * after a confirmation so the paid state appears without a manual reload.
 *
 * Renders nothing when there is no claim, so invoices without buyer activity
 * look exactly as before.
 */

type PaymentClaimStatus = "claimed" | "confirmed" | "rejected";

type PaymentClaimSummary = {
	id: string;
	invoiceId: string;
	claimedAmount: number;
	claimReference: string | null;
	note: string | null;
	status: PaymentClaimStatus;
	claimedAt: number;
	resolvedAt: number | null;
	resolvedBy: string | null;
};

const STATUS_LABEL: Record<PaymentClaimStatus, string> = {
	claimed: "Awaiting your confirmation",
	confirmed: "Confirmed",
	rejected: "Rejected",
};

async function fetchClaims(invoiceId: string): Promise<PaymentClaimSummary[]> {
	const response = await fetch(
		`/api/invoice/claims?invoiceId=${encodeURIComponent(invoiceId)}`,
	);
	if (!response.ok) return [];
	const payload = (await response.json().catch(() => null)) as {
		ok?: boolean;
		claims?: PaymentClaimSummary[];
	} | null;
	return payload?.ok ? (payload.claims ?? []) : [];
}

export function PaymentClaimsSection({ invoice }: { invoice: InvoiceRecord }) {
	const queryClient = useQueryClient();
	const [pendingId, setPendingId] = useState<string | null>(null);
	const claimsQuery = useQuery({
		queryKey: ["payment-claims", invoice.id],
		queryFn: () => fetchClaims(invoice.id),
	});

	const claims = claimsQuery.data ?? [];
	if (claims.length === 0) return null;

	const resolveClaim = async (
		claimId: string,
		action: "confirm" | "reject",
	) => {
		setPendingId(claimId);
		try {
			const response = await fetch(
				`/api/invoice/claims/${encodeURIComponent(claimId)}`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ action }),
				},
			);
			const payload = (await response.json().catch(() => null)) as {
				ok?: boolean;
				error?: string;
			} | null;
			if (!response.ok || !payload?.ok) {
				throw new Error(payload?.error ?? "Could not update the claim.");
			}
			await queryClient.invalidateQueries({
				queryKey: ["payment-claims", invoice.id],
			});
			if (action === "confirm") {
				// The confirmation recorded a payment server-side, so refresh the
				// invoice the sheet is showing.
				await queryClient.invalidateQueries({
					queryKey: ["supabase-invoices"],
				});
			}
			toast({
				title: action === "confirm" ? "Payment confirmed" : "Claim rejected",
				variant: "success",
			});
		} catch (error) {
			toast({
				title: "Could not update the claim",
				description: error instanceof Error ? error.message : "Try again.",
				variant: "error",
			});
		} finally {
			setPendingId(null);
		}
	};

	return (
		<section className="rounded-md border border-rule bg-paper-2 p-4">
			<h3 className="text-sm font-medium text-ink">Payment claims</h3>
			<p className="mt-1 text-xs text-ink-3">
				Buyers who tapped “I&apos;ve paid”. The invoice is not marked paid until
				you confirm.
			</p>
			<ul className="mt-3 divide-y divide-rule">
				{claims.map((claim) => {
					const isPendingRow = pendingId === claim.id;
					return (
						<li
							key={claim.id}
							className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
						>
							<div className="min-w-0">
								<p className="text-sm font-medium text-ink">
									{formatMoney(claim.claimedAmount, invoice.currency)}
								</p>
								<p className="mt-1 text-xs text-ink-3">
									{STATUS_LABEL[claim.status]}
									{claim.claimReference ? ` · ${claim.claimReference}` : ""}
								</p>
								{claim.note ? (
									<p className="mt-1 text-xs text-ink-2">{claim.note}</p>
								) : null}
							</div>
							{claim.status === "claimed" ? (
								<div className="flex shrink-0 gap-2">
									<Button
										type="button"
										onClick={() => void resolveClaim(claim.id, "confirm")}
										disabled={isPendingRow}
										className="h-9 rounded-md bg-brand px-3 text-[13px] font-medium text-brand-ink hover:bg-brand-hi"
									>
										{isPendingRow ? (
											<Spinner size={14} />
										) : (
											<Check className="h-4 w-4" />
										)}
										<span>Confirm</span>
									</Button>
									<Button
										type="button"
										variant="ghost"
										onClick={() => void resolveClaim(claim.id, "reject")}
										disabled={isPendingRow}
										className="h-9 rounded-md border border-rule bg-paper px-3 text-[13px] text-ink-2 hover:bg-paper-2 hover:text-ink"
									>
										<X className="h-4 w-4" />
										<span>Reject</span>
									</Button>
								</div>
							) : null}
						</li>
					);
				})}
			</ul>
		</section>
	);
}
