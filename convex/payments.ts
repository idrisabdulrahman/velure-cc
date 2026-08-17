import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
	action,
	internalMutation,
	internalQuery,
	mutation,
	query,
} from "./_generated/server";
import { recordAuditLog } from "./audit";
import { env } from "./env";
import { getPaymentCapabilities } from "./paymentCapabilities";
import {
	applyPaymentToSnapshot,
	canReuseCollectionSession,
	getInvoicePaymentSnapshot,
	payableInvoiceIssue,
	roundMoney,
	staleCollectionSessionReason,
} from "./paymentCollection";
import { requireWritableInvoice } from "./rls";

function publicCharge(charge: any) {
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

type InvoiceDepositRequestState = {
	documentType?: string;
	depositRequest?: {
		kind?: string;
		value?: number;
	};
};

type InvoiceCollectionSnapshot = {
	total: number;
	paid: number;
	balance: number;
};

function requestedDepositAmount(
	invoice: InvoiceDepositRequestState,
	total: number,
) {
	if ((invoice.documentType ?? "standard") !== "proforma") return null;
	const request = invoice.depositRequest;
	if (!request) return null;
	const value = request.value;
	if (!Number.isFinite(value) || value === undefined || value <= 0) return null;

	const amount = request.kind === "percentage" ? (total * value) / 100 : value;
	return roundMoney(Math.min(Math.max(amount, 0), total));
}

function collectionAmountForInvoice(
	invoice: InvoiceDepositRequestState,
	snapshot: InvoiceCollectionSnapshot,
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

async function applyInvoicePayment(
	ctx: any,
	args: {
		invoiceId: any;
		amount: number;
		source: "manual" | "paystack";
		recordedBy?: string;
		reference?: string;
		providerPaymentId?: string;
		eventType?: string;
		providerStatus?: string;
		customerEmail?: string;
		rawEvent?: string;
	},
) {
	const invoice = await ctx.db.get(args.invoiceId);
	if (!invoice) throw new Error("Invoice not found.");

	if (args.source === "paystack" && args.reference) {
		const existing = await ctx.db
			.query("payment_transactions")
			.withIndex("by_reference", (q: any) => q.eq("reference", args.reference))
			.first();
		if (existing)
			return { ok: true, duplicate: true, invoiceId: args.invoiceId };
	}

	const issue = payableInvoiceIssue(invoice);
	if (issue) throw new Error(issue);

	const snapshot = getInvoicePaymentSnapshot(invoice);
	const payment = applyPaymentToSnapshot(snapshot, args.amount);

	const now = Date.now();

	await ctx.db.insert("payment_transactions", {
		workspaceId: invoice.workspaceId,
		ownerId: invoice.userId,
		invoiceId: args.invoiceId,
		source: args.source,
		provider: args.source === "paystack" ? "paystack" : undefined,
		reference: args.reference,
		providerPaymentId: args.providerPaymentId,
		eventType: args.eventType,
		providerStatus: args.providerStatus,
		amount: payment.amount,
		currency: invoice.currency,
		recordedBy: args.recordedBy,
		customerEmail: args.customerEmail,
		rawEvent: args.rawEvent,
		createdAt: now,
		updatedAt: now,
	});

	await ctx.db.patch(args.invoiceId, {
		paymentAmount: payment.nextPaymentAmount,
		paidAt: payment.isPaid ? now : invoice.paidAt,
		paymentReference: args.reference ?? invoice.paymentReference,
		reminder: payment.isPaid
			? {
					...(invoice.reminder ?? {
						enabled: true,
						paused: false,
						stage: "none",
						escalationStatus: "idle",
					}),
					paidAt: now,
					nextReminderAt: undefined,
				}
			: invoice.reminder,
		lifecycle: {
			...(invoice.lifecycle ?? {}),
			paymentReceivedAt: invoice.lifecycle?.paymentReceivedAt ?? now,
		},
		status: payment.isPaid
			? "paid"
			: payment.nextPaymentAmount > 0
				? "partially-paid"
				: invoice.status,
		updatedAt: now,
	});

	await recordAuditLog(ctx, {
		workspaceId: invoice.workspaceId,
		actorId: args.recordedBy,
		actorType: args.recordedBy ? "user" : "system",
		action: "payment.received",
		resourceType: "payment",
		resourceId: String(args.reference ?? args.invoiceId),
		metadata: {
			source: args.source,
			amount: payment.amount,
			reference: args.reference,
			invoiceId: String(args.invoiceId),
			remainingBalance: payment.remainingBalance,
		},
	});

	await recordAuditLog(ctx, {
		workspaceId: invoice.workspaceId,
		actorId: args.recordedBy,
		actorType: args.recordedBy ? "user" : "system",
		action: payment.invoiceAuditAction,
		resourceType: "invoice",
		resourceId: String(args.invoiceId),
		metadata: {
			source: args.source,
			amount: payment.amount,
			reference: args.reference,
			remainingBalance: payment.remainingBalance,
		},
	});

	return { ok: true, duplicate: false, invoiceId: args.invoiceId };
}

export const recordPayment = mutation({
	args: {
		invoiceId: v.id("invoices"),
		amount: v.number(),
		recordedAt: v.optional(v.number()),
		reference: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const { scope } = await requireWritableInvoice(ctx, args.invoiceId);
		return await applyInvoicePayment(ctx, {
			invoiceId: args.invoiceId,
			amount: args.amount,
			source: "manual",
			recordedBy: scope.userId,
			reference: args.reference,
		});
	},
});

export const listInvoicePayments = query({
	args: { invoiceId: v.id("invoices") },
	handler: async (ctx, args) => {
		await requireWritableInvoice(ctx, args.invoiceId);
		return await ctx.db
			.query("payment_transactions")
			.withIndex("by_invoiceId", (q) => q.eq("invoiceId", args.invoiceId))
			.order("desc")
			.collect();
	},
});

export const getPublicPaymentContext = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const invoice = await ctx.db
			.query("invoices")
			.withIndex("by_token", (q) => q.eq("token", args.token))
			.first();
		if (!invoice || invoice.canceledAt || invoice.status === "canceled") {
			return null;
		}
		const workspace = await ctx.db.get(invoice.workspaceId);
		const capabilities = getPaymentCapabilities(workspace);
		const snapshot = getInvoicePaymentSnapshot(invoice);
		const collectionAmount = collectionAmountForInvoice(invoice, snapshot);
		const issue = payableInvoiceIssue(invoice);
		const now = Date.now();
		const charges = await ctx.db
			.query("payment_charges")
			.withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoice._id))
			.collect();
		const charge =
			charges
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
	},
});

