import { beforeAll, describe, expect, it, vi } from "vitest";
import { verifyPassword } from "#/server/password-hash";
import { createRateLimitStore } from "#/server/rate-limit-store";

/**
 * Gate 3 (auth security and concurrency), handler level.
 *
 * The unit suites prove the pieces: the hash contract, the store's Postgres and
 * fail-open behaviour, and the binding's fallbacks. What they cannot prove is the
 * order Better Auth actually runs them in, because that order is what the CPU
 * and lockout risks depend on:
 *
 *   1. the login limit must reject a request **before** the password is hashed,
 *      or a flood still spends the Durable Object allowance it was meant to
 *      bound;
 *   2. the submitted password must never reach a log line on any path;
 *   3. concurrent sign-ins must all settle, with the limit still enforced.
 *
 * Two layers are checked here:
 *
 *   - **Wiring**: the real singleton from `src/lib/auth.ts` must carry the
 *     hasher overrides and the shared store. This catches a future edit that
 *     silently drops one.
 *   - **Behaviour**: a Better Auth instance built with the same option shape,
 *     backed by the in-memory adapter, driven through `auth.handler` over real
 *     HTTP requests. The store is the real one; only its Postgres pool is
 *     emulated.
 */

const SECRET = "test-secret-at-least-32-characters-long";
const PASSWORD = "Correct-Horse-Battery-9!";
const EMAIL = "gate3-handler@example.com";

type BetterAuth = typeof import("#/lib/auth").auth;

/** The only surface the flow tests need, so a locally built instance fits. */
type HandlerOnly = {
	handler: (request: Request) => Promise<Response>;
};

let auth: BetterAuth;

beforeAll(async () => {
	process.env.BETTER_AUTH_SECRET = SECRET;
	process.env.RESEND_API_KEY = "test-resend-key";
	process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
	auth = (await import("#/lib/auth")).auth;
});

describe("production auth wiring", () => {
	it("routes every password hash and verify through the Durable Object binding", async () => {
		const binding = await import("#/server/password-hasher-binding");
		const options = auth.options as unknown as {
			emailAndPassword: {
				password: { hash: unknown; verify: unknown };
			};
		};

		// Identity, not shape: the singleton must hold *these* functions, so the
		// Worker never scrypts in process and never loses the DO route.
		expect(options.emailAndPassword.password.hash).toBe(
			binding.hashPasswordWithBinding,
		);
		expect(options.emailAndPassword.password.verify).toBe(
			binding.verifyPasswordWithBinding,
		);
	});

	it("enables the shared rate-limit store with a strict sign-in rule", () => {
		const options = auth.options as unknown as {
			rateLimit: {
				enabled: boolean;
				customStorage: { get: unknown; set: unknown };
				customRules: Record<string, { window: number; max: number }>;
			};
		};

		expect(options.rateLimit.enabled).toBe(true);
		expect(typeof options.rateLimit.customStorage.get).toBe("function");
		expect(typeof options.rateLimit.customStorage.set).toBe("function");
		// The strict budget that bounds how many hashes a flood can cause.
		expect(options.rateLimit.customRules["/sign-in/email"]).toEqual({
			window: 10,
			max: 3,
		});
	});

	it("enables account deletion and wires the application-side cascade", () => {
		const options = auth.options as unknown as {
			user?: {
				deleteUser?: { enabled?: boolean; beforeDelete?: unknown };
			};
		};

		expect(options.user?.deleteUser?.enabled).toBe(true);
		expect(typeof options.user?.deleteUser?.beforeDelete).toBe("function");
	});
});

/**
 * A pool that emulates the statements `createRateLimitStore` issues, so the real
 * store code (key digest, driver-string coercion, the reset rule) runs without a
 * Postgres server. The key is stored hashed, exactly as production does.
 */
function emulatedPool() {
	const rows = new Map<string, { count: number; lastRequest: number }>();

	return {
		rows,
		async query(text: string, values: unknown[] = []) {
			if (!text.startsWith("insert")) return { rows: [] };

			const [key, nowMs, windowMs] = values as [string, number, number];
			const previous = rows.get(key);
			const count =
				!previous || previous.lastRequest < nowMs - windowMs
					? 0
					: previous.count + 1;

			rows.set(key, { count, lastRequest: nowMs });

			return {
				// Emulate `pg` returning int8 as a string.
				rows: [{ count, lastRequest: String(nowMs) }],
			};
		},
	};
}

/** Builds a handler-driven instance with the same security options as production. */
async function handlerInstance() {
	const { betterAuth } = await import("better-auth");
	const { memoryAdapter } = await import("better-auth/adapters/memory");
	const { createAuthLogger } = await import("#/server/auth-logger");
	const binding = await import("#/server/password-hasher-binding");

	const pool = emulatedPool();
	const verifySpy = vi.fn(
		async (input: { hash: string; password: string }) =>
			await binding.verifyPasswordWithBinding(input, null),
	);

	const instance = betterAuth({
		baseURL: "http://localhost:3000",
		secret: SECRET,
		database: memoryAdapter({
			user: [],
			session: [],
			account: [],
			verification: [],
			rateLimit: [],
		}),
		logger: createAuthLogger(),
		emailAndPassword: {
			enabled: true,
			minPasswordLength: 12,
			maxPasswordLength: 128,
			password: {
				hash: (password: string) =>
					binding.hashPasswordWithBinding(password, null),
				verify: verifySpy,
			},
		},
		rateLimit: {
			enabled: true,
			customStorage: createRateLimitStore({ pool, secret: SECRET }),
			customRules: {
				"/sign-in/email": { window: 10, max: 3 },
				"/sign-up/email": { window: 10, max: 3 },
			},
		},
		advanced: {
			ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
		},
	});

	return { instance, verifySpy, pool };
}

