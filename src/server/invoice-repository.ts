import { ConvexHttpClient } from "convex/browser";
import type { InvoiceRecord } from "#/features/invoices/types";
import { firstServerEnv } from "#/server/env";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export type Invoice = InvoiceRecord;

function getAuthenticatedConvexClient(sessionToken: string) {
	const deploymentUrl = firstServerEnv(
		"CONVEX_URL",
		"VITE_CONVEX_URL",
		"CONVEX_SITE_URL",
	);

	if (!deploymentUrl) {
		throw new Error("Missing CONVEX_URL or VITE_CONVEX_URL");
	}

	const client = new ConvexHttpClient(deploymentUrl);
	client.setAuth(sessionToken);
	return client;
}

export async function getAuthenticatedInvoiceById(
	id: string,
	sessionToken: string,
) {
	const convex = getAuthenticatedConvexClient(sessionToken);

	return (await convex.query(api.invoices.getById, {
		id: id as Id<"invoices">,
	})) as Invoice | null;
}

export async function recordInvoiceDeliveryEvent(
	sessionToken: string,
	input: {
		invoiceId: string;
		recipient: string;
		status: "sent" | "failed";
		providerMessageId?: string;
		error?: string;
		publicUrl?: string;
	},
) {
	const convex = getAuthenticatedConvexClient(sessionToken);

	return await convex.mutation(api.invoices.recordDeliveryEvent, {
		invoiceId: input.invoiceId as Id<"invoices">,
		channel: "email",
		recipient: input.recipient,
		provider: "resend",
		status: input.status,
		providerMessageId: input.providerMessageId,
		error: input.error,
		publicUrl: input.publicUrl,
	});
}
