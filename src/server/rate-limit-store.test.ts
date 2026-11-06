import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
	createRateLimitStore,
	SHARED_RATE_LIMIT_CUSTOM_RULES,
	sharedRateLimitWindow,
} from "./rate-limit-store";

/**
 * The rate-limit store exists to make the login limit hold across Worker
 * isolates, because Better Auth's default store is a per-isolate `Map`. These
 * tests pin the properties that decide whether it actually works:
 *
 *   - credentialed paths go to the database and session reads do not;
 *   - the increment is a **single** statement (`on conflict`), because a read
 *     then a write lets concurrent requests all read the same count and pass;
 *   - the window the store resets on matches the window Better Auth enforces;
 *   - a store failure never breaks sign-in.
 */

const SECRET = "test-secret-at-least-32-characters-long";
const DIGEST = (key: string) =>
	createHmac("sha256", SECRET).update(key).digest("hex");

type Call = { text: string; values: unknown[] };

function stubPool(options: { rows?: unknown[]; fail?: boolean } = {}) {
	const calls: Call[] = [];

	return {
		calls,
		pool: {
			query: async (text: string, values?: unknown[]) => {
				calls.push({ text, values: values ?? [] });
				if (options.fail) throw new Error("probe: connection refused");
				return { rows: options.rows ?? [] };
			},
		},
	};
}

/**
 * Emulates the reserve statement, including the reset rule, so the counter
 * behaviour can be asserted without a Postgres server.
 */
function reservingPool() {
	const rows = new Map<string, { count: number; lastRequest: number }>();
	const calls: Call[] = [];

	return {
		rows,
		calls,
		pool: {
			query: async (text: string, values: unknown[] = []) => {
				calls.push({ text, values });

				if (!text.startsWith("insert")) return { rows: [] };

				const [key, nowMs, windowMs] = values as [string, number, number];
				const previous = rows.get(key);
				const count =
					!previous || previous.lastRequest < nowMs - windowMs
						? 0
						: previous.count + 1;

				rows.set(key, { count, lastRequest: nowMs });
				return { rows: [{ count, lastRequest: nowMs }] };
			},
		},
	};
}