export const listPublicInvoicePayments = query({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const invoice = await ctx.db
			.query("invoices")
			.withIndex("by_token", (q) => q.eq("token", args.token))
			.first();
		if (!invoice || invoice.canceledAt || invoice.status === "canceled") {
			return [];
		}

		const payments = await ctx.db
			.query("payment_transactions")
			.withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoice._id))
			.order("desc")
			.collect();

		return payments.map((payment) => ({
			id: payment._id,
			source: payment.source,
			provider: payment.provider,
			reference: payment.reference,
			amount: payment.amount,
			currency: payment.currency,
			createdAt: payment.createdAt,
		}));
	},
});

export const getChargeByTokenInternal = internalQuery({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const invoice = await ctx.db
			.query("invoices")
			.withIndex("by_token", (q) => q.eq("token", args.token))
			.first();
		if (!invoice || invoice.canceledAt || invoice.status === "canceled") {
			return null;
		}
		const workspace = await ctx.db.get(invoice.workspaceId);
		if (!workspace) return null;
		const capabilities = getPaymentCapabilities(workspace);
		const snapshot = getInvoicePaymentSnapshot(invoice);
		const collectionAmount = collectionAmountForInvoice(invoice, snapshot);
		const issue = payableInvoiceIssue(invoice);
		const now = Date.now();
		const charges = await ctx.db
			.query("payment_charges")
			.withIndex("by_invoiceId", (q) => q.eq("invoiceId", invoice._id))
			.collect();
		const charge =
			charges
				.filter((row) =>
					canReuseCollectionSession(row, {
						amount: collectionAmount,
						currency: invoice.currency,
						now,
					}),
				)
				.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
		const staleCharges = charges
			.map((row) => ({
				reference: row.reference,
				reason: staleCollectionSessionReason(row, {
					amount: collectionAmount,
					currency: invoice.currency,
					now,
				}),
			}))
			.filter((row) => row.reason);

		return {
			invoiceId: invoice._id,
			workspaceId: invoice.workspaceId,
			invoiceNumber: invoice.invoiceNumber,
			token: invoice.token,
			customerName: invoice.customerName,
			customerEmail: invoice.compliance?.buyer?.email,
			currency: invoice.currency,
			total: snapshot.total,
			balance: snapshot.balance,
			collectionAmount,
			depositRequest: invoice.depositRequest,
			payableIssue: issue,
			capabilities,
			charge,
			staleCharges,
		};
	},
});

