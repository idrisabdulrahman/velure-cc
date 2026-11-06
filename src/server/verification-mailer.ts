import { Resend } from "resend";
import { logEmailDeliveryFailure } from "./email-delivery";
import { getServerEnv } from "./env";

/**
 * The verification email for email+password accounts.
 *
 * Better Auth issues the token and builds the URL
 * (`/api/auth/verify-email?token=...&callbackURL=...`); this only delivers it.
 * A click on that URL verifies the address, signs the user in
 * (`autoSignInAfterVerification`) and redirects to `/verify-email`.
 *
 * Delivery failures are logged and swallowed, never thrown: the user row is
 * already created by the time this runs, so rethrowing would fail the sign-up
 * while leaving the account in place, and the retry would then say the email is
 * taken. Swallowing keeps the "check your inbox" screen honest, and that screen
 * carries the resend action which surfaces a persistent outage.
 *
 * Swallowing is not the same as hiding: the failure is written with its
 * Resend `statusCode`, error `name` and redacted `message`
 * (`./email-delivery`), which is what tells a misconfigured sending domain
 * apart from an invalid key. Only the name used to be logged, and those two
 * failures share a name.
 *
 * No address, token, or URL is logged (AGENTS section 8).
 */

const escapeHtml = (value: string) =>
	value.replace(
		/[&<>"']/g,
		(char) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				char
			] ?? char,
	);

export async function sendVerificationEmail({
	user,
	url,
}: {
	user: { email: string; name?: string | null };
	url: string;
}) {
	const apiKey = getServerEnv("RESEND_API_KEY");
	const from = getServerEnv("RESEND_FROM_EMAIL");

	if (!apiKey || !from) {
		console.error(
			"Cannot send a verification email: RESEND_API_KEY or RESEND_FROM_EMAIL is missing.",
		);
		return;
	}

	const name = user.name?.trim() || "there";

	try {
		const result = await new Resend(apiKey).emails.send({
			from,
			to: user.email,
			subject: "Verify your Invoicly email address",
			text: [
				`Hi ${name},`,
				"",
				"Confirm your email address to finish setting up your Invoicly account:",
				url,
				"",
				"This link expires in one hour. If you did not create a Invoicly account, ignore this email.",
			].join("\n"),
			html: [
				'<div style="font-family:Arial,sans-serif;color:#111;line-height:1.5">',
				"<h1>Verify your email</h1>",
				`<p>Hi ${escapeHtml(name)},</p>`,
				"<p>Confirm your email address to finish setting up your Invoicly account.</p>",
				`<p><a href="${escapeHtml(url)}">Verify my email</a></p>`,
				"<p>This link expires in one hour. If you did not create a Invoicly account, ignore this email.</p>",
				"</div>",
			].join(""),
			tags: [{ name: "source", value: "email-verification" }],
		});

		if (result.error) {
			logEmailDeliveryFailure("email-verification", result.error);
		}
	} catch (error) {
		logEmailDeliveryFailure("email-verification", error);
	}
}
