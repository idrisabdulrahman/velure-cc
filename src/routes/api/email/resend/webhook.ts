import { createFileRoute } from "@tanstack/react-router";
import { Resend } from "resend";
import { getServerEnv } from "#/server/env";
import {
	RequestBodyTooLargeError,
	readRequestText,
} from "#/server/http-security";
import { getSupabaseAdminClient } from "#/server/supabase";

type ResendWebhookPayload = {
	type?: string;
	id?: string;
	data?: {
		id?: string;
		email_id?: string;
		emailId?: string;
		to?: string | string[];
		recipient?: string;
		subject?: string;
		error?: string;
	};
};

type EmailEventType =
	| "sent"
	| "delivered"
	| "delivery_delayed"
	| "bounced"
	| "complained"
	| "opened"
	| "clicked"
	| "failed";

const EVENT_MAP: Record<string, EmailEventType> = {
	"email.sent": "sent",
	"email.delivered": "delivered",
	"email.delivery_delayed": "delivery_delayed",
	"email.bounced": "bounced",
	"email.complained": "complained",
	"email.opened": "opened",
	"email.clicked": "clicked",
	"email.failed": "failed",
};

function normalizeEventType(value: string | undefined): EmailEventType | null {
	if (!value) return null;
	return EVENT_MAP[value] ?? EVENT_MAP[value.toLowerCase()] ?? null;
}

function recipientFromPayload(payload: ResendWebhookPayload) {
	const to = payload.data?.to;
	if (Array.isArray(to)) return to[0];
	return to ?? payload.data?.recipient;
}

export async function handle({ request }: { request: Request }) {
	const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
	if (!webhookSecret) {
		console.error("Resend webhook secret is not configured");
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
	let payload: ResendWebhookPayload;
	try {
		payload = new Resend(getServerEnv("RESEND_API_KEY") ?? "").webhooks.verify({
			payload: rawBody,
			headers: {
				id: request.headers.get("svix-id") ?? "",
				timestamp: request.headers.get("svix-timestamp") ?? "",
				signature: request.headers.get("svix-signature") ?? "",
			},
			webhookSecret,
		}) as ResendWebhookPayload;
	} catch {
		return Response.json(
			{ ok: false, error: "Invalid Resend webhook signature or payload." },
			{ status: 401 },
		);
	}

	const eventType = normalizeEventType(payload.type);
	if (!eventType) {
		return Response.json(
			{ ok: false, error: "Unsupported Resend event type." },
			{ status: 400 },
		);
	}

	const providerMessageId =
		payload.data?.email_id ?? payload.data?.emailId ?? payload.data?.id;

	const supabase = getSupabaseAdminClient();
	if (!providerMessageId) {
		return Response.json({ ok: true, ignored: true });
	}

	const { data: delivery, error: deliveryError } = await supabase
		.from("invoice_delivery_events")
		.select("id, workspace_id, owner_id, invoice_id, recipient")
		.eq("provider", "resend")
		.eq("provider_message_id", providerMessageId)
		.maybeSingle();
	if (deliveryError) throw deliveryError;
	if (!delivery) return Response.json({ ok: true, ignored: true });

	const { data: event, error: eventError } = await supabase
		.from("email_events")
		.insert({
			workspace_id: delivery.workspace_id,
			owner_id: delivery.owner_id,
			invoice_id: delivery.invoice_id,
			delivery_event_id: delivery.id,
			provider: "resend",
			provider_message_id: providerMessageId,
			provider_event_id: payload.id ?? null,
			event_type: eventType,
			recipient: recipientFromPayload(payload) ?? delivery.recipient,
			subject: payload.data?.subject ?? null,
			error: payload.data?.error ?? null,
			raw_event: payload,
		})
		.select("id, invoice_id")
		.single();
	if (eventError) {
		if (eventError.code === "23505")
			return Response.json({ ok: true, alreadyTracked: true });
		throw eventError;
	}
	const result = { ok: true, eventId: event.id, invoiceId: event.invoice_id };

	return Response.json(result);
}

export const Route = createFileRoute("/api/email/resend/webhook")({
	server: {
		handlers: {
			POST: handle,
		},
	},
});