export const getChargeByReferenceInternal = internalQuery({
	args: { reference: v.string() },
	handler: async (ctx, args) => {
		const charge = await ctx.db
			.query("payment_charges")
			.withIndex("by_reference", (q) => q.eq("reference", args.reference))
			.first();
		if (!charge) return null;
		const invoice = await ctx.db.get(charge.invoiceId);
		if (!invoice) return null;
		return { charge, invoice };
	},
});

export const recordPaystackChargeInternal = internalMutation({
	args: {
		invoiceId: v.id("invoices"),
		workspaceId: v.id("workspaces"),
		reference: v.string(),
		amount: v.number(),
		currency: v.string(),
		accountName: v.optional(v.string()),
		accountNumber: v.optional(v.string()),
		bankName: v.optional(v.string()),
		bankSlug: v.optional(v.string()),
		expiresAt: v.number(),
		providerStatus: v.optional(v.string()),
		providerMessage: v.optional(v.string()),
		rawResponse: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query("payment_charges")
			.withIndex("by_reference", (q) => q.eq("reference", args.reference))
			.first();
		if (existing) return existing;

		const now = Date.now();
		const id = await ctx.db.insert("payment_charges", {
			workspaceId: args.workspaceId,
			invoiceId: args.invoiceId,
			provider: "paystack",
			reference: args.reference,
			status: "pending",
			amount: roundMoney(args.amount),
			currency: args.currency,
			accountName: args.accountName,
			accountNumber: args.accountNumber,
			bankName: args.bankName,
			bankSlug: args.bankSlug,
			expiresAt: args.expiresAt,
			providerStatus: args.providerStatus,
			providerMessage: args.providerMessage,
			rawResponse: args.rawResponse,
			createdAt: now,
			updatedAt: now,
		});
		await recordAuditLog(ctx, {
			workspaceId: args.workspaceId,
			actorType: "system",
			action: "collection.session.created",
			resourceType: "payment_charge",
			resourceId: args.reference,
			metadata: {
				invoiceId: String(args.invoiceId),
				provider: "paystack",
				amount: roundMoney(args.amount),
				currency: args.currency,
				expiresAt: args.expiresAt,
			},
		});
		await recordAuditLog(ctx, {
			workspaceId: args.workspaceId,
			actorType: "system",
			action: "payment.initiated",
			resourceType: "invoice",
			resourceId: String(args.invoiceId),
			metadata: {
				provider: "paystack",
				reference: args.reference,
				amount: roundMoney(args.amount),
				currency: args.currency,
			},
		});
		return await ctx.db.get(id);
	},
});

export const markChargeStatusInternal = internalMutation({
	args: {
		reference: v.string(),
		status: v.union(
			v.literal("pending"),
			v.literal("succeeded"),
			v.literal("failed"),
			v.literal("expired"),
			v.literal("manual_review"),
		),
		providerStatus: v.optional(v.string()),
		providerMessage: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		const charge = await ctx.db
			.query("payment_charges")
			.withIndex("by_reference", (q) => q.eq("reference", args.reference))
			.first();
		if (!charge) return { ok: false };
		await ctx.db.patch(charge._id, {
			status: args.status,
			providerStatus: args.providerStatus ?? charge.providerStatus,
			providerMessage: args.providerMessage ?? charge.providerMessage,
			updatedAt: Date.now(),
		});
		if (args.status === "expired") {
			await recordAuditLog(ctx, {
				workspaceId: charge.workspaceId,
				actorType: "system",
				action: "collection.session.expired",
				resourceType: "payment_charge",
				resourceId: charge.reference,
				metadata: {
					invoiceId: String(charge.invoiceId),
					provider: charge.provider,
				},
			});
		}
		return { ok: true };
	},
});

