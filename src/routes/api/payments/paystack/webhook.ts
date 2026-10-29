import { createHmac, timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import {
	confirmPaystackWebhookPayment,
	logPaymentAnomaly,
	type PaystackConfirmationResult,
} from "#/server/data/paystack-server";
import {
	RequestBodyTooLargeError,
	readRequestText,
	safeErrorDetails,
} from "#/server/http-security";

type PaystackWebhookPayload = {
	event?: string;
	data?: {
		id?: number;
		status?: string;
		reference?: string;
		amount?: number;
		currency?: string;
		customer?: {
			email?: string;
		};
		metadata?: {
			invoiceId?: string;
			token?: string;
		};
	};
};

export function verifyPaystackSignature(
	secretKey: string,
	rawBody: string,
	signature: string | null,
) {
	if (!signature || !/^[a-fA-F0-9]{128}$/.test(signature)) return false;

	try {
		const expected = createHmac("sha512", secretKey)
			.update(rawBody)
			.digest("hex");
		const expectedBuffer = Buffer.from(expected, "hex");
		const actualBuffer = Buffer.from(signature, "hex");

		if (expectedBuffer.length !== actualBuffer.length) return false;
		return timingSafeEqual(expectedBuffer, actualBuffer);
	} catch {
		return false;
	}
}

export async function handle({ request }: { request: Request }) {
	const secretKey = process.env.PAYSTACK_SECRET_KEY;
	if (!secretKey) {
		return Response.json(
			{ ok: false, error: "Server configuration error." },
			{ status: 500 },
		);
	}

	let rawBody: string;
	try {
		rawBody = await readRequestText(request);
	} catch (error) {
		if (error instanceof RequestBodyTooLargeError) {
			return Response.json(
				{ ok: false, error: "Request payload is too large." },
				{ status: 413 },
			);
		}
		throw error;
	}
	if (
		!verifyPaystackSignature(
			secretKey,
			rawBody,
			request.headers.get("x-paystack-signature"),
		)
	) {
		return Response.json(
			{ ok: false, error: "Unauthorized request." },
			{ status: 401 },
		);
	}

	let rawJson: unknown;
	try {
		rawJson = JSON.parse(rawBody);
	} catch {
		return Response.json(
			{ ok: false, error: "Invalid request payload." },
			{ status: 400 },
		);
	}
	if (!rawJson || typeof rawJson !== "object" || Array.isArray(rawJson)) {
		return Response.json(
			{ ok: false, error: "Invalid request payload." },
			{ status: 400 },
		);
	}
	const payload = rawJson as PaystackWebhookPayload;
	if (typeof payload.event !== "string" || !payload.event) {
		return Response.json(
			{ ok: false, error: "Incomplete request payload." },
			{ status: 400 },
		);
	}
	if (payload.event !== "charge.success") {
		return Response.json({ ok: true, ignored: true });
	}

	const data = payload.data;
	const reference = data?.reference;
	if (
		!payload.event ||
		!data?.status ||
		!reference ||
		!Number.isSafeInteger(data.amount) ||
		(data.amount as number) < 0 ||
		typeof data.currency !== "string" ||
		data.currency.length === 0
	) {
		return Response.json(
			{ ok: false, error: "Incomplete request payload." },
			{ status: 400 },
		);
	}

	if (payload.event !== "charge.success" || data.status !== "success") {
		return Response.json({ ok: true, ignored: true });
	}

	let result: PaystackConfirmationResult;
	try {
		result = await confirmPaystackWebhookPayment({
			eventType: payload.event,
			providerStatus: data.status,
			reference,
			// Paystack amounts are integer kobo; the money helper converts to
			// the exact naira decimal that the RPC compares against `numeric`.
			amountKobo: data.amount as number,
			currency: data.currency,
			providerPaymentId:
				typeof data.id === "number" ? String(data.id) : undefined,
			customerEmail: data.customer?.email,
			// Store the full parsed body (the 256KB body guard already bounds
			// it). Never slice-then-reparse, which corrupts the JSON.
			rawEvent: rawJson,
		});
	} catch (error) {
		// Transient / unexpected failure: keep 5xx so Paystack retries, and
		// log the reference only (never the key or full card payload).
		console.error("Paystack webhook processing failed", {
			reference,
			...safeErrorDetails(error),
		});
		throw error;
	}

	if (!result.ok) {
		// Business rejection — unknown reference, wrong amount or currency, a
		// canceled invoice, or an over-balance settlement. Acknowledge with
		// 200 so Paystack stops retrying, emit one structured anomaly event for
		// review, credit nothing.
		logPaymentAnomaly({
			type: "business_rejection",
			reference,
			reason: result.reason,
		});
		return Response.json({
			ok: true,
			processed: false,
			reason: result.reason,
		});
	}

	return Response.json(result);
}

export const Route = createFileRoute("/api/payments/paystack/webhook")({
	server: {
		handlers: {
			POST: handle,
		},
	},
});
