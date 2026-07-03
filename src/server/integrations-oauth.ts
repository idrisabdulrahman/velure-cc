import { createHmac, timingSafeEqual } from "node:crypto";
import { parse, serialize } from "cookie";

const INTEGRATION_OAUTH_COOKIE = "velure_integration_oauth";

type Provider = "quickbooks" | "xero";

type OAuthStatePayload = {
	provider: Provider;
	state: string;
	userId: string;
	sessionId: string;
	createdAt: number;
};

type OAuthSessionBinding = {
	userId: string;
	sessionId: string;
};

function appBaseUrl(request: Request) {
	const url = new URL(request.url);
	return `${url.protocol}//${url.host}`;
}

function isSecure(request: Request) {
	return new URL(request.url).protocol === "https:";
}

function authSecret() {
	const secret = process.env.BETTER_AUTH_SECRET;
	if (!secret) {
		throw new Error(
			"BETTER_AUTH_SECRET is required for integration OAuth state.",
		);
	}
	return secret;
}

function signPayload(payload: string) {
	return createHmac("sha256", authSecret()).update(payload).digest("base64url");
}

function verifySignature(payload: string, signature: string) {
	const expected = signPayload(payload);
	const actualBuffer = Buffer.from(signature, "base64url");
	const expectedBuffer = Buffer.from(expected, "base64url");

	if (actualBuffer.length !== expectedBuffer.length) return false;
	return timingSafeEqual(actualBuffer, expectedBuffer);
}

function serializeSignedPayload(payload: OAuthStatePayload) {
	const payloadJson = JSON.stringify(payload);
	return `${payloadJson}.${signPayload(payloadJson)}`;
}

export function readOAuthStateCookie(request: Request) {
	const raw = parse(request.headers.get("cookie") ?? "")[
		INTEGRATION_OAUTH_COOKIE
	];
	if (!raw) return null;

	try {
		const delimiter = raw.lastIndexOf(".");
		if (delimiter <= 0) return null;

		const payloadJson = raw.slice(0, delimiter);
		const signature = raw.slice(delimiter + 1);
		if (!verifySignature(payloadJson, signature)) return null;

		const payload = JSON.parse(payloadJson) as OAuthStatePayload;
		if (Date.now() - payload.createdAt > 60 * 10 * 1000) return null;

		return payload;
	} catch {
		return null;
	}
}

export function buildOAuthStateCookie(
	request: Request,
	payload: OAuthStatePayload,
) {
	return serialize(INTEGRATION_OAUTH_COOKIE, serializeSignedPayload(payload), {
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		secure: isSecure(request),
		maxAge: 60 * 10,
	});
}

export function clearOAuthStateCookie(request: Request) {
	return serialize(INTEGRATION_OAUTH_COOKIE, "", {
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		secure: isSecure(request),
		maxAge: 0,
	});
}

export function createOAuthState(
	provider: Provider,
	session: OAuthSessionBinding,
) {
	return {
		provider,
		state: crypto.randomUUID(),
		userId: session.userId,
		sessionId: session.sessionId,
		createdAt: Date.now(),
	};
}

export function getQuickBooksAuthorizeUrl(request: Request, state: string) {
	const clientId = process.env.QUICKBOOKS_CLIENT_ID;
	if (!clientId) {
		throw new Error("QUICKBOOKS_CLIENT_ID is missing.");
	}

	const redirectUri = `${appBaseUrl(request)}/api/integrations/quickbooks/callback`;
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: "code",
		scope: "com.intuit.quickbooks.accounting",
		state,
	});

	return `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`;
}

export async function exchangeQuickBooksCode(request: Request, code: string) {
	const clientId = process.env.QUICKBOOKS_CLIENT_ID;
	const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error("QuickBooks OAuth credentials are missing.");
	}

	const redirectUri = `${appBaseUrl(request)}/api/integrations/quickbooks/callback`;
	const response = await fetch(
		"https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
		{
			method: "POST",
			headers: {
				Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code,
				redirect_uri: redirectUri,
			}),
		},
	);

	if (!response.ok) {
		throw new Error(await response.text());
	}

	return (await response.json()) as {
		access_token: string;
		refresh_token?: string;
		expires_in?: number;
	};
}

export function getXeroAuthorizeUrl(request: Request, state: string) {
	const clientId = process.env.XERO_CLIENT_ID;
	if (!clientId) {
		throw new Error("XERO_CLIENT_ID is missing.");
	}

	const redirectUri = `${appBaseUrl(request)}/api/integrations/xero/callback`;
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: "code",
		scope:
			"offline_access openid profile email accounting.transactions accounting.contacts",
		state,
	});

	return `https://login.xero.com/identity/connect/authorize?${params.toString()}`;
}

export async function exchangeXeroCode(request: Request, code: string) {
	const clientId = process.env.XERO_CLIENT_ID;
	const clientSecret = process.env.XERO_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error("Xero OAuth credentials are missing.");
	}

	const redirectUri = `${appBaseUrl(request)}/api/integrations/xero/callback`;
	const response = await fetch("https://identity.xero.com/connect/token", {
		method: "POST",
		headers: {
			Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: redirectUri,
		}),
	});

	if (!response.ok) {
		throw new Error(await response.text());
	}

	return (await response.json()) as {
		access_token: string;
		refresh_token?: string;
		expires_in?: number;
	};
}

export async function getXeroTenant(accessToken: string) {
	const response = await fetch("https://api.xero.com/connections", {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: "application/json",
		},
	});

	if (!response.ok) {
		throw new Error(await response.text());
	}

	const tenants = (await response.json()) as Array<{
		tenantId: string;
		tenantName: string;
	}>;

	return tenants[0] ?? null;
}
