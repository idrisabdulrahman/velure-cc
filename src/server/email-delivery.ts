/**
 * Truthful, redacted reporting for transactional email delivery.
 *
 * Resend classifies very different failures under the same `error.name`:
 *
 *   - `validation_error` at 400/401 means "API key is invalid"
 *   - `validation_error` at 403 means "You can only send testing emails to your
 *     own email address ... verify a domain and change the `from` address"
 *     (`onboarding@resend.dev` used with any other recipient), or "the domain
 *     is not verified"
 *   - `validation_error` at 401 is also returned for a deleted key
 *
 * The mailer used to log `error.name` alone, so a live sign-up that Resend
 * rejected read as "Email sent" and the only clue in the log was
 * `validation_error` - which does not say whether the key, the sender or the
 * recipient was at fault. The `statusCode` is what separates those cases and
 * the provider `message` names the exact cause, so both are logged now.
 *
 * The message can quote an email address (Resend's 403 names the account
 * owner's), so it is redacted before it is written (AGENTS section 8: never log
 * unnecessary personal data). Nothing else about the recipient is logged.
 */

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const MAX_MESSAGE_LENGTH = 300;

export type DeliveryFailure = {
	/** `null` when the request never reached Resend (network failure). */
	statusCode: number | null;
	name: string;
	message: string;
};

/** Replaces every email address in a string, so a log line cannot carry one. */
export function redactEmailAddresses(value: string) {
	return value.replace(EMAIL_PATTERN, "[redacted-address]");
}

/**
 * Normalizes the two shapes a Resend failure arrives in: the `error` field of
 * the resolved `{ data, error }` result (an `ErrorResponse`), and a thrown
 * value from the transport layer.
 */
export function describeDeliveryFailure(error: unknown): DeliveryFailure {
	if (!error || typeof error !== "object") {
		return {
			statusCode: null,
			name: "unknown",
			message: redactEmailAddresses(String(error)).slice(0, MAX_MESSAGE_LENGTH),
		};
	}

	const record = error as Record<string, unknown>;
	const statusCode =
		typeof record.statusCode === "number" ? record.statusCode : null;
	const name = typeof record.name === "string" ? record.name : "unknown";
	const rawMessage =
		typeof record.message === "string" && record.message.length > 0
			? record.message
			: name;

	return {
		statusCode,
		name,
		message: redactEmailAddresses(rawMessage).slice(0, MAX_MESSAGE_LENGTH),
	};
}

/**
 * Logs one structured line describing why an email did not go out.
 *
 * `scope` names the workflow (`email-verification`, `onboarding`, ...) so a
 * Worker log can be filtered without printing who was being written to.
 */
export function logEmailDeliveryFailure(scope: string, error: unknown) {
	console.error(
		`Email delivery failed: ${scope}`,
		JSON.stringify(describeDeliveryFailure(error)),
	);
}
