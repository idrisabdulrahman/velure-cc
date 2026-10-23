import type { Database, Json } from "#/types/database.types";
import { recordInvoiceAudit } from "./audit-client";
import { isInvoiceIssued } from "./invoice-numbering";
import {
	assertCustomerForIssueTransition,
	getDerivedInvoiceStatus,
	getById as getInvoiceById,
} from "./invoices";
import { resolveActiveWorkspaceId, type Supabase } from "./workspaces";

/**
 * A10 — payments domain, ported to Supabase.
 *
 * RLS-pure: every function takes a USER-scoped Supabase client (the one
 * holding the OIDC-minted JWT) and never sends a user id for authorization.
 * RLS decides. A missing membership returns zero rows / null, not an error.
 *
 * Port of convex/payments.ts (the UI-facing surface): recordPayment,
 * listInvoicePayments, getPublicPaymentContext, listPublicInvoicePayments.
 * Return shapes match the Convex surface so call sites compile unchanged.
 *
 * Server-internal machinery lives in `./paystack-server`: charge creation
 * (ensurePaystackTransferCharge), Paystack webhook handling
 * (confirmPaystackWebhookPayment), and the internal charge lookups.
 * Append-only audit-log writes (audit_logs is SELECT-only for members under
 * RLS) go through `./audit-client`, a browser-safe transport that POSTs to
 * `POST /api/invoice/audit`, where the server derives the actor from the
 * verified session and writes with the admin client. No browser-imported
 * module touches `getSupabaseAdminClient`.
 *
 * Public anonymous access note: getPublicPaymentContext /
 * listPublicInvoicePayments are public queries in Convex (payer pages run
 * unauthenticated). Under Supabase, anonymous reads go through the
 * service-role `public_invoice_by_token` RPC path; this port resolves the
 * same shapes through a member-scoped client (the gate exercises that).
 */

export type PaymentSource = "manual" | "paystack";
export type PaymentChargeStatus =
	| "pending"
	| "success"
	| "succeeded"
	| "failed"
	| "expired"
	| "reversed";

export type PaymentTransaction = {
	_id: string;
	workspaceId: string;
	ownerId?: string;
	invoiceId: string;
	source: PaymentSource;
	provider?: "paystack";
	reference?: string;
	providerPaymentId?: string;
	eventType?: string;
	providerStatus?: string;
	amount: number;
	currency: string;
	recordedBy?: string;
	customerEmail?: string;
	rawEvent?: string;
	createdAt: number;
	updatedAt: number;
};

export type PaymentCharge = {
	_id: string;
	workspaceId: string;
	invoiceId: string;
	provider: "paystack";
	reference: string;
	status: PaymentChargeStatus;
	amount: number;
	currency: string;
	accountName?: string;
	accountNumber?: string;
	bankName?: string;
	bankSlug?: string;
	expiresAt: number;
	providerStatus?: string;
	providerMessage?: string;
	rawResponse?: string;
	createdAt: number;
	updatedAt: number;
};

export type PaymentCapabilities = {
	automaticBankTransfer: boolean;
	provider: "paystack" | null;
};

export type PublicCharge = {
	reference: string;
	status: PaymentChargeStatus;
	amount: number;
	currency: string;
	accountName?: string;
	accountNumber?: string;
	bankName?: string;
	expiresAt: number;
};

export type PublicPaymentContext = {
	capabilities: PaymentCapabilities;
	charge: PublicCharge | null;
	payable: boolean;
	payableIssue: string | null;
	collectionAmount: number;
	depositRequest: { kind?: string; value?: number } | undefined;
};

type InvoicePaymentState = {
	paymentAmount?: number;
	status?: string;
	deliveredAt?: number;
	lifecycle?: {
		emailDeliveredAt?: number;
		sentAt?: number;
		paymentReceivedAt?: number;
	};
	canceledAt?: number;
	dueDate?: string;
	updatedAt?: number;
	currency?: string;
	lineItems?: Array<{ quantity: number; price: number }>;
	compliance?: {
		netPayable?: number;
		grandTotal?: number;
		withholdingTaxAmount?: number;
	};
	documentType?: string;
	depositRequest?: { kind?: string; value?: number };
};

