import { describe, expect, it, vi } from "vitest";
import type { AuthPool } from "#/server/auth-database";
import {
	ACCOUNT_DELETION_STATEMENTS,
	accountDeletionConfig,
	deleteAccountData,
} from "./account-deletion";

const USER_ID = "usr_account_deletion_test";

type Recorded = { sql: string; values?: unknown[] };

function fakePool(options: { failOn?: string } = {}) {
	const queries: Recorded[] = [];
	let released = false;

	const query = vi.fn(async (sql: string, values?: unknown[]) => {
		queries.push({ sql, values });
		if (options.failOn && sql.includes(`public.${options.failOn} `)) {
			throw new Error(`boom: ${options.failOn}`);
		}
		return { rowCount: 2 };
	});

	const pool = {
		connect: async () => ({
			query,
			release: () => {
				released = true;
			},
		}),
		query: async () => ({ rowCount: 0 }),
		end: async () => undefined,
	} as unknown as AuthPool;

	return { pool, queries, isReleased: () => released };
}

describe("deleteAccountData", () => {
	it("runs every statement inside one transaction, bound to the verified user id", async () => {
		const { pool, queries } = fakePool();

		const deleted = await deleteAccountData(pool, USER_ID, () => undefined);

		expect(queries[0]).toEqual({ sql: "begin", values: undefined });
		expect(queries.at(-1)).toEqual({ sql: "commit", values: undefined });

		const body = queries.slice(1, -1);
		expect(body.map((q) => q.sql)).toEqual(
			ACCOUNT_DELETION_STATEMENTS.map((s) => s.sql),
		);
		for (const q of body) {
			expect(q.values).toEqual([USER_ID]);
		}

		// Workspaces go first so their FK cascade removes the bulk of the data.
		expect(body[0]?.sql).toContain("public.workspaces");
		expect(body[0]?.sql).toContain("owner_id = $1");

		expect(deleted).toEqual(
			Object.fromEntries(ACCOUNT_DELETION_STATEMENTS.map((s) => [s.table, 2])),
		);
	});

	it("rolls the whole deletion back when a statement fails, and rethrows", async () => {
		const { pool, queries } = fakePool({ failOn: "tax_profiles" });

		await expect(
			deleteAccountData(pool, USER_ID, () => undefined),
		).rejects.toThrow("boom: tax_profiles");

		const sqls = queries.map((q) => q.sql);
		expect(sqls).toContain("rollback");
		expect(sqls).not.toContain("commit");
	});

	it("releases the connection on every path", async () => {
		const ok = fakePool();
		await deleteAccountData(ok.pool, USER_ID, () => undefined);
		expect(ok.isReleased()).toBe(true);

		const failed = fakePool({ failOn: "clients" });
		await expect(
			deleteAccountData(failed.pool, USER_ID, () => undefined),
		).rejects.toThrow();
		expect(failed.isReleased()).toBe(true);
	});
});

describe("accountDeletionConfig", () => {
	it("enables the Better Auth delete-user endpoint", () => {
		const { pool } = fakePool();
		expect(accountDeletionConfig(pool).enabled).toBe(true);
	});

	it("runs the cascade for the deleted user before the identity is removed", async () => {
		const { pool, queries } = fakePool();
		const config = accountDeletionConfig(pool);

		await config.beforeDelete({ id: USER_ID });

		const scoped = queries.filter((q) => q.values?.[0] === USER_ID);
		expect(scoped.length).toBe(ACCOUNT_DELETION_STATEMENTS.length);
	});
});