describe("rate limit store", () => {
	it("keeps session reads out of the database entirely", async () => {
		const { calls, pool } = stubPool();
		const store = createRateLimitStore({ pool, secret: SECRET });

		// The key format Better Auth builds: ip + path.
		const key = "203.0.113.7/get-session";

		expect(await store.get(key)).toBeUndefined();
		await store.set(key, { key, count: 1, lastRequest: 1_700_000_000_000 });

		// Zero statements: this is the guarantee that no page load gains a query.
		expect(calls).toHaveLength(0);

		// The in-isolate store still holds it, matching Better Auth's default.
		expect(await store.get(key)).toEqual({
			key,
			count: 1,
			lastRequest: 1_700_000_000_000,
		});
	});

	it("reserves a credentialed request in one atomic statement", async () => {
		const { calls, pool } = stubPool({ rows: [{ count: 0, lastRequest: 42 }] });
		// Disable the 2% opportunistic sweep so the assertion sees exactly one
		// statement; the sweep itself is covered separately below.
		const store = createRateLimitStore({
			pool,
			secret: SECRET,
			random: () => 1,
		});
		const key = "203.0.113.7/sign-in/email";

		await store.get(key);

		// Exactly one statement, and it is the upsert that both reads and writes.
		expect(calls).toHaveLength(1);
		expect(calls[0].text).toContain('better_auth."rateLimit"');
		expect(calls[0].text).toContain("on conflict");
		expect(calls[0].text).toContain('returning "count"');

		// The raw address must never reach the table.
		expect(calls[0].values[0]).toBe(DIGEST(key));
		expect(JSON.stringify(calls[0].values)).not.toContain("203.0.113.7");
	});

	it("does not write a second time on set, which would double count", async () => {
		const { calls, pool } = stubPool();
		const store = createRateLimitStore({ pool, secret: SECRET });

		await store.set("203.0.113.7/sign-in/email", {
			key: "203.0.113.7/sign-in/email",
			count: 1,
			lastRequest: 1,
		});

		expect(calls).toHaveLength(0);
	});

	it("allows exactly `max` attempts, then reports the limit", async () => {
		const { pool } = reservingPool();
		const store = createRateLimitStore({
			pool,
			secret: SECRET,
			now: () => 1_700_000_000_000,
		});
		const max = SHARED_RATE_LIMIT_CUSTOM_RULES["/sign-in/email"].max;

		const counts: number[] = [];
		for (let attempt = 0; attempt < max + 2; attempt++) {
			const entry = await store.get("203.0.113.7/sign-in/email");
			counts.push(entry?.count ?? -1);
		}

		// The stored count is "attempts allowed before this one", so `max` allows
		// exactly `max` requests and the (max + 1)th sees count === max.
		expect(counts.slice(0, max)).toEqual([0, 1, 2]);
		expect(counts[max]).toBe(max);
	});

	it("resets the counter once the window has passed", async () => {
		let clock = 1_700_000_000_000;
		const { pool } = reservingPool();
		const store = createRateLimitStore({
			pool,
			secret: SECRET,
			now: () => clock,
		});

		await store.get("203.0.113.7/sign-in/email");
		await store.get("203.0.113.7/sign-in/email");
		expect((await store.get("203.0.113.7/sign-in/email"))?.count).toBe(2);

		// Past the 10 s sign-in window.
		clock += 11_000;

		expect((await store.get("203.0.113.7/sign-in/email"))?.count).toBe(0);
	});

	it("resets on the rule's own window, not a default", async () => {
		const { calls, pool } = stubPool({ rows: [] });
		const store = createRateLimitStore({ pool, secret: SECRET });

		await store.get("203.0.113.7/forget-password");

		// One hour, so a five-email reset budget is not refreshed every 10 s.
		expect(calls[0].values[2]).toBe(3600 * 1000);
		expect(sharedRateLimitWindow("203.0.113.7/forget-password")).toBe(3600);
		expect(sharedRateLimitWindow("203.0.113.7/sign-in/email")).toBe(10);
		expect(sharedRateLimitWindow("203.0.113.7/get-session")).toBe(10);
	});

	it("reads a credentialed entry back and coerces driver strings to numbers", async () => {
		// `pg` returns int8 (bigint) as a string; the limiter needs a number.
		const { pool } = stubPool({
			rows: [{ count: "3", lastRequest: "1700000000000" }],
		});
		const store = createRateLimitStore({ pool, secret: SECRET });

		expect(await store.get("203.0.113.7/sign-in/email")).toEqual({
			key: "203.0.113.7/sign-in/email",
			count: 3,
			lastRequest: 1_700_000_000_000,
		});
	});

	it("degrades to the in-isolate store when the database is unreachable", async () => {
		const onError = vi.fn();
		const { pool } = stubPool({ fail: true });
		const store = createRateLimitStore({ pool, secret: SECRET, onError });
		const key = "203.0.113.7/sign-in/email";

		// First read has nothing local to fall back on, and must not throw:
		// throwing here would reject the auth request and lock every user out.
		await expect(store.get(key)).resolves.toBeUndefined();

		// The limiter then writes back through `set`, and the limit keeps working
		// from the local store. Reporting "no data" instead would let every attempt
		// through while the database is down.
		await store.set(key, { key, count: 2, lastRequest: 123 });
		await expect(store.get(key)).resolves.toEqual({
			key,
			count: 2,
			lastRequest: 123,
		});

		// Reported once, not once per request.
		expect(onError).toHaveBeenCalledTimes(1);
	});

	it("sweeps expired rows occasionally, not on every read", async () => {
		const { calls, pool } = stubPool({ rows: [{ count: 0, lastRequest: 42 }] });
		const store = createRateLimitStore({
			pool,
			secret: SECRET,
			now: () => 1_700_000_000_000,
			random: () => 0,
		});

		await store.get("203.0.113.7/sign-in/email");

		const sweep = calls.find((call) => call.text.startsWith("delete from"));
		expect(sweep).toBeDefined();
		// Retention window is 24h.
		expect(sweep?.values[0]).toBe(1_700_000_000_000 - 24 * 60 * 60 * 1000);

		const quiet = stubPool({ rows: [{ count: 0, lastRequest: 42 }] });
		const quietStore = createRateLimitStore({
			pool: quiet.pool,
			secret: SECRET,
			random: () => 0.99,
		});
		await quietStore.get("203.0.113.7/sign-in/email");
		expect(
			quiet.calls.some((call) => call.text.startsWith("delete from")),
		).toBe(false);
	});

	it("never lets a failing sweep fail the read", async () => {
		let sweepAttempted = false;
		const pool = {
			query: async (text: string) => {
				if (text.startsWith("delete from")) {
					sweepAttempted = true;
					throw new Error("probe: sweep failed");
				}
				return { rows: [{ count: 0, lastRequest: 1 }] };
			},
		};
		const store = createRateLimitStore({
			pool,
			secret: SECRET,
			random: () => 0,
			onError: () => undefined,
		});

		await expect(store.get("203.0.113.7/sign-up/email")).resolves.toEqual({
			key: "203.0.113.7/sign-up/email",
			count: 0,
			lastRequest: 1,
		});
		expect(sweepAttempted).toBe(true);
	});
});
