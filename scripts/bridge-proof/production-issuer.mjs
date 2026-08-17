/**
 * Production better-auth standalone issuer — the A9 runtime shape.
 *
 * The memory-adapter harness (`standalone-issuer.mjs`) proved the OIDC flow;
 * this is the production counterpart: better-auth 1.4.9 with the Postgres
 * adapter (raw `pg.Pool`; better-auth auto-detects Postgres and uses its
 * internal Kysely adapter) against the `better_auth` schema on `velure-cc`
 * created by `20260817012325_phase_a9_better_auth_schema.sql`.
 *
 * Differences from the harness (all intentional):
 *   * `database` is the project's Postgres pool, NOT the memory adapter —
 *     sessions/users/jwks persist across restarts;
 *   * search_path is pinned to `better_auth` on the pool, so better-auth's
 *     unqualified table names (`user`, `session`, ...) resolve to the
 *     dedicated schema and never `public`;
 *   * private key encryption is ON (the harness disabled it only so the
 *     runbook could re-verify id_token signatures offline with jose);
 *   * no `__dev/verify-email` route — real email verification goes through
 *     `sendVerificationEmail` (Resend), and GoTrue requires verified emails
 *     at OIDC sign-in (`provider_email_needs_verification`).
 *
 * Env:
 *   ISSUER_URL        public base URL (the deployed issuer URL)
 *   DATABASE_URL      velure-cc direct Postgres connection string
 *                     (project owner role) — search_path is forced by this
 *                     server regardless of what the URL carries
 *   BETTER_AUTH_SECRET  >= 32 chars; also used for jwks key encryption
 *   PORT              local listen port (default 8788)
 *   CLIENT_ID         OIDC client id registered in Supabase
 *   CLIENT_SECRET     OIDC client secret registered in Supabase
 *   REDIRECT_URIS     comma-separated allowed redirect uris (defaults to the
 *                     Supabase GoTrue callback for `velure-cc`)
 *   RESEND_API_KEY    (optional) enables email verification via Resend
 *   RESEND_FROM       (optional) sender for verification emails
 */
import { betterAuth } from "better-auth";
import { jwt, oidcProvider } from "better-auth/plugins";
import { hashPassword } from "better-auth/crypto";
import pg from "pg";
import http from "node:http";
import crypto from "node:crypto";

const ISSUER_URL = process.env.ISSUER_URL;
if (!ISSUER_URL) throw new Error("ISSUER_URL is required (the deployed public URL)");
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required (velure-cc direct connection)");
const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
if (!BETTER_AUTH_SECRET || BETTER_AUTH_SECRET.length < 32) {
	throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
}

const PORT = Number(process.env.PORT ?? 8788);
const CLIENT_ID = process.env.CLIENT_ID ?? "velure-supabase-client";
const CLIENT_SECRET = process.env.CLIENT_SECRET;
if (!CLIENT_SECRET) throw new Error("CLIENT_SECRET is required (must match the Supabase OAuth app)");
// Shared secret for the A10 session bridge: the app server calls
// POST /__bridge/provision with this token to mirror its better-auth user
// into better_auth (same user id) and get back a one-time password it uses
// to sign in through the REAL /sign-in/email endpoint (proven path).
const BRIDGE_ADMIN_TOKEN = process.env.BRIDGE_ADMIN_TOKEN;
if (!BRIDGE_ADMIN_TOKEN || BRIDGE_ADMIN_TOKEN.length < 16) {
	throw new Error("BRIDGE_ADMIN_TOKEN is required (>= 16 chars, shared with the app server)");
}
const DEFAULT_REDIRECT = `https://kbexydkmmfabfutgkbxn.supabase.co/auth/v1/callback`;
const REDIRECT_URIS = (process.env.REDIRECT_URIS ?? DEFAULT_REDIRECT).split(",").map((s) => s.trim());

// search_path pinned to better_auth: every better-auth query resolves to the
// dedicated schema created by the A9 migration, never `public`.
const pool = new pg.Pool({
	connectionString: DATABASE_URL,
	options: "-c search_path=better_auth",
	max: 10,
});

