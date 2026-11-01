import { beforeEach, describe, expect, it, vi } from "vitest";

/* Regression tests for the Worker-safe auth pool.
 *
 * The production failure this guards against: a module-scope `pg.Pool` handed
 * the same connection to a later Worker invocation, whose socket the runtime had
 * already torn down, so the query never settled and Cloudflare answered 1101.
 * A test cannot reproduce a Worker runtime, but it can pin the two properties
 * that made the fix work:
 *
 *   1. connections are never shared between acquisitions unless the caller
 *      explicitly opened a request scope, and
 *   2. one request scope reuses a single connection and closes it exactly once.
 */

type FakeClient = {
	id: number;
	connect: ReturnType<typeof vi.fn>;
	query: ReturnType<typeof vi.fn>;
	end: ReturnType<typeof vi.fn>;
	release?: () => void;
};

const created: FakeClient[] = [];

class TestClient implements FakeClient {
	id = created.length + 1;
	connect = vi.fn(async () => undefined);
	query = vi.fn(async () => ({ rows: [], command: "SELECT" }));
	end = vi.fn(async () => undefined);
	release?: () => void;

	constructor() {
		created.push(this);
	}
}

type FakePool = {
	options: unknown;
	connect: ReturnType<typeof vi.fn>;
	query: ReturnType<typeof vi.fn>;
	end: ReturnType<typeof vi.fn>;
};

const pools: FakePool[] = [];

class TestPool implements FakePool {
	options: unknown;
	connect = vi.fn(async () => {
		const client = new TestClient();
		// `pg.PoolClient.release()` returns the client to the pool.
		client.release = vi.fn();
		return client;
	});
	query = vi.fn(async () => ({ rows: [], command: "SELECT" }));
	end = vi.fn(async () => undefined);

	constructor(options: unknown) {
		this.options = options;
		pools.push(this);
	}
}

vi.mock("pg", () => ({
	default: { Client: TestClient, Pool: TestPool },
}));

const { authDbMode, createAuthPool, withAuthConnection } = await import(
	"#/server/auth-database"
);

const CONNECTION_STRING = "postgres://test:test@localhost:5432/test";

beforeEach(() => {
	created.length = 0;
	pools.length = 0;
	vi.unstubAllEnvs();
});

describe("createAuthPool without a request scope", () => {
	it("hands out a fresh connection per acquisition", async () => {
		const pool = createAuthPool(CONNECTION_STRING);

		const first = await pool.connect();
		const second = await pool.connect();

		expect(first).not.toBe(second);
		expect(created).toHaveLength(2);
		// Each connection was really opened.
		expect(created[0]?.connect).toHaveBeenCalledTimes(1);
		expect(created[1]?.connect).toHaveBeenCalledTimes(1);
	});

	it("closes the connection when it is released", async () => {
		const pool = createAuthPool(CONNECTION_STRING);

		const client = await pool.connect();
		client.release();
		// `end()` is fire-and-forget; let the microtask queue drain.
		await Promise.resolve();
		await Promise.resolve();

		expect(created[0]?.end).toHaveBeenCalledTimes(1);
	});

	it("opens and releases around `pool.query`", async () => {
		const pool = createAuthPool(CONNECTION_STRING);

		await pool.query("select 1");
		await Promise.resolve();
		await Promise.resolve();

		expect(created).toHaveLength(1);
		expect(created[0]?.query).toHaveBeenCalledWith("select 1", undefined);
		expect(created[0]?.end).toHaveBeenCalledTimes(1);
	});
});

