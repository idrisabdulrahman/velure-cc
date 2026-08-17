import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import authConfig from "./auth.config";
import { env, requireEnv } from "./env";

export const authComponent = createClient<DataModel>(components.betterAuth);

type AuthMutationCtx = {
	runMutation: (
		mutation: unknown,
		args: { userId: string; businessName?: string },
	) => Promise<unknown>;
};

function appBaseUrl() {
	return (
		env.BETTER_AUTH_BASE_URL ??
		env.BETTER_AUTH_URL ??
		env.SITE_URL ??
		"http://localhost:3000"
	);
}

function appOrigin() {
	try {
		return new URL(appBaseUrl()).origin;
	} catch {
		return "http://localhost:3000";
	}
}

function isProductionEnv() {
	return env.NODE_ENV === "production";
}

const SESSION_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;
const SESSION_COOKIE_CACHE_MAX_AGE_SECONDS = 60;

function getAuthUserId(user: { id?: string; _id?: string }) {
	return user._id ?? user.id;
}

function getSignupBusinessName(context: unknown) {
	if (!context || typeof context !== "object") return undefined;
	const body = (context as { body?: unknown }).body;
	if (!body || typeof body !== "object") return undefined;
	const businessName = (body as { businessName?: unknown }).businessName;
	return typeof businessName === "string" ? businessName : undefined;
}

async function sendEmail(params: {
	to: string;
	subject: string;
	html: string;
}) {
	const apiKey = env.RESEND_API_KEY;
	if (!apiKey) {
		throw new Error("RESEND_API_KEY is missing for transactional emails.");
	}

	const from = env.RESEND_FROM ?? "Velure <onboarding@resend.dev>";

	const response = await fetch("https://api.resend.com/emails", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			from,
			to: params.to,
			subject: params.subject,
			html: params.html,
		}),
	});

	if (!response.ok) {
		const message = await response.text();
		throw new Error(`Resend request failed: ${message}`);
	}
}

async function sendResetPasswordEmail(params: {
	to: string;
	resetUrl: string;
}) {
	await sendEmail({
		to: params.to,
		subject: "Reset your password",
		html: `
      <div style="font-family: Arial, sans-serif; color: #111; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">Reset your password</h2>
        <p style="margin: 0 0 12px;">We received a request to reset your password.</p>
        <p style="margin: 0 0 16px;">
          <a href="${params.resetUrl}" style="display:inline-block;padding:10px 14px;background:#0f172a;color:#fff;border-radius:6px;text-decoration:none;">
            Reset password
          </a>
        </p>
        <p style="margin: 0; color: #555;">If you did not request this, you can ignore this email.</p>
      </div>
    `,
	});
}

export const createAuth = (ctx: GenericCtx<DataModel>) =>
	betterAuth({
		baseURL: appBaseUrl(),
		secret: requireEnv("BETTER_AUTH_SECRET"),
		trustedOrigins: [appOrigin()],
		database: authComponent.adapter(ctx),
		socialProviders:
			env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
				? {
						google: {
							clientId: env.GOOGLE_CLIENT_ID,
							clientSecret: env.GOOGLE_CLIENT_SECRET,
							disableImplicitSignUp: true,
						},
					}
				: undefined,
		rateLimit: {
			enabled: true,
			storage: "database",
			window: 10,
			max: 100,
		},
		session: {
			expiresIn: SESSION_EXPIRES_IN_SECONDS,
			updateAge: SESSION_UPDATE_AGE_SECONDS,
			freshAge: SESSION_UPDATE_AGE_SECONDS,
			cookieCache: {
				enabled: true,
				maxAge: SESSION_COOKIE_CACHE_MAX_AGE_SECONDS,
				version: env.AUTH_SESSION_VERSION ?? "1",
			},
		},
		advanced: {
			useSecureCookies: isProductionEnv(),
		},
		databaseHooks: {
			user: {
				create: {
					after: async (user, context) => {
						const userId = getAuthUserId(user);
						if (!userId) return;

						await (ctx as unknown as AuthMutationCtx).runMutation(
							internal.workspaces.ensureWorkspaceForAuth,
							{
								userId,
								businessName: getSignupBusinessName(context) ?? user.name,
							},
						);
					},
				},
			},
		},
		account: {
			accountLinking: {
				enabled: true,
				allowDifferentEmails: false,
				trustedProviders: [],
				allowUnlinkingAll: false,
			},
		},
		emailAndPassword: {
			enabled: true,
			sendResetPassword: async ({ user, url }) => {
				const parsed = new URL(url);
				const token = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
				const resetUrl = `${appBaseUrl()}/auth?mode=reset&token=${encodeURIComponent(token)}`;
				await sendResetPasswordEmail({
					to: user.email,
					resetUrl,
				});
			},
		},
		plugins: [
			crossDomain({
				siteUrl: appOrigin(),
			}),
			convex({
				authConfig,
			}),
		],
	});

export const requireAuthUser = authComponent.getAuthUser;
export const safeAuthUser = authComponent.safeGetAuthUser;
export const { getAuthUser } = authComponent.clientApi();
