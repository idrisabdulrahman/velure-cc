/**
 * App-level security-header floor (AGENTS.md section 11).
 *
 * Cloudflare terminates TLS and already owns `Strict-Transport-Security` and
 * `X-Content-Type-Options` at the edge (zone `always_use_https` +
 * `security_header`). Setting HSTS here as well would emit a second
 * `Strict-Transport-Security` header, which browsers may discard, so the edge
 * stays the single HSTS owner and this helper only adds the headers the edge
 * setting does not cover. It is applied to the SSR responses the Worker
 * constructs; static assets are served by the assets binding before the Worker
 * and inherit the edge headers instead.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"X-Frame-Options": "DENY",
	"Content-Security-Policy": "frame-ancestors 'none'",
};

/**
 * Adds each floor header only when the response does not already set it, so a
 * route with a stricter value is never weakened.
 */
export function applySecurityHeaders(headers: Headers): void {
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		if (!headers.has(name)) {
			headers.set(name, value);
		}
	}
}
