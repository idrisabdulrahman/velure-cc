import { createFileRoute } from "@tanstack/react-router";
import { getServerConvexClient } from "#/server/convex";
import { api } from "#convex/_generated/api";

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

function hasValidSecret(request: Request, secret: string) {
	const bearer = request.headers.get("authorization");
	const custom = request.headers.get("x-velure-webhook-secret");

	return bearer === `Bearer ${secret}` || custom === secret;
}

function normalizeEventType(value: string | undefined): EmailEventType | null {
	if (!value) return null;
	return EVENT_MAP[value] ?? EVENT_MAP[value.toLowerCase()] ?? null;
}

function recipientFromPayload(payload: ResendWebhookPayload) {
	const to = payload.data?.to;
	if (Array.isArray(to)) return to[0];
	return to ?? payload.data?.recipient;
}

async function handle({ request }: { request: Request }) {
	const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
	if (!webhookSecret) {
		return Response.json(
			{ ok: false, error: "RESEND_WEBHOOK_SECRET is missing on the server." },
			{ status: 500 },
		);
	}

	if (!hasValidSecret(request, webhookSecret)) {
		return Response.json(
			{ ok: false, error: "Invalid Resend webhook secret." },
			{ status: 401 },
		);
	}

	const rawBody = await request.text();
	let payload: ResendWebhookPayload;
	try {
		payload = JSON.parse(rawBody) as ResendWebhookPayload;
	} catch {
		return Response.json(
			{ ok: false, error: "Invalid Resend payload." },
			{ status: 400 },
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

	const convex = getServerConvexClient();
	const result = await convex.mutation(
		api.emailEvents.recordResendWebhookEvent,
		{
			internalSecret: webhookSecret,
			providerMessageId,
			providerEventId: payload.id,
			eventType,
			recipient: recipientFromPayload(payload),
			subject: payload.data?.subject,
			error: payload.data?.error,
			rawEvent: rawBody.slice(0, 8000),
		},
	);

	return Response.json(result);
}

export const Route = createFileRoute("/api/email/resend/webhook")({
	server: {
		handlers: {
			POST: handle,
		},
	},
});
