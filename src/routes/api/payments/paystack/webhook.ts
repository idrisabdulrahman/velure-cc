import { createHmac, timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { confirmPaystackWebhookPayment } from "#/server/data/paystack-server";
import {
	RequestBodyTooLargeError,
	readRequestText,
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
	if (!signature) return false;

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

	let payload: PaystackWebhookPayload;
	try {
		payload = JSON.parse(rawBody) as PaystackWebhookPayload;
	} catch {
		return Response.json(
			{ ok: false, error: "Invalid request payload." },
			{ status: 400 },
		);
	}

	const data = payload.data;
	const reference = data?.reference;
	if (
		!payload.event ||
		!data?.status ||
		!reference ||
		typeof data.amount !== "number"
	) {
		return Response.json(
			{ ok: false, error: "Incomplete request payload." },
			{ status: 400 },
		);
	}

	if (payload.event !== "charge.success" || data.status !== "success") {
		return Response.json({ ok: true, ignored: true });
	}

	const result = await confirmPaystackWebhookPayment({
		eventType: payload.event,
		providerStatus: data.status,
		reference,
		amount: Math.round((data.amount / 100) * 100) / 100,
		currency: data.currency ?? "NGN",
		providerPaymentId:
			typeof data.id === "number" ? String(data.id) : undefined,
		customerEmail: data.customer?.email,
		rawEvent: rawBody.slice(0, 8000),
	});

	return Response.json(result);
}

export const Route = createFileRoute("/api/payments/paystack/webhook")({
	server: {
		handlers: {
			POST: handle,
		},
	},
});
