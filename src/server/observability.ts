/**
 * Minimal server observability floor (build_plan.md §3 WP-H).
 *
 * The Goldfish observability lens found no correlation id, no error serializer
 * and no activation metric in server code, so no later slice could be proven to
 * work in the field. This module adds the smallest thing that fixes that,
 * without a new dependency or a billable service (`AGENTS.md` §10, §11):
 *
 *   - one request id per server request, carried into every log line;
 *   - one structured error line per failure, with the request id, a stable
 *     code and the stack, redacted of emails;
 *   - one structured activation line per money-visible action.
 *
 * Everything is a single JSON line on stdout/stderr, which is what Cloudflare
 * Workers Logs ingests. Nothing here is sent to a client: `AGENTS.md` §8 forbids
 * stack traces or SQL in responses, and a correlation id in a response body
 * would leak internal ids.
 */

import { redactLogValue } from "./auth-logger";
import { formatErrorMessage } from "./error-message";

export type ServerLogLevel = "debug" | "info" | "warn" | "error";

export type ServerLogFields = Record<string, unknown>;

/**
 * A correlation id for one server request.
 *
 * `crypto.randomUUID` exists on both Cloudflare Workers and Node 18+, so the
 * fallback only guards a non-standard embedder.
 */
export function createRequestId(): string {
	const cryptoApi = globalThis.crypto;
	if (typeof cryptoApi?.randomUUID === "function") {
		return cryptoApi.randomUUID();
	}
	return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

const CONSOLE_METHOD: Record<ServerLogLevel, (...args: unknown[]) => void> = {
	debug: (...args) => console.debug(...args),
	info: (...args) => console.log(...args),
	warn: (...args) => console.warn(...args),
	error: (...args) => console.error(...args),
};

/**
 * Emit one structured log line. Returns the payload so a caller (and a test) can
 * inspect exactly what was written.
 */
export function logServerEvent(
	level: ServerLogLevel,
	event: string,
	fields: ServerLogFields = {},
): ServerLogFields {
	const payload: ServerLogFields = {
		ts: new Date().toISOString(),
		level,
		event,
		...((redactLogValue(fields) as ServerLogFields) ?? {}),
	};
	const write = CONSOLE_METHOD[level] ?? CONSOLE_METHOD.error;
	try {
		write(JSON.stringify(payload));
	} catch {
		// A circular field must never break the request that is being logged.
		write(
			JSON.stringify({
				ts: payload.ts,
				level,
				event,
				serializationError: true,
			}),
		);
	}
	return payload;
}

/**
 * One correlated error line. `code` is a stable, non-sensitive classifier
 * (e.g. a Supabase/Postgres code or `internal_error`); the message and stack are
 * redacted of emails by {@link logServerEvent}, and neither is returned to a
 * client.
 */
export function logServerError(
	error: unknown,
	fields: ServerLogFields = {},
): ServerLogFields {
	const record =
		error && typeof error === "object"
			? (error as Record<string, unknown>)
			: undefined;
	const code =
		typeof record?.code === "string" && record.code.trim() !== ""
			? record.code
			: "internal_error";
	const stack = error instanceof Error ? error.stack : undefined;
	return logServerEvent("error", "server_error", {
		code,
		message: formatErrorMessage(error),
		stack,
		...fields,
	});
}

/**
 * One activation line for a money-visible action. `activation` is a stable
 * dotted name (`invoice.issued`, `payment.recorded`, `invoice.share_opened`).
 */
export function emitActivation(
	activation: string,
	fields: ServerLogFields = {},
): ServerLogFields {
	return logServerEvent("info", "activation", { activation, ...fields });
}

/**
 * Wrap an HTTP handler so it gets a request id and any failure produces exactly
 * one correlated error line plus a generic 500 — never a stack trace or SQL in
 * the body (`AGENTS.md` §8).
 */
export function withRequestObservability<Args extends unknown[]>(
	handler: (requestId: string, ...args: Args) => Promise<Response> | Response,
): (...args: Args) => Promise<Response> {
	return async (...args: Args) => {
		const requestId = createRequestId();
		try {
			return await handler(requestId, ...args);
		} catch (error) {
			logServerError(error, { requestId });
			return Response.json({ error: "Something went wrong." }, { status: 500 });
		}
	};
}
