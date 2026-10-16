import { list as listInvoices } from "./invoices";
import { listProducts } from "./products";
import { buildRevenueCashFlowReport } from "./revenue-reporting";
import { resolveActiveWorkspaceId, type Supabase } from "./workspaces";

export async function getRevenueCashFlow(
	client: Supabase,
	userId: string,
	args: { from?: string; to?: string; currency?: string; limit?: number } = {},
) {
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) return null;

	const [invoices, products, paymentResult, workspaceResult] =
		await Promise.all([
			listInvoices(client, userId),
			listProducts(client, userId),
			client
				.from("payment_transactions")
				.select(
					"invoice_id, amount, currency, source, provider, reference, created_at",
				)
				.eq("workspace_id", workspaceId),
			client
				.from("workspaces")
				.select("base_currency")
				.eq("id", workspaceId)
				.maybeSingle(),
		]);
	if (paymentResult.error) throw paymentResult.error;
	if (workspaceResult.error) throw workspaceResult.error;

	return buildRevenueCashFlowReport({
		invoices,
		products: products.map((product) => ({
			_id: product.id,
			name: product.name,
			type: product.type,
			deletedAt: undefined,
		})),
		payments: (paymentResult.data ?? []).map((payment) => ({
			invoiceId: payment.invoice_id,
			amount: Number(payment.amount),
			currency: payment.currency,
			source: payment.source as "manual" | "paystack",
			provider: payment.provider as "paystack" | undefined,
			reference: payment.reference ?? undefined,
			createdAt: Date.parse(payment.created_at),
		})),
		baseCurrency: args.currency ?? workspaceResult.data?.base_currency ?? "NGN",
		window: { from: args.from, to: args.to },
		limit: Math.min(Math.max(args.limit ?? 8, 1), 20),
	});
}