type PaymentTransactionRow = {
	id: string;
	workspace_id: string;
	owner_id: string | null;
	invoice_id: string;
	source: PaymentSource;
	provider: string | null;
	reference: string | null;
	provider_payment_id: string | null;
	event_type: string | null;
	provider_status: string | null;
	amount: number;
	currency: string;
	recorded_by: string | null;
	customer_email: string | null;
	raw_event: unknown;
	created_at: string;
	updated_at: string;
};

export type PaymentChargeRow = {
	id: string;
	workspace_id: string;
	invoice_id: string;
	provider: "paystack";
	reference: string;
	status: PaymentChargeStatus;
	amount: number;
	currency: string;
	account_name: string | null;
	account_number: string | null;
	bank_name: string | null;
	bank_slug: string | null;
	expires_at: string;
	provider_status: string | null;
	provider_message: string | null;
	raw_response: unknown;
	created_at: string;
	updated_at: string;
};

const PAYSTACK_PWT_COUNTRIES = ["NG"] as const;

export function getPaymentCapabilities(
	workspace:
		| Pick<{ countryCode?: string | null }, "countryCode">
		| null
		| undefined,
): PaymentCapabilities {
	const countryCode = workspace?.countryCode?.toUpperCase();
	const supportsPaystackPwt = PAYSTACK_PWT_COUNTRIES.includes(
		countryCode as (typeof PAYSTACK_PWT_COUNTRIES)[number],
	);
	return {
		automaticBankTransfer: supportsPaystackPwt,
		provider: supportsPaystackPwt ? "paystack" : null,
	};
}

export function roundMoney(amount: number) {
	return Math.round(amount * 100) / 100;
}

export function invoiceAmount(invoice: InvoicePaymentState) {
	if (invoice.compliance?.netPayable !== undefined) {
		return Math.max(0, invoice.compliance.netPayable);
	}
	if (invoice.compliance?.grandTotal !== undefined) {
		return Math.max(
			0,
			invoice.compliance.grandTotal -
				(invoice.compliance.withholdingTaxAmount ?? 0),
		);
	}
	return Math.max(
		0,
		(invoice.lineItems ?? []).reduce(
			(sum, item) => sum + item.quantity * item.price,
			0,
		),
	);
}

function currentPaymentAmount(invoice: InvoicePaymentState, total: number) {
	if (typeof invoice.paymentAmount === "number") {
		return Math.max(0, invoice.paymentAmount);
	}
	return invoice.status === "paid" ? total : 0;
}

function deliveredAtForInvoice(invoice: InvoicePaymentState) {
	return (
		invoice.deliveredAt ??
		invoice.lifecycle?.emailDeliveredAt ??
		invoice.lifecycle?.sentAt ??
		(invoice.status && invoice.status !== "draft"
			? invoice.updatedAt
			: undefined)
	);
}

export function derivedPaymentStatus(
	invoice: InvoicePaymentState,
	now = Date.now(),
) {
	const total = invoiceAmount(invoice);
	const paid = currentPaymentAmount(invoice, total);

	if (invoice.canceledAt || invoice.status === "canceled") return "canceled";
	if (total > 0 && paid >= total) return "paid";
	if (paid > 0 && paid < total) return "partially-paid";
	if (!deliveredAtForInvoice(invoice)) return "draft";

	const dueDate = invoice.dueDate
		? new Date(`${invoice.dueDate}T00:00:00`)
		: null;
	if (dueDate && !Number.isNaN(dueDate.getTime())) {
		const today = new Date(now);
		today.setHours(0, 0, 0, 0);
		if (dueDate.getTime() < today.getTime()) return "overdue";
	}

	return "unpaid";
}

export function getInvoicePaymentSnapshot(
	invoice: InvoicePaymentState,
	now = Date.now(),
) {
	const total = roundMoney(invoiceAmount(invoice));
	const paid = roundMoney(currentPaymentAmount(invoice, total));
	const balance = roundMoney(Math.max(0, total - paid));
	const status = derivedPaymentStatus(invoice, now);
	return { status, total, paid, balance };
}

