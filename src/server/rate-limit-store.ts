import { createHmac } from "node:crypto";
import type { RateLimit } from "better-auth";

/**
 * A Better Auth rate-limit store that holds across Worker isolates.
 *
 * Better Auth's default store is **per isolate**: with no `secondaryStorage`
 * configured its storage resolves to a module level `Map`
 * (`better-auth/dist/context/create-context.mjs:137`). On Cloudflare Workers that
 * map is not shared between isolates, so it cannot gate a login flood. The
 * consequences are specific here, not theoretical:
 *
 *   - Each password attempt costs one Durable Object request. A flood would spend
 *     the shared 100,000/day allowance and then stop sign-in for everyone.
 *   - The in-process scrypt fallback would burn the 10 ms Worker CPU budget on
 *     every attempt.
 *
 * Three deliberate properties:
 *
 *   1. **Only credentialed paths use the database.** A session read
 *      (`get-session`) currently issues zero statements; putting rate limiting
 *      in front of it would add a query to every page load for a threat that
 *      does not exist (session tokens are high entropy). Those paths keep an
 *      in-isolate map, which is exactly Better Auth's own default behaviour.
 *   2. **Degrade, never fail open to "no limit".** If the database is
 *      unavailable (including the table not yet migrated), the store falls back
 *      to its own in-isolate map for that request — exactly Better Auth's default
 *      store. A database blip therefore weakens the shared guarantee but never
 *      removes the limit, and can never lock a user out.
 *   3. **The reservation is atomic.** Better Auth's limiter does a read
 *      (`get`) then a write (`set`); done as two statements, concurrent requests
 *      all read the same stale count and every one of them is allowed, which is
 *      precisely the flood the store exists to stop (proven by
 *      `auth-hardening.test.ts`). So `get` performs the whole
 *      increment-or-reset in a single Postgres statement and returns the result,
 *      and `set` is a no-op against the database. The counter is only ever
 *      advanced by the database, never by a value computed in application code.
 */

/**
 * What Better Auth reads back from the store. Aliased to Better Auth's own
 * `RateLimit` type so the shape cannot drift from what the rate limiter expects.
 */
export type RateLimitEntry = RateLimit;

export type RateLimitStore = {
	get: (key: string) => Promise<RateLimitEntry | undefined>;
	set: (key: string, value: RateLimitEntry, update?: boolean) => Promise<void>;
};

/**
 * The subset of the auth pool this module needs, so tests can pass a stub.
 * `rows` is optional to match `pg`'s `QueryResult`, which is what the auth pool
 * hands back.
 */
export type RateLimitQueryable = {
	query: (text: string, values?: unknown[]) => Promise<{ rows?: unknown[] }>;
};

/**
 * The credentialed paths and the window, in seconds, their limit counts over.
 *
 * This is the single source of truth for both half of the design: which paths
 * reach the database at all, and how long the database keeps counting before it
 * resets. The reset has to use the same window Better Auth compares against, or
 * a path like `/forget-password` (one hour) would be reset after ten seconds and
 * its email-sending limit would be meaningless.
 *
 * Matched as substrings of the store key, which Better Auth builds as
 * `ip + path` (`rate-limiter/index.mjs:100`). A leading slash cannot appear in
 * an IP address, so a crafted client address cannot forge a match. Every path
 * here either hashes a password or sends an email.
 */
export const SHARED_RATE_LIMIT_PATHS: ReadonlyArray<{
	match: string;
	window: number;
}> = [
	{ match: "/sign-in", window: 10 },
	{ match: "/sign-up", window: 10 },
	{ match: "/change-password", window: 10 },
	{ match: "/set-password", window: 10 },
	{ match: "/change-email", window: 10 },
	{ match: "/verify-email", window: 10 },
	{ match: "/email-otp", window: 10 },
	{ match: "/delete-user", window: 10 },
	// Email-sending paths: a far longer window, matching the credentials that
	// would otherwise let a reset-email flood through.
	{ match: "/send-verification-email", window: 3600 },
	{ match: "/forget-password", window: 3600 },
	{ match: "/reset-password", window: 3600 },
];

/** The default window Better Auth uses when no rule matches. */
const DEFAULT_WINDOW_SECONDS = 10;

/**
 * The rules handed to Better Auth so the limit it reports and the limit the
 * store enforces are the same number. Kept beside {@link SHARED_RATE_LIMIT_PATHS}
 * so the two cannot drift.
 */
export const SHARED_RATE_LIMIT_CUSTOM_RULES: Record<
	string,
	{ window: number; max: number }