async function confirmPaystackCollectionPayment(
	ctx: any,
	args: {
		reference: string;
		amount: number;
		currency: string;
		eventType: string;
		providerStatus: string;
		providerPaymentId?: string;
		customerEmail?: string;
		rawEvent?: string;
	},
) {
	const charge = await ctx.db
		.query("payment_charges")
		.withIndex("by_reference", (q: any) => q.eq("reference", args.reference))
		.first();
	if (!charge) return { ok: false, error: "Charge not found." };

	if (charge.status === "succeeded") {
		return { ok: true, duplicate: true, invoiceId: charge.invoiceId };
	}

	if (
		args.currency !== charge.currency ||
		roundMoney(args.amount) !== roundMoney(charge.amount)
	) {
		await ctx.db.patch(charge._id, {
			status: "manual_review",
			providerStatus: args.providerStatus,
			providerMessage: "Webhook amount or currency did not match charge.",
			updatedAt: Date.now(),
		});
		await recordAuditLog(ctx, {
			workspaceId: charge.workspaceId,
			actorType: "system",
			action: "payment.failed",
			resourceType: "payment_charge",
			resourceId: charge.reference,
			result: "failure",
			metadata: {
				invoiceId: String(charge.invoiceId),
				expectedAmount: charge.amount,
				actualAmount: args.amount,
				expectedCurrency: charge.currency,
				actualCurrency: args.currency,
				reason: "amount_or_currency_mismatch",
			},
		});
		return { ok: false, error: "Payment did not match charge." };
	}

	if (charge.status !== "pending") {
		return { ok: false, error: "Collection session is not payable." };
	}

	if (charge.expiresAt <= Date.now()) {
		await ctx.db.patch(charge._id, {
			status: "expired",
			providerStatus: args.providerStatus,
			providerMessage: "Webhook arrived after collection session expiration.",
			updatedAt: Date.now(),
		});
		await recordAuditLog(ctx, {
			workspaceId: charge.workspaceId,
			actorType: "system",
			action: "collection.session.expired",
			resourceType: "payment_charge",
			resourceId: charge.reference,
			metadata: {
				invoiceId: String(charge.invoiceId),
				provider: charge.provider,
				reason: "webhook_after_expiration",
			},
		});
		return { ok: false, error: "Collection session has expired." };
	}

	const result = await applyInvoicePayment(ctx, {
		invoiceId: charge.invoiceId,
		amount: args.amount,
		source: "paystack",
		reference: args.reference,
		providerPaymentId: args.providerPaymentId,
		eventType: args.eventType,
		providerStatus: args.providerStatus,
		customerEmail: args.customerEmail,
		rawEvent: args.rawEvent,
	});

	await ctx.db.patch(charge._id, {
		status: "succeeded",
		providerStatus: args.providerStatus,
		updatedAt: Date.now(),
	});

	return result;
}

export const recordPaystackPaymentInternal = internalMutation({
	args: {
		reference: v.string(),
		amount: v.number(),
		currency: v.string(),
		eventType: v.string(),
		providerStatus: v.string(),
		providerPaymentId: v.optional(v.string()),
		customerEmail: v.optional(v.string()),
		rawEvent: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		return await confirmPaystackCollectionPayment(ctx, args);
	},
});

/**
 * Constant-time string comparison for secret verification.
 *
 * Uses a pure-JS XOR accumulation rather than `node:crypto.timingSafeEqual`,
 * which is unavailable in Convex's default V8 runtime. The length check is
 * deliberately combined into the accumulator (length mismatch forces a
 * non-zero result) and every byte of the longer input is still visited so the
 * loop does not short-circuit on the first differing byte.
 */
function constantTimeEqual(a: string, b: string): boolean {
	const aBytes = new TextEncoder().encode(a);
	const bBytes = new TextEncoder().encode(b);
	const length = Math.max(aBytes.length, bBytes.length);

	let mismatch = aBytes.length ^ bBytes.length;
	for (let i = 0; i < length; i++) {
		mismatch |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
	}
	return mismatch === 0;
}

