import { Resend } from "resend";
import { logEmailDeliveryFailure } from "./email-delivery";
import { getServerEnv } from "./env";

/**
 * The password-reset email for email+password accounts.
 *
 * Better Auth issues the token and builds the URL
 * (`/api/auth/reset-password/<token>?callbackURL=...`, which redirects to the
 * callback with `token` appended); this only delivers it. Without a
 * `sendResetPassword` callback Better Auth refuses `/request-password-reset`
 * outright ("Reset password isn't enabled" - see `src/lib/auth.ts`), so this
 * module is what makes the reset request possible at all.
 *
 * Delivery failures are logged and swallowed, never thrown. The request that
 * triggers this mail is anonymous and its response must stay identical whether
 * or not the address exists (no account enumeration), so throwing would only
 * leak that distinction. Only the provider `statusCode`, error `name` and
 * redacted `message` are written (`./email-delivery`); no address, token, or URL
 * is logged (AGENTS section 8).
 */

const escapeHtml = (value: string) =>
	value.replace(
		/[&<>"']/g,
		(char) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				char
			] ?? char,
	);

export async function sendPasswordResetEmail({
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
			"Cannot send a password reset email: RESEND_API_KEY or RESEND_FROM_EMAIL is missing.",
		);
		return;
	}

	const name = user.name?.trim() || "there";

	try {
		const result = await new Resend(apiKey).emails.send({
			from,
			to: user.email,
			subject: "Reset your Invoicly password",
			text: [
				`Hi ${name},`,
				"",
				"We received a request to reset your Invoicly password. Choose a new one here:",
				url,
				"",
				"This link expires in one hour. If you did not request a reset, you can ignore this email.",
			].join("\n"),
			html: [
				'<div style="font-family:Arial,sans-serif;color:#111;line-height:1.5">',
				"<h1>Reset your password</h1>",
				`<p>Hi ${escapeHtml(name)},</p>`,
				"<p>We received a request to reset your Invoicly password.</p>",
				`<p><a href="${escapeHtml(url)}">Choose a new password</a></p>`,
				"<p>This link expires in one hour. If you did not request a reset, you can ignore this email.</p>",
				"</div>",
			].join(""),
			tags: [{ name: "source", value: "password-reset" }],
		});

		if (result.error) {
			logEmailDeliveryFailure("password-reset", result.error);
		}
	} catch (error) {
		logEmailDeliveryFailure("password-reset", error);
	}
}
