import { type AuthPool, createAuthPool } from "#/server/auth-database";

/**
 * WP-E — the pool used to read Better Auth identity data (a member's email)
 * for the workspace directory.
 *
 * The `better_auth` schema is deliberately not exposed through PostgREST
 * (migration `20260817012325_phase_a9_better_auth_schema.sql` revokes it from
 * anon/authenticated/service_role), so the directory read is the one place
 * that needs the server's own Postgres connection. This is the same
 * `createAuthPool` lifecycle `#/lib/auth` already owns: on Workers it holds no
 * socket between invocations (each query opens and closes its own connection),
 * and on the Node host one long-lived pool is the correct, cheaper choice.
 * The pool is created lazily so importing this module needs no `DATABASE_URL`.
 */
let directoryPool: AuthPool | null = null;

export function getMemberDirectoryPool(): AuthPool {
	if (directoryPool) return directoryPool;
	const url = process.env.DATABASE_URL;
	if (!url) {
		throw new Error("DATABASE_URL is required for the member directory.");
	}
	directoryPool = createAuthPool(url);
	return directoryPool;
}
