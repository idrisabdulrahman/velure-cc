import {
	createCsrfMiddleware,
	createMiddleware,
	createStart,
} from "@tanstack/react-start";
import { applySecurityHeaders } from "#/server/security-headers";

/**
 * The framework's default CSRF guard. Defining a start instance replaces the
 * built-in default (`defaultCsrfMiddleware` in `createStartHandler`), so it is
 * added back explicitly with the same filter the framework uses: server
 * functions are same-origin RPC endpoints and must reject cross-site requests.
 */
const csrfMiddleware = createCsrfMiddleware({
	filter: (ctx) => ctx.handlerType === "serverFn",
});

/**
 * Stamps the app-level security-header floor onto every response the Worker
 * builds. The Cloudflare edge owns HSTS; this covers framing, referrer and
 * sniffing protection for SSR documents.
 */
const securityHeadersMiddleware = createMiddleware({ type: "request" }).server(
	async ({ next }) => {
		const result = await next();
		applySecurityHeaders(result.response.headers);
		return result;
	},
);

export const startInstance = createStart(() => ({
	requestMiddleware: [csrfMiddleware, securityHeadersMiddleware],
}));