describe("withAuthConnection", () => {
	it("reuses one connection for every query in the request", async () => {
		const pool = createAuthPool(CONNECTION_STRING);

		await withAuthConnection(async () => {
			const first = await pool.connect();
			const second = await pool.connect();

			expect(first).toBe(second);
			expect(created).toHaveLength(1);
		});

		expect(created).toHaveLength(1);
		expect(created[0]?.end).toHaveBeenCalledTimes(1);
	});

	it("opens the connection once when queries start concurrently", async () => {
		const pool = createAuthPool(CONNECTION_STRING);

		await withAuthConnection(async () => {
			const clients = await Promise.all([
				pool.connect(),
				pool.connect(),
				pool.connect(),
			]);

			expect(new Set(clients).size).toBe(1);
			expect(created).toHaveLength(1);
		});
	});

	it("closes the connection even when the handler throws", async () => {
		const pool = createAuthPool(CONNECTION_STRING);

		await expect(
			withAuthConnection(async () => {
				await pool.connect();
				throw new Error("auth failed");
			}),
		).rejects.toThrow("auth failed");

		expect(created[0]?.end).toHaveBeenCalledTimes(1);
	});

	it("starts a new connection for the next request", async () => {
		const pool = createAuthPool(CONNECTION_STRING);

		await withAuthConnection(() => pool.connect());
		await withAuthConnection(() => pool.connect());

		expect(created).toHaveLength(2);
		expect(created[0]?.end).toHaveBeenCalledTimes(1);
		expect(created[1]?.end).toHaveBeenCalledTimes(1);
	});

	it("does not close the connection when a query releases it early", async () => {
		const pool = createAuthPool(CONNECTION_STRING);

		await withAuthConnection(async () => {
			const client = await pool.connect();
			client.release();
			await Promise.resolve();
			await Promise.resolve();

			// Releasing inside the request must not end the shared connection.
			expect(created[0]?.end).not.toHaveBeenCalled();

			await pool.query("select 2");
		});

		expect(created[0]?.end).toHaveBeenCalledTimes(1);
	});
});

describe("authDbMode", () => {
	it("defaults to the Worker-safe invocation mode", () => {
		expect(authDbMode()).toBe("invocation");
	});

	it("selects pool mode for AUTH_DB_MODE=pool, case and space insensitive", () => {
		vi.stubEnv("AUTH_DB_MODE", "  Pool ");
		expect(authDbMode()).toBe("pool");
	});

	it("fails safe on an unrecognised value", () => {
		vi.stubEnv("AUTH_DB_MODE", "pooled");
		expect(authDbMode()).toBe("invocation");
	});
});

describe("createAuthPool in pool mode (Node / VPS)", () => {
	it("creates one real pg.Pool and delegates acquisitions to it", async () => {
		vi.stubEnv("AUTH_DB_MODE", "pool");
		const pool = createAuthPool(CONNECTION_STRING);

		expect(pools).toHaveLength(1);
		expect(pools[0]?.options).toMatchObject({
			options: "-c search_path=better_auth",
			max: 10,
		});

		const first = await pool.connect();
		const second = await pool.connect();

		// The pool decides connection reuse; each acquisition is its own checkout.
		expect(pools[0]?.connect).toHaveBeenCalledTimes(2);
		expect(typeof first.release).toBe("function");
		expect(typeof second.release).toBe("function");
	});

	it("never ends pooled connections when the auth request finishes", async () => {
		vi.stubEnv("AUTH_DB_MODE", "pool");
		const pool = createAuthPool(CONNECTION_STRING);

		await withAuthConnection(() => pool.connect());

		// The pool owns the lifecycle: the wrapper must not close the client.
		expect(created[0]?.end).not.toHaveBeenCalled();
		expect(pools[0]?.end).not.toHaveBeenCalled();
	});

	it("does not open a bare client per request", async () => {
		vi.stubEnv("AUTH_DB_MODE", "pool");
		const pool = createAuthPool(CONNECTION_STRING);

		await pool.connect();
		await pool.connect();
		await pool.connect();

		// All acquisitions came from the pool, and the pool was built once.
		expect(pools).toHaveLength(1);
		expect(pools[0]?.connect).toHaveBeenCalledTimes(3);
	});
});
