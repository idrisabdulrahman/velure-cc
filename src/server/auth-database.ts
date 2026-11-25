import { AsyncLocalStorage } from "node:async_hooks";
import type { Client, QueryResult } from "pg";
import pg from "pg";

/**
 * A Worker-safe stand-in for `pg.Pool` used by Better Auth.
 *
 * `new pg.Pool(...)` keeps connections alive at module scope, which is correct
 * in Node but wrong in Cloudflare Workers. A Worker invocation owns its sockets:
 * when the response is returned the runtime cancels outstanding I/O, but the
 * module-scope pool still believes it owns an idle client. The next invocation
 * is handed that client, whose query never settles, and the runtime cancels the
 * request with "your Worker's code had hung and would never generate a response"
 * (HTTP 500, Cloudflare error 1101).
 *
 * Measured before this change on `POST /api/auth/sign-in/email`:
 * `500 200 500 200 500 500 200 200 500 200` — roughly every second request
 * failed, and failure took ~12 ms while success took ~1.2 s (a real round trip).
 * Reads never showed it because `GET /api/auth/get-session` without a cookie
 * never queries the database.
 *
 * The fix has two parts.
 *
 * 1. Connections never outlive the invocation that opened them, so there is no
 *    dead socket to hand to the next request.
 * 2. All queries belonging to one auth request share one connection
 *    (`withAuthConnection`), because a fresh connection costs ~0.6-0.9 s to
 *    Supabase's pooler — several per sign-in made login take 4-8 s.
 *
 * Kysely's Postgres driver only requires `pool.connect()` to resolve an object
 * with `query(sql, params)` and `release()`, plus `pool.end()` for teardown.
 *
 * The database is Supabase's transaction-mode pooler (port 6543), which expects
 * a logical connection per transaction anyway.
 *
 * ## Node / VPS hosts
 *
 * The invocation-scoped strategy is only needed because a Worker invocation
 * owns its sockets. On a long-lived Node process the opposite is true: keeping
 * connections open is correct and much faster. Measured on Node against
 * Supabase's EU pooler with the invocation strategy, every authenticated request
 * cost a fresh connection (~1.0-2.4 s); a real `pg.Pool` amortises that to a
 * pool checkout. Set `AUTH_DB_MODE=pool` on a Node host to opt in (see
 * `deploy/velure.env.example`). The default stays Worker-safe so an accidental
 * Cloudflare deployment cannot regress into error 1101.
 */
export type AuthPool = {
	connect: () => Promise<Client & { release: () => void }>;
	query: (text: string, values?: unknown[]) => Promise<QueryResult>;
	end: () => Promise<void>;
};

type AuthDbMode = "invocation" | "pool";

/**
 * Reads the deployment mode from `AUTH_DB_MODE`.
 *
 * Anything other than the exact value `pool` keeps the Worker-safe default, so
 * a typo fails safe rather than silently changing connection lifetime.
 */
export function authDbMode(): AuthDbMode {
	return process.env.AUTH_DB_MODE?.trim().toLowerCase() === "pool"
		? "pool"
		: "invocation";
}

type RequestScope = {
	client: Promise<Client> | null;
};

const requestScope = new AsyncLocalStorage<RequestScope>();

async function openClient(connectionString: string): Promise<Client> {
	const client = new pg.Client({
		connectionString,
		// `search_path` is per connection, so it is set on every client.
		options: "-c search_path=better_auth",
	});

	await client.connect();

	return client;
}

function scoped(
	client: Client,
	{ closeOnRelease }: { closeOnRelease: boolean },
): Client & { release: () => void } {
	return Object.assign(client, {
		release: () => {
			if (!closeOnRelease) return;
			void client.end().catch(() => undefined);
		},
	});
}

export function createAuthPool(connectionString: string): AuthPool {
	if (authDbMode() === "pool") {
		return createNodePool(connectionString);
	}

	const connect: AuthPool["connect"] = async () => {
		const scope = requestScope.getStore();

		// No surrounding `withAuthConnection` (tests, scripts, any future caller):
		// fall back to one connection per acquisition, which is always safe.
		if (!scope) {
			return scoped(await openClient(connectionString), {
				closeOnRelease: true,
			});
		}

		scope.client ??= openClient(connectionString);

		// `release` is a no-op: the connection is closed once, when the whole
		// request finishes, so later queries in the same request can reuse it.
		return scoped(await scope.client, { closeOnRelease: false });
	};

	return {
		connect,
		// Kysely only reaches for `pool.query` on paths we do not use, but it is
		// part of the `pg.Pool` shape and cheap to honour correctly.
		query: async (text: string, values?: unknown[]) => {
			const client = await connect();

			try {
				return await client.query(text, values as unknown[]);
			} finally {
				client.release();
			}
		},
		end: async () => undefined,
	};
}

/**
 * A real `pg.Pool` for long-lived Node hosts (VPS). `pg` keeps idle clients
 * open between requests and hands them back to the pool on `release()`, which is
 * both correct and far cheaper than reconnecting per request. The pool is created
 * once per process, at module scope, exactly as `pg` is designed to be used.
 *
 * `withAuthConnection` deliberately does not close these clients: the pool owns
 * their lifecycle, and `release()` returns them to it.
 */
function createNodePool(connectionString: string): AuthPool {
	const pool = new pg.Pool({
		connectionString,
		// `search_path` is per connection, so `pg` applies it to every client it
		// opens for this pool.
		options: "-c search_path=better_auth",
		max: 10,
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 10_000,
	});

	return {
		connect: () => pool.connect(),
		query: (text: string, values?: unknown[]) =>
			pool.query(text, values as unknown[]),
		end: () => pool.end(),
	};
}

/**
 * Runs one auth request on a single database connection and closes it
 * afterwards. Every `auth.handler` call site must be wrapped: without the
 * wrapper the pool still behaves correctly, but pays a new connection per query.
 *
 * In `pool` mode this wrapper only exists for call-site symmetry: the pooled
 * clients are returned to `pg.Pool`, never ended here.
 */
export async function withAuthConnection<T>(
	handler: () => Promise<T>,
): Promise<T> {
	const scope: RequestScope = { client: null };

	try {
		return await requestScope.run(scope, handler);
	} finally {
		const pending = scope.client;
		scope.client = null;

		if (pending) {
			const client = await pending.catch(() => null);
			await client?.end().catch(() => undefined);
		}
	}
}