// better-auth has a known design gap (issues #4749 / #6649): trusted clients
// are validated from config but never persisted, so the token endpoint's
// oauthAccessToken insert violates the oauthAccessToken_clientId_fkey
// constraint (the memory adapter hid this — it has no FK enforcement).
// Maintainer-suggested workaround: seed the trusted client into
// oauthApplication at startup. Config still wins in getClient(); the row
// exists solely so the FK resolves. Fail fast if the seed cannot be written.
await seedTrustedClient(pool, CLIENT_ID, CLIENT_SECRET, REDIRECT_URIS);

async function seedTrustedClient(pool, clientId, clientSecret, redirectUris) {
	const now = new Date();
	const redirectUrls = redirectUris.join(","); // DB stores comma-joined; getClient splits on ","
	try {
		await pool.query(
			`insert into "oauthApplication"
				("id", "clientId", "clientSecret", "redirectUrls", "type", "name", "disabled", "metadata", "createdAt", "updatedAt")
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
			 on conflict ("clientId") do update set
				"clientSecret" = excluded."clientSecret",
				"redirectUrls" = excluded."redirectUrls",
				"updatedAt" = excluded."updatedAt"`,
			[crypto.randomUUID(), clientId, clientSecret, redirectUrls, "confidential", "Velure Supabase OIDC client", false, "{}", now],
		);
	} catch (error) {
		throw new Error(`failed to seed oauthApplication trusted client: ${error.message}`);
	}
}

