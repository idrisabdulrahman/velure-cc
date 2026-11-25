/**
 * Better Auth logging with email addresses removed.
 *
 * Better Auth logs free-form context on security events. Some of those paths
 * include the account email (for example "Credential account not found"), and
 * `lib/auth.ts` itself logs the onboarding-mailer failure. AGENTS §8 requires
 * that material workflows log actor, action, and result but never unnecessary
 * personal data, so every string that reaches the logger passes through
 * {@link redactEmails} first.
 *
 * The logger deliberately stays at `warn`: `debug`/`info` chatter is suppressed,
 * while authentication failures and errors are still recorded.
 */

/** Matches an email-shaped token, including inside a larger string. */
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

const REDACTED = "[redacted-email]";

const MAX_DEPTH = 4;

type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * Replaces every email-shaped substring with `[redacted-email]`.
 *
 * Exported so callers and tests can pin the exact redaction rule.
 */
export function redactEmails(value: string): string {
	return value.replace(EMAIL_PATTERN, REDACTED);
}

/**
 * Depth-limited, email-redacting walk over arbitrary log data.
 *
 * Exported so other server loggers (`src/server/observability.ts`) share the
 * exact same PII rule instead of re-implementing it. See the `redact` contract
 * below: strings are email-redacted, Errors become plain objects with a
 * redacted `stack`, and traversal stops at `MAX_DEPTH`.
 */
export function redactLogValue(value: unknown, depth = 0): unknown {
	return redact(value, depth);
}

function redact(value: unknown, depth = 0): unknown {
	if (typeof value === "string") return redactEmails(value);

	if (value instanceof Error) {
		return {
			name: value.name,
			message: redactEmails(value.message),
			stack: value.stack ? redactEmails(value.stack) : undefined,
		};
	}

	if (depth >= MAX_DEPTH) {
		// Stop walking deeply nested structures; a truncated marker is safer than
		// an unbounded traversal of attacker-influenced data.
		return Array.isArray(value) ? "[array]" : "[object]";
	}

	if (Array.isArray(value)) {
		return value.map((item) => redact(item, depth + 1));
	}

	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				redact(item, depth + 1),
			]),
		);
	}

	return value;
}

const CONSOLE_METHOD: Record<LogLevel, (...args: unknown[]) => void> = {
	debug: (...args) => console.debug(...args),
	info: (...args) => console.info(...args),
	warn: (...args) => console.warn(...args),
	error: (...args) => console.error(...args),
};

/**
 * A `Logger` for Better Auth that redacts emails and keeps production logs at
 * `warn` and above.
 */
export function createAuthLogger() {
	return {
		level: "warn" as const,
		log: (level: LogLevel, message: string, ...args: unknown[]): void => {
			const write = CONSOLE_METHOD[level] ?? CONSOLE_METHOD.error;
			write(redactEmails(message), ...args.map((arg) => redact(arg)));
		},
	};
}
