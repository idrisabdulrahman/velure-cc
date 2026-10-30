/**
 * Render an unknown thrown/returned value as a readable one-line message.
 *
 * `error instanceof Error` covers ordinary throws. Supabase's PostgREST client
 * instead hands back **plain objects** — `{ message, code, details, hint }` —
 * and `String({ ... })` collapses them to the useless `"[object Object]"`. That
 * is exactly how a Cloudflare subrequest failure once hid itself in production:
 * the real cause was behind `[object Object]` and the cursor never persisted.
 * Serialize the known fields first, then fall back to `JSON.stringify`, then to
 * a type tag, so no error is ever opaque again.
 */
export function formatErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	if (error && typeof error === "object") {
		const record = error as Record<string, unknown>;
		const parts = ["message", "code", "details", "hint"]
			.map((key) => record[key])
			.filter(
				(value): value is string =>
					typeof value === "string" && value.trim() !== "",
			)
			.map((value) => value.trim());
		if (parts.length > 0) return parts.join(" | ");
		try {
			const json = JSON.stringify(error);
			if (json && json !== "{}") return json;
		} catch {
			// Circular or otherwise unserialisable: fall through to the tag.
		}
		return Object.prototype.toString.call(error);
	}
	return String(error);
}
