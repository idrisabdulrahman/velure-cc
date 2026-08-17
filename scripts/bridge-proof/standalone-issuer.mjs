/**
 * Standalone better-auth OIDC issuer server — the A9 activation run.
 *
 * Serves the exact shape proven in `oidc-bridge.test.ts` (jwt + oidcProvider
 * plugins, `basePath: ""` so discovery lives at OIDC-standard root paths,
 * `useJWTPlugin: true` so the id_token is RS256 against the JWKS), but as a
 * real HTTP server behind a public URL so Supabase Auth (`velure-cc`) can
 * fetch discovery + JWKS server-side and run the real authorization-code flow.
 *
 * Memory adapter: zero writes to `velure-cc` (the A9 production shape uses a
 * Postgres adapter in its own schema — a separate, explicitly-approved change).
 *
 * Env:
 *   ISSUER_URL    public base URL (the cloudflared tunnel URL)
 *   PORT          local listen port (default 8788)
 *   CLIENT_ID     OIDC client id registered in Supabase (default from below)
 *   CLIENT_SECRET OIDC client secret registered in Supabase
 *   REDIRECT_URIS comma-separated allowed redirect uris (defaults to the
 *                  Supabase GoTrue callback for `velure-cc`)
 *
 * NOTE: `disablePrivateKeyEncryption` is on ONLY so the runbook can re-verify
 * the id_token signature offline with jose. Production keeps encryption on.
 */
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { jwt, oidcProvider } from "better-auth/plugins";
import http from "node:http";

const ISSUER_URL = process.env.ISSUER_URL;
if (!ISSUER_URL) throw new Error("ISSUER_URL is required (the public tunnel URL)");

const PORT = Number(process.env.PORT ?? 8788);
const CLIENT_ID = process.env.CLIENT_ID ?? "velure-supabase-client";
const CLIENT_SECRET = process.env.CLIENT_SECRET ?? "velure-supabase-client-secret-live-run";
const DEFAULT_REDIRECT = `https://kbexydkmmfabfutgkbxn.supabase.co/auth/v1/callback`;
const REDIRECT_URIS = (process.env.REDIRECT_URIS ?? DEFAULT_REDIRECT).split(",").map((s) => s.trim());

const memoryDb = {
	user: [],
	session: [],
	account: [],
	verification: [],
	jwks: [],
	oauthApplication: [],
	oauthAccessToken: [],
	oauthConsent: [],
};

export const auth = betterAuth({
	baseURL: ISSUER_URL,
	basePath: "",
	secret: process.env.BETTER_AUTH_SECRET ?? "a9-live-run-secret-not-for-production-0123456789",
	database: memoryAdapter(memoryDb),
	emailAndPassword: { enabled: true },
	plugins: [
		jwt({
			jwt: {
				issuer: ISSUER_URL,
				audience: ["velure-api"],
				expirationTime: "1 minute",
			},
			jwks: {
				keyPairConfig: { alg: "RS256" },
				disablePrivateKeyEncryption: true,
			},
		}),
		oidcProvider({
			useJWTPlugin: true,
			accessTokenExpiresIn: 300,
			allowDynamicClientRegistration: false,
			trustedClients: [
				{
					clientId: CLIENT_ID,
					clientSecret: CLIENT_SECRET,
					redirectUrls: REDIRECT_URIS,
					skipConsent: true,
					metadata: {},
				},
			],
		}),
	],
});

// DEV-ONLY (this harness uses a memory adapter and a throwaway tunnel; never
// port this route to production): mark a user's email verified so GoTrue
// accepts the OIDC sign-in. Gated by the DEV_TOKEN env so it cannot fire
// accidentally.
const DEV_TOKEN = process.env.DEV_TOKEN;

function devRoute(url, req, res) {
	if (url.pathname !== "/__dev/verify-email") return false;
	if (!DEV_TOKEN || req.headers["x-dev-token"] !== DEV_TOKEN) {
		res.statusCode = 403;
		res.end("forbidden");
		return true;
	}
	let body = "";
	req.on("data", (c) => (body += c));
	req.on("end", () => {
		const { email } = JSON.parse(body);
		const user = memoryDb.user.find((u) => u.email === email);
		if (!user) {
			res.statusCode = 404;
			res.end(JSON.stringify({ ok: false, error: "no such user" }));
			return;
		}
		user.emailVerified = true;
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify({ ok: true, id: user.id, emailVerified: user.emailVerified }));
	});
	return true;
}

const server = http.createServer((req, res) => {
	const url = new URL(req.url ?? "/", ISSUER_URL);
	if (devRoute(url, req, res)) return;
	// better-auth's handler expects the full URL of the incoming request.
	// Node 24's undici requires `duplex: "half"` whenever a body is attached.
	const hasBody = !["GET", "HEAD"].includes(req.method ?? "GET");
	const request = new Request(url, {
		method: req.method,
		headers: req.headers,
		body: hasBody ? req : undefined,
		...(hasBody ? { duplex: "half" } : {}),
	});
	auth.handler(request)
		.then(async (response) => {
			res.statusCode = response.status;
			for (const [k, v] of response.headers) res.setHeader(k, v);
			res.end(Buffer.from(await response.arrayBuffer()));
		})
		.catch((error) => {
			console.error("issuer error:", error);
			res.statusCode = 500;
			res.end(String(error));
		});
});

server.listen(PORT, () => {
	console.log(`issuer listening on http://localhost:${PORT}`);
	console.log(`issuer url: ${ISSUER_URL}`);
	console.log(`client id: ${CLIENT_ID}`);
	console.log(`redirect uris: ${REDIRECT_URIS.join(", ")}`);
});