export function payableInvoiceIssue(
	invoice: InvoicePaymentState,
	options: { allowDraft?: boolean } = {},
) {
	const { status, balance } = getInvoicePaymentSnapshot(invoice);
	// `allowDraft` is for the owner's manual "Mark as paid" only — an unsent
	// draft can still be settled offline. Public payment context and the
	// Paystack transfer-charge path keep blocking drafts: nobody should be
	// able to collect money online against an invoice that was never sent.
	if (status === "draft" && !options.allowDraft)
		return "Draft invoices are not payable.";
	if (status === "paid" || balance <= 0)
		return "Paid invoices are not payable.";
	if (status === "canceled") return "Canceled invoices are not payable.";
	return null;
}

export function applyPaymentToSnapshot(
	snapshot: { total: number; paid: number; balance: number },
	amount: number,
) {
	const roundedAmount = roundMoney(amount);
	if (!Number.isFinite(roundedAmount) || roundedAmount <= 0) {
		throw new Error("Payment amount must be greater than zero.");
	}
	if (roundedAmount > snapshot.balance) {
		throw new Error("Payment amount cannot exceed the invoice balance.");
	}
	const nextPaymentAmount = roundMoney(snapshot.paid + roundedAmount);
	const remainingBalance = roundMoney(
		Math.max(0, snapshot.total - nextPaymentAmount),
	);
	const isPaid = snapshot.total > 0 && remainingBalance === 0;
	return {
		amount: roundedAmount,
		nextPaymentAmount,
		remainingBalance,
		isPaid,
		invoiceAuditAction: isPaid
			? ("invoice.paid" as const)
			: ("invoice.partially_paid" as const),
	};
}

function isActiveCollectionSession(
	session: { status: string; expiresAt: number },
	now = Date.now(),
) {
	return session.status === "pending" && session.expiresAt > now;
}

export function canReuseCollectionSession(
	session: {
		status: string;
		expiresAt: number;
		amount: number;
		currency: string;
	},
	args: { amount: number; currency: string; now?: number },
) {
	return (
		isActiveCollectionSession(session, args.now) &&
		roundMoney(session.amount) === roundMoney(args.amount) &&
		session.currency === args.currency
	);
}

function requestedDepositAmount(invoice: InvoicePaymentState, total: number) {
	if ((invoice.documentType ?? "standard") !== "proforma") return null;
	const request = invoice.depositRequest;
	if (!request) return null;
	const value = request.value;
	if (!Number.isFinite(value) || value === undefined || value <= 0) return null;
	const amount = request.kind === "percentage" ? (total * value) / 100 : value;
	return roundMoney(Math.min(Math.max(amount, 0), total));
}

export function collectionAmountForInvoice(
	invoice: InvoicePaymentState,
	snapshot: { total: number; paid: number; balance: number },
) {
	const requestedDeposit = requestedDepositAmount(invoice, snapshot.total);
	if (requestedDeposit === null) return snapshot.balance;
	const remainingDeposit = roundMoney(
		Math.max(0, requestedDeposit - snapshot.paid),
	);
	return remainingDeposit > 0
		? Math.min(remainingDeposit, snapshot.balance)
		: snapshot.balance;
}

export function publicCharge(
	charge: PaymentCharge | null | undefined,
): PublicCharge | null {
	if (!charge) return null;
	return {
		reference: charge.reference,
		status: charge.status,
		amount: charge.amount,
		currency: charge.currency,
		accountName: charge.accountName,
		accountNumber: charge.accountNumber,
		bankName: charge.bankName,
		expiresAt: charge.expiresAt,
	};
}

function epoch(value?: string | null): number | undefined {
	if (!value) return undefined;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? undefined : ms;
}

