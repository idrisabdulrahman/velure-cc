import { createHash } from "node:crypto";
import { Resend } from "resend";
import { logEmailDeliveryFailure } from "./email-delivery";
import { getServerEnv } from "./env";

export async function sendOnboardingEmail(user: {
	id: string;
	name?: string | null;
	email: string;
}) {
	const apiKey = getServerEnv("RESEND_API_KEY");
	const from = getServerEnv("RESEND_FROM_EMAIL");
	if (!apiKey || !from) {
		console.error(
			"Cannot send an onboarding email: RESEND_API_KEY or RESEND_FROM_EMAIL is missing.",
		);
		return;
	}

	const name = user.name?.trim() || "there";
	const appUrl = getServerEnv("SITE_URL") ?? "";
	const idempotencyKey = `onboarding-${createHash("sha256")
		.update(user.id)
		.digest("hex")}`;

	try {
		const result = await new Resend(apiKey).emails.send(
			{
				from,
				to: user.email,
				subject: "Welcome to Invoicly",
				text: `Hi ${name}, welcome to Invoicly. Create your first invoice, add your business details, and share a payment-ready invoice with your customer. Get started: ${appUrl}`,
				html: `<div style="font-family:Arial,sans-serif;color:#111;line-height:1.5"><h1>Welcome to Invoicly</h1><p>Hi ${name.replace(/[&<>"']/g, "")},</p><p>Invoicly helps you create invoices, collect payments, and stay on top of Nigerian billing and compliance workflows.</p><p><a href="${appUrl}">Create your first invoice</a></p></div>`,
				tags: [{ name: "source", value: "onboarding" }],
			},
			{ idempotencyKey },
		);
		if (result.error) throw result.error;
	} catch (error) {
		// The caller only needs to know the welcome mail did not go out; the
		// reason (key, sender or recipient) is logged here once, with the
		// Resend status code, so a sign-up log states it instead of echoing
		// only the provider's error name.
		logEmailDeliveryFailure("onboarding", error);
		throw error;
	}
}
