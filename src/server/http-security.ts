import { createHash } from "node:crypto";
import type { Supabase } from "#/server/data/workspaces";

export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

export class RequestBodyTooLargeError extends Error {
	constructor() {
		super("Request body is too large.");
		this.name = "RequestBodyTooLargeError";
	}
}

function sha256(value: string) {
	return createHash("sha256").update(value).digest("hex");
}

export function safeErrorDetails(error: unknown) {
	if (!(error instanceof Error)) return { name: "UnknownError" };
	const cause = error.cause;
	const code =
		typeof cause === "object" && cause && "code" in cause
			? String((cause as { code?: unknown }).code)
			: undefined;
	return code ? { name: error.name, code } : { name: error.name };
}

export async function consumeFixedWindowRateLimit(
	client: Supabase,
	namespace: string,
	identifier: string,
	limit: number,
	windowSeconds: number,
	now = Date.now(),
) {
	const windowStart =
		Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000;
	const { data, error } = await client.rpc("consume_public_rate_limit", {
		input_key_hash: sha256(`${namespace}:${identifier}`),
		input_limit: limit,
		input_window_start: new Date(windowStart).toISOString(),
	});
	if (error) throw error;
	return data === true;
}

export function getClientIp(request: Request) {
	const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0];
	const direct = request.headers.get("x-real-ip");
	return forwarded?.trim() || direct?.trim() || null;
}

export async function readRequestText(request: Request) {
	const contentLength = Number(request.headers.get("content-length"));
	if (
		Number.isFinite(contentLength) &&
		contentLength > MAX_WEBHOOK_BODY_BYTES
	) {
		throw new RequestBodyTooLargeError();
	}

	if (!request.body) return "";

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const result = await reader.read();
			if (result.done) break;
			total += result.value.byteLength;
			if (total > MAX_WEBHOOK_BODY_BYTES) {
				await reader.cancel();
				throw new RequestBodyTooLargeError();
			}
			chunks.push(result.value);
		}
	} finally {
		reader.releaseLock();
	}

	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return new TextDecoder().decode(body);
}