export const confirmPaystackWebhookPayment = mutation({
	args: {
		webhookSecret: v.string(),
		eventType: v.string(),
		providerStatus: v.string(),
		reference: v.string(),
		amount: v.number(),
		currency: v.string(),
		providerPaymentId: v.optional(v.string()),
		customerEmail: v.optional(v.string()),
		rawEvent: v.optional(v.string()),
	},
	handler: async (ctx, args) => {
		if (!env.PAYSTACK_SECRET_KEY) {
			throw new Error("Unauthorized webhook confirmation.");
		}

		if (!constantTimeEqual(env.PAYSTACK_SECRET_KEY, args.webhookSecret)) {
			throw new Error("Unauthorized webhook confirmation.");
		}

		return await confirmPaystackCollectionPayment(ctx, args);
	},
});

type PaystackChargeResponse = {
	status?: boolean;
	message?: string;
	data?: {
		status?: string;
		reference?: string;
		display_text?: string;
		bank?: { name?: string; slug?: string };
		account_name?: string;
		account_number?: string;
		amount?: number;
		currency?: string;
	};
};

function referenceForInvoice(invoiceId: string) {
	return `velure-${invoiceId.replace(/[^a-zA-Z0-9]/g, "")}-${Date.now()}`;
}

function expiryTimestamp() {
	return Date.now() + 8 * 60 * 60 * 1000;
}

export const ensurePaystackTransferCharge = action({
	args: { token: v.string() },
	handler: async (ctx, args): Promise<any> => {
		const context: any = await ctx.runQuery(
			(internal as any).payments.getChargeByTokenInternal,
			{
				token: args.token,
			},
		);
		if (!context) throw new Error("Invoice not found.");
		if (context.payableIssue) throw new Error(context.payableIssue);
		if (!context.capabilities.automaticBankTransfer) {
			throw new Error(
				"Automatic bank transfer is not available for this workspace.",
			);
		}
		if (context.charge) return publicCharge(context.charge);
		if (context.balance <= 0)
			throw new Error("Invoice has no outstanding balance.");
		if (context.collectionAmount <= 0)
			throw new Error("Invoice has no collectible amount.");
		for (const staleCharge of context.staleCharges ?? []) {
			await ctx.runMutation(
				(internal as any).payments.markChargeStatusInternal,
				{
					reference: staleCharge.reference,
					status:
						staleCharge.reason === "expired" ? "expired" : "manual_review",
					providerMessage:
						staleCharge.reason === "expired"
							? "Collection session expired before reuse."
							: "Collection session balance or currency changed before reuse.",
				},
			);
		}

		const email = context.customerEmail?.trim().toLowerCase();
		if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
			throw new Error(
				"Invoice needs a valid client email before Paystack transfer.",
			);
		}
		if (!env.PAYSTACK_SECRET_KEY) {
			throw new Error("PAYSTACK_SECRET_KEY is not configured.");
		}

		const expiresAt = expiryTimestamp();
		const reference = referenceForInvoice(String(context.invoiceId));
		const amountKobo = Math.round(context.collectionAmount * 100);
		const response = await fetch("https://api.paystack.co/charge", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				email,
				amount: amountKobo,
				currency: context.currency,
				reference,
				bank_transfer: {
					account_expires_at: new Date(expiresAt).toISOString(),
				},
				metadata: {
					invoiceId: context.invoiceId,
					token: context.token,
					invoiceNumber: context.invoiceNumber,
					customerName: context.customerName,
				},
			}),
		});

		const payload = (await response
			.json()
			.catch(() => null)) as PaystackChargeResponse | null;
		const data = payload?.data;
		const accountNumber = data?.account_number;

		if (!response.ok || !payload?.status || !accountNumber) {
			throw new Error(
				payload?.message ?? "Could not create Paystack transfer account.",
			);
		}

		const charge = await ctx.runMutation(
			(internal as any).payments.recordPaystackChargeInternal,
			{
				invoiceId: context.invoiceId,
				workspaceId: context.workspaceId,
				reference: data.reference ?? reference,
				amount: context.collectionAmount,
				currency: data.currency ?? context.currency,
				accountName: data.account_name,
				accountNumber,
				bankName: data.bank?.name,
				bankSlug: data.bank?.slug,
				expiresAt,
				providerStatus: data.status,
				providerMessage: payload.message,
				rawResponse: JSON.stringify(payload).slice(0, 8000),
			},
		);
		return publicCharge(charge);
	},
});
