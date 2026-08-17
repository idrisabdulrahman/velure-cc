import { env } from "#/env";
import { getAuthSessionFromRequest } from "./security-stepup";

/**
 * A10 — the Supabase session bridge.
 *
 * The browser holds no Supabase JWT today (app auth is Better Auth over
 * Convex), so RLS-enforced reads are impossible from the UI. This module
 * mints one server-side, reusing the A9-proven OIDC mechanics:
 *
 *   1. verify the Better Auth session from the request (the app user id);
 *   2. provision that user at the issuer via `POST /__bridge/provision`
 *      (shared-token gated) — the issuer upserts the user with the SAME id
 *      so the minted JWT's `velure_user_id` == the id stored in
 *      owner_id/user_id, and RLS resolves existing rows;
 *   3. sign in at the issuer through the REAL `/sign-in/email` endpoint with
 *      the one-time password (the harness's proven path — no cookie
 *      re-implementation);
 *   4. drive GoTrue authorize -> issuer -> callback, capturing the minted
 *      Supabase JWT from the final fragment.
 *
 * Env: ISSUER_URL, BRIDGE_ADMIN_TOKEN, VITE_SUPABASE_URL, and the publishable
 * key (anon) via VITE_SUPABASE_PUBLISHABLE_KEY / SUPABASE_PUBLISHABLE_KEY.
 */

type MintResult = {
	accessToken: string;
	expiresAt: number;
	velureUserId: string;
};

function issuerUrl(): string {
	const value = env.ISSUER_URL;
	if (!value)
		throw new Error("ISSUER_URL is required for the Supabase session bridge");
	return value;
}

function bridgeToken(): string {
	const value = env.BRIDGE_ADMIN_TOKEN;
	if (!value)
		throw new Error(
			"BRIDGE_ADMIN_TOKEN is required for the Supabase session bridge",
		);
	return value;
}

function supabaseApi(): string {
	const value = env.VITE_SUPABASE_URL ?? env.SUPABASE_URL;
	if (!value) throw new Error("VITE_SUPABASE_URL / SUPABASE_URL is required");
	return value.replace(/\/$/, "");
}

function anonKey(): string {
	const value =
		env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_PUBLISHABLE_KEY;
	if (!value) throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY is required");
	return value;
}

function makeCookieJar() {
	const cookies = new Map<string, string>();
	return {
		store(res: Response) {
			for (const c of res.headers.getSetCookie?.() ?? []) {
				const [pair, ...rest] = c.split(";");
				const [k, ...v] = pair.split("=");
				const key = k.trim();
				const value = v.join("=").trim();
				const isExpired = rest.some((p) =>
					p.trim().toLowerCase().startsWith("max-age=0"),
				);
				if (isExpired || value === "") cookies.delete(key);
				else cookies.set(key, value);
			}
		},
		header() {
			return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
		},
	};
}

async function followRedirects(
	url: string,
	jar: ReturnType<typeof makeCookieJar>,
	{ headers = {} }: { headers?: Record<string, string> } = {},
	hops = 0,
): Promise<{ handoff?: string }> {
	const res = await fetch(url, {
		headers: { ...headers, cookie: jar.header() },
		redirect: "manual",
	});
	jar.store(res);
	const location = res.headers.get("location");
	let jsonRedirect: string | null = null;
	if (
		res.status === 200 &&
		res.headers.get("content-type")?.includes("application/json")
	) {
		try {
			const parsed = (await res.clone().json()) as {
				redirect?: boolean;
				url?: string;
			};
			if (parsed?.redirect === true && parsed.url) jsonRedirect = parsed.url;
		} catch {
			/* not a JSON redirect */
		}
	}
	const nextUrl =
		res.status >= 300 && res.status < 400 && location ? location : jsonRedirect;
	if (nextUrl) {
		const next = new URL(nextUrl, url);
		const host = next.hostname;
		const inFlow =
			host.endsWith("supabase.co") || host === new URL(issuerUrl()).hostname;
		if (!inFlow) return { handoff: next.toString() };
		if (hops > 8) throw new Error("too many redirects in OIDC flow");
		return followRedirects(next.toString(), jar, { headers }, hops + 1);
	}
	return {};
}

/**
 * Mint a Supabase JWT for the verified session user. Returns null when the
 * request carries no valid Better Auth session; throws on issuer/GoTrue
 * failures (the caller decides how to surface them).
 */
export async function mintSupabaseAccessToken(
	request: Request,
): Promise<MintResult | null> {
	const session = await getAuthSessionFromRequest(request);
	if (!session) return null;
	const userId = session.user.id;
	const email = session.user.email;
	const name = email;

	// 1) Provision the user at the issuer with the app's id.
	const provision = await fetch(`${issuerUrl()}/__bridge/provision`, {
		method: "POST",
		headers: {
			"x-bridge-token": bridgeToken(),
			"content-type": "application/json",
		},
		body: JSON.stringify({ userId, email, name }),
	});
	if (!provision.ok) {
		const text = await provision.text();
		throw new Error(
			`issuer provision failed: ${provision.status} ${text.slice(0, 200)}`,
		);
	}
	const provisionBody = (await provision.json()) as { password: string };
	const password = provisionBody.password;

	// 2) Sign in at the issuer through the real endpoint.
	const jar = makeCookieJar();
	const signin = await fetch(`${issuerUrl()}/sign-in/email`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ email, password }),
		redirect: "manual",
	});
	if (signin.status !== 200) {
		const text = await signin.text();
		throw new Error(
			`issuer sign-in failed: ${signin.status} ${text.slice(0, 200)}`,
		);
	}
	jar.store(signin);

	// 3) Drive GoTrue authorize -> issuer -> callback -> Supabase JWT.
	const { handoff } = await followRedirects(
		`${supabaseApi()}/auth/v1/authorize?provider=custom:velure`,
		jar,
		{ headers: { apikey: anonKey() } },
	);
	const fragment = handoff ? new URL(handoff).hash : "";
	const params = new URLSearchParams(fragment.replace(/^#/, ""));
	const accessToken = params.get("access_token");
	const expiresIn = params.get("expires_in");
	if (!accessToken) {
		throw new Error(
			`no access_token in GoTrue handoff: ${handoff?.slice(0, 200) ?? "no handoff"}`,
		);
	}

	return {
		accessToken,
		expiresAt:
			Date.now() + (expiresIn ? Number(expiresIn) * 1000 : 60 * 60 * 1000),
		velureUserId: userId,
	};
}

/** Decode the JWT's claims without verification (claim inspection only). */
export function decodeSupabaseJwt(token: string) {
	const part = token.split(".")[1];
	if (!part) throw new Error("invalid JWT");
	return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<
		string,
		unknown
	>;
}