function toPaymentTransaction(row: PaymentTransactionRow): PaymentTransaction {
	return {
		_id: row.id,
		workspaceId: row.workspace_id,
		ownerId: row.owner_id ?? undefined,
		invoiceId: row.invoice_id,
		source: row.source,
		provider: row.provider === "paystack" ? "paystack" : undefined,
		reference: row.reference ?? undefined,
		providerPaymentId: row.provider_payment_id ?? undefined,
		eventType: row.event_type ?? undefined,
		providerStatus: row.provider_status ?? undefined,
		amount: Number(row.amount),
		currency: row.currency,
		recordedBy: row.recorded_by ?? undefined,
		customerEmail: row.customer_email ?? undefined,
		rawEvent:
			typeof row.raw_event === "string"
				? (row.raw_event as string)
				: row.raw_event !== null
					? JSON.stringify(row.raw_event)
					: undefined,
		createdAt: epoch(row.created_at) ?? 0,
		updatedAt: epoch(row.updated_at) ?? 0,
	};
}

export function toPaymentCharge(row: PaymentChargeRow): PaymentCharge {
	return {
		_id: row.id,
		workspaceId: row.workspace_id,
		invoiceId: row.invoice_id,
		provider: "paystack",
		reference: row.reference,
		status: row.status,
		amount: Number(row.amount),
		currency: row.currency,
		accountName: row.account_name ?? undefined,
		accountNumber: row.account_number ?? undefined,
		bankName: row.bank_name ?? undefined,
		bankSlug: row.bank_slug ?? undefined,
		expiresAt: epoch(row.expires_at) ?? 0,
		providerStatus: row.provider_status ?? undefined,
		providerMessage: row.provider_message ?? undefined,
		rawResponse:
			typeof row.raw_response === "string"
				? (row.raw_response as string)
				: row.raw_response !== null
					? JSON.stringify(row.raw_response)
					: undefined,
		createdAt: epoch(row.created_at) ?? 0,
		updatedAt: epoch(row.updated_at) ?? 0,
	};
}

/**
 * Record a manual payment against an invoice. Mirrors convex/payments.ts
 * recordPayment: enforces the payable invariant, dedupes by reference
 * (paystack source), inserts the transaction row, then patches the invoice
 * payment state (amount, paidAt, reference, reminder, lifecycle, status).
 */
export async function recordPayment(
	client: Supabase,
	userId: string,
	args: {
		invoiceId: string;
		amount: number;
		recordedAt?: number;
		reference?: string;
	},
) {
	const invoice = await getInvoiceById(client, userId, args.invoiceId);
	if (!invoice) throw new Error("Invoice not found.");

	if (args.reference) {
		const { data: existing, error: dupError } = await client
			.from("payment_transactions")
			.select("id")
			.eq("reference", args.reference)
			.maybeSingle();
		if (dupError) throw dupError;
		if (existing)
			return { ok: true, duplicate: true, invoiceId: args.invoiceId };
	}

	const issue = payableInvoiceIssue(invoice, { allowDraft: true });
	if (issue) throw new Error(issue);

	const snapshot = getInvoicePaymentSnapshot(invoice);
	const payment = applyPaymentToSnapshot(snapshot, args.amount);

	const now = args.recordedAt ?? Date.now();
	const workspaceId = await resolveActiveWorkspaceId(client, userId);
	if (!workspaceId) throw new Error("No active workspace.");

	// B2 — customer required to leave Draft: a settlement moves a derived-Draft
	// invoice straight to paid / partially-paid, so it runs the same gate as
	// every other leave-Draft path BEFORE the transaction row and the invoice
	// patch are written. Invoices that do not derive Draft (issued / legacy
	// rows, including ones without a customer) are unaffected —
	// transitionLeavesDraft returns before any customer lookup.
	await assertCustomerForIssueTransition(
		client,
		workspaceId,
		invoice,
		getDerivedInvoiceStatus(invoice),
		payment.isPaid ? "paid" : "partially-paid",
	);

	const { error: insertError } = await client
		.from("payment_transactions")
		.insert({
			workspace_id: workspaceId,
			owner_id: userId,
			invoice_id: args.invoiceId,
			source: "manual",
			provider: null,
			reference: args.reference ?? null,
			amount: payment.amount,
			currency: invoice.currency,
			recorded_by: userId,
		});
	if (insertError) throw insertError;

	const invoicePatch: Record<string, unknown> = {
		payment_amount: payment.nextPaymentAmount,
		paid_at: payment.isPaid ? iso(now) : iso(invoice.paidAt),
		// C2 keeps this invoice-level pointer forward-only once set; each
		// manual payment retains its own reference on payment_transactions.
		payment_reference: invoice.paymentReference ?? args.reference ?? null,
		updated_at: iso(now),
	};
	const currentReminder = (invoice.reminder as
		| Record<string, unknown>
		| null
		| undefined) ?? {
		enabled: true,
		paused: false,
		stage: "none",
		escalationStatus: "idle",
	};
	invoicePatch.reminder = payment.isPaid
		? {
				...currentReminder,
				paidAt: now,
				nextReminderAt: undefined,
			}
		: invoice.reminder;
	const lifecycle =
		(invoice.lifecycle as Record<string, unknown> | null | undefined) ?? {};
	invoicePatch.lifecycle = {
		...lifecycle,
		paymentReceivedAt: lifecycle.paymentReceivedAt ?? now,
	};
	invoicePatch.status = payment.isPaid
		? "paid"
		: payment.nextPaymentAmount > 0
			? "partially-paid"
			: invoice.status;

	const { error: patchError } = await client
		.from("invoices")
		.update(toInvoiceUpdate(invoicePatch))
		.eq("id", args.invoiceId)
		.eq("workspace_id", workspaceId);
	if (patchError) throw patchError;

	// Append-only audit row for the money path (spec G1): the server records
	// the payment it just applied, with the invoice state before and after.
	// C3: money crossing a not-yet-issued invoice past the draft boundary is
	// its first issuance — logged as `invoice.send`; later payments on an
	// already-issued invoice stay `invoice.edit`.
	const updated =
		(await getInvoiceById(client, userId, args.invoiceId)) ?? invoice;
	const crossingIntoIssued =
		!isInvoiceIssued(invoice) && isInvoiceIssued(updated);
	await recordInvoiceAudit(client, userId, {
		action: crossingIntoIssued ? "invoice.send" : "invoice.edit",
		resourceId: args.invoiceId,
		before: invoice,
		after: updated,
		message: crossingIntoIssued
			? "Invoice issued when a payment was recorded."
			: "Recorded a payment.",
	});

	return { ok: true, duplicate: false, invoiceId: args.invoiceId };
}

