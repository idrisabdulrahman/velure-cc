import { ConvexHttpClient } from "convex/browser";
import type { InvoiceRecord } from "#/features/invoices/types";
import { firstServerEnv } from "#/server/env";
import { api } from "../../convex/_generated/api";

export type Invoice = InvoiceRecord;

function getConvexClient() {
	const deploymentUrl = firstServerEnv(
		"CONVEX_URL",
		"VITE_CONVEX_URL",
		"CONVEX_SITE_URL",
	);

	if (!deploymentUrl) {
		throw new Error("Missing CONVEX_URL or VITE_CONVEX_URL");
	}

	return new ConvexHttpClient(deploymentUrl);
}

export async function getInvoiceByToken(token: string) {
	const convex = getConvexClient();

	return (await convex.query(api.invoices.getPublicByToken, {
		token,
	})) as Invoice | null;
}