export const auth = betterAuth({
	baseURL: ISSUER_URL,
	basePath: "",
	secret: BETTER_AUTH_SECRET,
	database: pool,
	emailAndPassword: {
		enabled: true,
		requireEmailVerification: true,
		sendResetPassword: async ({ user, url }) => {
			if (!process.env.RESEND_API_KEY) {
				console.warn("RESEND_API_KEY not set — reset password email not sent to", user.email);
				return;
			}
			await sendEmail(user.email, "Reset your Velure password", `Reset your password: ${url}`);
		},
	},
	emailVerification: {
		sendOnSignUp: true,
		autoSignInAfterVerification: false,
		sendVerificationEmail: async ({ user, url }) => {
			if (!process.env.RESEND_API_KEY) {
				console.warn("RESEND_API_KEY not set — verification email not sent to", user.email);
				return;
			}
			await sendEmail(user.email, "Verify your Velure email", `Verify your email: ${url}`);
		},
	},
	plugins: [
		jwt({
			jwt: {
				issuer: ISSUER_URL,
				audience: ["velure-api"],
				expirationTime: "1 minute",
			},
			jwks: {
				keyPairConfig: { alg: "RS256" },
				// Production: private key encryption stays ON (BETTER_AUTH_SECRET).
			},
		}),
		oidcProvider({
			useJWTPlugin: true,
			accessTokenExpiresIn: 300,
			allowDynamicClientRegistration: false,
			// REQUIRED by OIDCOptions: when the authorize request carries no
			// session (unauthenticated browser), better-auth redirects here with
			// the original query. The app must serve a sign-in page at this URL.
			loginPage: `${ISSUER_URL}/sign-in`,
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

async function sendEmail(to, subject, html) {
	const res = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			authorization: `Bearer ${process.env.RESEND_API_KEY}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			from: process.env.RESEND_FROM ?? "Velure <no-reply@velure.app>",
			to,
			subject,
			html,
		}),
	});
	if (!res.ok) console.warn(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function readBody(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	return Buffer.concat(chunks).toString("utf8");
}

/**
 * A10 bridge: mirror the app's better-auth user into better_auth with the
 * SAME user id (so the minted Supabase JWT's velure_user_id == the app's
 * owner_id/user_id values and RLS resolves existing rows), and return a
 * one-time password the bridge uses to sign in through the real endpoint.
 */
async function handleBridgeProvision(req, res, url) {
	if (req.headers["x-bridge-token"] !== BRIDGE_ADMIN_TOKEN) {
		res.statusCode = 401;
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify({ error: "unauthorized" }));
		return;
	}
	let body;
	try {
		body = JSON.parse(await readBody(req));
	} catch {
		res.statusCode = 400;
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify({ error: "invalid json" }));
		return;
	}
	const { userId, email, name } = body ?? {};
	if (!userId || typeof userId !== "string" || !email || typeof email !== "string") {
		res.statusCode = 400;
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify({ error: "userId and email are required strings" }));
		return;
	}
	const normalizedEmail = email.trim().toLowerCase();
	const password = crypto.randomBytes(24).toString("base64url");
	const passwordHash = await hashPassword(password);
	try {
		// The user id is the identity anchor: existing owner_id/user_id rows in
		// `public` hold the app's better-auth user id, and the custom access
		// token hook copies the issuer's sub into velure_user_id — so the user
		// row MUST carry the app's id for RLS to resolve. Postgres allows only
		// ONE on conflict target per statement, so the user upsert keys on the
		// id PK (the anchor); a re-provision of the same id refreshes email.
		await pool.query(
			`insert into better_auth."user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
			 values ($1, $2, $3, true, now(), now())
			 on conflict ("id") do update set "email" = excluded."email", "name" = excluded."name", "emailVerified" = true, "updatedAt" = now()`,
			[userId, name ?? normalizedEmail, normalizedEmail],
		);
		// credential account row (providerId "credential") holds the password
		// hash. There is no unique (userId, providerId) constraint in the A9
		// migration, so upsert by PK id and delete any stale credential row.
		await pool.query(
			`delete from better_auth."account" where "userId" = $1 and "providerId" = 'credential'`,
			[userId],
		);
		await pool.query(
			`insert into better_auth."account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
			 values ($1, $2, 'credential', $3, $4, now(), now())
			 on conflict ("id") do update set "password" = excluded."password", "updatedAt" = now()`,
			[crypto.randomUUID(), userId, userId, passwordHash],
		);
	} catch (error) {
		console.error("provision error:", error);
		res.statusCode = 500;
		res.setHeader("content-type", "application/json");
		res.end(JSON.stringify({ error: "provision failed" }));
		return;
	}
	res.statusCode = 200;
	res.setHeader("content-type", "application/json");
	res.end(JSON.stringify({ ok: true, userId, email: normalizedEmail, password }));
}

process.on("unhandledRejection", (reason) => {
	console.error("unhandled rejection:", reason);
});

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url ?? "/", ISSUER_URL);
	// A10 session bridge endpoint — handled before better-auth so it stays out
	// of the OIDC/plugin surface entirely.
	if (url.pathname === "/__bridge/provision" && req.method === "POST") {
		try {
			await handleBridgeProvision(req, res, url);
		} catch (error) {
			console.error("provision handler error:", error);
			if (!res.headersSent) {
				res.statusCode = 500;
				res.setHeader("content-type", "application/json");
				res.end(JSON.stringify({ error: String(error) }));
			}
		}
		return;
	}
	const hasBody = !["GET", "HEAD"].includes(req.method ?? "GET");
	const request = new Request(url, {
		method: req.method,
		headers: req.headers,
		body: hasBody ? req : undefined,
		...(hasBody ? { duplex: "half" } : {}),
	});
	auth.handler(request)
		.then(async (response) => {
			const body = Buffer.from(await response.arrayBuffer());
			if (process.env.LOG_REQUESTS) {
				const snippet =
					url.pathname === "/oauth2/token"
						? ` body=${body.toString().slice(0, 220)}`
						: "";
				console.error(
					`REQ ${req.method} ${url.pathname} origin=${req.headers.origin ?? "-"} cookie=${req.headers.cookie ? "yes" : "no"} -> ${response.status}${snippet}`,
				);
			}
			res.statusCode = response.status;
			for (const [k, v] of response.headers) res.setHeader(k, v);
			res.end(body);
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
	console.log(`database: postgres (search_path=better_auth)`);
	console.log(`client id: ${CLIENT_ID}`);
	console.log(`redirect uris: ${REDIRECT_URIS.join(", ")}`);
	console.log(`bridge provision: enabled (__bridge/provision)`);
});