/** List payment transactions for an invoice (member-scoped read). */
export async function listInvoicePayments(
	client: Supabase,
	userId: string,
	invoiceId: string,
): Promise<PaymentTransaction[]> {
	const invoice = await getInvoiceById(client, userId, invoiceId);
	if (!invoice) return [];

	const { data, error } = await client
		.from("payment_transactions")
		.select("*")
		.eq("invoice_id", invoiceId)
		.order("created_at", { ascending: false });
	if (error) throw error;
	return (data ?? []).map((row) =>
		toPaymentTransaction(row as unknown as PaymentTransactionRow),
	);
}

export async function invoiceByToken(client: Supabase, token: string) {
	const { data, error } = await client
		.from("invoices")
		.select("*, workspaces(country_code)")
		.eq("token", token)
		.is("token_revoked_at", null)
		.maybeSingle();
	if (error) throw error;
	if (!data || data.canceled_at || data.status === "canceled") return null;
	return data as unknown as Record<string, unknown> & {
		workspaces: { country_code: string | null } | null;
	};
}

/**
 * Public payment context for the payer page. In Convex this is an
 * unauthenticated query; under RLS it resolves through a member-scoped
 * client (anonymous reads use the service-role RPC path on Convex).
 */
export async function getPublicPaymentContext(
	client: Supabase,
	token: string,
): Promise<PublicPaymentContext | null> {
	const row = await invoiceByToken(client, token);
	if (!row) return null;
	const workspace = row.workspaces as { country_code: string | null } | null;
	return getPublicPaymentContextForInvoice(
		client,
		{
			...rawRowToInvoiceState(row),
			id: String(row.id),
			currency: String(row.currency),
		},
		workspace?.country_code ?? null,
	);
}