> = {
	// The built-in credentials budget (3 attempts per 10 s per IP and path),
	// pinned explicitly so it is reviewable rather than implicit.
	"/sign-in/email": { window: 10, max: 3 },
	"/sign-up/email": { window: 10, max: 3 },
	// Password reset is not covered by the strict built-in rule (it would
	// otherwise allow 100 per 10 s) and each call can send an email.
	"/forget-password*": { window: 3600, max: 5 },
	"/reset-password*": { window: 3600, max: 5 },
	// Every call can send an email, and sign-in resends automatically, so the
	// per-hour budget covers both the resend button and the automatic path.
	"/send-verification-email*": { window: 3600, max: 5 },
};

/** How long an untouched entry is kept before opportunistic cleanup removes it. */
const RETENTION_MS = 24 * 60 * 60 * 1000;

/** Probability that a shared-path read also sweeps expired rows. */
const CLEANUP_CHANCE = 0.02;

function isSharedPath(key: string): boolean {
	return SHARED_RATE_LIMIT_PATHS.some(({ match }) => key.includes(match));
}

/** Exposed for tests and for the store's own reset window. */
export function sharedRateLimitWindow(key: string): number {
	return (
		SHARED_RATE_LIMIT_PATHS.find(({ match }) => key.includes(match))?.window ??
		DEFAULT_WINDOW_SECONDS
	);
}

/**
 * One statement that both reserves a request and returns the count the limiter
 * should judge.
 *
 * The `0` on a fresh insert (rather than `1`) is deliberate: it makes the count
 * mean "requests allowed before this one", so a budget of `max` permits exactly
 * `max` attempts. A row whose last request fell outside the window resets to the
 * same `0`, which is what keeps a one-hour rule from locking a user out
 * permanently.
 *
 * `on conflict do update` runs under a row lock, so concurrent requests
 * serialise here and the counter cannot be lost — the property a two-statement
 * read then write cannot provide.
 */
const RESERVE_SQL = `insert into better_auth."rateLimit" as r ("key", "count", "lastRequest")
 values ($1, 0, $2::bigint)
 on conflict ("key") do update set
   "count" = case
     when r."lastRequest" < ($2::bigint - $3::bigint) then 0
     else r."count" + 1
   end,
   "lastRequest" = $2::bigint
 returning "count", "lastRequest"`;

const SWEEP_SQL =
	'delete from better_auth."rateLimit" where "lastRequest" < $1::bigint';

export function createRateLimitStore({
	pool,
	secret,
	now = Date.now,
	random = Math.random,
	onError = (error: unknown) =>
		console.error("Rate limit store unavailable", error),
}: {
	pool: RateLimitQueryable;
	secret: string;
	now?: () => number;
	random?: () => number;
	onError?: (error: unknown) => void;
}): RateLimitStore {
	/**
	 * The key contains the client address. Storing it raw would make this table
	 * an IP log, which is personal data we do not need. An HMAC is deterministic
	 * (so lookups still work) but not reversible, and the secret stops the small
	 * IPv4 space from being brute forced.
	 */
	const keyDigest = (key: string): string =>
		createHmac("sha256", secret).update(key).digest("hex");

	// In-isolate fallback, matching Better Auth's default store exactly.
	const local = new Map<string, RateLimitEntry>();

	let reportedFailure = false;

	const reportFailure = (error: unknown) => {
		if (reportedFailure) return;
		reportedFailure = true;
		onError(error);
	};

	return {
		async get(key) {
			if (!isSharedPath(key)) return local.get(key);

			let entry: RateLimitEntry | undefined;

			try {
				const result = await pool.query(RESERVE_SQL, [
					keyDigest(key),
					now(),
					sharedRateLimitWindow(key) * 1000,
				]);
				const row = result.rows?.[0] as
					| { count: number | string; lastRequest: number | string }
					| undefined;

				if (row) {
					// `lastRequest` arrives as a string when the driver returns bigint.
					entry = {
						key,
						count: Number(row.count),
						lastRequest: Number(row.lastRequest),
					};
					// Mirror the database value locally so a later outage still has a
					// recent count to fall back to.
					local.set(key, entry);
				}
			} catch (error) {
				reportFailure(error);
				// Degrade to the in-isolate store rather than reporting "no data".
				// Reporting no data would let a flood through entirely while the
				// database is unavailable.
				entry = local.get(key);
			}

			if (random() < CLEANUP_CHANCE) {
				// Bounded growth: expired rows are only ever revisited when their key
				// is seen again, so without this the table would grow with every
				// distinct address that ever attempted a sign-in. Cleanup must never
				// fail the request.
				await pool
					.query(SWEEP_SQL, [now() - RETENTION_MS])
					.catch(reportFailure);
			}

			return entry;
		},

		async set(key, value) {
			// Always the in-isolate store. For a shared path the counter was already
			// advanced atomically by the matching `get`; Better Auth writes back the
			// value it derived from that read, so persisting it to the database here
			// would double count, and a non-atomic write is what let concurrent
			// requests bypass the limit in the first place. Writing it locally keeps
			// the degraded (database-unavailable) path working.
			local.set(key, value);
		},
	};
}
