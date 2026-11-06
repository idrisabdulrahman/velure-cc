/**
 * Which host the auth runtime is running on, and which header may be trusted as
 * the client address.
 *
 * This exists because better-auth's rate limiter returns early - no limit at all -
 * when `getIp` cannot find a valid address in `advanced.ipAddress.ipAddressHeaders`
 * (`better-auth/dist/utils/get-request-ip.mjs`, `if (!ip) return;`,
 * `dist/api/rate-limiter/index.mjs`). That is exactly what happened on the first
 * Workers deployment: the config trusted only `x-forwarded-for`, which Cloudflare
 * does not send for a direct `workers.dev` request, so every sign-in was unlimited
 * and the shared rate-limit table stayed empty.
 *
 * The trusted header has to differ per host:
 *
 *   - **Workers**: `cf-connecting-ip`. The edge sets it and strips any
 *     client-supplied copy, so it cannot be spoofed. There is no
 *     `x-forwarded-for` to fall back to.
 *   - **Node (VPS)**: `x-forwarded-for`, which nginx must REPLACE
 *     (`proxy_set_header X-Forwarded-For $remote_addr`). Trusting
 *     `cf-connecting-ip` there would be spoofable, because nothing in front of
 *     the process validates it.
 */

export type AuthRuntime = "workers" | "node";

/** The exact string Workers reports, per Cloudflare's runtime docs. */
const WORKERS_USER_AGENT = "Cloudflare-Workers";

/**
 * Detect the host from `navigator.userAgent`, the only signal Workers documents
 * for this. The auth database mode cannot be used instead: `pg` runs on Workers
 * too, so the presence of a pool says nothing about the runtime.
 */
export function detectAuthRuntime(
	userAgent: string | undefined = typeof navigator === "undefined"
		? undefined
		: navigator.userAgent,
): AuthRuntime {
	return userAgent === WORKERS_USER_AGENT ? "workers" : "node";
}

/** The header(s) betters-auth may read the client address from, most trusted first. */
export function trustedIpHeaders(runtime: AuthRuntime): string[] {
	return runtime === "workers" ? ["cf-connecting-ip"] : ["x-forwarded-for"];
}
