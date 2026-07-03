import { createHmac, timingSafeEqual } from "node:crypto";
import { serialize } from "cookie";
import { auth } from "#/lib/auth";

export const LINK_STEP_UP_COOKIE_NAME = "invoice_link_stepup";

type AuthSession = {
	session: {
		id: string;
		userId: string;
		token: string;
	};
	user: {
		id: string;
		email: string;
		twoFactorEnabled?: boolean | null;
	};
};

type LinkStepUpTokenPayload = {
	userId: string;
	sessionId: string;
};

function authSecret() {
	const value = process.env.BETTER_AUTH_SECRET;
	if (!value) {
		throw new Error(
			"BETTER_AUTH_SECRET is required for link step-up security.",
		);
	}
	return value;
}

function getBaseUrl(request: Request) {
	const url = new URL(request.url);
	return `${url.protocol}//${url.host}`;
}

function isProductionRequest(request: Request) {
	return new URL(request.url).protocol === "https:";
}

async function callAuthEndpoint(
	request: Request,
	path: string,
	init?: {
		method?: "GET" | "POST";
		body?: Record<string, unknown>;
	},
) {
	const headers = new Headers(request.headers);
	if (init?.body) {
		headers.set("content-type", "application/json");
	}

	const authRequest = new Request(`${getBaseUrl(request)}${path}`, {
		method: init?.method ?? "GET",
		headers,
		body: init?.body ? JSON.stringify(init.body) : undefined,
	});

	return auth.handler(authRequest);
}

export async function getAuthSessionFromRequest(request: Request) {
	const response = await callAuthEndpoint(request, "/api/auth/get-session", {
		method: "GET",
	});

	if (!response.ok) {
		return null;
	}

	const body = (await response.json()) as AuthSession | null;
	if (!body?.session?.id || !body?.user?.id) return null;
	return body;
}

export async function sendLinkStepUpOtp(request: Request) {
	return callAuthEndpoint(request, "/api/auth/two-factor/send-otp", {
		method: "POST",
		body: {},
	});
}

export async function verifyLinkStepUpOtp(request: Request, code: string) {
	return callAuthEndpoint(request, "/api/auth/two-factor/verify-otp", {
		method: "POST",
		body: { code },
	});
}

function signPayload(secret: string, payload: string) {
	return createHmac("sha256", secret).update(payload).digest("base64url");
}

function verifyPayload(secret: string, payload: string, signature: string) {
	const expectedSignature = signPayload(secret, payload);
	const signatureBuffer = Buffer.from(signature, "base64url");
	const expectedBuffer = Buffer.from(expectedSignature, "base64url");

	if (signatureBuffer.length !== expectedBuffer.length) {
		return false;
	}

	return timingSafeEqual(signatureBuffer, expectedBuffer);
}

export async function signLinkStepUpToken(payload: LinkStepUpTokenPayload) {
	const payloadJson = JSON.stringify(payload);
	const signature = signPayload(authSecret(), payloadJson);
	return `${encodeURIComponent(payloadJson)}.${signature}`;
}

export async function verifyLinkStepUpToken(
	token: string | undefined,
	expected: LinkStepUpTokenPayload,
) {
	if (!token) return false;

	const delimiter = token.lastIndexOf(".");
	if (delimiter <= 0) return false;

	const encodedPayload = token.slice(0, delimiter);
	const signature = token.slice(delimiter + 1);
	if (!encodedPayload || !signature) return false;

	let payloadJson: string;
	let payload: LinkStepUpTokenPayload;
	try {
		payloadJson = decodeURIComponent(encodedPayload);
		if (!verifyPayload(authSecret(), payloadJson, signature)) return false;
		payload = JSON.parse(payloadJson) as LinkStepUpTokenPayload;
	} catch {
		return false;
	}

	return (
		payload.userId === expected.userId &&
		payload.sessionId === expected.sessionId
	);
}

export function buildLinkStepUpCookie(request: Request, token: string) {
	return serialize(LINK_STEP_UP_COOKIE_NAME, token, {
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		secure: isProductionRequest(request),
	});
}

export function buildClearLinkStepUpCookie(request: Request) {
	return serialize(LINK_STEP_UP_COOKIE_NAME, "", {
		path: "/",
		httpOnly: true,
		sameSite: "lax",
		secure: isProductionRequest(request),
		maxAge: 0,
	});
}