export async function getPublicPaymentContextForInvoice(
	client: Supabase,
	invoice: InvoicePaymentState & { id: string; currency: string },
	countryCode: string | null,
): Promise<PublicPaymentContext> {
	const capabilities = getPaymentCapabilities({ countryCode });
	const snapshot = getInvoicePaymentSnapshot(invoice);
	const collectionAmount = collectionAmountForInvoice(invoice, snapshot);
	const issue = payableInvoiceIssue(invoice);
	const now = Date.now();
	const { data: charges, error } = await client
		.from("payment_charges")
		.select("*")
		.eq("invoice_id", invoice.id)
		.order("created_at", { ascending: false });
	if (error) throw error;

	const charge =
		(charges ?? [])
			.map((row) => toPaymentCharge(row as unknown as PaymentChargeRow))
			.filter((row) =>
				canReuseCollectionSession(row, {
					amount: collectionAmount,
					currency: invoice.currency,
					now,
				}),
			)
			.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;

	return {
		capabilities,
		charge: publicCharge(charge),
		payable: !issue,
		payableIssue: issue,
		collectionAmount,
		depositRequest: invoice.depositRequest,
	};
}

/** Public payment history for the payer page (member-scoped under RLS). */
export async function listPublicInvoicePayments(
	client: Supabase,
	token: string,
): Promise<
	Array<{
		id: string;
		source: PaymentSource;
		provider?: string;
		reference?: string;
		amount: number;
		currency: string;
		createdAt: number;
	}>
> {
	const row = await invoiceByToken(client, token);
	if (!row) return [];
	return listPublicInvoicePaymentsForInvoice(client, String(row.id));
}

export async function listPublicInvoicePaymentsForInvoice(
	client: Supabase,
	invoiceId: string,
) {
	const { data, error } = await client
		.from("payment_transactions")
		.select("*")
		.eq("invoice_id", invoiceId)
		.order("created_at", { ascending: false });
	if (error) throw error;

	return (data ?? []).map((row) => {
		const payment = toPaymentTransaction(
			row as unknown as PaymentTransactionRow,
		);
		return {
			id: payment._id,
			source: payment.source,
			provider: payment.provider,
			reference: payment.reference,
			amount: payment.amount,
			currency: payment.currency,
			createdAt: payment.createdAt,
		};
	});
}

export function rawRowToInvoiceState(
	row: Record<string, unknown>,
): InvoicePaymentState & { id?: unknown; currency?: string } {
	return {
		id: row.id,
		paymentAmount:
			typeof row.payment_amount === "number"
				? (row.payment_amount as number)
				: row.payment_amount !== null && row.payment_amount !== undefined
					? Number(row.payment_amount)
					: undefined,
		status: typeof row.status === "string" ? (row.status as string) : undefined,
		deliveredAt: epoch(row.delivered_at as string | null | undefined),
		lifecycle: (row.lifecycle as InvoicePaymentState["lifecycle"]) ?? {},
		canceledAt: epoch(row.canceled_at as string | null | undefined),
		dueDate:
			typeof row.due_date === "string" ? (row.due_date as string) : undefined,
		updatedAt: epoch(row.updated_at as string | null | undefined),
		currency:
			typeof row.currency === "string" ? (row.currency as string) : undefined,
		lineItems:
			(row.line_items as Array<{ quantity: number; price: number }>) ?? [],
		compliance:
			(row.compliance as InvoicePaymentState["compliance"]) ?? undefined,
		documentType:
			typeof row.document_type === "string"
				? (row.document_type as string)
				: undefined,
		depositRequest:
			(
				row.lifecycle as {
					depositRequest?: { kind?: string; value?: number };
				} | null
			)?.depositRequest ??
			(row.deposit_request as { kind?: string; value?: number } | null) ??
			undefined,
	};
}

function iso(value?: number | null): string | null {
	if (value === undefined || value === null) return null;
	return new Date(value).toISOString();
}

type InvoiceUpdate = Database["public"]["Tables"]["invoices"]["Update"];

function toInvoiceUpdate(patch: Record<string, unknown>): InvoiceUpdate {
	return {
		...(patch as Record<string, unknown>),
		reminder: json(patch.reminder),
		lifecycle: json(patch.lifecycle),
	} as unknown as InvoiceUpdate;
}

const json = (value: unknown): Json => value as Json;
