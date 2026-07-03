import { randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import type { InvoiceRecord, InvoiceStatus } from "#/features/invoices/types";
import { firstServerEnv } from "#/server/env";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

export type Invoice = InvoiceRecord;

let convexClient: ConvexHttpClient | null = null;

function getConvexClient() {
	if (convexClient) return convexClient;

	const deploymentUrl = firstServerEnv(
		"CONVEX_URL",
		"VITE_CONVEX_URL",
		"NUXT_CONVEX_URL",
	);

	if (!deploymentUrl) {
		throw new Error("Missing CONVEX_URL or VITE_CONVEX_URL");
	}

	convexClient = new ConvexHttpClient(deploymentUrl);
	return convexClient;
}

function getAuthenticatedConvexClient(sessionToken: string) {
	const deploymentUrl = firstServerEnv(
		"CONVEX_URL",
		"VITE_CONVEX_URL",
		"NUXT_CONVEX_URL",
	);

	if (!deploymentUrl) {
		throw new Error("Missing CONVEX_URL or VITE_CONVEX_URL");
	}

	const client = new ConvexHttpClient(deploymentUrl);
	client.setAuth(sessionToken);
	return client;
}

function nextInvoiceNumber(invoices: Invoice[]) {
	const year = new Date().getFullYear();
	return `INV-${year}-${String(invoices.length + 1).padStart(6, "0")}`;
}

function randomId(prefix: string) {
	return `${prefix}-${randomUUID()}`;
}

export async function listInvoices(filter?: {
	q?: string;
	status?: "all" | InvoiceStatus;
}) {
	const convex = getConvexClient();

	return (await convex.query(api.invoices.list, {
		q: filter?.q,
		status: filter?.status,
	})) as Invoice[];
}

export async function getInvoiceById(id: string) {
	const convex = getConvexClient();

	return (await convex.query(api.invoices.getById, {
		id: id as Id<"invoices">,
	})) as Invoice | null;
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

export async function getInvoiceByToken(token: string) {
	const convex = getConvexClient();

	return (await convex.query(api.invoices.getPublicByToken, {
		token,
	})) as Invoice | null;
}

export async function createDraftInvoice() {
	const convex = getConvexClient();

	const existing = await listInvoices({ status: "all" });
	const now = new Date();
	const dueDate = new Date(now);
	dueDate.setDate(dueDate.getDate() + 14);

	const draft = {
		token: randomId("pub"),
		invoiceNumber: nextInvoiceNumber(existing),
		customerName: "",
		currency: "NGN",
		dateFormat: "ng" as const,
		invoiceSize: "A4" as const,
		issueDate: now.toISOString().slice(0, 10),
		dueDate: dueDate.toISOString().slice(0, 10),
		lineItems: [{ id: randomId("li"), name: "", quantity: 1, price: 0 }],
	};

	return (await convex.mutation(api.invoices.createDraft, draft)) as Invoice;
}

export async function saveInvoice(input: Invoice) {
	const convex = getConvexClient();

	return (await convex.mutation(api.invoices.save, {
		...input,
		id: input.id as Id<"invoices">,
	})) as unknown as Invoice;
}

export async function invoiceSummary() {
	const convex = getConvexClient();

	return (await convex.query(api.invoices.summary, {})) as {
		open: number;
		paid: number;
		overdue: number;
	};
}

export async function listInvoiceProducts() {
	const convex = getConvexClient();

	return (await convex.query(api.invoices.products, {})) as Array<{
		name: string;
		quantity: number;
		amount: number;
		currency: string;
		usedIn: number;
	}>;
}