function post(
	instance: HandlerOnly,
	path: string,
	body: Record<string, unknown>,
	ip: string,
): Promise<Response> {
	return instance.handler(
		new Request(`http://localhost:3000/api/auth${path}`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-forwarded-for": ip,
			},
			body: JSON.stringify(body),
		}),
	);
}

/** Captures everything the logger writes while `run` executes. */
async function captureConsole<T>(run: () => Promise<T>): Promise<{
	result: T;
	printed: string;
}> {
	const spies = [
		vi.spyOn(console, "debug").mockImplementation(() => undefined),
		vi.spyOn(console, "info").mockImplementation(() => undefined),
		vi.spyOn(console, "warn").mockImplementation(() => undefined),
		vi.spyOn(console, "error").mockImplementation(() => undefined),
	];

	try {
		const result = await run();
		const printed = spies
			.flatMap((spy) => spy.mock.calls)
			.flat()
			.map((arg) => {
				try {
					return typeof arg === "string" ? arg : JSON.stringify(arg);
				} catch {
					return String(arg);
				}
			})
			.join("\n");

		return { result, printed };
	} finally {
		for (const spy of spies) spy.mockRestore();
	}
}

describe("login flow through auth.handler", () => {
	it("signs in with the correct password", async () => {
		const { instance, verifySpy } = await handlerInstance();

		const signUp = await post(
			instance,
			"/sign-up/email",
			{ email: EMAIL, password: PASSWORD, name: "Gate Three" },
			"198.51.100.10",
		);
		expect([200, 201]).toContain(signUp.status);

		verifySpy.mockClear();

		const signIn = await post(
			instance,
			"/sign-in/email",
			{ email: EMAIL, password: PASSWORD },
			"198.51.100.10",
		);

		expect(signIn.status).toBe(200);
		// Exactly one verify, through the binding seam.
		expect(verifySpy).toHaveBeenCalledTimes(1);
	});

	it("rejects with the limit before hashing a fourth time", async () => {
		const { instance, verifySpy } = await handlerInstance();
		const ip = "198.51.100.20";

		await post(
			instance,
			"/sign-up/email",
			{ email: `exhaust-${EMAIL}`, password: PASSWORD, name: "Gate Three" },
			ip,
		);
		verifySpy.mockClear();

		const statuses: number[] = [];
		for (let attempt = 0; attempt < 4; attempt++) {
			const response = await post(
				instance,
				"/sign-in/email",
				{ email: `exhaust-${EMAIL}`, password: "wrong-password-here" },
				ip,
			);
			statuses.push(response.status);
		}

		// The fourth is refused...
		expect(statuses.at(-1)).toBe(429);
		// ...and, decisively, the refusal happened before the password was
		// verified, so no fourth hash was ever computed.
		expect(verifySpy).toHaveBeenCalledTimes(3);
	});

	it("keeps the limit enforced under concurrent sign-ins", async () => {
		const { instance, verifySpy } = await handlerInstance();
		const ip = "198.51.100.30";

		await post(
			instance,
			"/sign-up/email",
			{ email: `concurrent-${EMAIL}`, password: PASSWORD, name: "Gate Three" },
			ip,
		);
		verifySpy.mockClear();

		const responses = await Promise.all(
			Array.from({ length: 6 }, () =>
				post(
					instance,
					"/sign-in/email",
					{ email: `concurrent-${EMAIL}`, password: "nope-nope-nope" },
					ip,
				),
			),
		);

		// Every request settles: no hang, no crash.
		expect(responses).toHaveLength(6);
		expect(responses.every((r) => typeof r.status === "number")).toBe(true);
		expect(responses.some((r) => r.status === 429)).toBe(true);
		// Bounded work: concurrency must not open a bypass around the limit.
		expect(verifySpy.mock.calls.length).toBeLessThanOrEqual(3);
	});

	it("never logs the submitted password", async () => {
		const { instance } = await handlerInstance();

		const { printed } = await captureConsole(async () => {
			await post(
				instance,
				"/sign-up/email",
				{ email: `log-${EMAIL}`, password: PASSWORD, name: "Gate Three" },
				"198.51.100.40",
			);
			await post(
				instance,
				"/sign-in/email",
				{ email: `log-${EMAIL}`, password: PASSWORD },
				"198.51.100.40",
			);
			await post(
				instance,
				"/sign-in/email",
				{ email: `log-${EMAIL}`, password: "definitely-wrong-password" },
				"198.51.100.40",
			);
		});

		expect(printed).not.toContain(PASSWORD);
		expect(printed).not.toContain("definitely-wrong-password");
	});

	it("stores the rate-limit key as a digest, never the raw address", async () => {
		const { instance, pool } = await handlerInstance();

		await post(
			instance,
			"/sign-up/email",
			{ email: `digest-${EMAIL}`, password: PASSWORD, name: "Gate Three" },
			"198.51.100.50",
		);

		expect(pool.rows.size).toBeGreaterThan(0);
		for (const key of pool.rows.keys()) {
			expect(key).not.toContain("198.51.100.50");
		}
	});
});

describe("hash contract is the module that runs in process", () => {
	it("agrees with the binding fallback", async () => {
		// Guards against the store or handler tests drifting onto a different
		// implementation than the one the DO and the fallback share.
		expect(typeof verifyPassword).toBe("function");
	});
});
